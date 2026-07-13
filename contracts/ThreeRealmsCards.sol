// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ITRC721Metadata } from "./interfaces/ITRC721Metadata.sol";
import { Card, Faction, Rarity, clampStat } from "./types/CardTypes.sol";
import { CardCodec } from "./libs/CardCodec.sol";
import "./access/Suzerain.sol";

/// @title 三分天下 · Three Realms Cards — the modular build.
/// @notice Deliberately exercises: interface inheritance with public-state-var
/// overrides, free functions imported by name, a GLOBAL using-for, a library
/// using-for, custom errors everywhere, unchecked arithmetic, an assembly
/// helper, and a reverting receive().
contract ThreeRealmsCards is Suzerain, ITRC721Metadata {
    using CardCodec for Card;

    error MintToZero();
    error UnknownCard(uint256 tokenId);
    error NotAuthorized(address operator, uint256 tokenId);
    error GenesisSealed();
    error EmptyGeneralName();
    error NoTribute();

    event CardMinted(uint256 indexed tokenId, string general, Faction faction, Rarity rarity);

    uint256 private _serial;
    bool public genesisSealed;

    // public state variables OVERRIDING external interface functions
    mapping(uint256 => address) public override ownerOf;
    mapping(address => uint256) public override balanceOf;
    mapping(uint256 => address) public override getApproved;
    mapping(address => mapping(address => bool)) public override isApprovedForAll;
    mapping(uint256 => Card) private _cards;

    constructor() Suzerain(msg.sender) {}

    receive() external payable { revert NoTribute(); }

    function name() public pure override returns (string memory) { return "Three Realms Cards"; }

    function symbol() public pure override returns (string memory) { return "SANFEN"; }

    function totalMinted() external view returns (uint256) { return _serial; }

    // ------------------------------------------------------------- minting
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
        ownerOf[tokenId] = to;
        unchecked { balanceOf[to] += 1; }
        _cards[tokenId] = card;
        emit Transfer(address(0), to, tokenId);
        emit CardMinted(tokenId, card.general, card.faction, card.rarity);
    }

    // ----------------------------------------------------------- transfers
    function approve(address approved, uint256 tokenId) public override {
        address holder = _holderOf(tokenId);
        if (msg.sender != holder && !isApprovedForAll[holder][msg.sender]) revert NotAuthorized(msg.sender, tokenId);
        getApproved[tokenId] = approved;
        emit Approval(holder, approved, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) public override {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public override {
        address holder = _holderOf(tokenId);
        if (holder != from) revert NotAuthorized(from, tokenId);
        if (to == address(0)) revert MintToZero();
        if (msg.sender != holder && msg.sender != getApproved[tokenId] && !isApprovedForAll[holder][msg.sender]) {
            revert NotAuthorized(msg.sender, tokenId);
        }
        delete getApproved[tokenId];
        ownerOf[tokenId] = to;
        unchecked {
            balanceOf[from] -= 1;
            balanceOf[to] += 1;
        }
        emit Transfer(from, to, tokenId);
    }

    // ------------------------------------------------------------- reading
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
        holder = ownerOf[tokenId];
        if (holder == address(0)) revert UnknownCard(tokenId);
    }

    /// @notice Assembly on purpose — the pavilion flow uses it as a guard.
    function isDeployedContract(address account) public view returns (bool result) {
        uint256 size;
        assembly { size := extcodesize(account) }
        result = size > 0;
    }
}
