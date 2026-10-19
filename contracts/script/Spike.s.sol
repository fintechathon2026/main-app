// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PrepaidEscrow} from "../src/PrepaidEscrow.sol";
import {TestCNY} from "../src/TestCNY.sol";

/// The Day-1 spike (architecture §24.12, PRD_PrepaidEscrow_Contract §9): purchase, one
/// check-in and an attested exit against a deployed escrow, each from the key that does it in
/// production. The three hashes are in broadcast/Spike.s.sol/<chainId>/run-latest.json.
///
/// Env: TOKEN_MINTER_PRIVATE_KEY, RELAYER_PRIVATE_KEY, AGENT_PRIVATE_KEY,
/// MERCHANT_SIM_PRIVATE_KEY, ORACLE_PRIVATE_KEY, SPIKE_CONSUMER_PRIVATE_KEY (a throwaway test
/// consumer; never Lin's browser key). Addresses come from deployments/<chainId>.json.
///
///   forge script script/Spike.s.sol --rpc-url base_sepolia --broadcast
contract Spike is Script {
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    // A small package so the spike is cheap: 3 sessions × ¥100, fee 10%.
    uint128 internal constant UNIT_PRICE = 10_000;
    uint32 internal constant UNITS = 3;
    uint16 internal constant FEE_BPS = 1000;

    TestCNY internal token;
    PrepaidEscrow internal escrow;

    function run() external returns (uint256 planId) {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json"));
        token = TestCNY(vm.parseJsonAddress(json, ".token"));
        escrow = PrepaidEscrow(vm.parseJsonAddress(json, ".escrow"));

        Keys memory k = Keys(
            vm.envUint("SPIKE_CONSUMER_PRIVATE_KEY"),
            vm.envUint("MERCHANT_SIM_PRIVATE_KEY"),
            vm.envUint("ORACLE_PRIVATE_KEY"),
            vm.envUint("RELAYER_PRIVATE_KEY"),
            vm.envUint("AGENT_PRIVATE_KEY")
        );
        require(vm.addr(k.oracle) == escrow.oracle(), "ORACLE_PRIVATE_KEY is not the escrow's oracle");

        // 0. Load the test wallet (the demo faucet).
        uint256 total = uint256(UNIT_PRICE) * UNITS;
        if (token.balanceOf(vm.addr(k.consumer)) < total) {
            vm.broadcast(vm.envUint("TOKEN_MINTER_PRIVATE_KEY"));
            token.mint(vm.addr(k.consumer), total);
        }
        planId = _purchase(k, total);
        _redeem(k, planId);
        _exit(k, planId);

        console.log("plan %s: purchased, session 1 redeemed, exited with attestation", planId);
        console.log("consumer refund (fen): %s", uint256(UNIT_PRICE) * (UNITS - 1));
    }

    struct Keys {
        uint256 consumer;
        uint256 merchant;
        uint256 oracle;
        uint256 relayer;
        uint256 agent;
    }

    /// 1. Purchase: merchant-signed offer, consumer-signed auth and permit, relayer pays gas.
    function _purchase(Keys memory k, uint256 total) internal returns (uint256) {
        PrepaidEscrow.Offer memory o = PrepaidEscrow.Offer(
            vm.addr(k.merchant), UNIT_PRICE, UNITS, FEE_BPS, uint64(block.timestamp + 1 days), block.timestamp
        );
        PrepaidEscrow.PurchaseAuth memory a = PrepaidEscrow.PurchaseAuth(
            escrow.hashOffer(o), vm.addr(k.consumer), vm.addr(k.agent), uint64(block.timestamp + 1 hours)
        );
        bytes memory merchantSig = _sig(k.merchant, escrow.hashOffer(o));
        bytes memory consumerSig = _sig(k.consumer, escrow.hashPurchaseAuth(a));
        PrepaidEscrow.Permit memory p = _permit(k.consumer, total);
        vm.broadcast(k.relayer);
        return escrow.purchaseWithPermit(o, merchantSig, a, consumerSig, p);
    }

    /// 2. Check-in: session 1, both signatures, relayer pays gas.
    function _redeem(Keys memory k, uint256 planId) internal {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 d = escrow.hashRedeem(planId, 1, deadline);
        bytes memory cSig = _sig(k.consumer, d);
        bytes memory mSig = _sig(k.merchant, d);
        vm.broadcast(k.relayer);
        escrow.redeem(planId, 1, deadline, cSig, mSig);
    }

    /// 3. Attested exit: oracle-signed closure notice, sent by the agent key.
    function _exit(Keys memory k, uint256 planId) internal {
        PrepaidEscrow.Attestation memory att = PrepaidEscrow.Attestation(
            vm.addr(k.merchant), 2, keccak256(abi.encode("spike", planId)), uint64(block.timestamp - 60), uint64(block.timestamp + 7 days)
        );
        bytes memory oracleSig = _sig(k.oracle, escrow.hashAttestation(att));
        vm.broadcast(k.agent);
        escrow.exitWithAttestation(planId, att, oracleSig);
    }

    function _sig(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _permit(uint256 ownerKey, uint256 value) internal view returns (PrepaidEscrow.Permit memory) {
        address owner = vm.addr(ownerKey);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                token.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(PERMIT_TYPEHASH, owner, address(escrow), value, token.nonces(owner), deadline))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, digest);
        return PrepaidEscrow.Permit(value, deadline, v, r, s);
    }
}
