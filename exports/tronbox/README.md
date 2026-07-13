# TronBox project exported from TronIDE

This project was generated from a deploy flow recorded in TronIDE
(Deploy & Run > Transactions recorded > Export to TronBox).

## Layout

- `contracts/` — the Solidity sources of your TronIDE workspace (plus TronBox's `Migrations.sol`)
- `migrations/2_deploy_contracts.js` — your recorded deploy flow, translated to a TronBox migration
- `tronbox-config.js` — Mainnet / Shasta / Nile / local network templates

## Usage

```shell
npm install -g tronbox
tronbox compile
```

Put your private key in a gitignored `.env` file (see `sample-env`), then:

```shell
source .env && tronbox migrate --network nile
```

(Use `--network shasta` or `--network mainnet` accordingly.)

## Notes

- Review `migrations/2_deploy_contracts.js` before migrating: steps the
  exporter could not translate are marked with TODO comments.
- Sources imported from outside the workspace (e.g. GitHub/.deps imports)
  are not bundled; install or copy them before compiling.
