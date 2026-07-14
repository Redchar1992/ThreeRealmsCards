// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Card, Faction, Rarity } from "../types/CardTypes.sol";
import { CardCodec } from "../libs/CardCodec.sol";
import { Base64 } from "../libs/Base64.sol";
import { Str } from "../utils/StrUtils.sol";
import { IRenderer } from "../interfaces/IRenderer.sol";

/// @title 丹青 · CardRenderer — fully on-chain SVG card art.
/// @notice Stateless pure pipeline: Card → SVG → data:image/svg+xml;base64.
/// Designed to hang off ThreeRealmsCards.setRenderer and be sealed once the
/// art is final. User-supplied text lands in XML TEXT NODES ONLY and goes
/// through Str.escapeXml — this renderer must never place it in attributes.
/// Card face: faction-colored frame, name, faction·rarity line, rarity
/// stars, four stat bars, series footer; LEGENDs get an outer halo stroke.
/// @dev Markup is assembled in small helpers, each abi.encodePacked kept
/// narrow — the flat 0.8.20 pipeline (no viaIR, matching the IDE's builtin
/// compiler) runs out of stack on wide argument lists.
contract CardRenderer is IRenderer {
    using Str for uint256;

    string private constant _BG = "#12151b";
    string private constant _PANEL = "#232833";
    string private constant _INK = "#f2ead8";
    string private constant _MUTED = "#9aa3ad";

    function imageURI(Card memory card, uint256 tokenId) external pure override returns (string memory) {
        bytes memory svg = abi.encodePacked(
            _frame(card),
            _header(card),
            _stats(card),
            _footer(card, tokenId),
            "</svg>"
        );
        return string(abi.encodePacked("data:image/svg+xml;base64,", Base64.encode(svg)));
    }

    // ------------------------------------------------------------ sections
    function _frame(Card memory card) private pure returns (bytes memory) {
        bytes memory halo = card.rarity == Rarity.LEGEND
            ? bytes('<rect x="3" y="3" width="294" height="414" rx="16" fill="none" stroke="#e8c15a" stroke-width="1.5" opacity="0.8"/>')
            : bytes("");
        bytes memory base = abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 420">',
            '<rect width="300" height="420" rx="18" fill="', _BG, '"/>',
            halo
        );
        return abi.encodePacked(
            base,
            '<rect x="10" y="10" width="280" height="400" rx="12" fill="none" stroke="', _factionColor(card.faction), '" stroke-width="3"/>',
            '<rect x="16" y="16" width="268" height="388" rx="9" fill="none" stroke="', _rarityColor(card.rarity), '" stroke-width="1" opacity="0.7"/>'
        );
    }

    function _header(Card memory card) private pure returns (bytes memory) {
        bytes memory name = abi.encodePacked(
            '<text x="150" y="64" text-anchor="middle" font-family="sans-serif" font-size="24" font-weight="bold" fill="', _INK, '">',
            Str.escapeXml(card.general),
            "</text>"
        );
        bytes memory caption = abi.encodePacked(
            '<text x="150" y="92" text-anchor="middle" font-family="sans-serif" font-size="13" letter-spacing="2" fill="', _factionColor(card.faction), '">',
            CardCodec.factionName(card.faction), unicode" · ", CardCodec.rarityName(card.rarity),
            "</text>"
        );
        bytes memory stars = abi.encodePacked(
            '<text x="150" y="118" text-anchor="middle" font-size="15" fill="', _rarityColor(card.rarity), '">',
            _stars(card.rarity),
            '</text><line x1="30" x2="270" y1="140" y2="140" stroke="#2a303b"/>'
        );
        return abi.encodePacked(name, caption, stars);
    }

    function _stats(Card memory card) private pure returns (bytes memory) {
        string memory color = _factionColor(card.faction);
        return abi.encodePacked(
            _statBar("ATK", card.attack, 168, color),
            _statBar("INT", card.intellect, 212, color),
            _statBar("CMD", card.command, 256, color),
            _statBar("CHA", card.charisma, 300, color)
        );
    }

    function _statBar(string memory label, uint8 value, uint256 y, string memory color) private pure returns (bytes memory) {
        string memory yMid = (y + 13).toString();
        bytes memory row = abi.encodePacked(
            '<text x="34" y="', yMid, '" font-family="sans-serif" font-size="12" fill="', _MUTED, '">', label, "</text>",
            '<rect x="76" y="', y.toString(), '" width="190" height="16" rx="8" fill="', _PANEL, '"/>'
        );
        return abi.encodePacked(
            row,
            _statFill(value, y, color),
            '<text x="286" y="', yMid, '" text-anchor="end" font-family="sans-serif" font-size="12" fill="', _INK, '">', uint256(value).toString(), "</text>"
        );
    }

    /// @dev A zero stat draws no fill at all — SVG treats width="0" as
    /// "disable rendering" anyway, this just keeps the markup honest.
    function _statFill(uint8 value, uint256 y, string memory color) private pure returns (bytes memory) {
        if (value == 0) return bytes("");
        return abi.encodePacked(
            '<rect x="76" y="', y.toString(), '" width="', (uint256(value) * 19 / 10).toString(), '" height="16" rx="8" fill="', color, '"/>'
        );
    }

    function _footer(Card memory card, uint256 tokenId) private pure returns (bytes memory) {
        return abi.encodePacked(
            '<line x1="30" x2="270" y1="360" y2="360" stroke="#2a303b"/>',
            '<text x="150" y="388" text-anchor="middle" font-family="sans-serif" font-size="12" fill="', _MUTED, '">',
            Str.escapeXml(card.series), unicode" · #", tokenId.toString(),
            "</text>"
        );
    }

    // -------------------------------------------------------------- themes
    function _factionColor(Faction faction) private pure returns (string memory) {
        if (faction == Faction.WEI) return "#4a7bd0"; // 魏 blue
        if (faction == Faction.SHU) return "#c8452c"; // 蜀 red
        if (faction == Faction.WU) return "#2f9e63"; // 吴 green
        return "#b08a3e"; // 群 bronze
    }

    function _rarityColor(Rarity rarity) private pure returns (string memory) {
        if (rarity == Rarity.N) return "#9aa0a6";
        if (rarity == Rarity.R) return "#6fa8ff";
        if (rarity == Rarity.SR) return "#b07ce8";
        if (rarity == Rarity.SSR) return "#f0b429";
        return "#e8c15a"; // LEGEND gold
    }

    /// @dev One star per rarity tier: N=★ … LEGEND=★★★★★.
    function _stars(Rarity rarity) private pure returns (bytes memory out) {
        uint256 n = uint256(uint8(rarity)) + 1;
        for (uint256 i = 0; i < n; i++) {
            out = abi.encodePacked(out, unicode"★");
        }
    }
}
