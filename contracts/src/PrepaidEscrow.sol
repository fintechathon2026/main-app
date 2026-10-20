// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PrepaidEscrow
/// @notice Holds prepaid package money (PRD_PrepaidEscrow_Contract §4, architecture §24.3).
///         Money leaves only (a) one unit price to the plan's merchant per session signed by both
///         the consumer and the merchant, (b) the unused balance to the plan's consumer on an
///         oracle-signed attestation, or (c) the unused balance minus a capped fee on the
///         consumer's signature. No function takes a recipient; there is no owner, admin, pause,
///         upgrade, sweep or oracle rotation (guarantees G9/G10).
contract PrepaidEscrow is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Active,
        Completed,
        ExitedAttested,
        ExitedVoluntary
    }

    struct Offer {
        address merchant;
        uint128 unitPrice;
        uint32 units;
        uint16 cancelFeeBps;
        uint64 expiresAt;
        uint256 nonce;
    }

    struct PurchaseAuth {
        bytes32 offerHash;
        address consumer;
        address agent;
        uint64 deadline;
    }

    struct Attestation {
        address merchant;
        uint8 kind;
        bytes32 caseRef;
        uint64 issuedAt;
        uint64 expiresAt;
    }

    struct Permit {
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct Plan {
        address consumer;
        address merchant;
        address agent;
        uint128 unitPrice;
        uint32 units;
        uint32 redeemed;
        uint16 cancelFeeBps;
        Status status;
    }

    bytes32 private constant OFFER_TYPEHASH = keccak256(
        "Offer(address merchant,uint128 unitPrice,uint32 units,uint16 cancelFeeBps,uint64 expiresAt,uint256 nonce)"
    );
    bytes32 private constant PURCHASE_TYPEHASH =
        keccak256("PurchaseAuth(bytes32 offerHash,address consumer,address agent,uint64 deadline)");
    bytes32 private constant REDEEM_TYPEHASH = keccak256("Redeem(uint256 planId,uint32 sessionNo,uint64 deadline)");
    bytes32 private constant ATTESTATION_TYPEHASH =
        keccak256("Attestation(address merchant,uint8 kind,bytes32 caseRef,uint64 issuedAt,uint64 expiresAt)");
    bytes32 private constant EXIT_TYPEHASH = keccak256("VoluntaryExit(uint256 planId,uint64 deadline)");

    uint64 public constant MAX_ATTESTATION_AGE = 2 days;
    uint16 public constant MAX_CANCEL_FEE_BPS = 2000;
    uint8 public constant KIND_COURT_ENFORCEMENT = 1;
    uint8 public constant KIND_CLOSURE_NOTICE = 2;

    IERC20 public immutable token;
    address public immutable oracle;
    uint256 public nextPlanId = 1;
    mapping(uint256 => Plan) private _plans;
    mapping(bytes32 => bool) public authUsed;

    event Purchased(
        uint256 indexed planId, address indexed consumer, address indexed merchant, address agent, uint256 total
    );
    event Redeemed(uint256 indexed planId, uint32 sessionNo, uint256 amount);
    event Exited(uint256 indexed planId, Status kind, uint256 refund, uint256 fee);

    error ZeroAddress();
    error Expired();
    error BadTerms();
    error BadMerchantSig();
    error OfferMismatch();
    error BadConsumerSig();
    error AuthUsed();
    error Inactive();
    error WrongSession();
    error BadCaller();
    error WrongMerchant();
    error BadKind();
    error OutsideWindow();
    error Stale();
    error BadOracleSig();

    constructor(IERC20 token_, address oracle_) EIP712("PrepaidEscrow", "1") {
        if (address(token_) == address(0) || oracle_ == address(0)) revert ZeroAddress();
        token = token_;
        oracle = oracle_;
    }

    // ---- Money paths ------------------------------------------------------------------------

    /// @notice Buys a package from a merchant-signed offer with the consumer's signed authorization.
    ///         Anyone (the relayer) may submit; every field is covered by a signature.
    function purchaseWithPermit(
        Offer calldata o,
        bytes calldata merchantSig,
        PurchaseAuth calldata a,
        bytes calldata consumerSig,
        Permit calldata p
    ) external nonReentrant returns (uint256 planId) {
        if (block.timestamp > o.expiresAt || block.timestamp > a.deadline) revert Expired();
        if (o.units == 0 || o.unitPrice == 0 || o.cancelFeeBps > MAX_CANCEL_FEE_BPS) revert BadTerms();
        bytes32 offerHash = hashOffer(o);
        if (ECDSA.recover(offerHash, merchantSig) != o.merchant) revert BadMerchantSig();
        if (a.offerHash != offerHash) revert OfferMismatch();
        bytes32 authDigest = hashPurchaseAuth(a);
        if (ECDSA.recover(authDigest, consumerSig) != a.consumer) revert BadConsumerSig();
        if (authUsed[authDigest]) revert AuthUsed();
        authUsed[authDigest] = true;

        uint256 total = uint256(o.unitPrice) * o.units;
        planId = nextPlanId++;
        _plans[planId] = Plan(a.consumer, o.merchant, a.agent, o.unitPrice, o.units, 0, o.cancelFeeBps, Status.Active);
        // forge-lint: disable-next-line(reentrancy-events) emitted before any token call; only ECDSA (internal) runs earlier
        emit Purchased(planId, a.consumer, o.merchant, a.agent, total);

        // A front-run permit only sets the same allowance; ignore its failure and rely on transferFrom.
        try IERC20Permit(address(token)).permit(a.consumer, address(this), p.value, p.deadline, p.v, p.r, p.s) {}
            catch {}
        // forge-lint: disable-next-line(arbitrary-send-erc20) `from` is the consumer whose signature was verified above
        token.safeTransferFrom(a.consumer, address(this), total);
    }

    /// @notice Releases one session's price to the merchant. Needs both parties' signatures over
    ///         the same (planId, sessionNo, deadline); sessions are strictly sequential.
    function redeem(uint256 planId, uint32 sessionNo, uint64 deadline, bytes calldata consumerSig, bytes calldata merchantSig)
        external
        nonReentrant
    {
        Plan storage pl = _plans[planId];
        if (pl.status != Status.Active) revert Inactive();
        if (block.timestamp > deadline) revert Expired();
        if (sessionNo != pl.redeemed + 1) revert WrongSession();
        bytes32 d = hashRedeem(planId, sessionNo, deadline);
        if (ECDSA.recover(d, consumerSig) != pl.consumer) revert BadConsumerSig();
        if (ECDSA.recover(d, merchantSig) != pl.merchant) revert BadMerchantSig();

        pl.redeemed = sessionNo;
        if (sessionNo == pl.units) pl.status = Status.Completed;
        // forge-lint: disable-next-line(reentrancy-events) emitted before any token call; only ECDSA (internal) runs earlier
        emit Redeemed(planId, sessionNo, pl.unitPrice);
        token.safeTransfer(pl.merchant, pl.unitPrice);
    }

    /// @notice Returns the whole unused balance to the consumer on a fresh oracle attestation
    ///         about this plan's merchant. Callable by the consumer or the plan's named agent.
    function exitWithAttestation(uint256 planId, Attestation calldata att, bytes calldata oracleSig)
        external
        nonReentrant
    {
        Plan storage pl = _plans[planId];
        if (pl.status != Status.Active) revert Inactive();
        if (msg.sender != pl.consumer && (pl.agent == address(0) || msg.sender != pl.agent)) revert BadCaller();
        if (att.merchant != pl.merchant) revert WrongMerchant();
        if (att.kind != KIND_COURT_ENFORCEMENT && att.kind != KIND_CLOSURE_NOTICE) revert BadKind();
        if (att.issuedAt > block.timestamp || block.timestamp > att.expiresAt) revert OutsideWindow();
        if (block.timestamp - att.issuedAt > MAX_ATTESTATION_AGE) revert Stale();
        if (ECDSA.recover(hashAttestation(att), oracleSig) != oracle) revert BadOracleSig();

        uint256 refund = uint256(pl.unitPrice) * (pl.units - pl.redeemed);
        pl.status = Status.ExitedAttested;
        // forge-lint: disable-next-line(reentrancy-events) emitted before any token call; only ECDSA (internal) runs earlier
        emit Exited(planId, Status.ExitedAttested, refund, 0);
        token.safeTransfer(pl.consumer, refund);
    }

    /// @notice Consumer-signed early exit: unused balance minus the plan's capped fee to the
    ///         consumer, the fee to the merchant. Anyone (the relayer) may submit.
    function exitVoluntaryBySig(uint256 planId, uint64 deadline, bytes calldata consumerSig) external nonReentrant {
        Plan storage pl = _plans[planId];
        if (pl.status != Status.Active) revert Inactive();
        if (block.timestamp > deadline) revert Expired();
        if (ECDSA.recover(hashVoluntaryExit(planId, deadline), consumerSig) != pl.consumer) revert BadConsumerSig();

        uint256 remainingAmount = uint256(pl.unitPrice) * (pl.units - pl.redeemed);
        uint256 fee = remainingAmount * pl.cancelFeeBps / 10_000;
        pl.status = Status.ExitedVoluntary;
        // forge-lint: disable-next-line(reentrancy-events) emitted before any token call; only ECDSA (internal) runs earlier
        emit Exited(planId, Status.ExitedVoluntary, remainingAmount - fee, fee);
        token.safeTransfer(pl.consumer, remainingAmount - fee);
        if (fee > 0) token.safeTransfer(pl.merchant, fee);
    }

    // ---- Views ------------------------------------------------------------------------------

    function getPlan(uint256 planId) external view returns (Plan memory) {
        return _plans[planId];
    }

    /// @notice Unused balance of an Active plan, in token units (fen); 0 otherwise.
    function remaining(uint256 planId) external view returns (uint256) {
        Plan storage pl = _plans[planId];
        if (pl.status != Status.Active) return 0;
        return uint256(pl.unitPrice) * (pl.units - pl.redeemed);
    }

    function hashOffer(Offer calldata o) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(OFFER_TYPEHASH, o.merchant, o.unitPrice, o.units, o.cancelFeeBps, o.expiresAt, o.nonce))
        );
    }

    function hashPurchaseAuth(PurchaseAuth calldata a) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(PURCHASE_TYPEHASH, a.offerHash, a.consumer, a.agent, a.deadline)));
    }

    function hashRedeem(uint256 planId, uint32 sessionNo, uint64 deadline) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(REDEEM_TYPEHASH, planId, sessionNo, deadline)));
    }

    function hashAttestation(Attestation calldata att) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(ATTESTATION_TYPEHASH, att.merchant, att.kind, att.caseRef, att.issuedAt, att.expiresAt))
        );
    }

    function hashVoluntaryExit(uint256 planId, uint64 deadline) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(EXIT_TYPEHASH, planId, deadline)));
    }
}
