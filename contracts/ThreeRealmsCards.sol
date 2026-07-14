// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ITRC165 } from "./interfaces/ITRC165.sol";
import { ITRC721 } from "./interfaces/ITRC721.sol";
import { ITRC721Metadata } from "./interfaces/ITRC721Metadata.sol";
import { ITRC721Receiver } from "./interfaces/ITRC721Receiver.sol";
import { Card, Faction, Rarity, clampStat } from "./types/CardTypes.sol";
import { CardCodec } from "./libs/CardCodec.sol";
import "./access/Suzerain.sol";

/// @title 三分天下 · Three Realms Cards — the modular build.
/// @notice Deliberately exercises: interface inheritance with a public-state-var
/// override (isApprovedForAll — the one getter the spec allows to not revert),
/// free functions imported by name, a GLOBAL using-for, a library using-for,
/// custom errors everywhere, unchecked arithmetic, an assembly helper, TRC-165
/// via type().interfaceId, a try/catch receiver probe (safeTransferFrom), and
/// a reverting receive().
contract ThreeRealmsCards is Suzerain, ITRC721Metadata {
    using CardCodec for Card;

    error MintToZero();
    error UnknownCard(uint256 tokenId);
    error NotAuthorized(address operator, uint256 tokenId);
    error GenesisSealed();
    error EmptyGeneralName();
    error NoTribute();
    error ZeroHolderQuery();
    error ReceiverRejected(address to, uint256 tokenId);

    event CardMinted(uint256 indexed tokenId, string general, Faction faction, Rarity rarity);

    uint256 private _serial;
    bool public genesisSealed;

    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals;
    // the surviving public-state-var override: the spec mandates reverts for
    // the other three getters (see the reading section), but not for this one,
    // so the auto-getter remains a legal implementation of the interface.
    mapping(address => mapping(address => bool)) public override isApprovedForAll;
    mapping(uint256 => Card) private _cards;

    constructor() Suzerain(msg.sender) {}

    receive() external payable { revert NoTribute(); }

    function name() public pure override returns (string memory) { return "Three Realms Cards"; }

    function symbol() public pure override returns (string memory) { return "SANFEN"; }

    /// @notice Lifetime mint count; ids are sequential from 1, nothing burns.
    function totalMinted() external view returns (uint256) { return _serial; }

    // ------------------------------------------------------------- TRC-165
    /// @notice Interface ids computed by the compiler (XOR of each interface's
    /// own selectors) — no hand-copied magic constants to rot.
    function supportsInterface(bytes4 interfaceId) public pure override returns (bool) {
        return
            interfaceId == type(ITRC165).interfaceId ||
            interfaceId == type(ITRC721).interfaceId ||
            interfaceId == type(ITRC721Metadata).interfaceId;
    }

    // ------------------------------------------------------------- minting
    /// @notice Suzerain-only: mint one fully-specified card to `to`.
    /// Stats are validated to 0-100 by `clampStat` (reverts, does not clamp).
    function mintCard(address to, Card calldata card) public onlySuzerain returns (uint256 tokenId) {
        tokenId = _mint(to, card);
    }

    /// @notice One-shot genesis: the Peach Garden oath trio, LEGEND 1/1s.
    function mintPeachGardenGenesis(address to) external onlySuzerain returns (uint256 firstTokenId) {
        if (genesisSealed) revert GenesisSealed();
        genesisSealed = true;
        firstTokenId = _mint(to, Card("Liu Bei", Faction.SHU, Rarity.LEGEND, 75, 82, 88, 98, "Peach Garden"));
        _mint(to, Card("Guan Yu", Faction.SHU, Rarity.LEGEND, 97, 80, 92, 93, "Peach Garden"));
        _mint(to, Card("Zhang Fei", Faction.SHU, Rarity.LEGEND, 96, 65, 85, 70, "Peach Garden"));
    }

    function _mint(address to, Card memory card) internal returns (uint256 tokenId) {
        if (to == address(0)) revert MintToZero();
        if (bytes(card.general).length == 0) revert EmptyGeneralName();
        card.attack = clampStat(card.attack);       // free function from types
        card.intellect = clampStat(card.intellect);
        card.command = clampStat(card.command);
        card.charisma = clampStat(card.charisma);
        unchecked { tokenId = ++_serial; }
        _owners[tokenId] = to;
        unchecked { _balances[to] += 1; }
        _cards[tokenId] = card;
        emit Transfer(address(0), to, tokenId);
        emit CardMinted(tokenId, card.general, card.faction, card.rarity);
    }

    // ----------------------------------------------------------- transfers
    /// @notice Single-card approval, settable by the holder or an operator.
    function approve(address approved, uint256 tokenId) public override {
        address holder = _holderOf(tokenId);
        if (msg.sender != holder && !isApprovedForAll[holder][msg.sender]) revert NotAuthorized(msg.sender, tokenId);
        _tokenApprovals[tokenId] = approved;
        emit Approval(holder, approved, tokenId);
    }

    /// @notice Grant or revoke operator rights over every card the caller holds.
    function setApprovalForAll(address operator, bool approved) public override {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    /// @notice Bare transfer; authorized callers are the holder, the approved
    /// address, or an operator. Clears any single-card approval on the way.
    function transferFrom(address from, address to, uint256 tokenId) public override {
        address holder = _holderOf(tokenId);
        if (holder != from) revert NotAuthorized(from, tokenId);
        if (to == address(0)) revert MintToZero();
        if (msg.sender != holder && msg.sender != _tokenApprovals[tokenId] && !isApprovedForAll[holder][msg.sender]) {
            revert NotAuthorized(msg.sender, tokenId);
        }
        delete _tokenApprovals[tokenId];
        _owners[tokenId] = to;
        unchecked {
            _balances[from] -= 1;
            _balances[to] += 1;
        }
        emit Transfer(from, to, tokenId);
    }

    /// @notice Like `transferFrom`, but a contract recipient must acknowledge
    /// the card via `onTRC721Received` — no more cards stuck in contracts
    /// that cannot handle them.
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public override {
        transferFrom(from, to, tokenId);
        if (!_checkOnTRC721Received(from, to, tokenId, data)) revert ReceiverRejected(to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) public override {
        safeTransferFrom(from, to, tokenId, "");
    }

    /// @dev State is settled before this external probe (checks-effects-
    /// interactions), so a malicious receiver can reenter but not desync.
    function _checkOnTRC721Received(address from, address to, uint256 tokenId, bytes memory data) private returns (bool) {
        if (!isDeployedContract(to)) return true;
        try ITRC721Receiver(to).onTRC721Received(msg.sender, from, tokenId, data) returns (bytes4 retval) {
            return retval == ITRC721Receiver.onTRC721Received.selector;
        } catch {
            return false;
        }
    }

    // ------------------------------------------------------------- reading
    /// @notice Spec-grade `ownerOf`: reverts with UnknownCard for tokens that
    /// were never minted, instead of silently returning address(0).
    function ownerOf(uint256 tokenId) public view override returns (address) {
        return _holderOf(tokenId);
    }

    /// @notice The spec forbids balance queries about the zero address.
    function balanceOf(address holder) public view override returns (uint256) {
        if (holder == address(0)) revert ZeroHolderQuery();
        return _balances[holder];
    }

    /// @notice Approved address for a card; reverts for unknown cards per spec.
    function getApproved(uint256 tokenId) public view override returns (address) {
        _holderOf(tokenId);
        return _tokenApprovals[tokenId];
    }

    /// @notice Full on-chain card data for an existing token.
    function cardOf(uint256 tokenId) external view returns (Card memory card) {
        _holderOf(tokenId);
        card = _cards[tokenId];
    }

    /// @notice The GLOBAL using-for in action: .cardKey() with no local using.
    function cardKeyOf(uint256 tokenId) external view returns (bytes32) {
        _holderOf(tokenId);
        return _cards[tokenId].cardKey();
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _holderOf(tokenId);
        return _cards[tokenId].toTokenURI(tokenId); // library using-for
    }

    function _holderOf(uint256 tokenId) internal view returns (address holder) {
        holder = _owners[tokenId];
        if (holder == address(0)) revert UnknownCard(tokenId);
    }

    /// @notice Assembly on purpose — the pavilion flow and the safe-transfer
    /// receiver probe both use it as a guard.
    function isDeployedContract(address account) public view returns (bool result) {
        uint256 size;
        assembly { size := extcodesize(account) }
        result = size > 0;
    }
}
