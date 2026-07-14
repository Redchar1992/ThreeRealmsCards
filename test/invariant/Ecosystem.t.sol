// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ForgeLite } from "./ForgeLite.sol";
import { EcosystemHandler } from "./EcosystemHandler.sol";
import { ThreeRealmsCards } from "../../contracts/ThreeRealmsCards.sol";
import { CardBazaar } from "../../contracts/CardBazaar.sol";
import { PeachPavilion } from "../../contracts/PeachPavilion.sol";
import { ITRC721 } from "../../contracts/interfaces/ITRC721.sol";

/// @title The ecosystem invariant campaign.
/// @notice 64 fuzzed sequences × 128 guarded ops (mint, genesis, transfer,
/// list/reprice/delist/buy/withdraw, gift/claim/reclaim, time warps) with
/// fail_on_revert=true — after every op, all five invariants below must
/// hold. The star is `everyCardHasALegalHome`: custody contracts can never
/// end up holding a card without an open stall or gift, which kills the
/// whole stranded-custody bug class (the pavilion v1 heir=0 trap lived
/// there) across every reachable sequence.
contract EcosystemInvariant is ForgeLite {
    ThreeRealmsCards internal cards;
    CardBazaar internal bazaar;
    PeachPavilion internal pavilion;
    EcosystemHandler internal handler;

    function setUp() external {
        vm.warp(1_700_000_000); // a sane clock before any deadline math
        cards = new ThreeRealmsCards();
        bazaar = new CardBazaar(ITRC721(address(cards)));
        pavilion = new PeachPavilion(ITRC721(address(cards)));
        handler = new EcosystemHandler(cards, bazaar, pavilion);

        // the handler takes the throne through the two-step handover
        cards.passSuzerainty(address(handler));
        handler.acceptThrone();

        bytes4[] memory selectors = new bytes4[](12);
        selectors[0] = EcosystemHandler.opMint.selector;
        selectors[1] = EcosystemHandler.opGenesis.selector;
        selectors[2] = EcosystemHandler.opTransfer.selector;
        selectors[3] = EcosystemHandler.opList.selector;
        selectors[4] = EcosystemHandler.opReprice.selector;
        selectors[5] = EcosystemHandler.opDelist.selector;
        selectors[6] = EcosystemHandler.opBuy.selector;
        selectors[7] = EcosystemHandler.opWithdraw.selector;
        selectors[8] = EcosystemHandler.opGift.selector;
        selectors[9] = EcosystemHandler.opClaim.selector;
        selectors[10] = EcosystemHandler.opReclaim.selector;
        selectors[11] = EcosystemHandler.opWarp.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
    }

    /// @notice Cards are conserved: every minted card is held by an actor,
    /// the bazaar, or the pavilion — no leaks, no duplicates.
    function invariant_cardConservation() external view {
        uint256 held;
        for (uint256 i = 0; i < handler.ACTOR_COUNT(); i++) {
            held += cards.balanceOf(handler.actors(i));
        }
        held += cards.balanceOf(address(bazaar));
        held += cards.balanceOf(address(pavilion));
        require(held == cards.totalMinted(), "invariant: cards leaked or duplicated");
    }

    /// @notice Custody is always accounted for: a card sitting in the bazaar
    /// has an open stall, a card in the pavilion has an open gift, and
    /// everything else is with an actor. Stranded custody is unreachable.
    function invariant_everyCardHasALegalHome() external view {
        uint256 count = handler.mintedCount();
        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId = handler.mintedAt(i);
            address owner = cards.ownerOf(tokenId);
            if (owner == address(bazaar)) {
                (address seller, uint256 price) = bazaar.stallOf(tokenId);
                require(seller != address(0) && price > 0, "invariant: card stranded in the bazaar");
            } else if (owner == address(pavilion)) {
                (address giver, address heir, ) = pavilion.giftOf(tokenId);
                require(giver != address(0) && heir != address(0), "invariant: card stranded in the pavilion");
            } else {
                require(handler.isActor(owner), "invariant: card owned by a stranger");
            }
        }
    }

    /// @notice The bazaar can always pay everyone out: its balance equals the
    /// sum of pending proceeds exactly.
    function invariant_bazaarSolvency() external view {
        uint256 owed;
        for (uint256 i = 0; i < handler.ACTOR_COUNT(); i++) {
            owed += bazaar.pendingProceeds(handler.actors(i));
        }
        require(address(bazaar).balance == owed, "invariant: bazaar balance != owed proceeds");
    }

    /// @notice Money in equals money parked plus money out (ghost ledger).
    function invariant_ledgerAccounting() external view {
        uint256 owed;
        for (uint256 i = 0; i < handler.ACTOR_COUNT(); i++) {
            owed += bazaar.pendingProceeds(handler.actors(i));
        }
        require(
            handler.ghostCredited() == handler.ghostWithdrawn() + owed,
            "invariant: ledger accounting broke"
        );
    }

    /// @notice No phantom mints, and the throne never moves mid-campaign.
    function invariant_supplyAndThrone() external view {
        require(cards.totalMinted() == handler.mintedCount(), "invariant: phantom mint");
        require(cards.suzerain() == address(handler), "invariant: the throne moved");
    }
}
