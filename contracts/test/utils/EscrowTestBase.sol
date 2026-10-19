// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {PrepaidEscrow} from "../../src/PrepaidEscrow.sol";
import {TestCNY} from "../../src/TestCNY.sol";

/// Shared fixture and EIP-712 signing helpers for the escrow tests. Keys are test-only.
abstract contract EscrowTestBase is Test {
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    TestCNY internal token;
    PrepaidEscrow internal escrow;

    uint256 internal oracleKey = 0x0AC1E;
    uint256 internal consumerKey = 0xC0FFEE;
    uint256 internal merchantKey = 0xF17B0;
    uint256 internal agentKey = 0xA9E7;
    address internal oracle;
    address internal consumer;
    address internal merchant;
    address internal agent;
    address internal relayer = makeAddr("relayer");

    // FitBox Futian: 60 sessions at ¥100 (10,000 fen), 10% cancel fee (PRD §15.11).
    uint128 internal constant UNIT_PRICE = 10_000;
    uint32 internal constant UNITS = 60;
    uint16 internal constant FEE_BPS = 1000;

    uint256 private _nonce;

    function setUp() public virtual {
        vm.warp(1_790_000_000);
        oracle = vm.addr(oracleKey);
        consumer = vm.addr(consumerKey);
        merchant = vm.addr(merchantKey);
        agent = vm.addr(agentKey);
        token = new TestCNY(address(this));
        escrow = new PrepaidEscrow(token, oracle);
        token.mint(consumer, 1_000_000_00); // ¥1,000,000
    }

    // ---- Signatures ---------------------------------------------------------------------------

    function _sig(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _offer(address m, uint128 price, uint32 units, uint16 fee) internal returns (PrepaidEscrow.Offer memory) {
        return PrepaidEscrow.Offer(m, price, units, fee, uint64(block.timestamp + 30 days), ++_nonce);
    }

    function _offer() internal returns (PrepaidEscrow.Offer memory) {
        return _offer(merchant, UNIT_PRICE, UNITS, FEE_BPS);
    }

    function _auth(PrepaidEscrow.Offer memory o, address c, address ag) internal view returns (PrepaidEscrow.PurchaseAuth memory) {
        return PrepaidEscrow.PurchaseAuth(escrow.hashOffer(o), c, ag, uint64(block.timestamp + 1 hours));
    }

    function _permit(uint256 ownerKey, uint256 value) internal view returns (PrepaidEscrow.Permit memory p) {
        address owner = vm.addr(ownerKey);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, address(escrow), value, token.nonces(owner), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, digest);
        p = PrepaidEscrow.Permit(value, deadline, v, r, s);
    }

    /// Full purchase by `cKey` from merchant `mKey` with the given terms; returns the plan id.
    function _buy(uint256 cKey, uint256 mKey, uint128 price, uint32 units, uint16 fee, address ag) internal returns (uint256) {
        PrepaidEscrow.Offer memory o = _offer(vm.addr(mKey), price, units, fee);
        PrepaidEscrow.PurchaseAuth memory a = _auth(o, vm.addr(cKey), ag);
        PrepaidEscrow.Permit memory p = _permit(cKey, uint256(price) * units);
        vm.prank(relayer);
        return escrow.purchaseWithPermit(o, _sig(mKey, escrow.hashOffer(o)), a, _sig(cKey, escrow.hashPurchaseAuth(a)), p);
    }

    function _buy() internal returns (uint256) {
        return _buy(consumerKey, merchantKey, UNIT_PRICE, UNITS, FEE_BPS, agent);
    }

    function _redeem(uint256 planId, uint32 sessionNo) internal {
        _redeemAs(planId, sessionNo, consumerKey, merchantKey);
    }

    function _redeemAs(uint256 planId, uint32 sessionNo, uint256 cKey, uint256 mKey) internal {
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        bytes32 d = escrow.hashRedeem(planId, sessionNo, deadline);
        vm.prank(relayer);
        escrow.redeem(planId, sessionNo, deadline, _sig(cKey, d), _sig(mKey, d));
    }

    function _attestation(address m, uint8 kind) internal view returns (PrepaidEscrow.Attestation memory) {
        return PrepaidEscrow.Attestation(m, kind, keccak256("case:SZ-2026-0042"), uint64(block.timestamp), uint64(block.timestamp + 7 days));
    }

    function _signAtt(uint256 key, PrepaidEscrow.Attestation memory att) internal view returns (bytes memory) {
        return _sig(key, escrow.hashAttestation(att));
    }

    function _status(uint256 planId) internal view returns (PrepaidEscrow.Status) {
        return escrow.getPlan(planId).status;
    }
}
