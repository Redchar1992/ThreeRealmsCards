# Nile 测试网部署记录

## v5 — 渲染层版(当前)

| 项 | 值 |
|---|---|
| 合约 | `ThreeRealmsCards`(13 文件:加固版 + 可插拔链上 SVG 渲染层,assembly Base64) |
| 地址 | `TDQ9k3oqaV1tErua4uft1ZnndV96oFBH4X` |
| 渲染器 | `CardRenderer` @ `TAsJa3bbao3Kk71KMM2TDkpTBqPKvCT4KJ`(**未封印**,可迭代) |
| 部署交易 | [`26989981…`](https://nile.tronscan.org/#/transaction/26989981b1e7e99eae83) 创世 [`4277ff15…`] 渲染器 [`1bc86758…`] 接线 [`8a3061e2…`](txid 前缀,完整见账户页) |
| 部署账户 | `TCrDi83pUoK17GbwxN1SckM3YNXzahWvoN` |
| 编译器 | Tron Solidity 0.8.20(builtin);fee limit 上限 1000 TRX |
| 驱动 | `tools/p11-nile-v5.cjs` + `tools/p11b-genesis-renderer.cjs` |
| 虎符 | `TigerTally` @ `TMUmN6NKSyvAR6CJq2U8ndsCjXB2Uc7T19`(**现任 suzerain**,元帅=部署账户;部署 tx [`f3b02d40…`],经两步移交就任) |
| 日期 | 2026-07-14(P11/P12) |

**P12 虎符演武**:元帅经 TronLink typed-data 弹窗签发不记名 `MintOrder`(chainId 由链上 `domainSeparator()` 反推 = 3448148188;签名先本地 `ecrecover` 对权威 digest 验证再上链)→ 持券人兑现(tx [`015290ec…`](https://nile.tronscan.org/#/transaction/015290ec09703542f37f550b959b280cc86563c6610b86b968a8c94ce3871232))→ **诸葛亮 #4 铸成**(智力 100,LEGEND,系列 "Tiger Tally")。链上核验:`totalMinted=4`、`ownerOf(4)=元帅`、`tallyBroken(1)=true`(防重放生效)、`tokenURI(4)` 公共节点可读且 SVG 完整。

**P13 市集全周期**:`CardBazaar` @ `TKfYhL4AQvR5zHxaWezFN4ve7PChsEB6RU`(无 owner 无费用)。真实 TRX 走完整环:`approve`(tx `0187af70…`)→ `list(#3, 100 TRX)`(tx `8adc82f8…`,链上核验张飞入柜托管 + 摊位记录)→ `buy` 恰好价(tx [`b534b47a…`](https://nile.tronscan.org/#/transaction/b534b47a2b6af90ab73950d21bed91d9c8b1f1cc4eb4b4116501634dc74288e0),卡归买家、市集账户余额=100 TRX、待提款账本=100 TRX)→ `withdraw`(tx `85ce25e9…`,账本与市集余额双双归零)。**value 闭环收官**——四步全部 TronGrid 直查验证。

链上验证(TronGrid 直查):`renderer()==CardRenderer`、`rendererSealed=false`、`genesisSealed=true`、`totalMinted=3`、`supportsInterface(0x80ac58cd)=true`;**三张创世卡的 `tokenURI` 均可经公共节点读出**——双层 data-URI 解码成功,每张内嵌 SVG ~2.1KB,刘备/关羽/张飞 LEGEND 五星卡面完整。

> 性能教训:P10 的 v4 版 tokenURI(SVG + 双层 base64 逐字节循环)重达 **4.07M gas**,TronGrid 公共节点直接以 `OutOfTimeException`(常量调用 CPU 时限)拒读——**全链上美术的硬约束**。assembly Base64 + SVG 标记瘦身后降到 **1.46M(-64%)**,公共节点恢复可读。

## v4 — 渲染层首发(历史,渲染器已封印)

| 项 | 值 |
|---|---|
| 合约 / 渲染器 | `THRSFpEVownGtVx7WjdzYbbvqbTsD3iywJ` / `TCPVf7pGZWZ8Gn28eqJXfBTrFhNzfXaEoj` |
| 状态 | 创世已铸;`rendererSealed=true`;tokenURI 因 4.07M gas 在公共节点不可读(见上) |
| 日期 | 2026-07-14(P10) |

> 诚实入账:v4 的封印**并非有意**——驱动脚本用子串匹配选择实例行,`renderer` 命中了 `sealRenderer`,弹窗自动确认器把这笔交易签了(链上可见后续 4 笔 `RendererSealed` revert)。测试网无损失,主网即事故;修复 = 精确匹配行选择器(p11 起)。**模糊选择器 + 自动签名 = 不可逆链上变更**,这是 P10 最贵的一课。

## v3 — 加固版模块化架构(历史)

| 项 | 值 |
|---|---|
| 合约 | `ThreeRealmsCards`(11 文件加固版:两步移交 / safeTransferFrom / TRC-165 / JSON 转义) |
| 地址 | `TYK5P6bUBGuadpjyB9aZ6nVSDEj98PfSWR` |
| 部署交易 | [`d084fe93…02ef9df`](https://nile.tronscan.org/#/transaction/d084fe936f53d29dfed55d23e96814c7d3d5365233fab3138a56302d202ef9df) |
| 创世 mint | [`04b74b98…0fefcab`](https://nile.tronscan.org/#/transaction/04b74b98fe02e9b925fd1a66eae877ab81a640614f22a1739d44a30710fefcab) |
| 浏览器 | [TronScan (Nile) 合约页](https://nile.tronscan.org/#/contract/TYK5P6bUBGuadpjyB9aZ6nVSDEj98PfSWR) |
| 部署账户 | `TCrDi83pUoK17GbwxN1SckM3YNXzahWvoN` |
| 编译器 | Tron Solidity 0.8.20(builtin);optimizer 200;fee limit 上限 1000 TRX,实耗 4,260,454 energy |
| 驱动 | `tools/p8-nile-v3.cjs`(TronLink 弹窗自动确认 + 幂等工作区写入) |
| 日期 | 2026-07-14(P8) |

链上验证(TronGrid 直查,部署当日):`genesisSealed=true`、`totalMinted=3`、**`supportsInterface(0x80ac58cd)=true`、`(0x5b5e139f)=true`、`(0xffffffff)=false`**——TRC-165 只存在于加固版,直接证明新代码上链;`heirApparent=0`(两步移交 ABI 生效);`tokenURI(2)` 解码为 Guan Yu。桃园创世三卡(刘备 #1 / 关羽 #2 / 张飞 #3)已铸造。

> 教训入账:默认 fee limit 400,000,000 sun 的首次部署 `OUT_OF_ENERGY` 失败(tx `7876ad49…`,energy_usage_total 恰好 4,000,000,白付 23.885 TRX 手续费)——与 Nile 能量单价 100 sun/energy 的换算吻合;加固版实需 4,260,454。上调 fee limit 上限后同一部署一次成功。

## v2 — 多文件模块化架构(历史)

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
