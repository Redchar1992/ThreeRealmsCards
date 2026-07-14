require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");

/**
 * Logic-regression harness: the contracts compile with upstream solc and run
 * on Hardhat's EVM — instruction-for-instruction equivalent to the TVM for
 * everything this codebase uses, and it needs no local java-tron. On-chain
 * integration (energy, TronLink, TronScan verification) stays in the TronIDE
 * scenario replays and the TronBox export.
 * evmVersion is pinned to "paris" so no PUSH0 sneaks in ahead of the TVM.
 */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
  },
  mocha: {
    timeout: 120000,
  },
};
