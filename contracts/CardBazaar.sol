// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ITRC721 } from "./interfaces/ITRC721.sol";
import { ITRC721Receiver } from "./interfaces/ITRC721Receiver.sol";

/// @title 市集 · CardBazaar — a fixed-price stall market, TRX-settled.
/// @notice The minimal honest marketplace: list a card (it moves into the
/// bazaar's custody — no stale listings), buy it for exactly the asked
/// price, and proceeds wait in a PULL-payment ledger until the seller
/// withdraws. Pull over push is the load-bearing choice: paying sellers
/// inline would let any seller whose receive() reverts brick the purchase
/// of their own listing; here the buyer's trade never depends on the
/// seller's ability to receive TRX.
/// @dev No owner, no fees, no sweep — the bazaar has zero governance
/// surface and nobody can touch proceeds but their seller. withdraw() is
/// checks-effects-interactions: the ledger zeroes before the TRX leaves,
/// so a reentrant withdraw finds nothing (tested with a hostile seller).
/// TRX moves via call{value:} — .transfer's fixed gas stipend is exactly
/// the kind of brittleness an energy-priced VM does not need.
contract CardBazaar is ITRC721Receiver {
    error NotStallHolder(address caller, uint256 tokenId);
    error NothingListed(uint256 tokenId);
    error ZeroPrice();
    error WrongTribute(uint256 asked, uint256 offered);
    error NothingToWithdraw(address seller);
    error ProceedsTransferFailed(address seller, uint256 amount);
    error GoodsOnlyViaList();
    error BazaarTakesNoTribute();

    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event Repriced(uint256 indexed tokenId, uint256 price);
    event Delisted(uint256 indexed tokenId);
    event Sold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price);
    event ProceedsWithdrawn(address indexed seller, uint256 amount);

    /// @notice A stall: who is selling this card, and for how much.
    struct Stall {
        address seller;
        uint256 price;
    }

    ITRC721 public immutable cards;
    mapping(uint256 => Stall) public stallOf;
    /// @notice Sale proceeds waiting to be pulled, per seller.
    mapping(address => uint256) public pendingProceeds;

    constructor(ITRC721 cardContract) {
        cards = cardContract;
    }

    receive() external payable { revert BazaarTakesNoTribute(); }

    fallback() external payable { revert BazaarTakesNoTribute(); }

    /// @notice Reject naked safeTransferFrom deliveries — a card that arrives
    /// outside list() would sit in custody with no stall and no way home.
    function onTRC721Received(address, address, uint256, bytes calldata) external pure override returns (bytes4) {
        revert GoodsOnlyViaList();
    }

    // -------------------------------------------------------------- selling
    /// @notice Open a stall: the card moves into the bazaar's custody. The
    /// caller must hold the card and have approved the bazaar beforehand.
    function list(uint256 tokenId, uint256 price) external {
        if (price == 0) revert ZeroPrice();
        if (cards.ownerOf(tokenId) != msg.sender) revert NotStallHolder(msg.sender, tokenId);
        stallOf[tokenId] = Stall(msg.sender, price);
        cards.transferFrom(msg.sender, address(this), tokenId);
        emit Listed(tokenId, msg.sender, price);
    }

    /// @notice Change the asking price of an open stall.
    function reprice(uint256 tokenId, uint256 newPrice) external {
        if (newPrice == 0) revert ZeroPrice();
        Stall storage stall = stallOf[tokenId];
        if (stall.seller != msg.sender) revert NotStallHolder(msg.sender, tokenId);
        stall.price = newPrice;
        emit Repriced(tokenId, newPrice);
    }

    /// @notice Close the stall and take the card back.
    function delist(uint256 tokenId) external {
        if (stallOf[tokenId].seller != msg.sender) revert NotStallHolder(msg.sender, tokenId);
        delete stallOf[tokenId];
        cards.transferFrom(address(this), msg.sender, tokenId);
        emit Delisted(tokenId);
    }

    // -------------------------------------------------------------- buying
    /// @notice Pay exactly the asking price; the card is yours immediately,
    /// the seller's proceeds wait in the pull ledger.
    function buy(uint256 tokenId) external payable {
        Stall memory stall = stallOf[tokenId];
        if (stall.seller == address(0)) revert NothingListed(tokenId);
        if (msg.value != stall.price) revert WrongTribute(stall.price, msg.value);
        delete stallOf[tokenId];
        pendingProceeds[stall.seller] += msg.value;
        cards.transferFrom(address(this), msg.sender, tokenId);
        emit Sold(tokenId, stall.seller, msg.sender, stall.price);
    }

    /// @notice Pull your sale proceeds. Ledger zeroes before the TRX moves
    /// (checks-effects-interactions) — reentering finds nothing to take.
    function withdraw() external {
        uint256 amount = pendingProceeds[msg.sender];
        if (amount == 0) revert NothingToWithdraw(msg.sender);
        pendingProceeds[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{ value: amount }("");
        if (!ok) revert ProceedsTransferFailed(msg.sender, amount);
        emit ProceedsWithdrawn(msg.sender, amount);
    }
}
