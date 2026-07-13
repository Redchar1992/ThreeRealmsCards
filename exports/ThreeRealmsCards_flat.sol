// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Flattened by TronIDE from contracts/ThreeRealmsCards.sol. Imports inlined in dependency order.

// File: contracts/interfaces/ITRC721.sol
/// @title Core TRC-721 surface (transfer/approval), events included.
interface ITRC721 {
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed holder, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed holder, address indexed operator, bool approved);

    function balanceOf(address holder) external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
    function approve(address approved, uint256 tokenId) external;
    function getApproved(uint256 tokenId) external view returns (address);
    function setApprovalForAll(address operator, bool approved) external;
    function isApprovedForAll(address holder, address operator) external view returns (bool);
    function transferFrom(address from, address to, uint256 tokenId) external;
}

// File: contracts/interfaces/ITRC721Metadata.sol
/// @title Metadata extension — INTERFACE INHERITANCE on purpose: implementers
/// override across two interface levels.
interface ITRC721Metadata is ITRC721 {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function tokenURI(uint256 tokenId) external view returns (string memory);
}

// File: contracts/types/CardTypes.sol
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

// File: contracts/utils/StrUtils.sol
/// @title Minimal string helpers. Tiny on purpose — the point is the import
/// graph (this file is imported under an ALIAS elsewhere), not the code.
library Str {
    function toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { unchecked { digits++; temp /= 10; } }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            unchecked {
                digits -= 1;
                buffer[digits] = bytes1(uint8(48 + (value % 10)));
                value /= 10;
            }
        }
        return string(buffer);
    }

    function equal(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}

// File: contracts/libs/Base64.sol
/// @title Loop-based base64 encoder (no assembly, analyzer-friendly).
library Base64 {
    bytes internal constant TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    function encode(bytes memory data) internal pure returns (string memory) {
        if (data.length == 0) return "";
        bytes memory table = TABLE;
        bytes memory result = new bytes(4 * ((data.length + 2) / 3));
        uint256 di = 0;
        uint256 ri = 0;
        while (di + 3 <= data.length) {
            uint256 chunk = (uint256(uint8(data[di])) << 16) | (uint256(uint8(data[di + 1])) << 8) | uint256(uint8(data[di + 2]));
            result[ri++] = table[(chunk >> 18) & 63];
            result[ri++] = table[(chunk >> 12) & 63];
            result[ri++] = table[(chunk >> 6) & 63];
            result[ri++] = table[chunk & 63];
            di += 3;
        }
        uint256 rem = data.length - di;
        if (rem == 1) {
            uint256 chunk = uint256(uint8(data[di])) << 16;
            result[ri++] = table[(chunk >> 18) & 63];
            result[ri++] = table[(chunk >> 12) & 63];
            result[ri++] = "=";
            result[ri] = "=";
        } else if (rem == 2) {
            uint256 chunk = (uint256(uint8(data[di])) << 16) | (uint256(uint8(data[di + 1])) << 8);
            result[ri++] = table[(chunk >> 18) & 63];
            result[ri++] = table[(chunk >> 12) & 63];
            result[ri++] = table[(chunk >> 6) & 63];
            result[ri] = "=";
        }
        return string(result);
    }
}

// File: contracts/libs/CardCodec.sol
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

// File: contracts/access/Suzerain.sol
/// @title 主公 access control — Ownable with local color, kept abstract so the
/// inheriting contract must chain the constructor.
abstract contract Suzerain {
    error NotSuzerain(address intruder);
    error ZeroSuzerain();

    event SuzeraintyPassed(address indexed from, address indexed to);

    address public suzerain;
    uint64 public immutable enthronedAt;

    modifier onlySuzerain() {
        if (msg.sender != suzerain) revert NotSuzerain(msg.sender);
        _;
    }

    constructor(address firstLord) {
        if (firstLord == address(0)) revert ZeroSuzerain();
        suzerain = firstLord;
        enthronedAt = uint64(block.timestamp);
    }

    function passSuzerainty(address heir) public virtual onlySuzerain {
        if (heir == address(0)) revert ZeroSuzerain();
        emit SuzeraintyPassed(suzerain, heir);
        suzerain = heir;
    }
}

// File: contracts/ThreeRealmsCards.sol
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
