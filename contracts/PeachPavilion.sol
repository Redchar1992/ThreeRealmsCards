// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ITRC721 } from "./interfaces/ITRC721.sol";
import { ITRC721Receiver } from "./interfaces/ITRC721Receiver.sol";
// Deliberately devious: this resolves to the SAME file as "./types/CardTypes.sol"
// but through a different path string (up and back down). Path normalization in
// the import resolver and the flattener's dedup both get tested here.
import { Card } from "../contracts/types/CardTypes.sol";

/// @title 桃园馆 — gift escrow: deposit a card for a designated heir, the heir
/// claims it. try/catch over an external interface call, reverting receive AND
/// fallback, immutable interface reference, custom errors.
contract PeachPavilion is ITRC721Receiver {
    error NotCardHolder(address caller, uint256 tokenId);
    error NothingDeposited(uint256 tokenId);
    error NotDesignatedHeir(address caller, uint256 tokenId);
    error PavilionTakesNoTribute();
    error CardContractRejected(uint256 tokenId, string reason);
    error GiftsOnlyViaDeposit();

    event GiftDeposited(uint256 indexed tokenId, address indexed from, address indexed heir);
    event GiftClaimed(uint256 indexed tokenId, address indexed heir);

    ITRC721 public immutable cards;
    mapping(uint256 => address) public heirOf;
    mapping(uint256 => address) public giverOf;

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

    /// @notice Escrow `tokenId` for `heir` to claim later. The caller must
    /// hold the card and have approved the pavilion beforehand.
    function depositGift(uint256 tokenId, address heir) external {
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
        heirOf[tokenId] = heir;
        giverOf[tokenId] = msg.sender;
        emit GiftDeposited(tokenId, msg.sender, heir);
    }

    /// @notice The designated heir collects the escrowed card.
    function claimGift(uint256 tokenId) external {
        address heir = heirOf[tokenId];
        if (heir == address(0)) revert NothingDeposited(tokenId);
        if (msg.sender != heir) revert NotDesignatedHeir(msg.sender, tokenId);
        delete heirOf[tokenId];
        delete giverOf[tokenId];
        cards.transferFrom(address(this), msg.sender, tokenId);
        emit GiftClaimed(tokenId, msg.sender);
    }
}
