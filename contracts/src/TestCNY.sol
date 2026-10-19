// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title TestCNY (tCNY)
/// @notice Valueless test token for the prepaid escrow demo (PRD_PrepaidEscrow_Contract §4.1).
///         2 decimals, so on-chain amounts are fen, like the prepaid_* database columns.
///         The owner is the demo faucet; the escrow never calls owner functions.
contract TestCNY is ERC20, ERC20Permit, Ownable {
    constructor(address owner_) ERC20("Test CNY (no value)", "tCNY") ERC20Permit("Test CNY (no value)") Ownable(owner_) {}

    function decimals() public pure override returns (uint8) {
        return 2;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
