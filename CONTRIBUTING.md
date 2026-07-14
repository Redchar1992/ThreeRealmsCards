# Contributing

Thanks for looking under the hood. This repo is deliberately small — please
help keep it that way.

## Setup

```bash
npm install        # node >= 20
npm test           # 71 specs, ~2s
npm run coverage   # must stay at 100% — CI enforces it
```

No local TRON node is needed: the Hardhat suite is a logic-regression layer
(EVM ≡ TVM for everything used here). On-chain integration runs through the
TronIDE scenario replays (`scenarios/`) and the TronBox export
(`exports/tronbox/`).

## Ground rules

1. **Keep the spikes.** The unusual constructs (file-level definitions,
   `global` using-for, aliased imports, the two-path import in
   `PeachPavilion.sol`, the public-state-var interface override, assembly
   guard, reverting `receive`/`fallback`) are **load-bearing** — they exist
   to stress Solidity toolchains and are part of the dogfooding case study.
   Don't normalize them; if you must touch one, update
   [docs/architecture.md](docs/architecture.md) and
   [docs/case-study.md](docs/case-study.md) in the same PR.
2. **Coverage stays at 100%.** Statements, branches, functions, lines — the
   CI gate fails below that. New code ships with tests that reach it.
3. **Zero dependencies in `contracts/`.** No OpenZeppelin, no vendored
   libraries. The audit surface is this repo, in one sitting.
4. **Custom errors only.** No `require("string")` in production contracts
   (mocks may, to exercise the legacy decode path).
5. **Honest ledgers.** If you file a bug against the contracts or the IDE
   and later disprove it, retract it in writing with the root cause of the
   misread — that convention is the soul of `docs/journal.md`.

## Conventions

- Commits follow the existing history: `feat(scope): …`, `docs(scope): …`,
  `fix(scope): …`, with a `—`-separated summary.
- Solidity: 0.8.20, four-space indent, NatSpec on every external/public
  member; keep the section banner comments.
- The two READMEs (`README.md` / `README.zh-CN.md`) must stay in sync —
  update both or neither.
- `contracts/mocks/` is test-only and excluded from coverage; nothing there
  may be referenced by production code.

## What to work on

- Open items from the case study: an on-chain `image` (SVG) for the metadata
  pipeline, ERC-2981, enumeration-by-indexer examples.
- Anything in [SECURITY.md](SECURITY.md) "known limitations" that can be
  improved without breaking the design goals.
