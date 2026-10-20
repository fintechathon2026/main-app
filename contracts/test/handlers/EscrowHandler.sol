// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {PrepaidEscrow} from "../../src/PrepaidEscrow.sol";
import {TestCNY} from "../../src/TestCNY.sol";

/// Drives the escrow with random but well-signed actions across several consumers and
/// merchants, and keeps ghost records for the invariants (PRD_PrepaidEscrow_Contract §8.3).
contract EscrowHandler is Test {
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    PrepaidEscrow public escrow;
    TestCNY public token;
    uint256 internal oracleKey;
    address public agent;

    uint256[] public consumerKeys;
    uint256[] public merchantKeys;
    address[] public parties; // every consumer and merchant

    uint256[] public planIds;
    /// Terms captured at purchase, to check they never change.
    mapping(uint256 => PrepaidEscrow.Plan) public termsAtPurchase;
    /// Status after the handler last changed the plan; terminal statuses are never rewritten.
    mapping(uint256 => PrepaidEscrow.Status) public lastStatus;

    uint256 public ghostDeposited;
    uint256 public ghostPaidOut;
    uint256 public ghostMinted;
    uint256 internal nonce;

    constructor(PrepaidEscrow escrow_, TestCNY token_, uint256 oracleKey_, address agent_) {
        escrow = escrow_;
        token = token_;
        oracleKey = oracleKey_;
        agent = agent_;
        for (uint256 i = 0; i < 3; i++) {
            consumerKeys.push(0xC000 + i);
            merchantKeys.push(0x3000 + i);
            parties.push(vm.addr(0xC000 + i));
            parties.push(vm.addr(0x3000 + i));
        }
    }

    function partiesLength() external view returns (uint256) {
        return parties.length;
    }

    function planCount() external view returns (uint256) {
        return planIds.length;
    }

    function _sig(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    // ---- Actions ------------------------------------------------------------------------------

    function buy(uint256 cSeed, uint256 mSeed, uint128 price, uint32 units, uint16 fee, bool withAgent) external {
        uint256 cKey = consumerKeys[cSeed % consumerKeys.length];
        uint256 mKey = merchantKeys[mSeed % merchantKeys.length];
        price = uint128(bound(price, 1, 100_000));
        units = uint32(bound(units, 1, 20));
        fee = uint16(bound(fee, 0, 2000));
        uint256 total = uint256(price) * units;
        token.mint(vm.addr(cKey), total);
        ghostMinted += total;

        PrepaidEscrow.Offer memory o =
            PrepaidEscrow.Offer(vm.addr(mKey), price, units, fee, uint64(block.timestamp + 1 days), ++nonce);
        uint256 planId = _purchase(cKey, mKey, o, withAgent ? agent : address(0), total);
        planIds.push(planId);
        termsAtPurchase[planId] = escrow.getPlan(planId);
        lastStatus[planId] = PrepaidEscrow.Status.Active;
        ghostDeposited += total;
    }

    function _purchase(uint256 cKey, uint256 mKey, PrepaidEscrow.Offer memory o, address ag, uint256 total)
        internal
        returns (uint256)
    {
        PrepaidEscrow.PurchaseAuth memory a =
            PrepaidEscrow.PurchaseAuth(escrow.hashOffer(o), vm.addr(cKey), ag, uint64(block.timestamp + 1 hours));
        bytes memory ms = _sig(mKey, escrow.hashOffer(o));
        bytes memory cs = _sig(cKey, escrow.hashPurchaseAuth(a));
        return escrow.purchaseWithPermit(o, ms, a, cs, _permit(cKey, total));
    }

    function _permit(uint256 cKey, uint256 total) internal view returns (PrepaidEscrow.Permit memory) {
        address c = vm.addr(cKey);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                token.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(PERMIT_TYPEHASH, c, address(escrow), total, token.nonces(c), deadline))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(cKey, digest);
        return PrepaidEscrow.Permit(total, deadline, v, r, s);
    }

    function redeem(uint256 planSeed, uint8 times) external {
        if (planIds.length == 0) return;
        uint256 planId = planIds[planSeed % planIds.length];
        times = uint8(bound(times, 1, 5));
        for (uint8 i = 0; i < times; i++) {
            PrepaidEscrow.Plan memory pl = escrow.getPlan(planId);
            if (pl.status != PrepaidEscrow.Status.Active) return;
            uint32 sessionNo = pl.redeemed + 1;
            uint64 deadline = uint64(block.timestamp + 10 minutes);
            bytes32 d = escrow.hashRedeem(planId, sessionNo, deadline);
            escrow.redeem(planId, sessionNo, deadline, _sig(_keyOf(pl.consumer, consumerKeys), d), _sig(_keyOf(pl.merchant, merchantKeys), d));
            ghostPaidOut += pl.unitPrice;
            lastStatus[planId] = escrow.getPlan(planId).status;
        }
    }

    function exitAttested(uint256 planSeed, bool byAgent) external {
        if (planIds.length == 0) return;
        uint256 planId = planIds[planSeed % planIds.length];
        PrepaidEscrow.Plan memory pl = escrow.getPlan(planId);
        if (pl.status != PrepaidEscrow.Status.Active) return;
        PrepaidEscrow.Attestation memory att = PrepaidEscrow.Attestation(
            pl.merchant, 1, keccak256(abi.encode(planId)), uint64(block.timestamp), uint64(block.timestamp + 7 days)
        );
        bytes memory sig = _sig(oracleKey, escrow.hashAttestation(att));
        uint256 refund = uint256(pl.unitPrice) * (pl.units - pl.redeemed);
        vm.prank(byAgent && pl.agent != address(0) ? pl.agent : pl.consumer);
        escrow.exitWithAttestation(planId, att, sig);
        ghostPaidOut += refund;
        lastStatus[planId] = PrepaidEscrow.Status.ExitedAttested;
    }

    function exitVoluntary(uint256 planSeed) external {
        if (planIds.length == 0) return;
        uint256 planId = planIds[planSeed % planIds.length];
        PrepaidEscrow.Plan memory pl = escrow.getPlan(planId);
        if (pl.status != PrepaidEscrow.Status.Active) return;
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        bytes memory sig = _sig(_keyOf(pl.consumer, consumerKeys), escrow.hashVoluntaryExit(planId, deadline));
        escrow.exitVoluntaryBySig(planId, deadline, sig);
        ghostPaidOut += uint256(pl.unitPrice) * (pl.units - pl.redeemed);
        lastStatus[planId] = PrepaidEscrow.Status.ExitedVoluntary;
    }

    /// Attacks that must always fail; a success would break the invariants on the next check.
    function attackForgedExit(uint256 planSeed, uint256 attackerKey) external {
        if (planIds.length == 0) return;
        uint256 planId = planIds[planSeed % planIds.length];
        attackerKey = bound(attackerKey, 1, 1e30);
        if (attackerKey == oracleKey) return;
        PrepaidEscrow.Plan memory pl = escrow.getPlan(planId);
        PrepaidEscrow.Attestation memory att =
            PrepaidEscrow.Attestation(pl.merchant, 1, bytes32(0), uint64(block.timestamp), uint64(block.timestamp + 1 days));
        bytes memory sig = _sig(attackerKey, escrow.hashAttestation(att));
        vm.prank(pl.agent == address(0) ? pl.consumer : pl.agent);
        try escrow.exitWithAttestation(planId, att, sig) {
            revert("forged attestation accepted");
        } catch {}
    }

    function warp(uint32 secondsAhead) external {
        vm.warp(block.timestamp + bound(secondsAhead, 1, 3 days));
    }

    function _keyOf(address who, uint256[] storage keys) internal view returns (uint256) {
        for (uint256 i = 0; i < keys.length; i++) {
            if (vm.addr(keys[i]) == who) return keys[i];
        }
        revert("unknown party");
    }
}
