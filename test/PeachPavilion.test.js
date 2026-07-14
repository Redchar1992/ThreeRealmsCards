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

describe("PeachPavilion", () => {
  let cards, pavilion, owner, alice, bob, carol;

  beforeEach(async () => {
    [owner, alice, bob, carol] = await ethers.getSigners();
    cards = await ethers.deployContract("ThreeRealmsCards");
    pavilion = await ethers.deployContract("PeachPavilion", [await cards.getAddress()]);
    await cards.mintCard(alice.address, CARD());
  });

  it("escrows a gift and lets exactly the heir claim it", async () => {
    await cards.connect(alice).approve(await pavilion.getAddress(), 1);
    await expect(pavilion.connect(alice).depositGift(1, bob.address))
      .to.emit(pavilion, "GiftDeposited")
      .withArgs(1n, alice.address, bob.address);
    expect(await cards.ownerOf(1)).to.equal(await pavilion.getAddress());
    expect(await pavilion.heirOf(1)).to.equal(bob.address);
    expect(await pavilion.giverOf(1)).to.equal(alice.address);

    await expect(pavilion.connect(carol).claimGift(1))
      .to.be.revertedWithCustomError(pavilion, "NotDesignatedHeir")
      .withArgs(carol.address, 1);

    await expect(pavilion.connect(bob).claimGift(1))
      .to.emit(pavilion, "GiftClaimed")
      .withArgs(1n, bob.address);
    expect(await cards.ownerOf(1)).to.equal(bob.address);
    expect(await pavilion.heirOf(1)).to.equal(ethers.ZeroAddress);
    expect(await pavilion.giverOf(1)).to.equal(ethers.ZeroAddress);

    await expect(pavilion.connect(bob).claimGift(1)).to.be.revertedWithCustomError(
      pavilion,
      "NothingDeposited"
    );
  });

  it("rejects deposits from non-holders and without approval", async () => {
    await expect(pavilion.connect(bob).depositGift(1, carol.address))
      .to.be.revertedWithCustomError(pavilion, "NotCardHolder")
      .withArgs(bob.address, 1);
    // holder but pavilion not approved -> the card contract itself rejects
    await expect(
      pavilion.connect(alice).depositGift(1, bob.address)
    ).to.be.revertedWithCustomError(cards, "NotAuthorized");
  });

  it("maps the card contract's custom error into CardContractRejected", async () => {
    await expect(pavilion.connect(alice).depositGift(99, bob.address))
      .to.be.revertedWithCustomError(pavilion, "CardContractRejected")
      .withArgs(99, "unknown card");
  });

  it("relays require-string reverts from legacy card contracts verbatim", async () => {
    const legacy = await ethers.deployContract("StringRevertingCardsMock");
    const legacyPavilion = await ethers.deployContract("PeachPavilion", [
      await legacy.getAddress(),
    ]);
    await expect(legacyPavilion.connect(alice).depositGift(1, bob.address))
      .to.be.revertedWithCustomError(legacyPavilion, "CardContractRejected")
      .withArgs(1, "legacy string revert");
  });

  it("claiming an untouched card reverts", async () => {
    await expect(pavilion.connect(bob).claimGift(1)).to.be.revertedWithCustomError(
      pavilion,
      "NothingDeposited"
    );
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

  it("refuses naked safeTransferFrom deliveries (cards must come via depositGift)", async () => {
    const target = await pavilion.getAddress();
    await expect(
      cards
        .connect(alice)
        ["safeTransferFrom(address,address,uint256)"](alice.address, target, 1)
    )
      .to.be.revertedWithCustomError(cards, "ReceiverRejected")
      .withArgs(target, 1);
    expect(await cards.ownerOf(1)).to.equal(alice.address);
  });

  it("a claimed card can be re-gifted", async () => {
    await cards.connect(alice).approve(await pavilion.getAddress(), 1);
    await pavilion.connect(alice).depositGift(1, bob.address);
    await pavilion.connect(bob).claimGift(1);

    await cards.connect(bob).setApprovalForAll(await pavilion.getAddress(), true);
    await pavilion.connect(bob).depositGift(1, alice.address);
    await pavilion.connect(alice).claimGift(1);
    expect(await cards.ownerOf(1)).to.equal(alice.address);
  });
});
