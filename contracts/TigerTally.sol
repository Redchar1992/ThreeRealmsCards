// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ThreeRealmsCards } from "./ThreeRealmsCards.sol";
import { Card } from "./types/CardTypes.sol";
import { IRenderer } from "./interfaces/IRenderer.sol";

/// @title 虎符 · TigerTally — EIP-712 signed mint orders (lazy minting).
/// @notice The ancient tiger tally was cast in two halves: the sovereign
/// kept one, the marshal in the field held the other, and an order stood
/// only when the halves matched. Here the marshal signs a MintOrder off
/// chain (the sovereign's half) and any bearer submits it on chain (the
/// field half); ecrecover checks the match, and the bearer pays the energy.
/// While in service the tally contract itself holds the cards' suzerainty —
/// the two-step handover exists precisely so a CONTRACT can take the throne
/// safely — and every suzerain power keeps a marshal-gated passthrough,
/// including the escape hatch that hands the throne back.
/// @dev Zero-dependency EIP-712: nested-struct hashing (MintOrder wraps
/// Card, whose strings hash per spec), dynamic domain via block.chainid
/// (test chains and forks just work), malleability-guarded ecrecover
/// (low-s only, v ∈ {27,28} with 0/1 normalized for TRON tooling variance).
contract TigerTally {
    error NotMarshal(address intruder);
    error TallyExpired(uint64 deadline);
    error TallyBroken(uint256 nonce);
    error MalformedTally();
    error ForgedTally(address recovered);

    event TallyRedeemed(uint256 indexed nonce, uint256 indexed tokenId, address indexed bearer);
    event TallyVoided(uint256 indexed nonce);

    /// @notice A signed mint order. `to == address(0)` makes it a BEARER
    /// tally — whoever submits it receives the card. Any other `to` binds
    /// the card to that address while still letting anyone submit and pay
    /// (relayer-friendly).
    struct MintOrder {
        address to;
        Card card;
        uint256 nonce;
        uint64 deadline;
    }

    ThreeRealmsCards public immutable cards;
    address public immutable marshal;

    /// @notice A tally breaks on use; the marshal can also break one early
    /// via voidTally — a signature cannot be unsigned, but it can be bricked.
    mapping(uint256 => bool) public tallyBroken;

    bytes32 private constant _DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant _CARD_TYPEHASH = keccak256(
        "Card(string general,uint8 faction,uint8 rarity,uint8 attack,uint8 intellect,uint8 command,uint8 charisma,string series)"
    );
    bytes32 private constant _ORDER_TYPEHASH = keccak256(
        "MintOrder(address to,Card card,uint256 nonce,uint64 deadline)Card(string general,uint8 faction,uint8 rarity,uint8 attack,uint8 intellect,uint8 command,uint8 charisma,string series)"
    );

    modifier onlyMarshal() {
        if (msg.sender != marshal) revert NotMarshal(msg.sender);
        _;
    }

    constructor(ThreeRealmsCards cardContract) {
        cards = cardContract;
        marshal = msg.sender;
    }

    // ------------------------------------------------------------- EIP-712
    /// @notice Computed live rather than cached so the separator follows
    /// block.chainid across forks and test chains.
    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                _DOMAIN_TYPEHASH,
                keccak256(bytes("Three Realms Tiger Tally")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function hashCard(Card memory card) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                _CARD_TYPEHASH,
                keccak256(bytes(card.general)),
                card.faction,
                card.rarity,
                card.attack,
                card.intellect,
                card.command,
                card.charisma,
                keccak256(bytes(card.series))
            )
        );
    }

    function hashOrder(MintOrder memory order) public pure returns (bytes32) {
        return keccak256(
            abi.encode(_ORDER_TYPEHASH, order.to, hashCard(order.card), order.nonce, order.deadline)
        );
    }

    /// @notice The exact digest the marshal signs — public so off-chain
    /// encoders can be differentially tested against the chain's view.
    function digestOf(MintOrder memory order) public view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), hashOrder(order)));
    }

    // -------------------------------------------------------------- redeem
    /// @notice Present a signed tally; if the halves match, the card mints
    /// and the tally breaks. Stat bounds, name checks etc. stay enforced by
    /// the cards contract itself.
    function redeem(MintOrder calldata order, bytes calldata signature) external returns (uint256 tokenId) {
        if (block.timestamp > order.deadline) revert TallyExpired(order.deadline);
        if (tallyBroken[order.nonce]) revert TallyBroken(order.nonce);
        address recovered = _recover(digestOf(order), signature);
        if (recovered != marshal) revert ForgedTally(recovered);
        address bearer = order.to == address(0) ? msg.sender : order.to;
        tallyBroken[order.nonce] = true; // effects before the mint
        tokenId = cards.mintCard(bearer, order.card);
        emit TallyRedeemed(order.nonce, tokenId, bearer);
    }

    /// @notice Brick an outstanding signature before anyone presents it.
    function voidTally(uint256 nonce) external onlyMarshal {
        if (tallyBroken[nonce]) revert TallyBroken(nonce);
        tallyBroken[nonce] = true;
        emit TallyVoided(nonce);
    }

    // ------------------------ suzerain surface, marshal-gated passthroughs
    /// @notice Step 2 of taking office — call cards.passSuzerainty(tally)
    /// from the current suzerain first.
    function acceptSuzerainty() external onlyMarshal {
        cards.acceptSuzerainty();
    }

    /// @notice Escape hatch: start handing the throne to `heir` (the
    /// two-step continues on the cards contract; address(0) cancels).
    function returnSuzerainty(address heir) external onlyMarshal {
        cards.passSuzerainty(heir);
    }

    function directMint(address to, Card calldata card) external onlyMarshal returns (uint256 tokenId) {
        return cards.mintCard(to, card);
    }

    function mintGenesis(address to) external onlyMarshal returns (uint256 firstTokenId) {
        return cards.mintPeachGardenGenesis(to);
    }

    function setRenderer(IRenderer newRenderer) external onlyMarshal {
        cards.setRenderer(newRenderer);
    }

    function sealRenderer() external onlyMarshal {
        cards.sealRenderer();
    }

    // ----------------------------------------------------------- ecrecover
    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address) {
        if (signature.length != 65) revert MalformedTally();
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        if (v < 27) v += 27; // some TRON tooling emits recovery ids 0/1
        if (v != 27 && v != 28) revert MalformedTally();
        // EIP-2: reject the mirrored high-s form of every signature
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            revert MalformedTally();
        }
        address recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0)) revert ForgedTally(address(0));
        return recovered;
    }
}
