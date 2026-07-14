// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ForgeLite } from "./ForgeLite.sol";
import { ThreeRealmsCards } from "../../contracts/ThreeRealmsCards.sol";
import { CardBazaar } from "../../contracts/CardBazaar.sol";
import { PeachPavilion } from "../../contracts/PeachPavilion.sol";
import { Card, Faction, Rarity } from "../../contracts/types/CardTypes.sol";

/// @title The fuzz handler: the whole ecosystem behind guarded operations.
/// @notice Every op pre-checks its own preconditions and returns early when
/// they don't hold — it never reverts on purpose. With fail_on_revert=true
/// in foundry.toml, ANY revert inside a fuzzed sequence is therefore a real
/// finding. The handler itself sits on the throne (it accepts the cards'
/// suzerainty through the two-step handover) and time is a first-class op:
/// opWarp jumps the chain clock so the pavilion's claim windows open and
/// close mid-campaign.
contract EcosystemHandler is ForgeLite {
    ThreeRealmsCards public immutable cards;
    CardBazaar public immutable bazaar;
    PeachPavilion public immutable pavilion;

    uint256 public constant ACTOR_COUNT = 6;
    uint256 public constant MAX_CARDS = 96;

    address[ACTOR_COUNT] public actors;
    uint256[] private _minted;

    // ghost ledger for the bazaar's money flow
    uint256 public ghostCredited;
    uint256 public ghostWithdrawn;

    constructor(ThreeRealmsCards cards_, CardBazaar bazaar_, PeachPavilion pavilion_) {
        cards = cards_;
        bazaar = bazaar_;
        pavilion = pavilion_;
        for (uint256 i = 0; i < ACTOR_COUNT; i++) {
            actors[i] = makeAddr(string(abi.encodePacked("actor-", bytes1(uint8(0x61 + i)))));
            vm.deal(actors[i], 1e24);
        }
    }

    /// @dev Called once from setUp, never fuzzed (not in the selector list).
    function acceptThrone() external {
        cards.acceptSuzerainty();
    }

    // ------------------------------------------------------------- minting
    function opMint(uint256 actorSeed, uint256 f, uint256 r, uint256 a, uint256 i_, uint256 c_, uint256 ch) external {
        if (_minted.length >= MAX_CARDS) return;
        address to = actors[bound(actorSeed, 0, ACTOR_COUNT - 1)];
        Card memory card = Card(
            "Storm General",
            Faction(uint8(bound(f, 0, 3))),
            Rarity(uint8(bound(r, 0, 4))),
            uint8(bound(a, 0, 100)),
            uint8(bound(i_, 0, 100)),
            uint8(bound(c_, 0, 100)),
            uint8(bound(ch, 0, 100)),
            "Storm"
        );
        _minted.push(cards.mintCard(to, card));
    }

    function opGenesis(uint256 actorSeed) external {
        if (cards.genesisSealed()) return;
        if (_minted.length + 3 > MAX_CARDS) return;
        uint256 first = cards.mintPeachGardenGenesis(actors[bound(actorSeed, 0, ACTOR_COUNT - 1)]);
        _minted.push(first);
        _minted.push(first + 1);
        _minted.push(first + 2);
    }

    // ------------------------------------------------------------ transfers
    function opTransfer(uint256 tokenSeed, uint256 toSeed) external {
        (uint256 tokenId, address holder) = _actorHeldToken(tokenSeed);
        if (tokenId == 0) return;
        address to = actors[bound(toSeed, 0, ACTOR_COUNT - 1)];
        vm.prank(holder);
        cards.transferFrom(holder, to, tokenId);
    }

    // -------------------------------------------------------------- bazaar
    function opList(uint256 tokenSeed, uint256 price) external {
        (uint256 tokenId, address holder) = _actorHeldToken(tokenSeed);
        if (tokenId == 0) return;
        price = bound(price, 1, 1e21);
        vm.startPrank(holder);
        cards.approve(address(bazaar), tokenId);
        bazaar.list(tokenId, price);
        vm.stopPrank();
    }

    function opReprice(uint256 tokenSeed, uint256 price) external {
        uint256 tokenId = _listedToken(tokenSeed);
        if (tokenId == 0) return;
        (address seller, ) = bazaar.stallOf(tokenId);
        vm.prank(seller);
        bazaar.reprice(tokenId, bound(price, 1, 1e21));
    }

    function opDelist(uint256 tokenSeed) external {
        uint256 tokenId = _listedToken(tokenSeed);
        if (tokenId == 0) return;
        (address seller, ) = bazaar.stallOf(tokenId);
        vm.prank(seller);
        bazaar.delist(tokenId);
    }

    function opBuy(uint256 tokenSeed, uint256 buyerSeed) external {
        uint256 tokenId = _listedToken(tokenSeed);
        if (tokenId == 0) return;
        (, uint256 price) = bazaar.stallOf(tokenId);
        address buyer = actors[bound(buyerSeed, 0, ACTOR_COUNT - 1)];
        if (buyer.balance < price) return;
        vm.prank(buyer);
        bazaar.buy{ value: price }(tokenId);
        ghostCredited += price;
    }

    function opWithdraw(uint256 actorSeed) external {
        address actor = actors[bound(actorSeed, 0, ACTOR_COUNT - 1)];
        uint256 amount = bazaar.pendingProceeds(actor);
        if (amount == 0) return;
        vm.prank(actor);
        bazaar.withdraw();
        ghostWithdrawn += amount;
    }

    // ------------------------------------------------------------ pavilion
    function opGift(uint256 tokenSeed, uint256 heirSeed, uint256 window) external {
        (uint256 tokenId, address holder) = _actorHeldToken(tokenSeed);
        if (tokenId == 0) return;
        address heir = actors[bound(heirSeed, 0, ACTOR_COUNT - 1)];
        uint64 claimBy = uint64(block.timestamp + bound(window, 1, 30 days));
        vm.startPrank(holder);
        cards.approve(address(pavilion), tokenId);
        pavilion.depositGift(tokenId, heir, claimBy);
        vm.stopPrank();
    }

    function opClaim(uint256 tokenSeed) external {
        uint256 tokenId = _giftedToken(tokenSeed);
        if (tokenId == 0) return;
        (, address heir, uint64 claimBy) = pavilion.giftOf(tokenId);
        if (block.timestamp > claimBy) return; // expired — heir missed it
        vm.prank(heir);
        pavilion.claimGift(tokenId);
    }

    function opReclaim(uint256 tokenSeed) external {
        uint256 tokenId = _giftedToken(tokenSeed);
        if (tokenId == 0) return;
        (address giver, , uint64 claimBy) = pavilion.giftOf(tokenId);
        if (block.timestamp <= claimBy) return; // still the heir's window
        vm.prank(giver);
        pavilion.reclaimGift(tokenId);
    }

    // ---------------------------------------------------------------- time
    function opWarp(uint256 delta) external {
        vm.warp(block.timestamp + bound(delta, 1, 15 days));
    }

    // ------------------------------------------------------- invariant views
    function mintedCount() external view returns (uint256) {
        return _minted.length;
    }

    function mintedAt(uint256 index) external view returns (uint256) {
        return _minted[index];
    }

    function isActor(address account) public view returns (bool) {
        for (uint256 i = 0; i < ACTOR_COUNT; i++) {
            if (actors[i] == account) return true;
        }
        return false;
    }

    // ------------------------------------------------------------- scanning
    function _actorHeldToken(uint256 seed) private view returns (uint256 tokenId, address holder) {
        uint256 count = _minted.length;
        if (count == 0) return (0, address(0));
        uint256 start = bound(seed, 0, count - 1);
        for (uint256 i = 0; i < count; i++) {
            uint256 candidate = _minted[(start + i) % count];
            address owner = cards.ownerOf(candidate);
            if (isActor(owner)) return (candidate, owner);
        }
        return (0, address(0));
    }

    function _listedToken(uint256 seed) private view returns (uint256) {
        uint256 count = _minted.length;
        if (count == 0) return 0;
        uint256 start = bound(seed, 0, count - 1);
        for (uint256 i = 0; i < count; i++) {
            uint256 candidate = _minted[(start + i) % count];
            (address seller, ) = bazaar.stallOf(candidate);
            if (seller != address(0)) return candidate;
        }
        return 0;
    }

    function _giftedToken(uint256 seed) private view returns (uint256) {
        uint256 count = _minted.length;
        if (count == 0) return 0;
        uint256 start = bound(seed, 0, count - 1);
        for (uint256 i = 0; i < count; i++) {
            uint256 candidate = _minted[(start + i) % count];
            (, address heir, ) = pavilion.giftOf(candidate);
            if (heir != address(0)) return candidate;
        }
        return 0;
    }
}
