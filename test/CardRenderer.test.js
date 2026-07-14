const { expect } = require("chai");
const { ethers } = require("hardhat");
const { XMLValidator } = require("fast-xml-parser");

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

const FACTION_COLORS = ["#4a7bd0", "#c8452c", "#2f9e63", "#b08a3e"];
const FACTION_NAMES = ["WEI", "SHU", "WU", "QUN"];
const RARITY_COLORS = ["#9aa0a6", "#6fa8ff", "#b07ce8", "#f0b429", "#e8c15a"];

const SVG_PREFIX = "data:image/svg+xml;base64,";

function decodeSvg(uri) {
  expect(uri.startsWith(SVG_PREFIX), `unexpected image URI prefix: ${uri.slice(0, 40)}`).to.be.true;
  return Buffer.from(uri.slice(SVG_PREFIX.length), "base64").toString("utf8");
}

describe("CardRenderer", () => {
  let renderer;

  before(async () => {
    renderer = await ethers.deployContract("CardRenderer");
  });

  it("emits a base64 SVG data URI that is well-formed XML", async () => {
    const svg = decodeSvg(await renderer.imageURI(CARD(), 7));
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).to.be.true;
    expect(svg.endsWith("</svg>")).to.be.true;
    expect(XMLValidator.validate(svg)).to.equal(true);
  });

  it("renders name, faction·rarity caption, series and token id", async () => {
    const svg = decodeSvg(await renderer.imageURI(CARD(), 7));
    expect(svg).to.contain("Zhao Yun");
    expect(svg).to.contain("SHU · SSR");
    expect(svg).to.contain("Five Tigers · #7");
  });

  it("themes every faction with its color and label", async () => {
    for (let faction = 0; faction < 4; faction++) {
      const svg = decodeSvg(await renderer.imageURI(CARD({ faction }), 1));
      expect(svg).to.contain(FACTION_COLORS[faction]);
      expect(svg).to.contain(`${FACTION_NAMES[faction]} · SSR`);
      expect(XMLValidator.validate(svg)).to.equal(true);
    }
  });

  it("themes every rarity with its color and star count", async () => {
    for (let rarity = 0; rarity < 5; rarity++) {
      const svg = decodeSvg(await renderer.imageURI(CARD({ rarity }), 1));
      expect(svg).to.contain(RARITY_COLORS[rarity]);
      expect(svg.match(/★+/)[0].length).to.equal(rarity + 1);
      expect(XMLValidator.validate(svg)).to.equal(true);
    }
  });

  it("gives LEGENDs (and only LEGENDs) the outer halo", async () => {
    const legend = decodeSvg(await renderer.imageURI(CARD({ rarity: 4 }), 1));
    const ssr = decodeSvg(await renderer.imageURI(CARD({ rarity: 3 }), 1));
    expect(legend).to.contain('opacity="0.8"');
    expect(ssr).to.not.contain('opacity="0.8"');
  });

  it("scales stat bars ×1.9 and omits the fill for zero stats", async () => {
    const svg = decodeSvg(
      await renderer.imageURI(CARD({ attack: 100, intellect: 0, command: 50, charisma: 1 }), 1)
    );
    const fills = svg.match(/<rect x="76" y="\d+" width="(\d+)" height="16" rx="8" fill="#c8452c"\/>/g) || [];
    expect(fills.length).to.equal(3); // the zero stat draws nothing
    expect(svg).to.contain('width="190" height="16" rx="8" fill="#c8452c"'); // 100 → 190
    expect(svg).to.contain('width="95" height="16" rx="8" fill="#c8452c"'); // 50 → 95
    expect(svg).to.contain('width="1" height="16" rx="8" fill="#c8452c"'); // 1 → 1
    // background troughs always render for all four stats
    expect((svg.match(/fill="#232833"/g) || []).length).to.equal(4);
    expect(XMLValidator.validate(svg)).to.equal(true);
  });

  it("escapes XML specials in name/series and strips control chars", async () => {
    const svg = decodeSvg(
      await renderer.imageURI(CARD({ general: "Cao & <Wei> Pi", series: "S>eries\u0001X" }), 1)
    );
    expect(svg).to.contain("Cao &amp; &lt;Wei&gt; Pi");
    expect(svg).to.contain("S&gt;eriesX · #1");
    expect(svg).to.not.contain("\u0001");
    expect(XMLValidator.validate(svg)).to.equal(true);
  });

  it("passes CJK and emoji through untouched", async () => {
    const svg = decodeSvg(await renderer.imageURI(CARD({ general: "赵子龙 🐉", series: "五虎上将" }), 1));
    expect(svg).to.contain("赵子龙 🐉");
    expect(svg).to.contain("五虎上将 · #1");
    expect(XMLValidator.validate(svg)).to.equal(true);
  });

  it("is deterministic", async () => {
    expect(await renderer.imageURI(CARD(), 42)).to.equal(await renderer.imageURI(CARD(), 42));
  });
});
