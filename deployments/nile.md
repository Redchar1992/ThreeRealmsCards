# Nile 测试网部署记录

## v2 — 多文件模块化架构(当前)

| 项 | 值 |
|---|---|
| 合约 | `ThreeRealmsCards`(9 文件架构,拍平后单文件语义等价) |
| 地址 | `TEzyMokXwNqJteoSGC1v4rerK4mkfYE1f9` |
| 部署交易 | [`515cc242…fb05bd`](https://nile.tronscan.org/#/transaction/515cc2426e634074c7fbe8a02c6a3e1d33ea27400f3c0840db99ae0276fb05bd) |
| 创世 mint | [`cadaddb77…78e21`](https://nile.tronscan.org/#/transaction/cadaddb77bbba7a030f4f06a05569be79b4cafa579562d4882aa16614f478e21) |
| 浏览器 | [TronScan (Nile) 合约页](https://nile.tronscan.org/#/contract/TEzyMokXwNqJteoSGC1v4rerK4mkfYE1f9) |
| 部署账户 | `TCrDi83pUoK17GbwxN1SckM3YNXzahWvoN` |
| 编译器 | Tron Solidity 0.8.20(builtin);TronScan 验证用主合约 flatten |
| 日期 | 2026-07-14 |

链上验证(部署当日):`genesisSealed=true`、`totalMinted=3`、`balanceOf(owner)=3`;`tokenURI(2)` 解码为 `{"name":"Guan Yu #2",…"Faction":"SHU"…}`(库管线 base64 全链上编码正常);`cardKeyOf(1)=0xaef847e7…530b34`(**global using-for 在真链上生效**)。桃园创世三卡(刘备 #1 / 关羽 #2 / 张飞 #3)已铸造。

> `PeachPavilion` 托管合约的跨账户礼物流转已在 VM 完整验证(P6),真链需第二个 Nile 账户,未在本轮部署。

## v1 — 单合约版本(历史)

| 项 | 值 |
|---|---|
| 合约 | `ThreeRealmsCards`(单文件自包含版) |
| 地址 | `TBig1iST9AW2vUrcQZ2nDTCtL3kf7gb18V` |
| 部署交易 | [`7fb10c15…3bbf19`](https://nile.tronscan.org/#/transaction/7fb10c15aff213e290325d44fae67602e4fd6d16cedd741eb334157c283bbf19) |
| 日期 | 2026-07-13 |
