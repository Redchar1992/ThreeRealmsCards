const { expect } = require("chai");
const { ethers } = require("hardhat");

const CARD = (over = {}) => ({
  general: "Zhuge Liang",
  faction: 1, // SHU
  rarity: 4, // LEGEND
  attack: 35,
  intellect: 100,
  command: 95,
  charisma: 92,
  series: "Tiger Tally",
  ...over,
});

const TYPES = {
  MintOrder: [
    { name: "to", type: "address" },
    { name: "card", type: "Card" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
  Card: [
    { name: "general", type: "string" },
    { name: "faction", type: "uint8" },
    { name: "rarity", type: "uint8" },
    { name: "attack", type: "uint8" },
    { name: "intellect", type: "uint8" },
    { name: "command", type: "uint8" },
    { name: "charisma", type: "uint8" },
    { name: "series", type: "string" },
  ],
};

const SECP256K1_N = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");

describe("TigerTally", () => {
  let cards, tally, owner, alice, bob, carol, domain;

  const futureDeadline = async () => BigInt((await ethers.provider.getBlock("latest")).timestamp + 86400);

  const ORDER = async (over = {}) => ({
    to: ethers.ZeroAddress, // bearer tally by default
    card: CARD(),
    nonce: 1n,
    deadline: await futureDeadline(),
    ...over,
  });

  const sign = (order, signer = owner) => signer.signTypedData(domain, TYPES, order);

  beforeEach(async () => {
    [owner, alice, bob, carol] = await ethers.getSigners();
    cards = await ethers.deployContract("ThreeRealmsCards");
    tally = await ethers.deployContract("TigerTally", [await cards.getAddress()]);
    domain = {
      name: "Three Realms Tiger Tally",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await tally.getAddress(),
    };
    // seat the tally on the throne (two-step, contract-side accept)
    await cards.passSuzerainty(await tally.getAddress());
    await tally.acceptSuzerainty();
  });

  // ------------------------------------------------------------ anchoring
  describe("EIP-712 encoding", () => {
    it("digestOf matches ethers' TypedDataEncoder across order shapes", async () => {
      const shapes = [
        await ORDER(),
        await ORDER({ to: bob.address, nonce: 7n }),
        await ORDER({ card: CARD({ general: "赵子龙 🐉", series: '罕见 "系列"' }), nonce: 2n ** 200n }),
      ];
      for (const order of shapes) {
        expect(await tally.digestOf(order)).to.equal(ethers.TypedDataEncoder.hash(domain, TYPES, order));
      }
    });

    it("domainSeparator matches ethers' hashDomain", async () => {
      expect(await tally.domainSeparator()).to.equal(ethers.TypedDataEncoder.hashDomain(domain));
    });
  });

  // ------------------------------------------------------------ the seat
  describe("taking and leaving the throne", () => {
    it("sits as suzerain after the two-step handover", async () => {
      expect(await cards.suzerain()).to.equal(await tally.getAddress());
      expect(await tally.marshal()).to.equal(owner.address);
    });

    it("only the marshal drives the seat", async () => {
      for (const call of [
        () => tally.connect(alice).acceptSuzerainty(),
        () => tally.connect(alice).returnSuzerainty(alice.address),
        () => tally.connect(alice).directMint(alice.address, CARD()),
        () => tally.connect(alice).mintGenesis(alice.address),
        () => tally.connect(alice).setRenderer(ethers.ZeroAddress),
        () => tally.connect(alice).sealRenderer(),
        () => tally.connect(alice).voidTally(1),
      ]) {
        await expect(call()).to.be.revertedWithCustomError(tally, "NotMarshal").withArgs(alice.address);
      }
    });

    it("a valid tally is powerless while the contract is not suzerain", async () => {
      const lone = await ethers.deployContract("TigerTally", [await cards.getAddress()]);
      const loneDomain = { ...domain, verifyingContract: await lone.getAddress() };
      const order = await ORDER();
      const sig = await owner.signTypedData(loneDomain, TYPES, order);
      await expect(lone.connect(alice).redeem(order, sig)).to.be.revertedWithCustomError(
        cards,
        "NotSuzerain"
      );
    });

    it("returnSuzerainty hands the throne back through the same two-step", async () => {
      await tally.returnSuzerainty(owner.address);
      expect(await cards.suzerain()).to.equal(await tally.getAddress()); // not yet
      await cards.acceptSuzerainty();
      expect(await cards.suzerain()).to.equal(owner.address);
      // and the tally is now powerless
      const order = await ORDER();
      await expect(tally.connect(alice).redeem(order, await sign(order))).to.be.revertedWithCustomError(
        cards,
        "NotSuzerain"
      );
    });
  });

  // ------------------------------------------------------------ redeeming
  describe("redeeming", () => {
    it("a bearer tally mints to whoever presents it", async () => {
      const order = await ORDER();
      const sig = await sign(order);
      await expect(tally.connect(alice).redeem(order, sig))
        .to.emit(tally, "TallyRedeemed")
        .withArgs(1n, 1n, alice.address)
        .and.to.emit(cards, "CardMinted");
      expect(await cards.ownerOf(1)).to.equal(alice.address);
      expect((await cards.cardOf(1)).general).to.equal("Zhuge Liang");
      expect(await tally.tallyBroken(1)).to.equal(true);
    });

    it("a bound tally mints to the named bearer even when a relayer submits", async () => {
      const order = await ORDER({ to: bob.address });
      await tally.connect(carol).redeem(order, await sign(order));
      expect(await cards.ownerOf(1)).to.equal(bob.address);
      expect(await cards.balanceOf(carol.address)).to.equal(0);
    });

    it("returns the minted tokenId", async () => {
      const order = await ORDER();
      expect(await tally.connect(alice).redeem.staticCall(order, await sign(order))).to.equal(1n);
    });

    it("breaks on use — replays bounce", async () => {
      const order = await ORDER();
      const sig = await sign(order);
      await tally.connect(alice).redeem(order, sig);
      await expect(tally.connect(bob).redeem(order, sig))
        .to.be.revertedWithCustomError(tally, "TallyBroken")
        .withArgs(1n);
    });

    it("expires strictly after the deadline", async () => {
      const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp + 100);
      const order = await ORDER({ deadline });
      const sig = await sign(order);
      // exactly at the deadline: still valid
      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(deadline)]);
      await tally.connect(alice).redeem(order, sig);
      // one second past, with a fresh nonce: expired
      const late = await ORDER({ nonce: 2n, deadline });
      const lateSig = await sign(late);
      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(deadline) + 1]);
      await expect(tally.connect(alice).redeem(late, lateSig))
        .to.be.revertedWithCustomError(tally, "TallyExpired")
        .withArgs(deadline);
    });

    it("the cards contract's own validation still guards voucher mints", async () => {
      const order = await ORDER({ card: CARD({ attack: 101 }) });
      await expect(tally.connect(alice).redeem(order, await sign(order))).to.be.revertedWithCustomError(
        cards,
        "StatOutOfRange"
      );
    });
  });

  // ------------------------------------------------------------- voiding
  describe("voiding", () => {
    it("the marshal can brick an outstanding signature", async () => {
      const order = await ORDER();
      const sig = await sign(order);
      await expect(tally.voidTally(1)).to.emit(tally, "TallyVoided").withArgs(1n);
      await expect(tally.connect(alice).redeem(order, sig)).to.be.revertedWithCustomError(
        tally,
        "TallyBroken"
      );
    });

    it("voiding twice bounces too", async () => {
      await tally.voidTally(1);
      await expect(tally.voidTally(1)).to.be.revertedWithCustomError(tally, "TallyBroken");
    });
  });

  // ------------------------------------------------------------- forgery
  describe("forgery and malleability", () => {
    it("rejects a signature from anyone but the marshal", async () => {
      const order = await ORDER();
      const sig = await sign(order, alice);
      await expect(tally.connect(alice).redeem(order, sig))
        .to.be.revertedWithCustomError(tally, "ForgedTally")
        .withArgs(alice.address);
    });

    it("rejects a tampered order", async () => {
      const order = await ORDER();
      const sig = await sign(order);
      const tampered = { ...order, card: { ...order.card, attack: 99 } };
      await expect(tally.connect(alice).redeem(tampered, sig)).to.be.revertedWithCustomError(
        tally,
        "ForgedTally"
      );
    });

    it("rejects malformed signatures: wrong length, bad v, high-s, zero recovery", async () => {
      const order = await ORDER();
      const sig = await sign(order);

      await expect(
        tally.connect(alice).redeem(order, sig.slice(0, -2)) // 64 bytes
      ).to.be.revertedWithCustomError(tally, "MalformedTally");

      const badV = sig.slice(0, -2) + "1d"; // v = 29
      await expect(tally.connect(alice).redeem(order, badV)).to.be.revertedWithCustomError(
        tally,
        "MalformedTally"
      );

      // mirrored high-s form of the same signature
      const r = sig.slice(2, 66);
      const s = BigInt("0x" + sig.slice(66, 130));
      const v = parseInt(sig.slice(130, 132), 16);
      const highS = "0x" + r + (SECP256K1_N - s).toString(16).padStart(64, "0") + (v === 27 ? "1c" : "1b");
      await expect(tally.connect(alice).redeem(order, highS)).to.be.revertedWithCustomError(
        tally,
        "MalformedTally"
      );

      // r = 0 forces ecrecover to fail → zero recovery
      const zeroR = "0x" + "0".repeat(64) + sig.slice(66);
      await expect(tally.connect(alice).redeem(order, zeroR))
        .to.be.revertedWithCustomError(tally, "ForgedTally")
        .withArgs(ethers.ZeroAddress);
    });

    it("accepts recovery ids written as 0/1 (TRON tooling variance)", async () => {
      const order = await ORDER();
      const sig = await sign(order);
      const v = parseInt(sig.slice(130, 132), 16);
      const rawV = "0x" + sig.slice(2, 130) + (v - 27).toString(16).padStart(2, "0");
      await tally.connect(alice).redeem(order, rawV);
      expect(await cards.ownerOf(1)).to.equal(alice.address);
    });
  });

  // -------------------------------------------------------- passthroughs
  describe("marshal passthroughs", () => {
    it("directMint mints through the seat", async () => {
      await tally.directMint(bob.address, CARD({ general: "Jiang Wei", rarity: 3 }));
      expect(await cards.ownerOf(1)).to.equal(bob.address);
    });

    it("mintGenesis runs the one-shot through the seat", async () => {
      await tally.mintGenesis(owner.address);
      expect(await cards.totalMinted()).to.equal(3);
      await expect(tally.mintGenesis(owner.address)).to.be.revertedWithCustomError(
        cards,
        "GenesisSealed"
      );
    });

    it("renderer governance flows through the seat", async () => {
      const renderer = await ethers.deployContract("CardRenderer");
      await tally.directMint(alice.address, CARD());
      await tally.setRenderer(await renderer.getAddress());
      const uri = await cards.tokenURI(1);
      const meta = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString("utf8"));
      expect(meta.image.startsWith("data:image/svg+xml;base64,")).to.be.true;
      await tally.sealRenderer();
      await expect(tally.setRenderer(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        cards,
        "RendererSealed"
      );
    });
  });
});
