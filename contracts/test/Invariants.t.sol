// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {PrepaidEscrow} from "../src/PrepaidEscrow.sol";
import {TestCNY} from "../src/TestCNY.sol";
import {EscrowHandler} from "./handlers/EscrowHandler.sol";

/// Handler-based invariants (PRD_PrepaidEscrow_Contract §4.5, §8.3).
contract EscrowInvariants is Test {
    PrepaidEscrow internal escrow;
    TestCNY internal token;
    EscrowHandler internal handler;
    address internal agent;

    function setUp() public {
        vm.warp(1_790_000_000);
        uint256 oracleKey = 0x0AC1E;
        agent = vm.addr(0xA9E7);
        token = new TestCNY(address(this));
        escrow = new PrepaidEscrow(token, vm.addr(oracleKey));
        handler = new EscrowHandler(escrow, token, oracleKey, agent);
        token.transferOwnership(address(handler)); // the handler mints for buyers

        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = EscrowHandler.buy.selector;
        selectors[1] = EscrowHandler.redeem.selector;
        selectors[2] = EscrowHandler.exitAttested.selector;
        selectors[3] = EscrowHandler.exitVoluntary.selector;
        selectors[4] = EscrowHandler.attackForgedExit.selector;
        selectors[5] = EscrowHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    /// #1: the escrow holds exactly the unused balance of Active plans.
    function invariant_balanceEqualsActiveRemaining() public view {
        uint256 sum;
        for (uint256 i = 0; i < handler.planCount(); i++) {
            sum += escrow.remaining(handler.planIds(i));
        }
        assertEq(token.balanceOf(address(escrow)), sum);
        assertEq(token.balanceOf(address(escrow)), handler.ghostDeposited() - handler.ghostPaidOut());
    }

    /// #2: money only ever leaves to the plans' consumers and merchants: every minted token is
    /// either in the escrow or with a consumer or merchant; the agent and the handler hold none.
    function invariant_outflowsOnlyToConsumersAndMerchants() public view {
        uint256 held = token.balanceOf(address(escrow));
        for (uint256 i = 0; i < handler.partiesLength(); i++) {
            held += token.balanceOf(handler.parties(i));
        }
        assertEq(held, handler.ghostMinted());
        assertEq(token.balanceOf(agent), 0);
        assertEq(token.balanceOf(address(handler)), 0);
        assertEq(token.totalSupply(), handler.ghostMinted());
    }

    /// #3 and #4: redeemed ≤ units, Completed iff fully redeemed, status never goes back to
    /// Active, and the terms never change.
    function invariant_planStateIsMonotonicAndTermsFixed() public view {
        for (uint256 i = 0; i < handler.planCount(); i++) {
            uint256 id = handler.planIds(i);
            PrepaidEscrow.Plan memory pl = escrow.getPlan(id);
            (address c, address m, address ag, uint128 price, uint32 units,, uint16 fee,) = handler.termsAtPurchase(id);
            assertEq(pl.consumer, c);
            assertEq(pl.merchant, m);
            assertEq(pl.agent, ag);
            assertEq(pl.unitPrice, price);
            assertEq(pl.units, units);
            assertEq(pl.cancelFeeBps, fee);

            assertLe(pl.redeemed, pl.units);
            assertEq(pl.status == PrepaidEscrow.Status.Completed, pl.redeemed == pl.units);
            assertTrue(pl.status != PrepaidEscrow.Status.None);
            // The handler records each change it makes; any other change (e.g. back to Active) fails.
            assertEq(uint8(pl.status), uint8(handler.lastStatus(id)));
        }
    }
}
