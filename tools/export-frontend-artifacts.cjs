#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const deploymentPath = path.join(root, "deployments", "nile.json");
const outputDir = path.join(root, "deployments", "abi");

const artifactPaths = {
  ThreeRealmsCards: "artifacts/contracts/ThreeRealmsCards.sol/ThreeRealmsCards.json",
  CardRenderer: "artifacts/contracts/render/CardRenderer.sol/CardRenderer.json",
  TigerTally: "artifacts/contracts/TigerTally.sol/TigerTally.json",
  CardBazaar: "artifacts/contracts/CardBazaar.sol/CardBazaar.json",
  PeachPavilion: "artifacts/contracts/PeachPavilion.sol/PeachPavilion.json"
};

const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
const declaredNames = new Set(
  Object.values(deployment.contracts).map((contract) => contract.name)
);

fs.mkdirSync(outputDir, { recursive: true });

for (const [contractName, artifactPath] of Object.entries(artifactPaths)) {
  if (!declaredNames.has(contractName)) {
    throw new Error(`${contractName} is missing from deployments/nile.json`);
  }

  const absoluteArtifactPath = path.join(root, artifactPath);
  if (!fs.existsSync(absoluteArtifactPath)) {
    throw new Error(
      `Missing ${artifactPath}. Run npm run compile before exporting frontend artifacts.`
    );
  }

  const artifact = JSON.parse(fs.readFileSync(absoluteArtifactPath, "utf8"));
  const output = {
    contractName,
    sourceName: artifact.sourceName,
    abi: artifact.abi
  };

  fs.writeFileSync(
    path.join(outputDir, `${contractName}.json`),
    `${JSON.stringify(output, null, 2)}\n`
  );
}

console.log(`Exported ${Object.keys(artifactPaths).length} frontend ABIs to deployments/abi`);
