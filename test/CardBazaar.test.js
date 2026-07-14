const { expect } = require("chai");
const { ethers } = require("hardhat");

const CARD = (over = {}) => ({
  general: "Zhang Fei",
  faction: 1, // SHU
  rarity: 3, // SSR
  attack: 96,
  intellect: 65,
  command: 85,
  charisma: 70,
  series: "Bazaar",
  ...over,
});

const PRICE = ethers.parseEther("100");

describe("CardBazaar", () => {
  let cards, bazaar, owner, alice, bob, carol;

  beforeEach(async () => {
    [owner, alice, bob, carol] = await ethers.getSigners();
    cards = await ethers.deployContract("ThreeRealmsCards");
    bazaar = await ethers.deployContract("CardBazaar", [await cards.getAddress()]);
    await cards.mintCard(alice.address, CARD()); // token 1
  });

  const listByAlice = async (tokenId = 1, price = PRICE) => {
    await cards.connect(alice).approve(await bazaar.getAddress(), tokenId);
    await bazaar.connect(alice).list(tokenId, price);
  };

  // -------------------------------------------------------------- listing
  describe("listing", () => {
    it("moves the card into custody and opens the stall", async () => {
      await cards.connect(alice).approve(await bazaar.getAddress(), 1);
      await expect(bazaar.connect(alice).list(1, PRICE))
        .to.emit(bazaar, "Listed")
        .withArgs(1n, alice.address, PRICE);
      expect(await cards.ownerOf(1)).to.equal(await bazaar.getAddress());
      const stall = await bazaar.stallOf(1);
      expect(stall.seller).to.equal(alice.address);
      expect(stall.price).to.equal(PRICE);
    });

    it("works via operator approval too", async () => {
      await cards.connect(alice).setApprovalForAll(await bazaar.getAddress(), true);
      await bazaar.connect(alice).list(1, PRICE);
      expect(await cards.ownerOf(1)).to.equal(await bazaar.getAddress());
    });

    it("rejects zero prices, non-holders, missing approval, and double listing", async () => {
      await expect(bazaar.connect(alice).list(1, 0)).to.be.revertedWithCustomError(
        bazaar,
        "ZeroPrice"
      );
      await expect(bazaar.connect(bob).list(1, PRICE))
        .to.be.revertedWithCustomError(bazaar, "NotStallHolder")
        .withArgs(bob.address, 1);
      await expect(bazaar.connect(alice).list(1, PRICE)).to.be.revertedWithCustomError(
        cards,
        "NotAuthorized" // approved nothing
      );
      await listByAlice();
      await expect(bazaar.connect(alice).list(1, PRICE)).to.be.revertedWithCustomError(
        bazaar,
        "NotStallHolder" // the bazaar holds it now
      );
    });
  });

  // ------------------------------------------------------------- repricing
  describe("repricing", () => {
    beforeEach(async () => listByAlice());

    it("updates the asking price", async () => {
      const newPrice = ethers.parseEther("250");
      await expect(bazaar.connect(alice).reprice(1, newPrice))
        .to.emit(bazaar, "Repriced")
        .withArgs(1n, newPrice);
      await expect(bazaar.connect(bob).buy(1, { value: PRICE }))
        .to.be.revertedWithCustomError(bazaar, "WrongTribute")
        .withArgs(newPrice, PRICE);
      await bazaar.connect(bob).buy(1, { value: newPrice });
      expect(await cards.ownerOf(1)).to.equal(bob.address);
    });

    it("rejects zero and strangers", async () => {
      await expect(bazaar.connect(alice).reprice(1, 0)).to.be.revertedWithCustomError(
        bazaar,
        "ZeroPrice"
      );
      await expect(bazaar.connect(bob).reprice(1, PRICE))
        .to.be.revertedWithCustomError(bazaar, "NotStallHolder")
        .withArgs(bob.address, 1);
    });
  });

  // ------------------------------------------------------------- delisting
  describe("delisting", () => {
    beforeEach(async () => listByAlice());

    it("returns the card and clears the stall; relisting works", async () => {
      await expect(bazaar.connect(alice).delist(1)).to.emit(bazaar, "Delisted").withArgs(1n);
      expect(await cards.ownerOf(1)).to.equal(alice.address);
      expect((await bazaar.stallOf(1)).seller).to.equal(ethers.ZeroAddress);
      await listByAlice(1, ethers.parseEther("7"));
      expect((await bazaar.stallOf(1)).price).to.equal(ethers.parseEther("7"));
    });

    it("only the seller may close the stall", async () => {
      await expect(bazaar.connect(bob).delist(1))
        .to.be.revertedWithCustomError(bazaar, "NotStallHolder")
        .withArgs(bob.address, 1);
      await expect(bazaar.connect(bob).delist(42)).to.be.revertedWithCustomError(
        bazaar,
        "NotStallHolder"
      );
    });
  });

  // --------------------------------------------------------------- buying
  describe("buying", () => {
    beforeEach(async () => listByAlice());

    it("exact tribute: card to buyer, proceeds to the pull ledger", async () => {
      const tx = bazaar.connect(bob).buy(1, { value: PRICE });
      await expect(tx).to.emit(bazaar, "Sold").withArgs(1n, alice.address, bob.address, PRICE);
      await expect(tx).to.changeEtherBalances(
        [bob, await bazaar.getAddress()],
        [-PRICE, PRICE]
      );
      expect(await cards.ownerOf(1)).to.equal(bob.address);
      expect((await bazaar.stallOf(1)).seller).to.equal(ethers.ZeroAddress);
      expect(await bazaar.pendingProceeds(alice.address)).to.equal(PRICE);
    });

    it("rejects underpay, overpay, unlisted, and double buys", async () => {
      await expect(bazaar.connect(bob).buy(1, { value: PRICE - 1n }))
        .to.be.revertedWithCustomError(bazaar, "WrongTribute")
        .withArgs(PRICE, PRICE - 1n);
      await expect(bazaar.connect(bob).buy(1, { value: PRICE + 1n }))
        .to.be.revertedWithCustomError(bazaar, "WrongTribute")
        .withArgs(PRICE, PRICE + 1n);
      await expect(bazaar.connect(bob).buy(9, { value: PRICE })).to.be.revertedWithCustomError(
        bazaar,
        "NothingListed"
      );
      await bazaar.connect(bob).buy(1, { value: PRICE });
      await expect(bazaar.connect(carol).buy(1, { value: PRICE }))
        .to.be.revertedWithCustomError(bazaar, "NothingListed")
        .withArgs(1);
    });

    it("self-buys are legal (and pointless)", async () => {
      await bazaar.connect(alice).buy(1, { value: PRICE });
      expect(await cards.ownerOf(1)).to.equal(alice.address);
      expect(await bazaar.pendingProceeds(alice.address)).to.equal(PRICE);
    });

    it("cards keep circulating: buyer relists and sells on", async () => {
      await bazaar.connect(bob).buy(1, { value: PRICE });
      await cards.connect(bob).approve(await bazaar.getAddress(), 1);
      await bazaar.connect(bob).list(1, PRICE * 2n);
      await bazaar.connect(carol).buy(1, { value: PRICE * 2n });
      expect(await cards.ownerOf(1)).to.equal(carol.address);
      expect(await bazaar.pendingProceeds(bob.address)).to.equal(PRICE * 2n);
    });
  });

  // ------------------------------------------------------------ withdrawal
  describe("withdrawing", () => {
    it("pulls exactly once and zeroes the ledger", async () => {
      await listByAlice();
      await bazaar.connect(bob).buy(1, { value: PRICE });
      const tx = bazaar.connect(alice).withdraw();
      await expect(tx).to.emit(bazaar, "ProceedsWithdrawn").withArgs(alice.address, PRICE);
      await expect(tx).to.changeEtherBalances(
        [alice, await bazaar.getAddress()],
        [PRICE, -PRICE]
      );
      expect(await bazaar.pendingProceeds(alice.address)).to.equal(0);
      await expect(bazaar.connect(alice).withdraw())
        .to.be.revertedWithCustomError(bazaar, "NothingToWithdraw")
        .withArgs(alice.address);
    });

    it("accumulates across sales", async () => {
      await cards.mintCard(alice.address, CARD({ general: "Ma Chao" })); // token 2
      await listByAlice(1, PRICE);
      await listByAlice(2, PRICE * 3n);
      await bazaar.connect(bob).buy(1, { value: PRICE });
      await bazaar.connect(carol).buy(2, { value: PRICE * 3n });
      await expect(bazaar.connect(alice).withdraw()).to.changeEtherBalances(
        [alice],
        [PRICE * 4n]
      );
    });
  });

  // -------------------------------------------------------------- security
  describe("hostile sellers", () => {
    const armHostile = async (mode) => {
      const hostile = await ethers.deployContract("HostileSellerMock", [
        await bazaar.getAddress(),
        mode,
      ]);
      await cards.mintCard(await hostile.getAddress(), CARD({ general: "Dong Zhuo", faction: 3 })); // token 2
      await hostile.approveBazaar(await cards.getAddress(), 2);
      await hostile.listCard(2, PRICE);
      await bazaar.connect(bob).buy(2, { value: PRICE });
      return hostile;
    };

    it("a reentrant withdraw finds an already-zeroed ledger", async () => {
      const hostile = await armHostile(0);
      await expect(hostile.doWithdraw()).to.changeEtherBalance(hostile, PRICE); // once
      expect(await hostile.receiveCount()).to.equal(1);
      expect(await hostile.innerWithdrawSucceeded()).to.equal(false); // CEI held
      expect(await bazaar.pendingProceeds(await hostile.getAddress())).to.equal(0);
    });

    it("a seller who refuses TRX fails withdraw without losing proceeds", async () => {
      const hostile = await armHostile(1);
      await expect(hostile.doWithdraw())
        .to.be.revertedWithCustomError(bazaar, "ProceedsTransferFailed")
        .withArgs(await hostile.getAddress(), PRICE);
      expect(await bazaar.pendingProceeds(await hostile.getAddress())).to.equal(PRICE); // intact
    });

    it("pull-over-push: a seller who cannot receive TRX cannot block the sale", async () => {
      // armHostile(1) already contains the proof — the buy succeeded even
      // though the seller's receive() reverts unconditionally
      const hostile = await armHostile(1);
      expect(await cards.ownerOf(2)).to.equal(bob.address);
      expect(await bazaar.pendingProceeds(await hostile.getAddress())).to.equal(PRICE);
    });
  });

  // ---------------------------------------------------------- house rules
  describe("house rules", () => {
    it("rejects naked safeTransferFrom deliveries", async () => {
      const target = await bazaar.getAddress();
      await expect(
        cards.connect(alice)["safeTransferFrom(address,address,uint256)"](alice.address, target, 1)
      )
        .to.be.revertedWithCustomError(cards, "ReceiverRejected")
        .withArgs(target, 1);
    });

    it("takes no tribute via receive or fallback", async () => {
      const target = await bazaar.getAddress();
      await expect(owner.sendTransaction({ to: target, value: 1n })).to.be.revertedWithCustomError(
        bazaar,
        "BazaarTakesNoTribute"
      );
      await expect(
        owner.sendTransaction({ to: target, data: "0xdeadbeef" })
      ).to.be.revertedWithCustomError(bazaar, "BazaarTakesNoTribute");
    });

    it("ledger invariant: bazaar balance equals the sum of pending proceeds", async () => {
      await cards.mintCard(bob.address, CARD({ general: "Lu Bu", faction: 3 })); // token 2
      await listByAlice(1, PRICE);
      await cards.connect(bob).approve(await bazaar.getAddress(), 2);
      await bazaar.connect(bob).list(2, PRICE * 2n);
      await bazaar.connect(carol).buy(1, { value: PRICE });
      await bazaar.connect(carol).buy(2, { value: PRICE * 2n });
      await bazaar.connect(alice).withdraw();
      const sum =
        (await bazaar.pendingProceeds(alice.address)) +
        (await bazaar.pendingProceeds(bob.address)) +
        (await bazaar.pendingProceeds(carol.address));
      expect(await ethers.provider.getBalance(await bazaar.getAddress())).to.equal(sum);
      expect(sum).to.equal(PRICE * 2n); // bob's unclaimed proceeds
    });
  });
});
