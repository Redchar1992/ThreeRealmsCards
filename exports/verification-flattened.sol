// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Flattened by TronIDE from ThreeRealmsCards.sol. Imports inlined in dependency order.

// File: ThreeRealmsCards.sol
/// @title 三分天下 · Three Realms Cards — Three Kingdoms general cards (TRC-721).
/// @notice Self-contained (no imports) so it compiles in the browser IDE.
/// TRC-721 core surface + on-chain card attributes + data-URI metadata.
/// The faction/rarity/stat model and the one-shot "Peach Garden" genesis
/// are specified in the project README.
contract ThreeRealmsCards {
    // -------------------------------------------------------------- TRC-721
    string public constant name = "Three Realms Cards";
    string public constant symbol = "SANFEN";

    address public contractOwner;
    uint256 public nextTokenId;
    bool public genesisMinted;

    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    // ----------------------------------------------------------- card model
    enum Faction {
        WEI,
        SHU,
        WU,
        QUN
    }
    enum Rarity {
        N,
        R,
        SR,
        SSR,
        LEGEND
    }

    struct Card {
        string general; // display name, e.g. "Guan Yu"
        Faction faction;
        Rarity rarity;
        uint8 attack; // 武力 0-100
        uint8 intellect; // 智力 0-100
        uint8 command; // 统率 0-100
        uint8 charisma; // 魅力 0-100
        string series; // e.g. "Peach Garden"
    }

    mapping(uint256 => Card) private _cards;

    event Transfer(
        address indexed from,
        address indexed to,
        uint256 indexed tokenId
    );
    event Approval(
        address indexed holder,
        address indexed approved,
        uint256 indexed tokenId
    );
    event ApprovalForAll(
        address indexed holder,
        address indexed operator,
        bool approved
    );
    event CardMinted(
        uint256 indexed tokenId,
        string general,
        Faction faction,
        Rarity rarity
    );

    modifier onlyOwner() {
        require(
            msg.sender == contractOwner,
            "ThreeRealms: caller is not the owner"
        );
        _;
    }

    constructor() {
        contractOwner = msg.sender;
    }

    // -------------------------------------------------------------- minting
    function mintCard(
        address to,
        Card calldata card
    ) public onlyOwner returns (uint256 tokenId) {
        tokenId = _mint(to, card);
    }

    /// @notice One-shot genesis: the Peach Garden oath trio, LEGEND 1/1s.
    function mintPeachGardenGenesis(
        address to
    ) public onlyOwner returns (uint256 firstTokenId) {
        require(!genesisMinted, "ThreeRealms: genesis already minted");
        genesisMinted = true;
        firstTokenId = _mint(
            to,
            Card(
                "Liu Bei",
                Faction.SHU,
                Rarity.LEGEND,
                75,
                82,
                88,
                98,
                "Peach Garden"
            )
        );
        _mint(
            to,
            Card(
                "Guan Yu",
                Faction.SHU,
                Rarity.LEGEND,
                97,
                80,
                92,
                93,
                "Peach Garden"
            )
        );
        _mint(
            to,
            Card(
                "Zhang Fei",
                Faction.SHU,
                Rarity.LEGEND,
                96,
                65,
                85,
                70,
                "Peach Garden"
            )
        );
    }

    function _mint(
        address to,
        Card memory card
    ) internal returns (uint256 tokenId) {
        require(to != address(0), "ThreeRealms: mint to the zero address");
        require(
            bytes(card.general).length != 0,
            "ThreeRealms: general name is empty"
        );
        require(
            card.attack <= 100 &&
                card.intellect <= 100 &&
                card.command <= 100 &&
                card.charisma <= 100,
            "ThreeRealms: stats must be 0-100"
        );
        tokenId = ++nextTokenId;
        ownerOf[tokenId] = to;
        balanceOf[to] += 1;
        _cards[tokenId] = card;
        emit Transfer(address(0), to, tokenId);
        emit CardMinted(tokenId, card.general, card.faction, card.rarity);
    }

    // ------------------------------------------------------------ transfers
    function approve(address approved, uint256 tokenId) public {
        address holder = ownerOf[tokenId];
        require(
            msg.sender == holder || isApprovedForAll[holder][msg.sender],
            "ThreeRealms: not authorized"
        );
        getApproved[tokenId] = approved;
        emit Approval(holder, approved, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) public {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        address holder = ownerOf[tokenId];
        require(holder == from, "ThreeRealms: from is not the token owner");
        require(to != address(0), "ThreeRealms: transfer to the zero address");
        require(
            msg.sender == holder ||
                msg.sender == getApproved[tokenId] ||
                isApprovedForAll[holder][msg.sender],
            "ThreeRealms: not authorized"
        );
        delete getApproved[tokenId];
        ownerOf[tokenId] = to;
        balanceOf[from] -= 1;
        balanceOf[to] += 1;
        emit Transfer(from, to, tokenId);
    }

    // ------------------------------------------------------------- metadata
    function cardOf(uint256 tokenId) public view returns (Card memory card) {
        require(
            ownerOf[tokenId] != address(0),
            "ThreeRealms: card does not exist"
        );
        card = _cards[tokenId];
    }

    /// @notice Fully on-chain metadata: data:application/json;base64,…
    function tokenURI(uint256 tokenId) public view returns (string memory) {
        require(
            ownerOf[tokenId] != address(0),
            "ThreeRealms: card does not exist"
        );
        Card memory card = _cards[tokenId];
        bytes memory json = abi.encodePacked(
            '{"name":"',
            card.general,
            " #",
            _toString(tokenId),
            '","description":"Three Realms Cards - a Three Kingdoms general card of the ',
            card.series,
            ' series.","attributes":',
            _attributesJson(card),
            "}"
        );
        return
            string(
                abi.encodePacked("data:application/json;base64,", _base64(json))
            );
    }

    function _attributesJson(
        Card memory card
    ) internal pure returns (bytes memory) {
        return
            abi.encodePacked(
                '[{"trait_type":"Faction","value":"',
                _factionName(card.faction),
                '"},{"trait_type":"Rarity","value":"',
                _rarityName(card.rarity),
                '"},{"trait_type":"Attack","value":',
                _toString(card.attack),
                '},{"trait_type":"Intellect","value":',
                _toString(card.intellect),
                '},{"trait_type":"Command","value":',
                _toString(card.command),
                '},{"trait_type":"Charisma","value":',
                _toString(card.charisma),
                "}]"
            );
    }

    function _factionName(
        Faction faction
    ) internal pure returns (string memory) {
        if (faction == Faction.WEI) return "WEI";
        if (faction == Faction.SHU) return "SHU";
        if (faction == Faction.WU) return "WU";
        return "QUN";
    }

    function _rarityName(Rarity rarity) internal pure returns (string memory) {
        if (rarity == Rarity.N) return "N";
        if (rarity == Rarity.R) return "R";
        if (rarity == Rarity.SR) return "SR";
        if (rarity == Rarity.SSR) return "SSR";
        return "LEGEND";
    }

    // ------------------------------------------------------------- helpers
    bytes internal constant _TABLE =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    function _base64(bytes memory data) internal pure returns (string memory) {
        if (data.length == 0) return "";
        bytes memory table = _TABLE;
        bytes memory result = new bytes(4 * ((data.length + 2) / 3));
        uint256 di = 0;
        uint256 ri = 0;
        while (di + 3 <= data.length) {
            uint256 chunk = (uint256(uint8(data[di])) << 16) |
                (uint256(uint8(data[di + 1])) << 8) |
                uint256(uint8(data[di + 2]));
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
            uint256 chunk = (uint256(uint8(data[di])) << 16) |
                (uint256(uint8(data[di + 1])) << 8);
            result[ri++] = table[(chunk >> 18) & 63];
            result[ri++] = table[(chunk >> 12) & 63];
            result[ri++] = table[(chunk >> 6) & 63];
            result[ri] = "=";
        }
        return string(result);
    }
}
