# Architecture

The codebase is nine production Solidity files plus a test-double file. It is
small on purpose: the goal is a TRC-721 whose **entire on-chain surface can be
audited in one sitting**, with zero external dependencies, while doubling as a
stress fixture for Solidity toolchains (see [the spiky inventory](#the-spiky-constructs-inventory)).

## Module map

```text
                          ┌────────────────────────┐
                          │  ThreeRealmsCards.sol  │  TRC-721 card contract
                          └───┬──────┬──────┬──────┘
              is │            │      │      │ uses
        ┌────────┴───┐        │      │      └──────────────┐
        │ Suzerain   │        │      │                     │
        │ (access/)  │        │      │              ┌──────┴──────┐
        └────────────┘        │      │              │  CardCodec  │ library
   two-step ownership         │      │              │   (libs/)   │
                              │      │              └──┬───────┬──┘
                    is │      │      │ types      uses │       │ uses
        ┌──────────────┴──┐   │  ┌───┴─────────┐  ┌────┴───┐ ┌─┴────────┐
        │ ITRC721Metadata │   │  │ CardTypes   │  │ Str    │ │ Base64   │
        │ is ITRC721      │   │  │ (types/)    │  │(utils/)│ │ (libs/)  │
        │ is ITRC165      │   │  │ file-level  │  └────────┘ └──────────┘
        │ (interfaces/)   │   │  │ definitions │   toString     encode
        └─────────────────┘   │  └─────────────┘   escapeJson
                              │
                   ┌──────────┴───────────┐
                   │  PeachPavilion.sol   │  gift escrow, is ITRC721Receiver
                   └──────────────────────┘
```

| File | Responsibility | Notable |
|---|---|---|
| `ThreeRealmsCards.sol` | TRC-721 core + minting + safe transfers + TRC-165 | one public-state-var override survives by design |
| `access/Suzerain.sol` | two-step ownership (designate heir → heir accepts) | abstract, constructor must be chained |
| `interfaces/ITRC165.sol` | interface detection | |
| `interfaces/ITRC721.sol` | the nine core functions, `is ITRC165` | `type(ITRC721).interfaceId == 0x80ac58cd` — checked in tests |
| `interfaces/ITRC721Metadata.sol` | `name`/`symbol`/`tokenURI`, `is ITRC721` | two-level interface inheritance on purpose |
| `interfaces/ITRC721Receiver.sol` | safe-transfer receiver hook | |
| `interfaces/IRenderer.sol` | pluggable art hook: `(Card, tokenId) → image URI` | stateless by contract — the card is passed in, no storage access |
| `render/CardRenderer.sol` | 丹青 — the card face as pure on-chain SVG | user text in XML text nodes only, via `Str.escapeXml` |
| `types/CardTypes.sol` | `Faction`, `Rarity`, `Card`, `clampStat`, `cardKey` | everything file-level; `using {cardKey} for Card global` |
| `libs/CardCodec.sol` | `Card → data:application/json;base64` | escapes user strings; aliased import `Str as S` |
| `libs/Base64.sol` | assembly Base64 encoder | was a byte loop until P10: the 4.07M-gas double-encoded tokenURI hit public nodes' constant-call CPU cap (`OutOfTimeException`); now 1.46M. Differential-tested vs Node across the swap |
| `utils/StrUtils.sol` | `toString`, `equal`, `escapeJson` | escape: `"` `\` → backslashed, `< 0x20` → `\u00XX`, UTF-8 passthrough |
| `PeachPavilion.sol` | gift escrow with claim windows (v2): heir claims while `now <= claimBy`, giver reclaims after — gapless, overlap-free boundary | rejects naked deliveries; rejects heirless gifts (the v1 stuck-card trap) |
| `TigerTally.sol` | 虎符 — EIP-712 signed mint orders (lazy minting); holds the suzerainty while in service | zero-dep nested-struct 712, low-s `ecrecover`, marshal passthroughs for the full suzerain surface |
| `CardBazaar.sol` | 市集 — fixed-price stalls, TRX-settled, escrowed listings | pull-payment proceeds (CEI, reentrancy-tested), `call{value:}` over `.transfer`, zero governance surface |
| `mocks/TestMocks.sol` | receiver mocks, lib harness, abstract-base shims | **never deploy** |

## Standards conformance

- **Core surface.** All nine TRC-721 core functions exist with canonical
  signatures; the test suite XORs the selectors and asserts the result is the
  canonical `0x80ac58cd`, so a signature typo cannot silently break interface
  detection.
- **Revert semantics.** `ownerOf`, `getApproved`, `tokenURI`, `cardOf`,
  `cardKeyOf` revert with `UnknownCard(tokenId)` for tokens never minted;
  `balanceOf(address(0))` reverts with `ZeroHolderQuery()`. The one
  deliberately non-reverting getter is `isApprovedForAll` — the spec allows
  it, which is why it remains a public mapping overriding the interface
  function (a toolchain stress case we wanted to keep).
- **Safe transfers.** `safeTransferFrom` settles all state via `transferFrom`
  first, then probes contract recipients with `try/catch` on
  `onTRC721Received` (checks-effects-interactions: a malicious receiver can
  reenter but never observe or create inconsistent state). Wrong magic value,
  reverting hooks, and hookless contracts all end in `ReceiverRejected`.
  EOAs are detected with an `extcodesize` guard — with the standard,
  documented caveat that a contract under construction reads as an EOA.
- **TRC-165.** `supportsInterface` compares against
  `type(ITRC165|ITRC721|ITRC721Metadata).interfaceId` — computed by the
  compiler from the interface definitions themselves, so the constants cannot
  rot as the interfaces evolve.
- **Ownership.** `Suzerain` is two-step: `passSuzerainty(heir)` only
  designates (`address(0)` cancels); the heir's own `acceptSuzerainty()`
  moves the throne. A typoed address can misdesignate but can no longer brick
  the contract. For production custody, point the suzerain at a TRON
  multisig account (native account permissions) — no extra contract needed.

## The metadata pipeline

```text
Card (storage)
  → renderer set?  IRenderer.imageURI(card, tokenId)   [try/catch — failure ⇒ no image]
        CardRenderer: frame → header (name, faction·rarity, stars)
                      → four stat bars → footer, all pure string assembly
        → Base64.encode(svg) → "data:image/svg+xml;base64," ++ …
  → CardCodec.toTokenURI(card, tokenId, image)   [library using-for]
      → attributes JSON  (faction/rarity names, four stats via Str.toString)
      → top-level JSON   (general, series AND image via Str.escapeJson;
                          empty image ⇒ field omitted, byte-identical to v3)
  → Base64.encode(json)
  → "data:application/json;base64," ++ …
```

Design choices:

- **Everything on chain — including the art.** Both URIs are self-contained;
  wallets decode them with no network fetch. The cost is paid at read time
  (views are free on TRON) and metadata + artwork share the chain's lifetime.
- **Escaping at read time, not mint time.** Minting accepts any UTF-8 name;
  `escapeJson` guarantees the JSON stays valid (`"`, `\`, control chars) and
  `escapeXml` guarantees the SVG stays well-formed (`&` `<` `>` entities,
  control chars stripped — they are illegal in XML even escaped). Clean
  strings take a zero-copy fast path. User text never lands in an XML
  attribute, only in text nodes.
- **Renderer power is presentation-only, and one-way sealable.** The suzerain
  can swap `renderer` (`address(0)` = imageless) until `sealRenderer()`
  fires; after that the art is as immutable as the cards. `tokenURI` wraps
  the renderer call in `try/catch`: a broken or hostile renderer degrades to
  imageless metadata, and its output is JSON-escaped so it cannot inject
  fields — both paths are under test.

## The spiky constructs inventory

Every unusual construct below is **load-bearing for the dogfooding case
study** — it exists to stress a specific part of the toolchain. Do not
"clean them up" without updating [case-study.md](case-study.md).

| Construct | Where | What it stresses |
|---|---|---|
| file-level enums / struct / free functions / custom error | `types/CardTypes.sol` | lint parsers, UML, flatteners handling code outside contract bodies |
| `using {cardKey} for Card global` | `types/CardTypes.sol` | 0.8.13+ syntax through the whole pipeline; verified on Nile via `cardKeyOf` |
| aliased named import (`Str as S`) | `libs/CardCodec.sol` | import resolvers, flatten ordering |
| same file via two path strings (`./types/…` vs `../contracts/types/…`) | `PeachPavilion.sol` | path normalization + flattener dedup |
| public state var overriding an interface function | `ThreeRealmsCards.isApprovedForAll` | override checker, ABI generators |
| `pure` overriding `view` interface members | `name()`, `symbol()`, `supportsInterface()` | mutability-tightening rules |
| interface inheritance two levels deep | `ITRC721Metadata is ITRC721 is ITRC165` | UML, interface-id computation |
| custom errors everywhere (incl. file-level `StatOutOfRange`) | all contracts | ABI error decoding (found J-012: VM terminal didn't decode) |
| `unchecked` arithmetic | `_mint`, `transferFrom`, `Str.toString` | analyzers; bounded by 0-100 stats and one-owner-per-token invariants |
| assembly `extcodesize` guard | `ThreeRealmsCards.isDeployedContract` | analyzers, debugger stepping |
| `try/catch` with both `Error(string)` and bare branches | `PeachPavilion.depositGift`, receiver probe | debugger, coverage of both decode paths |
| reverting `receive()` **and** `fallback()` | both deployables | tooling that probes with plain transfers |
| pluggable renderer with a one-way seal (`setRenderer` / `sealRenderer`) | `ThreeRealmsCards` | minimal-governance pattern: mutable until sealed, immutable after |
| assembly Base64 (upgraded from a byte loop) | `libs/Base64.sol` | the P10 discovery: fully on-chain art must fit public nodes' constant-call CPU budget — heavyweight `tokenURI`s get `OutOfTimeException`, not metadata |
| nested-struct EIP-712 hashing (`MintOrder` wraps `Card`, strings hashed per spec) | `TigerTally.sol` | typed-data encoders; differentially anchored to ethers' `TypedDataEncoder` |
| contract-held ownership through the two-step handover | `TigerTally` + `Suzerain` | the *reason* one-step transfers to contracts are unsafe, demonstrated live |
| calldata slices (`signature[0:32]`) + low-s/v-normalizing `ecrecover` | `TigerTally._recover` | analyzers and debuggers on slice ops; EIP-2 malleability discipline |
| `try/catch` graceful degradation inside a view path | `ThreeRealmsCards.tokenURI` | external-call failure isolation; debugger/analyzer handling of catch-all in views |
| `immutable` interface reference / `uint64` timestamp | `PeachPavilion.cards`, `Suzerain.enthronedAt` | storage-layout tooling |
| free function validation (`clampStat` reverts, name notwithstanding) | `types/CardTypes.sol` | free-function call graphs (found J-011: linter false positive, fixed upstream) |

## What is deliberately NOT here

| Missing | Why |
|---|---|
| Enumerable extension (`totalSupply`/`tokenByIndex`…) | per-transfer gas tax for an indexer's job; `totalMinted()` + `Transfer` events feed any indexer |
| burn | genesis 1/1s are meant to be permanent; adding burn would complicate the `totalMinted == max id` invariant for no current need |
| pausability / upgradeability | immutability is the product: what you audit is what runs forever; custody risk is handled by the two-step + multisig owner instead |
| ERC-2981 royalties, gacha, supply caps | commercialization machinery, out of scope for a reference implementation (see the case study's scope decision) |

## Toolchain pinning

- `pragma solidity ^0.8.20`, compiled and deployed on Nile with **Tron
  Solidity 0.8.20 (builtin)**; the Hardhat harness pins upstream solc 0.8.20
  with `evmVersion: "paris"` so no PUSH0 lands ahead of TVM support.
- Optimizer on, 200 runs, in both worlds.
- The Hardhat suite is a logic-regression layer (EVM ≡ TVM for every
  construct used here); energy accounting, TronLink signing and TronScan
  verification are validated through the IDE scenario replays and the
  TronBox export instead.
- Foundry is the second verification stack: `test/invariant/` holds a
  guarded ecosystem handler (twelve ops including time warps, never
  reverting on purpose) fuzzed under `fail_on_revert` strict mode, with
  five invariants checked after every op. The harness base (`ForgeLite`)
  is written in-repo — the stale npm mirror and a forty-file submodule
  both lost to sixty lines of the subset we actually use.
