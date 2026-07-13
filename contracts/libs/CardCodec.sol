// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Card, Faction, Rarity } from "../types/CardTypes.sol";
import { Str as S } from "../utils/StrUtils.sol"; // aliased NAMED import on purpose
import "./Base64.sol";

/// @title Card → fully on-chain tokenURI codec (data:application/json;base64).
/// @notice Library that itself imports two libraries plus file-level types —
/// the flattener has to order all of this correctly.
library CardCodec {
    using S for uint256;

    function factionName(Faction faction) internal pure returns (string memory) {
        if (faction == Faction.WEI) return "WEI";
        if (faction == Faction.SHU) return "SHU";
        if (faction == Faction.WU) return "WU";
        return "QUN";
    }

    function rarityName(Rarity rarity) internal pure returns (string memory) {
        if (rarity == Rarity.N) return "N";
        if (rarity == Rarity.R) return "R";
        if (rarity == Rarity.SR) return "SR";
        if (rarity == Rarity.SSR) return "SSR";
        return "LEGEND";
    }

    function toTokenURI(Card memory card, uint256 tokenId) internal pure returns (string memory) {
        bytes memory attrs = abi.encodePacked(
            '[{"trait_type":"Faction","value":"', factionName(card.faction),
            '"},{"trait_type":"Rarity","value":"', rarityName(card.rarity),
            '"},{"trait_type":"Attack","value":', uint256(card.attack).toString(),
            '},{"trait_type":"Intellect","value":', uint256(card.intellect).toString(),
            '},{"trait_type":"Command","value":', uint256(card.command).toString(),
            '},{"trait_type":"Charisma","value":', uint256(card.charisma).toString(), '}]'
        );
        bytes memory json = abi.encodePacked(
            '{"name":"', card.general, ' #', tokenId.toString(),
            '","description":"Three Realms Cards - a Three Kingdoms general card of the ',
            card.series, ' series.","attributes":', attrs, '}'
        );
        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(json)));
    }
}
