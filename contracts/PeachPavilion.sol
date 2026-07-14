// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ITRC721 } from "./interfaces/ITRC721.sol";
import { ITRC721Receiver } from "./interfaces/ITRC721Receiver.sol";
// Deliberately devious: this resolves to the SAME file as "./types/CardTypes.sol"
// but through a different path string (up and back down). Path normalization in
// the import resolver and the flattener's dedup both get tested here.
import { Card } from "../contracts/types/CardTypes.sol";

/// @title 桃园馆 · PeachPavilion v2 — gift escrow with deadlines and regret.
/// @notice Deposit a card for a designated heir with a claim window. The
/// boundary rule is crisp and gapless: the heir may claim while
/// `block.timestamp <= claimBy` (the boundary second is theirs); once
/// `block.timestamp > claimBy` the giver — and only the giver — may reclaim.
/// The giver cannot reclaim inside the window: a gift you can yank back at
/// will is no gift, the deadline is a promise. try/catch over an external
/// interface call, reverting receive AND fallback, immutable interface
/// reference, custom errors.
/// @dev v2 also closes a v1 trap: a gift to address(0) used to collide with
/// the "nothing deposited" sentinel and strand the card in custody forever —
/// heirless gifts are now rejected outright. Deadlines are header timestamps
/// (~3s block cadence on TRON): do not cut windows finer than that.
contract PeachPavilion is ITRC721Receiver {
    error NotCardHolder(address caller, uint256 tokenId);
    error NothingDeposited(uint256 tokenId);
    error NotDesignatedHeir(address caller, uint256 tokenId);
    error NotGiftGiver(address caller, uint256 tokenId);
    error HeirlessGift();
    error DeadlineInThePast(uint64 claimBy);
    error GiftExpired(uint256 tokenId, uint64 claimBy);
    error GiftStillClaimable(uint256 tokenId, uint64 claimBy);
    error PavilionTakesNoTribute();
    error CardContractRejected(uint256 tokenId, string reason);
    error GiftsOnlyViaDeposit();

    event GiftDeposited(uint256 indexed tokenId, address indexed from, address indexed heir, uint64 claimBy);
    event GiftClaimed(uint256 indexed tokenId, address indexed heir);
    event GiftReclaimed(uint256 indexed tokenId, address indexed giver);

    /// @notice One escrowed gift: who gave it, who may claim it, until when.
    struct Gift {
        address giver;
        address heir;
        uint64 claimBy;
    }

    ITRC721 public immutable cards;
    mapping(uint256 => Gift) public giftOf;

    constructor(ITRC721 cardContract) {
        cards = cardContract;
    }

    receive() external payable { revert PavilionTakesNoTribute(); }

    fallback() external payable { revert PavilionTakesNoTribute(); }

    /// @notice Reject naked safeTransferFrom deliveries: a card that arrived
    /// without depositGift bookkeeping would have no heir and be stuck forever.
    function onTRC721Received(address, address, uint256, bytes calldata) external pure override returns (bytes4) {
        revert GiftsOnlyViaDeposit();
    }

    /// @notice Escrow `tokenId` for `heir`, claimable until `claimBy`
    /// (inclusive). The caller must hold the card and have approved the
    /// pavilion beforehand; the deadline must be strictly in the future.
    function depositGift(uint256 tokenId, address heir, uint64 claimBy) external {
        if (heir == address(0)) revert HeirlessGift();
        if (claimBy <= block.timestamp) revert DeadlineInThePast(claimBy);
        address holder;
        try cards.ownerOf(tokenId) returns (address h) {
            holder = h;
        } catch Error(string memory reason) {
            revert CardContractRejected(tokenId, reason);
        } catch {
            // custom errors (UnknownCard) land here, not in Error(string)
            revert CardContractRejected(tokenId, "unknown card");
        }
        if (holder != msg.sender) revert NotCardHolder(msg.sender, tokenId);
        cards.transferFrom(msg.sender, address(this), tokenId);
        giftOf[tokenId] = Gift(msg.sender, heir, claimBy);
        emit GiftDeposited(tokenId, msg.sender, heir, claimBy);
    }

    /// @notice The designated heir collects the gift — the boundary second
    /// still counts as inside the window.
    function claimGift(uint256 tokenId) external {
        Gift memory gift = giftOf[tokenId];
        if (gift.heir == address(0)) revert NothingDeposited(tokenId);
        if (msg.sender != gift.heir) revert NotDesignatedHeir(msg.sender, tokenId);
        if (block.timestamp > gift.claimBy) revert GiftExpired(tokenId, gift.claimBy);
        delete giftOf[tokenId];
        cards.transferFrom(address(this), msg.sender, tokenId);
        emit GiftClaimed(tokenId, msg.sender);
    }

    /// @notice After the window closes unclaimed, the giver takes the card
    /// back. There is no reclaim deadline — an expired gift waits safely in
    /// custody for its giver, forever.
    function reclaimGift(uint256 tokenId) external {
        Gift memory gift = giftOf[tokenId];
        if (gift.heir == address(0)) revert NothingDeposited(tokenId);
        if (msg.sender != gift.giver) revert NotGiftGiver(msg.sender, tokenId);
        if (block.timestamp <= gift.claimBy) revert GiftStillClaimable(tokenId, gift.claimBy);
        delete giftOf[tokenId];
        cards.transferFrom(address(this), msg.sender, tokenId);
        emit GiftReclaimed(tokenId, gift.giver);
    }
}
