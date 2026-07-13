// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Three Realms card domain types.
/// @notice Deliberately FILE-LEVEL definitions (enums, struct, free functions,
/// custom error, a global using-for): the whole toolchain — lint parser,
/// flattener, UML, analyzers — has to cope with code that lives outside any
/// contract body.

enum Faction { WEI, SHU, WU, QUN }

enum Rarity { N, R, SR, SSR, LEGEND }

struct Card {
    string general;   // display name, e.g. "Guan Yu"
    Faction faction;
    Rarity rarity;
    uint8 attack;     // 武力 0-100
    uint8 intellect;  // 智力 0-100
    uint8 command;    // 统率 0-100
    uint8 charisma;   // 魅力 0-100
    string series;    // e.g. "Peach Garden"
}

error StatOutOfRange(uint8 value);

/// @notice Free function: stats are capped at 100, reverting with a custom error.
function clampStat(uint8 value) pure returns (uint8) {
    if (value > 100) revert StatOutOfRange(value);
    return value;
}

/// @notice Free function attached to Card GLOBALLY below (0.8.13+ syntax):
/// every importer gets `someCard.cardKey()` without a local using-for.
function cardKey(Card memory card) pure returns (bytes32) {
    return keccak256(abi.encode(card.general, card.faction, card.series));
}

using { cardKey } for Card global;
