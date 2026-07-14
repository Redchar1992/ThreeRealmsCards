# Security

## Status — read this first

- **No external audit has been performed yet.** "Audit-grade" in this repo's
  description refers to engineering practice (scope, tests, documentation),
  not to a completed audit. Do not custody meaningful value on unaudited
  deployments.
- The live Nile instances are **testnet** deployments. The current
  `TDQ9k3oq…` (v5) instance runs the hardened build plus the on-chain SVG
  renderer (`TAsJa3bb…`, unsealed) — standards surface, two-step handover
  and all three genesis `tokenURI`s were verified on chain through public
  nodes right after deployment; the v5 suzerainty is currently held by a
  `TigerTally` (`TMUmN6NK…`) whose marshal is the deploy account, with
  `returnSuzerainty` as the escape hatch. v4/v3/v2/v1 are historical (see
  deployments/nile.md, including the honest v4 incident notes).

## Engineering posture

- 92 Hardhat specs; **100% statement / branch / function / line coverage**
  over every deployable contract (mocks excluded), enforced by a CI gate
  that fails below 100%.
- Differential tests: the on-chain Base64 and decimal encoders are compared
  against Node's implementations on RFC 4648 vectors plus seeded random
  blobs; `escapeJson` output must `JSON.parse` back to the original string;
  `escapeXml` is compared against a reference implementation and every
  rendered SVG must pass an XML well-formedness check.
- Invariant testing: a seeded random mint/transfer storm re-derives the full
  ownership ledger and reconciles it against `ownerOf`/`balanceOf`/
  `totalMinted`.
- Zero external Solidity dependencies — the audit surface is exactly this
  repository.
- Checks-effects-interactions: `safeTransferFrom` settles all state before
  the external receiver probe; the probe is wrapped in `try/catch` and
  rejects wrong magic values.

## Trust model

| Power | Holder | Bound |
|---|---|---|
| mint any card / the one-shot genesis | `suzerain` | genesis is single-shot for everyone, forever (`genesisSealed`) |
| hand over control | `suzerain` → heir | two-step: heir must `acceptSuzerainty()`; `address(0)` cancels |
| swap / seal the art renderer | `suzerain` (until sealed) | presentation-only: a renderer can never touch ownership, stats or metadata text; hostile output is escaped inert; failures degrade to imageless metadata; `sealRenderer()` is one-way |
| sign mint orders / void tallies / drive the seat while a TigerTally holds the throne | `marshal` (immutable per tally) | vouchers can be bricked (`voidTally`) but never unsigned; every voucher mint still passes the cards contract's own validation; `returnSuzerainty` is the always-available escape hatch |
| pause / upgrade / burn / censor transfers | **nobody** | not implemented — deployed code is immutable |

Holders' transfer and approval rights follow TRC-721 exactly; the suzerain
has **no** power over already-minted cards.

**Custody recommendation:** on production deployments, make the suzerain a
TRON multisig account (native account-permission feature — no extra
contract needed) and rehearse the two-step handover on testnet first.

## Known limitations (by design)

- `extcodesize` receiver detection treats a contract **under construction**
  as an EOA — the standard, documented limitation of every ERC/TRC-721
  implementation of this shape.
- Plain `transferFrom` to a contract without a receiver hook can still
  strand a card (only `safeTransferFrom` probes recipients) — exactly per
  spec.
- No enumerable extension: index via `Transfer`/`CardMinted` events.
- `unchecked` blocks rely on invariants (stats ≤ 100 enforced at mint; one
  owner per token makes balance under/overflow unreachable); these
  invariants are what the test storm checks.
- `PeachPavilion.depositGift` trusts the card contract it was constructed
  with; it is an escrow for *this* collection, not a generic vault.

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** on this repository
(Security → Report a vulnerability). If that is unavailable, open an issue
titled `[security]` *without* exploit details and a maintainer will follow
up privately. Testnet-only findings are welcome too — this project treats
honest ledgers as a feature.
