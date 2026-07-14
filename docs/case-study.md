# Dogfooding TronIDE: the Three Realms Cards campaign

*An end-to-end field test of [TronIDE](https://github.com/tronweb3/TronIDE)
(dev build), run by shipping a real TRC-721 project through it — from empty
workspace to two Nile deployments — and filing every friction point found
along the way. The primary source is the Chinese
[journal.md](journal.md); this document is the English summary. Feature
coverage lives in [dogfooding-matrix.md](dogfooding-matrix.md).*

## Method

- **Real work, not scripted demos.** Every IDE feature was exercised because
  the project actually needed it: the contract was written, linted,
  formatted, compiled, deployed, debugged, recorded, exported, versioned,
  pushed, flattened and verified **inside the IDE**.
- **Automated driving, human judgment.** Playwright scripts (`tools/*.cjs`)
  drove the browser IDE over CDP — including taking over the user's real
  Chrome with an unlocked TronLink for the mainnet-style deploys — while
  findings were verified by hand before filing.
- **An honest ledger.** Findings that didn't survive strict re-verification
  were **retracted in public, with the root cause of the misread recorded**.
  Three of thirteen were. The retractions taught as much about test-probe
  design as the bugs taught about the IDE.

## Campaign timeline

| Phase | What shipped | IDE surface exercised |
|---|---|---|
| P0 scaffold | workspace from `trc721-minimal` template, smoke compile | templates, welcome flow, builtin compiler |
| P1 contract | v1 single-file TRC-721 (cards + one-shot genesis + data-URI metadata) | AI create-file loop, live lint, format, UML, static analysis, autosave, compiler versions (0.8.6 → 0.8.27) |
| P2 local chain | genesis flow on the JS VM; scenario recorded & replayed; TronBox export | VM deploy/interact, recorder, debugger stepping, export |
| P3 versioning | workspace pushed to GitHub through the CORS proxy; cloned back | git panel, PAT auth, real-credential push/clone |
| P4 mainnet-style | **v1 live on Nile** (`TBig1iST…`), genesis minted, flatten + verification package | Injected TronWeb, TronLink signing, flatten, verification |
| P5 wrap | backup/restore drill; campaign accounting | workspace zip export/restore, global search |
| P6 modular | **9-file architecture, deliberately spiky** (see [architecture.md](architecture.md)); PeachPavilion escrow | multi-file compile graph, flatten dedup, UML inheritance, analyzers vs assembly/try-catch/global using-for |
| P7 redeploy | **v2 live on Nile** (`TEzyMokX…`), `cardKeyOf` (global using-for) verified on chain | lightweight workspace, full-graph builtin compile, second TronLink deploy |
| P8 hardened redeploy | **v3 live on Nile** (`TYK5P6bU…`) — the hardened build; TRC-165 + two-step ownership ABI verified on chain via TronGrid | fee-limit sizing (first attempt `OUT_OF_ENERGY` at the 400 TRX default), TronLink popup auto-confirm, idempotent workspace writes dodging the J-005 race |

After the campaign, the repo gained a Hardhat logic-regression harness
(54 specs, 100% statement/branch/function/line coverage, CI-gated) and a
production-hardening round: two-step ownership, `safeTransferFrom` +
TRC-165, spec-grade revert semantics, on-chain JSON escaping.

## Findings ledger (J-001 … J-013)

| ID | Class | Status | One line |
|---|---|---|---|
| J-001 | product default | **mostly retracted** | "recommended compiler badge not clickable" — it was; residual question (default ≠ recommended version) judged acceptable |
| J-002 | UX noise | **fixed upstream** | duplicate "is modifying" toasts on every compile — silenced |
| J-003 | usability | **fixed upstream** | last-used workspace not restored across sessions (while compiler version was) — now restored, with fallback |
| J-004 | product default | open observation | remote 0.8.27 loads in 6–9 s, weakening the case for defaulting to old builtin 0.8.6 |
| J-005 | data loss | **root-caused → design item** | files written shortly before a browser-process kill vanish; cause: BrowserFS **LocalStorage backend** lazy persistence → IndexedDB migration scheduled |
| J-006 | noise | **fixed upstream** | 80 advisory hits on a clean ~200-line contract — advisory group now collapsed by default |
| J-007 | export | **retracted** | "silent no-op export" — an existing "Nothing to export" modal was missed by a download-only probe; driver blind spot, not a product bug |
| J-008 | export correctness | **fixed upstream** | reverted VM transactions were exported as executable migration steps — now emitted as TODO comments |
| J-009 | data loss family | **fixed upstream** | cloning an image-bearing repo into a near-quota profile fails mid-flight and strands a selected-but-empty workspace; quota errors humanized, last-used marker fixed |
| J-010 | data availability | **root-caused → design item** | restore-from-zip writes the backup into a `/.workspaces/.workspaces/…` nested black hole — data intact but unreachable; vendored plugin rebuild scheduled with the IndexedDB batch |
| J-011 | linter false positive | **fixed upstream, same day** | file-level free functions flagged for missing visibility (which they must not have) — SourceUnit-level functions exempted, gated both ways |
| J-012 | DX enhancement | filed | VM terminal shows raw revert data for custom errors despite having the ABI to decode names |
| J-013 | compiler UX | **fully retracted** | two sub-claims ("version-mismatch silent failure", "stale artifacts after failed compile") both disproved under strict re-verification; probe timing artifacts |

**Tally: 13 filed → 6 fixed upstream (each with a regression gate), 3
retracted, 2 root-caused into one shared design item (LocalStorage backend →
IndexedDB migration), 1 open default-setting observation, 1 enhancement
filed.**

## What the campaign proved about the *project*

- The full on-chain metadata pipeline (`Card → JSON → Base64 → data:` URI)
  decodes correctly in the VM, in wallets, and on Nile — twice.
- The one-shot genesis guard held under replay (second call reverts, replay
  halts at the failed step by design).
- `using … for … global`, file-level types, aliased imports and the
  two-path import trap survive the entire toolchain: compile, flatten
  (deduped correctly), UML, analysis, deploy.
- Escrow (PeachPavilion) ran a full cross-account gift flow on the VM:
  deposit → wrong-account claim rejected → heir claims.

## Lessons that transfer

1. **Verify strictly before concluding.** All three retractions came from
   probes that over-interpreted what they saw (waited for the wrong signal,
   missed a modal, misread polling timing). The discipline "reproduce under
   controlled conditions before filing" is the campaign's core rule.
2. **Read the chain, not the UI.** When a click overlay blocked a UI
   read-back after a Nile deploy, querying the chain directly settled it —
   the transaction had long landed.
3. **Redundancy is the real backup.** A restore-freeze incident (J-010)
   destroyed the headless browser profile mid-campaign; nothing of value was
   lost because everything lived in three places (repo + GitHub + chain).
   Rebuilding the environment from scratch took ten minutes.
4. **Silent failures must be visible.** The recurring theme across J-007,
   J-008, J-009, J-010: the worst bugs are the ones that say nothing.
