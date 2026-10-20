// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PrepaidEscrow} from "../src/PrepaidEscrow.sol";
import {TestCNY} from "../src/TestCNY.sol";

/// Deploys TestCNY and PrepaidEscrow(token, oracle) and writes deployments/<chainId>.json
/// (PRD_PrepaidEscrow_Contract §9).
///
/// Env: DEPLOYER_PRIVATE_KEY, ORACLE_ADDRESS; optional TOKEN_MINTER_ADDRESS (tCNY owner, the
/// demo faucet; defaults to the deployer).
///
///   forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast
contract Deploy is Script {
    function run() external returns (TestCNY token, PrepaidEscrow escrow) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address oracle = vm.envAddress("ORACLE_ADDRESS");
        address minter = vm.envOr("TOKEN_MINTER_ADDRESS", vm.addr(deployerKey));
        uint256 deployBlock = block.number;

        vm.startBroadcast(deployerKey);
        token = new TestCNY(minter);
        escrow = new PrepaidEscrow(token, oracle);
        vm.stopBroadcast();

        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "token", address(token));
        vm.serializeAddress(key, "escrow", address(escrow));
        vm.serializeAddress(key, "oracle", oracle);
        vm.serializeAddress(key, "tokenMinter", minter);
        string memory json = vm.serializeUint(key, "deployBlock", deployBlock);
        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);

        console.log("TOKEN_ADDRESS=%s", address(token));
        console.log("ESCROW_ADDRESS=%s", address(escrow));
        console.log("CHAIN_START_BLOCK=%s", deployBlock);
        console.log("written: %s", path);
    }
}
