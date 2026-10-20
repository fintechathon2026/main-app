// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {PrepaidEscrow} from "../src/PrepaidEscrow.sol";
import {TestCNY} from "../src/TestCNY.sol";
import {EscrowTestBase} from "./utils/EscrowTestBase.sol";

/// Unit and fuzz tests: every money path's happy path and every revert
/// (PRD_PrepaidEscrow_Contract §8.1, §8.2).
contract PrepaidEscrowTest is EscrowTestBase {
    uint256 internal constant TOTAL = uint256(UNIT_PRICE) * UNITS;

    // ---- Constructor and token ------------------------------------------------------------------

    function test_constructor_rejectsZeroAddresses() public {
        vm.expectRevert(PrepaidEscrow.ZeroAddress.selector);
        new PrepaidEscrow(IERC20(address(0)), oracle);
        vm.expectRevert(PrepaidEscrow.ZeroAddress.selector);
        new PrepaidEscrow(token, address(0));
    }

    function test_constructor_setsImmutablesAndDomain() public view {
        assertEq(address(escrow.token()), address(token));
        assertEq(escrow.oracle(), oracle);
        assertEq(escrow.nextPlanId(), 1);
        (, string memory name, string memory version, uint256 chainId, address verifying,,) = escrow.eip712Domain();
        assertEq(name, "PrepaidEscrow");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(verifying, address(escrow));
    }

    function test_token_hasTwoDecimalsAndOwnerOnlyMint() public {
        assertEq(token.decimals(), 2);
        assertEq(token.symbol(), "tCNY");
        vm.prank(consumer);
        vm.expectRevert();
        token.mint(consumer, 1);
    }

    // ---- Purchase -------------------------------------------------------------------------------

    function test_purchase_createsPlanAndPullsFunds() public {
        uint256 before = token.balanceOf(consumer);
        PrepaidEscrow.Offer memory o = _offer();
        PrepaidEscrow.PurchaseAuth memory a = _auth(o, consumer, agent);
        bytes memory ms = _sig(merchantKey, escrow.hashOffer(o));
        bytes memory cs = _sig(consumerKey, escrow.hashPurchaseAuth(a));
        PrepaidEscrow.Permit memory p = _permit(consumerKey, TOTAL);

        vm.expectEmit(address(escrow));
        emit PrepaidEscrow.Purchased(1, consumer, merchant, agent, TOTAL);
        vm.prank(relayer);
        uint256 planId = escrow.purchaseWithPermit(o, ms, a, cs, p);

        assertEq(planId, 1);
        assertEq(escrow.nextPlanId(), 2);
        PrepaidEscrow.Plan memory pl = escrow.getPlan(planId);
        assertEq(pl.consumer, consumer);
        assertEq(pl.merchant, merchant);
        assertEq(pl.agent, agent);
        assertEq(pl.unitPrice, UNIT_PRICE);
        assertEq(pl.units, UNITS);
        assertEq(pl.redeemed, 0);
        assertEq(pl.cancelFeeBps, FEE_BPS);
        assertEq(uint8(pl.status), uint8(PrepaidEscrow.Status.Active));
        assertEq(token.balanceOf(address(escrow)), TOTAL);
        assertEq(token.balanceOf(consumer), before - TOTAL);
        assertEq(escrow.remaining(planId), TOTAL);
        assertTrue(escrow.authUsed(escrow.hashPurchaseAuth(a)));
    }

    function test_purchase_planIdsIncrement() public {
        assertEq(_buy(), 1);
        assertEq(_buy(), 2);
        assertEq(escrow.nextPlanId(), 3);
    }

    function test_purchase_revertsWhenOfferExpired() public {
        PrepaidEscrow.Offer memory o = _offer();
        o.expiresAt = uint64(block.timestamp - 1);
        _expectPurchaseRevert(o, _auth(o, consumer, agent), merchantKey, consumerKey, PrepaidEscrow.Expired.selector);
    }

    function test_purchase_revertsWhenAuthExpired() public {
        PrepaidEscrow.Offer memory o = _offer();
        PrepaidEscrow.PurchaseAuth memory a = _auth(o, consumer, agent);
        a.deadline = uint64(block.timestamp - 1);
        _expectPurchaseRevert(o, a, merchantKey, consumerKey, PrepaidEscrow.Expired.selector);
    }

    function test_purchase_revertsOnBadTerms() public {
        PrepaidEscrow.Offer memory o = _offer(merchant, UNIT_PRICE, 0, FEE_BPS);
        _expectPurchaseRevert(o, _auth(o, consumer, agent), merchantKey, consumerKey, PrepaidEscrow.BadTerms.selector);
        o = _offer(merchant, 0, UNITS, FEE_BPS);
        _expectPurchaseRevert(o, _auth(o, consumer, agent), merchantKey, consumerKey, PrepaidEscrow.BadTerms.selector);
        o = _offer(merchant, UNIT_PRICE, UNITS, 2001);
        _expectPurchaseRevert(o, _auth(o, consumer, agent), merchantKey, consumerKey, PrepaidEscrow.BadTerms.selector);
    }

    function test_purchase_acceptsMaxFee() public {
        uint256 planId = _buy(consumerKey, merchantKey, UNIT_PRICE, UNITS, 2000, agent);
        assertEq(escrow.getPlan(planId).cancelFeeBps, 2000);
    }

    function test_purchase_revertsWhenOfferSignedByAnotherKey() public {
        PrepaidEscrow.Offer memory o = _offer();
        _expectPurchaseRevert(o, _auth(o, consumer, agent), 0xBAD, consumerKey, PrepaidEscrow.BadMerchantSig.selector);
    }

    function test_purchase_revertsWhenTermsChangedAfterSigning() public {
        PrepaidEscrow.Offer memory o = _offer();
        bytes memory ms = _sig(merchantKey, escrow.hashOffer(o));
        PrepaidEscrow.PurchaseAuth memory a = _auth(o, consumer, agent);
        o.unitPrice = UNIT_PRICE / 2; // cheaper for the consumer, still not what the merchant signed
        bytes memory cs = _sig(consumerKey, escrow.hashPurchaseAuth(a));
        PrepaidEscrow.Permit memory p = _permit(consumerKey, TOTAL);
        vm.expectRevert(PrepaidEscrow.BadMerchantSig.selector);
        escrow.purchaseWithPermit(o, ms, a, cs, p);
    }

    function test_purchase_revertsWhenAuthNamesAnotherOffer() public {
        PrepaidEscrow.Offer memory o = _offer();
        PrepaidEscrow.Offer memory other = _offer(merchant, UNIT_PRICE, 10, FEE_BPS);
        _expectPurchaseRevert(o, _auth(other, consumer, agent), merchantKey, consumerKey, PrepaidEscrow.OfferMismatch.selector);
    }

    function test_purchase_revertsWhenAuthSignedByAnotherKey() public {
        PrepaidEscrow.Offer memory o = _offer();
        _expectPurchaseRevert(o, _auth(o, consumer, agent), merchantKey, 0xBAD, PrepaidEscrow.BadConsumerSig.selector);
    }

    function test_purchase_revertsOnMalformedSignature() public {
        PrepaidEscrow.Offer memory o = _offer();
        PrepaidEscrow.PurchaseAuth memory a = _auth(o, consumer, agent);
        bytes memory cs = _sig(consumerKey, escrow.hashPurchaseAuth(a));
        PrepaidEscrow.Permit memory p = _permit(consumerKey, TOTAL);
        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureLength.selector, 3));
        escrow.purchaseWithPermit(o, hex"010203", a, cs, p);
    }

    function test_purchase_revertsWhenAuthReused() public {
        PrepaidEscrow.Offer memory o = _offer();
        PrepaidEscrow.PurchaseAuth memory a = _auth(o, consumer, agent);
        bytes memory ms = _sig(merchantKey, escrow.hashOffer(o));
        bytes memory cs = _sig(consumerKey, escrow.hashPurchaseAuth(a));
        escrow.purchaseWithPermit(o, ms, a, cs, _permit(consumerKey, TOTAL));
        PrepaidEscrow.Permit memory p2 = _permit(consumerKey, TOTAL);
        vm.expectRevert(PrepaidEscrow.AuthUsed.selector);
        escrow.purchaseWithPermit(o, ms, a, cs, p2);
    }

    function test_purchase_sameOfferServesManyConsumers() public {
        uint256 otherKey = 0xB0B;
        token.mint(vm.addr(otherKey), TOTAL);
        PrepaidEscrow.Offer memory o = _offer();
        bytes memory ms = _sig(merchantKey, escrow.hashOffer(o));
        PrepaidEscrow.PurchaseAuth memory a1 = _auth(o, consumer, agent);
        PrepaidEscrow.PurchaseAuth memory a2 = _auth(o, vm.addr(otherKey), agent);
        escrow.purchaseWithPermit(o, ms, a1, _sig(consumerKey, escrow.hashPurchaseAuth(a1)), _permit(consumerKey, TOTAL));
        escrow.purchaseWithPermit(o, ms, a2, _sig(otherKey, escrow.hashPurchaseAuth(a2)), _permit(otherKey, TOTAL));
        assertEq(token.balanceOf(address(escrow)), 2 * TOTAL);
    }

    function test_purchase_worksWithPriorApprovalAndBadPermit() public {
        vm.prank(consumer);
        token.approve(address(escrow), TOTAL);
        PrepaidEscrow.Offer memory o = _offer();
        PrepaidEscrow.PurchaseAuth memory a = _auth(o, consumer, agent);
        PrepaidEscrow.Permit memory junk = PrepaidEscrow.Permit(0, 0, 0, 0, 0);
        escrow.purchaseWithPermit(o, _sig(merchantKey, escrow.hashOffer(o)), a, _sig(consumerKey, escrow.hashPurchaseAuth(a)), junk);
        assertEq(token.balanceOf(address(escrow)), TOTAL);
    }

    function test_purchase_survivesFrontRunPermit() public {
        PrepaidEscrow.Offer memory o = _offer();
        PrepaidEscrow.PurchaseAuth memory a = _auth(o, consumer, agent);
        PrepaidEscrow.Permit memory p = _permit(consumerKey, TOTAL);
        token.permit(consumer, address(escrow), p.value, p.deadline, p.v, p.r, p.s); // attacker submits it first
        escrow.purchaseWithPermit(o, _sig(merchantKey, escrow.hashOffer(o)), a, _sig(consumerKey, escrow.hashPurchaseAuth(a)), p);
        assertEq(token.balanceOf(address(escrow)), TOTAL);
    }

    function test_purchase_revertsWithoutAllowance() public {
        PrepaidEscrow.Offer memory o = _offer();
        PrepaidEscrow.PurchaseAuth memory a = _auth(o, consumer, agent);
        PrepaidEscrow.Permit memory junk = PrepaidEscrow.Permit(0, 0, 0, 0, 0);
        bytes memory ms = _sig(merchantKey, escrow.hashOffer(o));
        bytes memory cs = _sig(consumerKey, escrow.hashPurchaseAuth(a));
        vm.expectRevert();
        escrow.purchaseWithPermit(o, ms, a, cs, junk);
        assertEq(escrow.nextPlanId(), 1); // nothing recorded
    }

    function _expectPurchaseRevert(
        PrepaidEscrow.Offer memory o,
        PrepaidEscrow.PurchaseAuth memory a,
        uint256 mKey,
        uint256 cKey,
        bytes4 err
    ) internal {
        bytes memory ms = _sig(mKey, escrow.hashOffer(o));
        bytes memory cs = _sig(cKey, escrow.hashPurchaseAuth(a));
        PrepaidEscrow.Permit memory p = _permit(consumerKey, TOTAL);
        vm.expectRevert(err);
        escrow.purchaseWithPermit(o, ms, a, cs, p);
    }

    // ---- Redeem ---------------------------------------------------------------------------------

    function test_redeem_paysMerchantOneUnit() public {
        uint256 planId = _buy();
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        bytes32 d = escrow.hashRedeem(planId, 1, deadline);
        vm.expectEmit(address(escrow));
        emit PrepaidEscrow.Redeemed(planId, 1, UNIT_PRICE);
        escrow.redeem(planId, 1, deadline, _sig(consumerKey, d), _sig(merchantKey, d));
        assertEq(token.balanceOf(merchant), UNIT_PRICE);
        assertEq(escrow.getPlan(planId).redeemed, 1);
        assertEq(escrow.remaining(planId), TOTAL - UNIT_PRICE);
    }

    function test_redeem_lastUnitCompletesPlan() public {
        uint256 planId = _buy(consumerKey, merchantKey, UNIT_PRICE, 3, FEE_BPS, agent);
        _redeem(planId, 1);
        _redeem(planId, 2);
        assertEq(uint8(_status(planId)), uint8(PrepaidEscrow.Status.Active));
        _redeem(planId, 3);
        assertEq(uint8(_status(planId)), uint8(PrepaidEscrow.Status.Completed));
        assertEq(token.balanceOf(address(escrow)), 0);
        assertEq(token.balanceOf(merchant), 3 * uint256(UNIT_PRICE));
        assertEq(escrow.remaining(planId), 0);
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        bytes32 d = escrow.hashRedeem(planId, 4, deadline);
        bytes memory cs = _sig(consumerKey, d);
        bytes memory ms = _sig(merchantKey, d);
        vm.expectRevert(PrepaidEscrow.Inactive.selector);
        escrow.redeem(planId, 4, deadline, cs, ms);
    }

    function test_redeem_revertsOnWrongSession() public {
        uint256 planId = _buy();
        _expectRedeemRevert(planId, 2, consumerKey, merchantKey, PrepaidEscrow.WrongSession.selector); // skip
        _redeem(planId, 1);
        _expectRedeemRevert(planId, 1, consumerKey, merchantKey, PrepaidEscrow.WrongSession.selector); // replay
    }

    function test_redeem_revertsWhenExpired() public {
        uint256 planId = _buy();
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        bytes32 d = escrow.hashRedeem(planId, 1, deadline);
        bytes memory cs = _sig(consumerKey, d);
        bytes memory ms = _sig(merchantKey, d);
        vm.warp(deadline + 1);
        vm.expectRevert(PrepaidEscrow.Expired.selector);
        escrow.redeem(planId, 1, deadline, cs, ms);
    }

    function test_redeem_needsBothSignatures() public {
        uint256 planId = _buy();
        // Merchant signs twice (merchant-only check-in, T22).
        _expectRedeemRevert(planId, 1, merchantKey, merchantKey, PrepaidEscrow.BadConsumerSig.selector);
        // Consumer signs twice.
        _expectRedeemRevert(planId, 1, consumerKey, consumerKey, PrepaidEscrow.BadMerchantSig.selector);
        // A stranger as the merchant.
        _expectRedeemRevert(planId, 1, consumerKey, 0xBAD, PrepaidEscrow.BadMerchantSig.selector);
    }

    function test_redeem_revertsWhenSignaturesCoverDifferentSessions() public {
        uint256 planId = _buy();
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        bytes memory cs = _sig(consumerKey, escrow.hashRedeem(planId, 1, deadline));
        bytes memory ms = _sig(merchantKey, escrow.hashRedeem(planId, 2, deadline));
        vm.expectRevert(PrepaidEscrow.BadMerchantSig.selector);
        escrow.redeem(planId, 1, deadline, cs, ms);
    }

    function test_redeem_signatureForOnePlanDoesNotRedeemAnother() public {
        uint256 plan1 = _buy();
        uint256 plan2 = _buy();
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        bytes32 d = escrow.hashRedeem(plan1, 1, deadline);
        bytes memory cs = _sig(consumerKey, d);
        bytes memory ms = _sig(merchantKey, d);
        vm.expectRevert(PrepaidEscrow.BadConsumerSig.selector);
        escrow.redeem(plan2, 1, deadline, cs, ms);
    }

    function test_redeem_revertsOnUnknownPlan() public {
        _expectRedeemRevert(99, 1, consumerKey, merchantKey, PrepaidEscrow.Inactive.selector);
    }

    function _expectRedeemRevert(uint256 planId, uint32 sessionNo, uint256 cKey, uint256 mKey, bytes4 err) internal {
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        bytes32 d = escrow.hashRedeem(planId, sessionNo, deadline);
        bytes memory cs = _sig(cKey, d);
        bytes memory ms = _sig(mKey, d);
        vm.expectRevert(err);
        escrow.redeem(planId, sessionNo, deadline, cs, ms);
    }

    // ---- Attested exit --------------------------------------------------------------------------

    function test_attestedExit_byAgentRefundsConsumer() public {
        uint256 planId = _buy();
        for (uint32 i = 1; i <= 12; i++) _redeem(planId, i);
        uint256 before = token.balanceOf(consumer);
        PrepaidEscrow.Attestation memory att = _attestation(merchant, 1);
        bytes memory sig = _signAtt(oracleKey, att);

        vm.expectEmit(address(escrow));
        emit PrepaidEscrow.Exited(planId, PrepaidEscrow.Status.ExitedAttested, 48 * uint256(UNIT_PRICE), 0);
        vm.prank(agent);
        escrow.exitWithAttestation(planId, att, sig);

        // Lin's numbers (PRD §15.11): 48 unused sessions = ¥4,800 back.
        assertEq(token.balanceOf(consumer) - before, 480_000);
        assertEq(token.balanceOf(address(escrow)), 0);
        assertEq(uint8(_status(planId)), uint8(PrepaidEscrow.Status.ExitedAttested));
        assertEq(escrow.remaining(planId), 0);
    }

    function test_attestedExit_byConsumerWithClosureNotice() public {
        uint256 planId = _buy();
        PrepaidEscrow.Attestation memory att = _attestation(merchant, 2);
        bytes memory sig = _signAtt(oracleKey, att);
        vm.prank(consumer);
        escrow.exitWithAttestation(planId, att, sig);
        assertEq(uint8(_status(planId)), uint8(PrepaidEscrow.Status.ExitedAttested));
    }

    function test_attestedExit_refundGoesToConsumerWhoeverCalls() public {
        uint256 planId = _buy();
        PrepaidEscrow.Attestation memory att = _attestation(merchant, 1);
        bytes memory sig = _signAtt(oracleKey, att);
        uint256 agentBefore = token.balanceOf(agent);
        vm.prank(agent);
        escrow.exitWithAttestation(planId, att, sig);
        assertEq(token.balanceOf(agent), agentBefore); // a stolen agent key gains nothing
        assertEq(token.balanceOf(consumer), 1_000_000_00);
    }

    function test_attestedExit_revertsForOtherCallers() public {
        uint256 planId = _buy();
        PrepaidEscrow.Attestation memory att = _attestation(merchant, 1);
        bytes memory sig = _signAtt(oracleKey, att);
        vm.prank(relayer);
        vm.expectRevert(PrepaidEscrow.BadCaller.selector);
        escrow.exitWithAttestation(planId, att, sig);
        vm.prank(merchant);
        vm.expectRevert(PrepaidEscrow.BadCaller.selector);
        escrow.exitWithAttestation(planId, att, sig);
    }

    function test_attestedExit_planWithoutAgentOnlyConsumer() public {
        uint256 planId = _buy(consumerKey, merchantKey, UNIT_PRICE, UNITS, FEE_BPS, address(0));
        PrepaidEscrow.Attestation memory att = _attestation(merchant, 1);
        bytes memory sig = _signAtt(oracleKey, att);
        vm.prank(address(0));
        vm.expectRevert(PrepaidEscrow.BadCaller.selector);
        escrow.exitWithAttestation(planId, att, sig);
        vm.prank(consumer);
        escrow.exitWithAttestation(planId, att, sig);
    }

    function test_attestedExit_revertsForOtherMerchant() public {
        uint256 planId = _buy();
        PrepaidEscrow.Attestation memory att = _attestation(vm.addr(0xD1FF), 1);
        _expectExitRevert(planId, att, _signAtt(oracleKey, att), PrepaidEscrow.WrongMerchant.selector);
    }

    function test_attestedExit_revertsOnUnknownKind() public {
        uint256 planId = _buy();
        PrepaidEscrow.Attestation memory att = _attestation(merchant, 0);
        _expectExitRevert(planId, att, _signAtt(oracleKey, att), PrepaidEscrow.BadKind.selector);
        att = _attestation(merchant, 3);
        _expectExitRevert(planId, att, _signAtt(oracleKey, att), PrepaidEscrow.BadKind.selector);
    }

    function test_attestedExit_revertsOutsideWindow() public {
        uint256 planId = _buy();
        PrepaidEscrow.Attestation memory future = _attestation(merchant, 1);
        future.issuedAt = uint64(block.timestamp + 1);
        _expectExitRevert(planId, future, _signAtt(oracleKey, future), PrepaidEscrow.OutsideWindow.selector);

        PrepaidEscrow.Attestation memory expired = _attestation(merchant, 1);
        expired.expiresAt = uint64(block.timestamp + 1 hours);
        bytes memory sig = _signAtt(oracleKey, expired);
        vm.warp(block.timestamp + 1 hours + 1);
        _expectExitRevert(planId, expired, sig, PrepaidEscrow.OutsideWindow.selector);
    }

    function test_attestedExit_revertsWhenStale() public {
        uint256 planId = _buy();
        PrepaidEscrow.Attestation memory att = _attestation(merchant, 1);
        bytes memory sig = _signAtt(oracleKey, att);
        vm.warp(block.timestamp + 2 days);
        vm.prank(agent);
        escrow.exitWithAttestation(planId, att, sig); // exactly 2 days is still fresh

        uint256 plan2 = _buy();
        PrepaidEscrow.Attestation memory att2 = _attestation(merchant, 1);
        bytes memory sig2 = _signAtt(oracleKey, att2);
        vm.warp(block.timestamp + 2 days + 1);
        _expectExitRevert(plan2, att2, sig2, PrepaidEscrow.Stale.selector);
    }

    function test_attestedExit_revertsOnForgedSignature() public {
        uint256 planId = _buy();
        PrepaidEscrow.Attestation memory att = _attestation(merchant, 1);
        _expectExitRevert(planId, att, _signAtt(0xF0F0, att), PrepaidEscrow.BadOracleSig.selector);
        // A real oracle signature over different fields.
        PrepaidEscrow.Attestation memory other = _attestation(merchant, 2);
        _expectExitRevert(planId, att, _signAtt(oracleKey, other), PrepaidEscrow.BadOracleSig.selector);
    }

    function test_attestedExit_revertsTheSecondTime() public {
        uint256 planId = _buy();
        PrepaidEscrow.Attestation memory att = _attestation(merchant, 1);
        bytes memory sig = _signAtt(oracleKey, att);
        vm.prank(agent);
        escrow.exitWithAttestation(planId, att, sig);
        _expectExitRevert(planId, att, sig, PrepaidEscrow.Inactive.selector);
    }

    function test_attestedExit_onlyTouchesThatPlan() public {
        uint256 plan1 = _buy();
        uint256 plan2 = _buy();
        PrepaidEscrow.Attestation memory att = _attestation(merchant, 1);
        bytes memory sig = _signAtt(oracleKey, att);
        vm.prank(agent);
        escrow.exitWithAttestation(plan1, att, sig);
        assertEq(uint8(_status(plan2)), uint8(PrepaidEscrow.Status.Active));
        assertEq(token.balanceOf(address(escrow)), TOTAL);
    }

    function _expectExitRevert(uint256 planId, PrepaidEscrow.Attestation memory att, bytes memory sig, bytes4 err) internal {
        vm.prank(agent);
        vm.expectRevert(err);
        escrow.exitWithAttestation(planId, att, sig);
    }

    // ---- Voluntary exit -------------------------------------------------------------------------

    function test_voluntaryExit_splitsFee() public {
        uint256 planId = _buy();
        for (uint32 i = 1; i <= 12; i++) _redeem(planId, i);
        uint256 cBefore = token.balanceOf(consumer);
        uint256 mBefore = token.balanceOf(merchant);
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        bytes memory sig = _sig(consumerKey, escrow.hashVoluntaryExit(planId, deadline));

        // 48 unused × ¥100 = ¥4,800; 10% fee = ¥480.
        vm.expectEmit(address(escrow));
        emit PrepaidEscrow.Exited(planId, PrepaidEscrow.Status.ExitedVoluntary, 432_000, 48_000);
        vm.prank(relayer);
        escrow.exitVoluntaryBySig(planId, deadline, sig);

        assertEq(token.balanceOf(consumer) - cBefore, 432_000);
        assertEq(token.balanceOf(merchant) - mBefore, 48_000);
        assertEq(token.balanceOf(address(escrow)), 0);
        assertEq(uint8(_status(planId)), uint8(PrepaidEscrow.Status.ExitedVoluntary));
    }

    function test_voluntaryExit_zeroFeeSendsNothingToMerchant() public {
        uint256 planId = _buy(consumerKey, merchantKey, UNIT_PRICE, UNITS, 0, agent);
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        escrow.exitVoluntaryBySig(planId, deadline, _sig(consumerKey, escrow.hashVoluntaryExit(planId, deadline)));
        assertEq(token.balanceOf(merchant), 0);
        assertEq(token.balanceOf(consumer), 1_000_000_00);
    }

    function test_voluntaryExit_reverts() public {
        uint256 planId = _buy();
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        bytes memory good = _sig(consumerKey, escrow.hashVoluntaryExit(planId, deadline));

        // Signed by the merchant or the agent: not the consumer.
        bytes memory bad = _sig(merchantKey, escrow.hashVoluntaryExit(planId, deadline));
        vm.expectRevert(PrepaidEscrow.BadConsumerSig.selector);
        escrow.exitVoluntaryBySig(planId, deadline, bad);
        bad = _sig(agentKey, escrow.hashVoluntaryExit(planId, deadline));
        vm.expectRevert(PrepaidEscrow.BadConsumerSig.selector);
        escrow.exitVoluntaryBySig(planId, deadline, bad);

        // Signature for another deadline.
        vm.expectRevert(PrepaidEscrow.BadConsumerSig.selector);
        escrow.exitVoluntaryBySig(planId, deadline + 1, good);

        vm.warp(deadline + 1);
        vm.expectRevert(PrepaidEscrow.Expired.selector);
        escrow.exitVoluntaryBySig(planId, deadline, good);
    }

    function test_voluntaryExit_revertsTheSecondTimeAndAfterCompletion() public {
        uint256 planId = _buy();
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        bytes memory sig = _sig(consumerKey, escrow.hashVoluntaryExit(planId, deadline));
        escrow.exitVoluntaryBySig(planId, deadline, sig);
        vm.expectRevert(PrepaidEscrow.Inactive.selector);
        escrow.exitVoluntaryBySig(planId, deadline, sig);

        uint256 done = _buy(consumerKey, merchantKey, UNIT_PRICE, 1, FEE_BPS, agent);
        _redeem(done, 1);
        bytes memory sig2 = _sig(consumerKey, escrow.hashVoluntaryExit(done, deadline));
        vm.expectRevert(PrepaidEscrow.Inactive.selector);
        escrow.exitVoluntaryBySig(done, deadline, sig2);
    }

    // ---- Views and domain binding ---------------------------------------------------------------

    function test_hashes_matchLocalEip712() public view {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("PrepaidEscrow"),
                keccak256("1"),
                block.chainid,
                address(escrow)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(keccak256("Redeem(uint256 planId,uint32 sessionNo,uint64 deadline)"), uint256(7), uint32(3), uint64(99))
        );
        assertEq(escrow.hashRedeem(7, 3, 99), keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
    }

    function test_signaturesDoNotReplayOnAnotherDeployment() public {
        uint256 planId = _buy();
        PrepaidEscrow.Attestation memory att = _attestation(merchant, 1);
        bytes memory sig = _signAtt(oracleKey, att);

        // Same token, same oracle, same plan id on a second escrow: the domain differs.
        PrepaidEscrow other = new PrepaidEscrow(token, oracle);
        escrow = other;
        uint256 otherPlan = _buy();
        assertEq(otherPlan, planId);
        vm.prank(agent);
        vm.expectRevert(PrepaidEscrow.BadOracleSig.selector);
        other.exitWithAttestation(otherPlan, att, sig);
    }

    // ---- Fuzz -----------------------------------------------------------------------------------

    /// Refund + fee + released sessions always equal what was paid in, for any terms and path.
    function testFuzz_moneyIsConserved(uint128 price, uint32 units, uint16 fee, uint32 redeems, bool attested) public {
        price = uint128(bound(price, 1, 1_000_000));
        units = uint32(bound(units, 1, 40));
        fee = uint16(bound(fee, 0, 2000));
        redeems = uint32(bound(redeems, 0, units));
        uint256 total = uint256(price) * units;
        token.mint(consumer, total);
        uint256 cStart = token.balanceOf(consumer);

        uint256 planId = _buy(consumerKey, merchantKey, price, units, fee, agent);
        for (uint32 i = 1; i <= redeems; i++) _redeem(planId, i);

        if (redeems < units) {
            if (attested) {
                PrepaidEscrow.Attestation memory att = _attestation(merchant, 1);
                bytes memory sig = _signAtt(oracleKey, att);
                vm.prank(agent);
                escrow.exitWithAttestation(planId, att, sig);
            } else {
                uint64 deadline = uint64(block.timestamp + 1);
                escrow.exitVoluntaryBySig(planId, deadline, _sig(consumerKey, escrow.hashVoluntaryExit(planId, deadline)));
            }
        }

        uint256 merchantGot = token.balanceOf(merchant);
        uint256 consumerBack = token.balanceOf(consumer) - (cStart - total);
        assertEq(token.balanceOf(address(escrow)), 0);
        assertEq(merchantGot + consumerBack, total);
        assertGe(merchantGot, uint256(price) * redeems);
        if (redeems < units && !attested) {
            uint256 rem = uint256(price) * (units - redeems);
            assertEq(merchantGot - uint256(price) * redeems, rem * fee / 10_000);
        }
    }

    /// No random key passes a merchant, consumer or oracle signature check.
    function testFuzz_randomSignersAreRejected(uint256 key) public {
        key = bound(key, 1, 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140);
        vm.assume(key != merchantKey && key != consumerKey && key != oracleKey);
        uint256 planId = _buy();

        PrepaidEscrow.Offer memory o = _offer();
        _expectPurchaseRevert(o, _auth(o, consumer, agent), key, consumerKey, PrepaidEscrow.BadMerchantSig.selector);
        _expectRedeemRevert(planId, 1, key, merchantKey, PrepaidEscrow.BadConsumerSig.selector);
        _expectRedeemRevert(planId, 1, consumerKey, key, PrepaidEscrow.BadMerchantSig.selector);
        PrepaidEscrow.Attestation memory att = _attestation(merchant, 1);
        _expectExitRevert(planId, att, _signAtt(key, att), PrepaidEscrow.BadOracleSig.selector);
    }
}
