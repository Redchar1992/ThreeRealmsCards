// temporary probe — measures view-path gas for tokenURI shapes (not a spec)
const { ethers } = require("hardhat");

async function main() {
  const cards = await ethers.deployContract("ThreeRealmsCards");
  const renderer = await ethers.deployContract("CardRenderer");
  const [owner] = await ethers.getSigners();
  await cards.mintPeachGardenGenesis(owner.address);

  const bare = await cards.tokenURI.estimateGas(2);
  await cards.setRenderer(await renderer.getAddress());
  const withImage = await cards.tokenURI.estimateGas(2);
  const imageOnly = await renderer.imageURI.estimateGas(
    { general: "Guan Yu", faction: 1, rarity: 4, attack: 97, intellect: 80, command: 92, charisma: 93, series: "Peach Garden" },
    2
  );
  console.log(`tokenURI (no image):   ${bare}`);
  console.log(`tokenURI (with SVG):   ${withImage}`);
  console.log(`renderer.imageURI:     ${imageOnly}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
