# Three Realms Cards · 三分天下

[![CI](https://github.com/Redchar1992/ThreeRealmsCards/actions/workflows/ci.yml/badge.svg)](https://github.com/Redchar1992/ThreeRealmsCards/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Solidity](https://img.shields.io/badge/solidity-0.8.20-363636)
![Coverage](https://img.shields.io/badge/coverage-100%25_stmts_·_branches_·_funcs_·_lines-brightgreen)

**A fully on-chain, modular TRC-721 on TRON, engineered to audit-grade practice — and a complete, brutally honest dogfooding case study of [TronIDE](https://github.com/tronweb3/TronIDE).**

English · [简体中文](README.zh-CN.md)

Three Kingdoms general cards: four factions (WEI / SHU / WU / QUN), five rarities (N → LEGEND), four 0–100 stats, and a one-shot **"Peach Garden" genesis** — Liu Bei, Guan Yu, Zhang Fei as LEGEND 1/1s, sealed forever after one mint. Metadata — and, through the sealable SVG renderer, **the card art itself** — lives entirely on chain as data URIs: no IPFS pin to lapse, no metadata server to die. If the chain is up, the cards are whole.

## Why this repo is worth reading

- **A reference TRC-721, zero dependencies.** The full core + metadata surface — both `safeTransferFrom` overloads with a `try/catch` receiver probe, TRC-165 with compiler-computed `type(X).interfaceId` (no hand-copied magic constants), spec-grade revert semantics on `ownerOf` / `balanceOf` / `getApproved`, two-step ownership handover, custom errors throughout. No OpenZeppelin import: every byte that ends up on chain is in this repo, which makes the whole surface auditable in one sitting.
- **Fully on-chain metadata *and artwork*.** `Card → JSON → Base64 → data:` URI for metadata, plus `CardRenderer` — the card face drawn as pure SVG in Solidity (faction-themed frame, rarity stars, stat bars) and embedded as a nested `data:image/svg+xml;base64` URI. User strings are JSON-escaped *and* XML-escaped on chain; a broken or hostile renderer degrades to imageless metadata instead of bricking `tokenURI`; the suzerain can `sealRenderer()` forever once the art is final.
- **Deliberately spiky Solidity.** File-level types and free functions, a `global` using-for, aliased named imports, a same-file-two-paths import trap, a public-state-var overriding an interface function, `unchecked` blocks, an assembly guard, reverting `receive`/`fallback` — each one placed on purpose to stress compilers, flatteners, UML generators, linters and analyzers, and annotated with *why*. See [docs/architecture.md](docs/architecture.md).
- **71 tests, 100% coverage, gated in CI.** Statements, branches, functions and lines all at 100% (mocks excluded); the CI fails if any of it regresses. Includes differential tests of the on-chain Base64/decimal/JSON-escape/XML-escape helpers against reference implementations, XML well-formedness checks on every rendered SVG, a receiver-behavior matrix, and a seeded random transfer storm checked against a model.
- **A real dogfooding campaign, honestly kept.** The entire project — scaffold, edit, lint, compile, VM deploy, debug, record/replay, TronBox export, git push, TronLink mainnet-style deploys, flatten & verification — was executed **inside TronIDE**, driving 23 IDE features and filing 13 findings, of which 6 were fixed upstream with regression gates and **3 were retracted after strict re-verification** (the ledger counts our own misreads too). See [docs/case-study.md](docs/case-study.md).

> **Audit status:** engineered to audit-grade practice, **not yet externally audited**. Read [SECURITY.md](SECURITY.md) before depositing value you care about.

## Contracts

```text
contracts/
├── ThreeRealmsCards.sol        the TRC-721 card contract
│   ├── interfaces/
│   │   ├── ITRC165.sol         interface detection
│   │   ├── ITRC721.sol         core surface (is ITRC165) — 9 fns XOR to 0x80ac58cd
│   │   ├── ITRC721Metadata.sol name / symbol / tokenURI (is ITRC721)
│   │   ├── ITRC721Receiver.sol safe-transfer hook
│   │   └── IRenderer.sol       pluggable art hook (Card in, image URI out)
│   ├── access/Suzerain.sol     two-step Ownable (主公): designate heir → heir accepts
│   ├── render/CardRenderer.sol 丹青 — the card face as pure on-chain SVG
│   ├── types/CardTypes.sol     file-level enums, Card struct, free fns, global using-for
│   ├── libs/CardCodec.sol      Card → data:application/json;base64 (JSON-escaped)
│   ├── libs/Base64.sol         loop-based encoder, no assembly
│   └── utils/StrUtils.sol      toString / equal / escapeJson / escapeXml
├── PeachPavilion.sol           gift escrow: deposit a card for an heir to claim;
│                               rejects naked safeTransferFrom deliveries
└── mocks/TestMocks.sol         test doubles only — never deploy
```

## Live on Nile testnet

| Version | Contract | Address | Notes |
|---|---|---|---|
| **v3 (current)** | `ThreeRealmsCards` (hardened, 11 files) | [`TYK5P6bUBGuadpjyB9aZ6nVSDEj98PfSWR`](https://nile.tronscan.org/#/contract/TYK5P6bUBGuadpjyB9aZ6nVSDEj98PfSWR) | genesis minted; `supportsInterface(0x80ac58cd)` + two-step ownership ABI verified on chain |
| v2 (historical) | `ThreeRealmsCards` (modular, 9 files) | [`TEzyMokXwNqJteoSGC1v4rerK4mkfYE1f9`](https://nile.tronscan.org/#/contract/TEzyMokXwNqJteoSGC1v4rerK4mkfYE1f9) | first modular deploy; `cardKeyOf` (global using-for) verified on chain |
| v1 (historical) | `ThreeRealmsCards` (single file) | [`TBig1iST9AW2vUrcQZ2nDTCtL3kf7gb18V`](https://nile.tronscan.org/#/contract/TBig1iST9AW2vUrcQZ2nDTCtL3kf7gb18V) | first campaign deploy |

Transactions, deployer, energy numbers and verification materials: [deployments/nile.md](deployments/nile.md).

## Quickstart

```bash
npm install
npm test              # 71 specs, ~2s, no local TRON node needed
npm run coverage      # istanbul report; CI enforces 100%
npx hardhat compile   # solc 0.8.20, evm target paris (no PUSH0 ahead of the TVM)
```

The Hardhat suite is a **logic-regression harness**: upstream solc + an EVM is instruction-equivalent to the TVM for everything this codebase uses, so unit tests run anywhere, fast. On-chain integration (energy model, TronLink signing, TronScan verification) is exercised separately through the TronIDE scenario replays (`scenarios/`) and the TronBox export (`exports/tronbox/`).

## Repository layout

| Path | What it is |
|---|---|
| `contracts/` | the production sources (see map above) |
| `test/` | Hardhat suite — conformance, receiver matrix, differentials, invariants |
| `docs/architecture.md` | module walkthrough + the annotated "spiky constructs" inventory |
| `docs/case-study.md` | the TronIDE dogfooding campaign, in English |
| `docs/journal.md` | full campaign journal (Chinese, primary source) |
| `docs/dogfooding-matrix.md` | 23-feature coverage matrix |
| `deployments/nile.md` | live addresses, txids, compiler settings |
| `scenarios/` | IDE recorder scenario (deploy → genesis → reads), replayable |
| `exports/` | IDE-generated TronBox project + flattened verification sources |
| `tools/` | Playwright scripts that drove the IDE for each campaign phase |

## The dogfooding story, in numbers

**23** IDE features exercised end-to-end · **13** findings filed (J-001…J-013) · **6** fixed upstream with regression gates · **3** honestly retracted after re-verification · **2** root-caused to a shared LocalStorage-backend design and scheduled as upstream migration work · **2** live deployments signed through TronLink on Nile.

The campaign's discipline — *verify strictly before concluding, retract in public, prefer reading the chain over reading the UI* — is documented in [docs/case-study.md](docs/case-study.md).

## License

[MIT](LICENSE)
