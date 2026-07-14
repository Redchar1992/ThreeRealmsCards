const { expect } = require("chai");
const { ethers } = require("hardhat");

// ---------------------------------------------------------------- helpers

const CARD = (over = {}) => ({
  general: "Zhao Yun",
  faction: 1, // SHU
  rarity: 3, // SSR
  attack: 96,
  intellect: 76,
  command: 91,
  charisma: 81,
  series: "Five Tigers",
  ...over,
});

const FACTIONS = ["WEI", "SHU", "WU", "QUN"];
const RARITIES = ["N", "R", "SR", "SSR", "LEGEND"];

const RECEIVER_MAGIC = ethers.dataSlice(
  ethers.id("onTRC721Received(address,address,uint256,bytes)"),
  0,
  4
);

const DATA_URI_PREFIX = "data:application/json;base64,";

function decodeMeta(uri) {
  expect(uri.startsWith(DATA_URI_PREFIX), `unexpected tokenURI prefix: ${uri.slice(0, 40)}`).to.be
    .true;
  return JSON.parse(Buffer.from(uri.slice(DATA_URI_PREFIX.length), "base64").toString("utf8"));
}

function selectorXor(signatures) {
  let acc = 0n;
  for (const sig of signatures) acc ^= BigInt(ethers.dataSlice(ethers.id(sig), 0, 4));
  return "0x" + acc.toString(16).padStart(8, "0");
}

// deterministic PRNG so fuzz-ish cases are reproducible
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randInt = (rng, n) => Math.floor(rng() * n);

describe("ThreeRealmsCards", () => {
  let cards, owner, alice, bob, carol;

  beforeEach(async () => {
    [owner, alice, bob, carol] = await ethers.getSigners();
    cards = await ethers.deployContract("ThreeRealmsCards");
  });

  // ------------------------------------------------------------ deployment
  describe("deployment", () => {
    it("sets metadata and initial state", async () => {
      expect(await cards.name()).to.equal("Three Realms Cards");
      expect(await cards.symbol()).to.equal("SANFEN");
      expect(await cards.totalMinted()).to.equal(0);
      expect(await cards.genesisSealed()).to.equal(false);
      expect(await cards.suzerain()).to.equal(owner.address);
      expect(await cards.heirApparent()).to.equal(ethers.ZeroAddress);
      expect(await cards.enthronedAt()).to.be.greaterThan(0n);
    });

    it("emits SuzeraintyPassed(0 -> deployer) on deployment", async () => {
      await expect(cards.deploymentTransaction())
        .to.emit(cards, "SuzeraintyPassed")
        .withArgs(ethers.ZeroAddress, owner.address);
    });

    it("rejects plain TRX/ETH tribute via receive()", async () => {
      await expect(
        owner.sendTransaction({ to: await cards.getAddress(), value: 1n })
      ).to.be.revertedWithCustomError(cards, "NoTribute");
    });
  });

  // ------------------------------------------------- two-step suzerainty (①)
  describe("suzerainty handover (two-step)", () => {
    it("only the suzerain can designate an heir", async () => {
      await expect(cards.connect(alice).passSuzerainty(alice.address))
        .to.be.revertedWithCustomError(cards, "NotSuzerain")
        .withArgs(alice.address);
    });

    it("designation alone moves nothing", async () => {
      await expect(cards.passSuzerainty(alice.address))
        .to.emit(cards, "HeirDesignated")
        .withArgs(owner.address, alice.address);
      expect(await cards.suzerain()).to.equal(owner.address);
      expect(await cards.heirApparent()).to.equal(alice.address);
      // heir has no powers yet, old suzerain keeps all of them
      await expect(
        cards.connect(alice).mintCard(alice.address, CARD())
      ).to.be.revertedWithCustomError(cards, "NotSuzerain");
      await cards.mintCard(owner.address, CARD());
    });

    it("only the heir apparent can accept", async () => {
      await cards.passSuzerainty(alice.address);
      await expect(cards.connect(bob).acceptSuzerainty())
        .to.be.revertedWithCustomError(cards, "NotHeirApparent")
        .withArgs(bob.address);
    });

    it("accept completes the handover and swaps powers", async () => {
      await cards.passSuzerainty(alice.address);
      await expect(cards.connect(alice).acceptSuzerainty())
        .to.emit(cards, "SuzeraintyPassed")
        .withArgs(owner.address, alice.address);
      expect(await cards.suzerain()).to.equal(alice.address);
      expect(await cards.heirApparent()).to.equal(ethers.ZeroAddress);
      await expect(
        cards.mintCard(owner.address, CARD())
      ).to.be.revertedWithCustomError(cards, "NotSuzerain");
      await cards.connect(alice).mintCard(alice.address, CARD());
    });

    it("a later designation overwrites the previous heir", async () => {
      await cards.passSuzerainty(alice.address);
      await cards.passSuzerainty(bob.address);
      await expect(cards.connect(alice).acceptSuzerainty()).to.be.revertedWithCustomError(
        cards,
        "NotHeirApparent"
      );
      await cards.connect(bob).acceptSuzerainty();
      expect(await cards.suzerain()).to.equal(bob.address);
    });

    it("the abstract base refuses a zero first lord", async () => {
      const factory = await ethers.getContractFactory("SuzerainMock");
      await expect(factory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        factory,
        "ZeroSuzerain"
      );
      const lord = await factory.deploy(alice.address);
      expect(await lord.suzerain()).to.equal(alice.address);
      expect(await lord.enthronedAt()).to.be.greaterThan(0n);
    });

    it("passing address(0) cancels a pending designation", async () => {
      await cards.passSuzerainty(alice.address);
      await cards.passSuzerainty(ethers.ZeroAddress);
      expect(await cards.heirApparent()).to.equal(ethers.ZeroAddress);
      await expect(cards.connect(alice).acceptSuzerainty()).to.be.revertedWithCustomError(
        cards,
        "NotHeirApparent"
      );
    });
  });

  // --------------------------------------------------------------- minting
  describe("minting", () => {
    it("mints with sequential ids starting at 1 and full bookkeeping", async () => {
      expect(await cards.mintCard.staticCall(alice.address, CARD())).to.equal(1n);
      await expect(cards.mintCard(alice.address, CARD()))
        .to.emit(cards, "Transfer")
        .withArgs(ethers.ZeroAddress, alice.address, 1n)
        .and.to.emit(cards, "CardMinted")
        .withArgs(1n, "Zhao Yun", 1, 3);
      await cards.mintCard(bob.address, CARD({ general: "Ma Chao" }));
      expect(await cards.totalMinted()).to.equal(2);
      expect(await cards.ownerOf(1)).to.equal(alice.address);
      expect(await cards.ownerOf(2)).to.equal(bob.address);
      expect(await cards.balanceOf(alice.address)).to.equal(1);
    });

    it("stores the full card and round-trips via cardOf", async () => {
      await cards.mintCard(alice.address, CARD());
      const card = await cards.cardOf(1);
      expect(card.general).to.equal("Zhao Yun");
      expect(card.faction).to.equal(1);
      expect(card.rarity).to.equal(3);
      expect(card.attack).to.equal(96);
      expect(card.intellect).to.equal(76);
      expect(card.command).to.equal(91);
      expect(card.charisma).to.equal(81);
      expect(card.series).to.equal("Five Tigers");
    });

    it("only the suzerain mints", async () => {
      await expect(cards.connect(alice).mintCard(alice.address, CARD()))
        .to.be.revertedWithCustomError(cards, "NotSuzerain")
        .withArgs(alice.address);
    });

    it("rejects the zero address and empty names", async () => {
      await expect(
        cards.mintCard(ethers.ZeroAddress, CARD())
      ).to.be.revertedWithCustomError(cards, "MintToZero");
      await expect(
        cards.mintCard(alice.address, CARD({ general: "" }))
      ).to.be.revertedWithCustomError(cards, "EmptyGeneralName");
    });

    it("accepts stats of exactly 100 and rejects 101 on every stat", async () => {
      await cards.mintCard(
        alice.address,
        CARD({ attack: 100, intellect: 100, command: 100, charisma: 100 })
      );
      for (const stat of ["attack", "intellect", "command", "charisma"]) {
        await expect(cards.mintCard(alice.address, CARD({ [stat]: 101 })))
          .to.be.revertedWithCustomError(cards, "StatOutOfRange")
          .withArgs(101);
      }
    });
  });

  // ------------------------------------------------------------- genesis
  describe("Peach Garden genesis", () => {
    const TRIO = [
      ["Liu Bei", 75, 82, 88, 98],
      ["Guan Yu", 97, 80, 92, 93],
      ["Zhang Fei", 96, 65, 85, 70],
    ];

    it("mints the oath trio exactly once", async () => {
      expect(await cards.mintPeachGardenGenesis.staticCall(owner.address)).to.equal(1n);
      const tx = await cards.mintPeachGardenGenesis(owner.address);
      const receipt = await tx.wait();
      const minted = receipt.logs
        .map((log) => {
          try {
            return cards.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .filter((parsed) => parsed && parsed.name === "CardMinted");
      expect(minted.map((event) => event.args.general)).to.deep.equal(TRIO.map(([name]) => name));

      expect(await cards.totalMinted()).to.equal(3);
      expect(await cards.genesisSealed()).to.equal(true);
      expect(await cards.balanceOf(owner.address)).to.equal(3);
      for (let i = 0; i < 3; i++) {
        const [general, attack, intellect, command, charisma] = TRIO[i];
        const card = await cards.cardOf(i + 1);
        expect(card.general).to.equal(general);
        expect(card.faction).to.equal(1); // SHU
        expect(card.rarity).to.equal(4); // LEGEND
        expect(card.attack).to.equal(attack);
        expect(card.intellect).to.equal(intellect);
        expect(card.command).to.equal(command);
        expect(card.charisma).to.equal(charisma);
        expect(card.series).to.equal("Peach Garden");
      }

      await expect(
        cards.mintPeachGardenGenesis(owner.address)
      ).to.be.revertedWithCustomError(cards, "GenesisSealed");
    });

    it("is suzerain-only and id numbering continues from prior mints", async () => {
      await expect(
        cards.connect(alice).mintPeachGardenGenesis(alice.address)
      ).to.be.revertedWithCustomError(cards, "NotSuzerain");
      await cards.mintCard(alice.address, CARD());
      expect(await cards.mintPeachGardenGenesis.staticCall(owner.address)).to.equal(2n);
      await cards.mintPeachGardenGenesis(owner.address);
      expect(await cards.totalMinted()).to.equal(4);
      expect((await cards.cardOf(4)).general).to.equal("Zhang Fei");
    });
  });

  // ----------------------------------------------- spec-grade queries (②)
  describe("query revert semantics", () => {
    it("ownerOf / getApproved / cardOf / cardKeyOf / tokenURI revert for unknown cards", async () => {
      for (const call of [
        () => cards.ownerOf(999),
        () => cards.getApproved(999),
        () => cards.cardOf(999),
        () => cards.cardKeyOf(999),
        () => cards.tokenURI(999),
      ]) {
        await expect(call()).to.be.revertedWithCustomError(cards, "UnknownCard").withArgs(999);
      }
    });

    it("balanceOf rejects the zero address", async () => {
      await expect(cards.balanceOf(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        cards,
        "ZeroHolderQuery"
      );
    });

    it("isApprovedForAll stays a non-reverting public-mapping getter", async () => {
      expect(await cards.isApprovedForAll(alice.address, bob.address)).to.equal(false);
    });
  });

  // ------------------------------------------------------------ approvals
  describe("approvals", () => {
    beforeEach(async () => {
      await cards.mintCard(alice.address, CARD());
    });

    it("holder can approve; approval is readable and clearable", async () => {
      await expect(cards.connect(alice).approve(bob.address, 1))
        .to.emit(cards, "Approval")
        .withArgs(alice.address, bob.address, 1n);
      expect(await cards.getApproved(1)).to.equal(bob.address);
      await cards.connect(alice).approve(ethers.ZeroAddress, 1);
      expect(await cards.getApproved(1)).to.equal(ethers.ZeroAddress);
    });

    it("operator can approve on the holder's behalf; strangers cannot", async () => {
      await expect(cards.connect(alice).setApprovalForAll(carol.address, true))
        .to.emit(cards, "ApprovalForAll")
        .withArgs(alice.address, carol.address, true);
      await cards.connect(carol).approve(bob.address, 1);
      expect(await cards.getApproved(1)).to.equal(bob.address);
      await expect(cards.connect(bob).approve(bob.address, 1))
        .to.be.revertedWithCustomError(cards, "NotAuthorized")
        .withArgs(bob.address, 1);
    });

    it("approving a nonexistent card reverts", async () => {
      await expect(cards.connect(alice).approve(bob.address, 42)).to.be.revertedWithCustomError(
        cards,
        "UnknownCard"
      );
    });
  });

  // ------------------------------------------------------------ transfers
  describe("transferFrom", () => {
    beforeEach(async () => {
      await cards.mintCard(alice.address, CARD());
    });

    it("holder transfers; balances, owner, events all move", async () => {
      await expect(cards.connect(alice).transferFrom(alice.address, bob.address, 1))
        .to.emit(cards, "Transfer")
        .withArgs(alice.address, bob.address, 1n);
      expect(await cards.ownerOf(1)).to.equal(bob.address);
      expect(await cards.balanceOf(alice.address)).to.equal(0);
      expect(await cards.balanceOf(bob.address)).to.equal(1);
    });

    it("single-card approvee and operator can transfer; strangers cannot", async () => {
      await cards.connect(alice).approve(bob.address, 1);
      await cards.connect(bob).transferFrom(alice.address, carol.address, 1);
      expect(await cards.ownerOf(1)).to.equal(carol.address);

      await cards.connect(carol).setApprovalForAll(owner.address, true);
      await cards.transferFrom(carol.address, alice.address, 1);
      expect(await cards.ownerOf(1)).to.equal(alice.address);

      await expect(cards.connect(bob).transferFrom(alice.address, bob.address, 1))
        .to.be.revertedWithCustomError(cards, "NotAuthorized")
        .withArgs(bob.address, 1);
    });

    it("stale approvals die with the transfer", async () => {
      await cards.connect(alice).approve(bob.address, 1);
      await cards.connect(alice).transferFrom(alice.address, carol.address, 1);
      expect(await cards.getApproved(1)).to.equal(ethers.ZeroAddress);
      await expect(
        cards.connect(bob).transferFrom(carol.address, bob.address, 1)
      ).to.be.revertedWithCustomError(cards, "NotAuthorized");
    });

    it("rejects wrong from, zero to, unknown card", async () => {
      await expect(cards.connect(alice).transferFrom(bob.address, carol.address, 1))
        .to.be.revertedWithCustomError(cards, "NotAuthorized")
        .withArgs(bob.address, 1);
      await expect(
        cards.connect(alice).transferFrom(alice.address, ethers.ZeroAddress, 1)
      ).to.be.revertedWithCustomError(cards, "MintToZero");
      await expect(
        cards.connect(alice).transferFrom(alice.address, bob.address, 7)
      ).to.be.revertedWithCustomError(cards, "UnknownCard");
    });

    it("self-transfer keeps the books consistent", async () => {
      await cards.connect(alice).transferFrom(alice.address, alice.address, 1);
      expect(await cards.ownerOf(1)).to.equal(alice.address);
      expect(await cards.balanceOf(alice.address)).to.equal(1);
    });
  });

  // ------------------------------------------------- safe transfers (②)
  describe("safeTransferFrom", () => {
    beforeEach(async () => {
      await cards.mintCard(alice.address, CARD());
    });

    it("moves cards to EOAs via both overloads", async () => {
      await cards
        .connect(alice)
        ["safeTransferFrom(address,address,uint256)"](alice.address, bob.address, 1);
      expect(await cards.ownerOf(1)).to.equal(bob.address);
      await cards
        .connect(bob)
        ["safeTransferFrom(address,address,uint256,bytes)"](bob.address, alice.address, 1, "0x99");
      expect(await cards.ownerOf(1)).to.equal(alice.address);
    });

    it("delivers to a well-behaved receiver and forwards operator/from/data", async () => {
      const receiver = await ethers.deployContract("TRC721ReceiverMock", [RECEIVER_MAGIC, false]);
      await cards.connect(alice).setApprovalForAll(bob.address, true);
      await expect(
        cards
          .connect(bob)
          ["safeTransferFrom(address,address,uint256,bytes)"](
            alice.address,
            await receiver.getAddress(),
            1,
            "0xdead"
          )
      )
        .to.emit(receiver, "Received")
        .withArgs(bob.address, alice.address, 1n, "0xdead");
      expect(await cards.ownerOf(1)).to.equal(await receiver.getAddress());
    });

    it("empty data arrives as empty bytes on the no-data overload", async () => {
      const receiver = await ethers.deployContract("TRC721ReceiverMock", [RECEIVER_MAGIC, false]);
      await expect(
        cards
          .connect(alice)
          ["safeTransferFrom(address,address,uint256)"](
            alice.address,
            await receiver.getAddress(),
            1
          )
      )
        .to.emit(receiver, "Received")
        .withArgs(alice.address, alice.address, 1n, "0x");
    });

    it("reverts (and rolls back) for wrong magic, reverting hooks, and hookless contracts", async () => {
      const wrongMagic = await ethers.deployContract("TRC721ReceiverMock", ["0x12345678", false]);
      const hostile = await ethers.deployContract("TRC721ReceiverMock", [RECEIVER_MAGIC, true]);
      const hookless = await ethers.deployContract("NonReceiverMock");
      for (const target of [wrongMagic, hostile, hookless]) {
        const to = await target.getAddress();
        await expect(
          cards
            .connect(alice)
            ["safeTransferFrom(address,address,uint256)"](alice.address, to, 1)
        )
          .to.be.revertedWithCustomError(cards, "ReceiverRejected")
          .withArgs(to, 1);
        expect(await cards.ownerOf(1)).to.equal(alice.address); // rolled back
      }
    });

    it("keeps transferFrom's authorization rules", async () => {
      await expect(
        cards
          .connect(bob)
          ["safeTransferFrom(address,address,uint256)"](alice.address, bob.address, 1)
      ).to.be.revertedWithCustomError(cards, "NotAuthorized");
    });
  });

  // ----------------------------------------------------------- TRC-165 (②)
  describe("TRC-165", () => {
    const CORE_SIGNATURES = [
      "balanceOf(address)",
      "ownerOf(uint256)",
      "safeTransferFrom(address,address,uint256,bytes)",
      "safeTransferFrom(address,address,uint256)",
      "transferFrom(address,address,uint256)",
      "approve(address,uint256)",
      "setApprovalForAll(address,bool)",
      "getApproved(uint256)",
      "isApprovedForAll(address,address)",
    ];
    const METADATA_SIGNATURES = ["name()", "symbol()", "tokenURI(uint256)"];

    it("the ABI really carries all nine core functions, XORing to 0x80ac58cd", () => {
      for (const sig of CORE_SIGNATURES) {
        expect(() => cards.interface.getFunction(sig)).to.not.throw();
      }
      expect(selectorXor(CORE_SIGNATURES)).to.equal("0x80ac58cd");
      expect(selectorXor(METADATA_SIGNATURES)).to.equal("0x5b5e139f");
    });

    it("claims exactly TRC-165 + TRC-721 core + metadata", async () => {
      expect(await cards.supportsInterface("0x01ffc9a7")).to.equal(true); // TRC-165
      expect(await cards.supportsInterface("0x80ac58cd")).to.equal(true); // TRC-721
      expect(await cards.supportsInterface("0x5b5e139f")).to.equal(true); // metadata
      expect(await cards.supportsInterface("0x780e9d63")).to.equal(false); // enumerable (not implemented)
      expect(await cards.supportsInterface("0xffffffff")).to.equal(false); // mandated by TRC-165
      expect(await cards.supportsInterface("0xdeadbeef")).to.equal(false);
    });
  });

  // ------------------------------------------------------------- metadata
  describe("tokenURI metadata", () => {
    it("emits parseable on-chain JSON with the full attribute set", async () => {
      await cards.mintCard(alice.address, CARD());
      const meta = decodeMeta(await cards.tokenURI(1));
      expect(meta.name).to.equal("Zhao Yun #1");
      expect(meta.description).to.equal(
        "Three Realms Cards - a Three Kingdoms general card of the Five Tigers series."
      );
      expect(meta.attributes).to.deep.equal([
        { trait_type: "Faction", value: "SHU" },
        { trait_type: "Rarity", value: "SSR" },
        { trait_type: "Attack", value: 96 },
        { trait_type: "Intellect", value: 76 },
        { trait_type: "Command", value: 91 },
        { trait_type: "Charisma", value: 81 },
      ]);
    });

    it("renders every faction and rarity name", async () => {
      for (let faction = 0; faction < FACTIONS.length; faction++) {
        await cards.mintCard(alice.address, CARD({ faction, general: `F${faction}` }));
        const meta = decodeMeta(await cards.tokenURI(faction + 1));
        expect(meta.attributes[0].value).to.equal(FACTIONS[faction]);
      }
      for (let rarity = 0; rarity < RARITIES.length; rarity++) {
        await cards.mintCard(alice.address, CARD({ rarity, general: `R${rarity}` }));
        const meta = decodeMeta(await cards.tokenURI(FACTIONS.length + rarity + 1));
        expect(meta.attributes[1].value).to.equal(RARITIES[rarity]);
      }
    });

    it("survives hostile general/series strings (JSON escaping, ③)", async () => {
      const general = 'Guan "Yun-chang" Yu\\';
      const series = 'Series "A"\nsecond\tline';
      await cards.mintCard(alice.address, CARD({ general, series }));
      const meta = decodeMeta(await cards.tokenURI(1)); // JSON.parse must not throw
      expect(meta.name).to.equal(`${general} #1`);
      expect(meta.description).to.equal(
        `Three Realms Cards - a Three Kingdoms general card of the ${series} series.`
      );
    });

    it("passes multi-byte UTF-8 through untouched", async () => {
      await cards.mintCard(alice.address, CARD({ general: "赵子龙 🐉", series: "五虎上将" }));
      const meta = decodeMeta(await cards.tokenURI(1));
      expect(meta.name).to.equal("赵子龙 🐉 #1");
      expect(meta.description).to.contain("五虎上将");
    });
  });

  // ------------------------------------------------------------- card key
  describe("cardKeyOf (global using-for)", () => {
    it("matches keccak(abi.encode(general, faction, series)) and ignores stats", async () => {
      await cards.mintCard(alice.address, CARD({ attack: 10 }));
      await cards.mintCard(alice.address, CARD({ attack: 99 }));
      await cards.mintCard(alice.address, CARD({ series: "Other" }));
      const expected = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["string", "uint8", "string"],
          ["Zhao Yun", 1, "Five Tigers"]
        )
      );
      expect(await cards.cardKeyOf(1)).to.equal(expected);
      expect(await cards.cardKeyOf(2)).to.equal(expected); // stats don't matter
      expect(await cards.cardKeyOf(3)).to.not.equal(expected); // series does
    });
  });

  // ------------------------------------------------------------ invariants
  describe("bookkeeping invariant storm", () => {
    it("random mints and transfers never desync owners and balances", async () => {
      const players = [owner, alice, bob, carol];
      const byAddress = new Map(players.map((p) => [p.address, p]));
      const rng = mulberry32(0x54524321);
      const owners = {};

      for (let i = 0; i < 8; i++) {
        const to = players[randInt(rng, players.length)];
        await cards.mintCard(
          to.address,
          CARD({
            general: `G${i}`,
            faction: randInt(rng, 4),
            rarity: randInt(rng, 5),
            attack: randInt(rng, 101),
            intellect: randInt(rng, 101),
            command: randInt(rng, 101),
            charisma: randInt(rng, 101),
          })
        );
        owners[i + 1] = to.address;
      }

      for (let step = 0; step < 25; step++) {
        const tokenId = 1 + randInt(rng, 8);
        const holder = byAddress.get(owners[tokenId]);
        const to = players[randInt(rng, players.length)];
        await cards.connect(holder).transferFrom(holder.address, to.address, tokenId);
        owners[tokenId] = to.address;
      }

      const tally = {};
      for (let tokenId = 1; tokenId <= 8; tokenId++) {
        expect(await cards.ownerOf(tokenId)).to.equal(owners[tokenId]);
        tally[owners[tokenId]] = (tally[owners[tokenId]] ?? 0) + 1;
      }
      let sum = 0n;
      for (const player of players) {
        const balance = await cards.balanceOf(player.address);
        expect(balance).to.equal(BigInt(tally[player.address] ?? 0));
        sum += balance;
      }
      expect(sum).to.equal(await cards.totalMinted());
    });
  });
});

// ------------------------------------------------- library differentials (④)
describe("library differentials", () => {
  let lib;

  before(async () => {
    lib = await ethers.deployContract("LibHarness");
  });

  it("Base64.encode matches Node's encoder on RFC 4648 vectors", async () => {
    for (const text of ["", "f", "fo", "foo", "foob", "fooba", "foobar"]) {
      const buf = Buffer.from(text, "ascii");
      expect(await lib.base64(buf)).to.equal(buf.toString("base64"));
    }
  });

  it("Base64.encode matches Node's encoder on seeded random blobs", async () => {
    const rng = mulberry32(0xc0ffee);
    const lengths = [1, 2, 3, 4, 5, 63, 64, 65];
    for (let i = 0; i < 32; i++) lengths.push(randInt(rng, 81));
    for (const length of lengths) {
      const bytes = Uint8Array.from({ length }, () => randInt(rng, 256));
      expect(await lib.base64(bytes)).to.equal(Buffer.from(bytes).toString("base64"));
    }
  });

  it("Str.toString matches BigInt.toString across the range", async () => {
    const values = [0n, 1n, 9n, 10n, 42n, 99n, 100n, 101n, 255n, 256n, 65535n, 10n ** 18n, 2n ** 256n - 1n];
    for (const value of values) {
      expect(await lib.toDecimalString(value)).to.equal(value.toString(10));
    }
  });

  it("Str.escapeJson output always re-parses to the original string", async () => {
    const samples = [
      "",
      "plain",
      'with "quotes"',
      "back\\slash",
      "line\nbreak\r\ttab",
      "  edge controls",
      "中文·赵子龙 🐉",
      '"\\\n mixed "',
    ];
    for (const sample of samples) {
      const escaped = await lib.escapeJson(sample);
      expect(JSON.parse(`"${escaped}"`)).to.equal(sample);
    }
    // clean strings take the fast path untouched
    expect(await lib.escapeJson("plain 中文")).to.equal("plain 中文");
  });

  it("Str.equal compares by content", async () => {
    expect(await lib.strEqual("Guan Yu", "Guan Yu")).to.equal(true);
    expect(await lib.strEqual("Guan Yu", "Guan Yu ")).to.equal(false);
    expect(await lib.strEqual("", "")).to.equal(true);
  });
});
