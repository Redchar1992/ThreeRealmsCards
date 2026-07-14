const { expect } = require("chai");
const { ethers } = require("hardhat");

const CARD = (over = {}) => ({
  general: "Diao Chan",
  faction: 3, // QUN
  rarity: 4, // LEGEND
  attack: 25,
  intellect: 92,
  command: 40,
  charisma: 100,
  series: "Beauties",
  ...over,
});

const DAY = 86400n;

describe("PeachPavilion (v2: deadlines and regret)", () => {
  let cards, pavilion, owner, alice, bob, carol;

  const now = async () => BigInt((await ethers.provider.getBlock("latest")).timestamp);
  const setNext = async (ts) => ethers.provider.send("evm_setNextBlockTimestamp", [Number(ts)]);
  const jumpPast = async (ts) => {
    await setNext(ts + 1n);
    await ethers.provider.send("evm_mine", []);
  };

  beforeEach(async () => {
    [owner, alice, bob, carol] = await ethers.getSigners();
    cards = await ethers.deployContract("ThreeRealmsCards");
    pavilion = await ethers.deployContract("PeachPavilion", [await cards.getAddress()]);
    await cards.mintCard(alice.address, CARD());
    await cards.connect(alice).approve(await pavilion.getAddress(), 1);
  });

  const deposit = async (claimBy, heir = bob) =>
    pavilion.connect(alice).depositGift(1, heir.address, claimBy);

  // ------------------------------------------------------------ depositing
  describe("depositing", () => {
    it("escrows the card with giver, heir and window on record", async () => {
      const claimBy = (await now()) + DAY;
      await expect(deposit(claimBy))
        .to.emit(pavilion, "GiftDeposited")
        .withArgs(1n, alice.address, bob.address, claimBy);
      expect(await cards.ownerOf(1)).to.equal(await pavilion.getAddress());
      const gift = await pavilion.giftOf(1);
      expect(gift.giver).to.equal(alice.address);
      expect(gift.heir).to.equal(bob.address);
      expect(gift.claimBy).to.equal(claimBy);
    });

    it("rejects deadlines that are past or exactly now", async () => {
      const current = await now();
      await expect(deposit(current - 10n))
        .to.be.revertedWithCustomError(pavilion, "DeadlineInThePast")
        .withArgs(current - 10n);
      // exactly-now: pin the next block's timestamp so the comparison is exact
      const pinned = current + 100n;
      await setNext(pinned);
      await expect(deposit(pinned)).to.be.revertedWithCustomError(
        pavilion,
        "DeadlineInThePast"
      );
    });

    it("rejects heirless gifts (the v1 stuck-card trap)", async () => {
      await expect(
        pavilion.connect(alice).depositGift(1, ethers.ZeroAddress, (await now()) + DAY)
      ).to.be.revertedWithCustomError(pavilion, "HeirlessGift");
    });

    it("rejects non-holders and unapproved deposits", async () => {
      await expect(pavilion.connect(bob).depositGift(1, carol.address, (await now()) + DAY))
        .to.be.revertedWithCustomError(pavilion, "NotCardHolder")
        .withArgs(bob.address, 1);
      await cards.mintCard(alice.address, CARD({ general: "Zhen Ji" })); // token 2, unapproved
      await expect(
        pavilion.connect(alice).depositGift(2, bob.address, (await now()) + DAY)
      ).to.be.revertedWithCustomError(cards, "NotAuthorized");
    });

    it("maps card-contract failures into CardContractRejected", async () => {
      await expect(pavilion.connect(alice).depositGift(99, bob.address, (await now()) + DAY))
        .to.be.revertedWithCustomError(pavilion, "CardContractRejected")
        .withArgs(99, "unknown card");
      const legacy = await ethers.deployContract("StringRevertingCardsMock");
      const legacyPavilion = await ethers.deployContract("PeachPavilion", [
        await legacy.getAddress(),
      ]);
      await expect(
        legacyPavilion.connect(alice).depositGift(1, bob.address, (await now()) + DAY)
      )
        .to.be.revertedWithCustomError(legacyPavilion, "CardContractRejected")
        .withArgs(1, "legacy string revert");
    });
  });

  // -------------------------------------------------------------- claiming
  describe("claiming", () => {
    let claimBy;
    beforeEach(async () => {
      claimBy = (await now()) + DAY;
      await deposit(claimBy);
    });

    it("the heir claims inside the window", async () => {
      await expect(pavilion.connect(bob).claimGift(1))
        .to.emit(pavilion, "GiftClaimed")
        .withArgs(1n, bob.address);
      expect(await cards.ownerOf(1)).to.equal(bob.address);
      expect((await pavilion.giftOf(1)).heir).to.equal(ethers.ZeroAddress);
    });

    it("the boundary second still belongs to the heir", async () => {
      await setNext(claimBy);
      await pavilion.connect(bob).claimGift(1); // timestamp == claimBy: valid
      expect(await cards.ownerOf(1)).to.equal(bob.address);
    });

    it("one second past the boundary the gift is expired", async () => {
      await setNext(claimBy + 1n);
      await expect(pavilion.connect(bob).claimGift(1))
        .to.be.revertedWithCustomError(pavilion, "GiftExpired")
        .withArgs(1, claimBy);
    });

    it("strangers, empty slots and double claims all bounce", async () => {
      await expect(pavilion.connect(carol).claimGift(1))
        .to.be.revertedWithCustomError(pavilion, "NotDesignatedHeir")
        .withArgs(carol.address, 1);
      await expect(pavilion.connect(bob).claimGift(7)).to.be.revertedWithCustomError(
        pavilion,
        "NothingDeposited"
      );
      await pavilion.connect(bob).claimGift(1);
      await expect(pavilion.connect(bob).claimGift(1)).to.be.revertedWithCustomError(
        pavilion,
        "NothingDeposited"
      );
    });
  });

  // ------------------------------------------------------------ reclaiming
  describe("reclaiming", () => {
    let claimBy;
    beforeEach(async () => {
      claimBy = (await now()) + DAY;
      await deposit(claimBy);
    });

    it("is blocked while the window is open — even at the boundary second", async () => {
      await expect(pavilion.connect(alice).reclaimGift(1))
        .to.be.revertedWithCustomError(pavilion, "GiftStillClaimable")
        .withArgs(1, claimBy);
      await setNext(claimBy);
      await expect(pavilion.connect(alice).reclaimGift(1)).to.be.revertedWithCustomError(
        pavilion,
        "GiftStillClaimable"
      );
    });

    it("the giver takes the card back once the window closes", async () => {
      await jumpPast(claimBy);
      await expect(pavilion.connect(alice).reclaimGift(1))
        .to.emit(pavilion, "GiftReclaimed")
        .withArgs(1n, alice.address);
      expect(await cards.ownerOf(1)).to.equal(alice.address);
      expect((await pavilion.giftOf(1)).giver).to.equal(ethers.ZeroAddress);
    });

    it("only the giver may reclaim — the heir missed their chance", async () => {
      await jumpPast(claimBy);
      await expect(pavilion.connect(bob).reclaimGift(1))
        .to.be.revertedWithCustomError(pavilion, "NotGiftGiver")
        .withArgs(bob.address, 1);
      await expect(pavilion.connect(bob).claimGift(1)).to.be.revertedWithCustomError(
        pavilion,
        "GiftExpired"
      );
    });

    it("expired gifts wait in custody indefinitely — no reclaim deadline", async () => {
      await jumpPast(claimBy + DAY * 365n);
      await pavilion.connect(alice).reclaimGift(1);
      expect(await cards.ownerOf(1)).to.equal(alice.address);
    });

    it("empty slots and double reclaims bounce; claimed gifts cannot be reclaimed", async () => {
      await expect(pavilion.connect(alice).reclaimGift(9)).to.be.revertedWithCustomError(
        pavilion,
        "NothingDeposited"
      );
      await pavilion.connect(bob).claimGift(1); // heir claims in time
      await jumpPast(claimBy);
      await expect(pavilion.connect(alice).reclaimGift(1)).to.be.revertedWithCustomError(
        pavilion,
        "NothingDeposited"
      );
    });

    it("a reclaimed card can be gifted again with a fresh window", async () => {
      await jumpPast(claimBy);
      await pavilion.connect(alice).reclaimGift(1);
      await cards.connect(alice).approve(await pavilion.getAddress(), 1);
      const fresh = (await now()) + DAY;
      await deposit(fresh, carol);
      await pavilion.connect(carol).claimGift(1);
      expect(await cards.ownerOf(1)).to.equal(carol.address);
    });
  });

  // ------------------------------------------------------------ house rules
  describe("house rules", () => {
    it("refuses naked safeTransferFrom deliveries", async () => {
      const target = await pavilion.getAddress();
      await expect(
        cards.connect(alice)["safeTransferFrom(address,address,uint256)"](alice.address, target, 1)
      )
        .to.be.revertedWithCustomError(cards, "ReceiverRejected")
        .withArgs(target, 1);
    });

    it("takes no tribute via receive or fallback", async () => {
      const target = await pavilion.getAddress();
      await expect(
        owner.sendTransaction({ to: target, value: 1n })
      ).to.be.revertedWithCustomError(pavilion, "PavilionTakesNoTribute");
      await expect(
        owner.sendTransaction({ to: target, data: "0x12345678" })
      ).to.be.revertedWithCustomError(pavilion, "PavilionTakesNoTribute");
    });
  });
});
