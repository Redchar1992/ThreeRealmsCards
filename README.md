# 三分天下 · Three Realms Cards

三国武将卡牌 NFT,TRON 链 TRC-721。**T**hree **R**ealms **C**ards —— 缩写 TRC,呼应 TRC-721。

本项目同时是 [TronIDE](https://github.com/tronweb3/TronIDE) 的全功能 dogfooding:每个 IDE 功能都在真实开发流程中使用一遍,发现的问题回流 IDE 缺陷清单(见 `docs/journal.md`)。

## 卡牌设计

| 维度 | 设计 |
|---|---|
| 阵营 | 魏 WEI / 蜀 SHU / 吴 WU / 群 QUN |
| 稀有度 | N / R / SR / SSR / LEGEND |
| 四维 | 武力 / 智力 / 统率 / 魅力(0-100) |
| 创世系列 | 「桃园」— 刘备 / 关羽 / 张飞,各 1/1,owner mint |
| 元数据 | MVP 用链上 data-URI JSON,后续可切 IPFS |

## 技术

- 合约 `ThreeRealmsCards`:从 TronIDE `trc721-minimal` 模板起步(自包含 TRC-721 核心面,浏览器可编译),逐步扩展属性存储、分系列 mint、tokenURI。
- 开发主战场:TronIDE(dev build,workspace `three-realms`,持久浏览器 profile 在 `../.tronide-profile`)。
- 本仓库是规范镜像:IDE 工作区的合约/脚本定期同步至此;`docs/` 记录 dogfooding 进展。

## 阶段

- **P0 立项** ✅ 工作区(模板)+ 编译冒烟 + 本仓库奠基
- **P1 合约开发** — 编辑器 lint / AI 工具 / Format / UML / 静态分析 / 编译器配置
- **P2 本地链** — VM 部署 / recorder 场景 / debugger / TronBox 导出
- **P3 版本管理** — IDE Git 面板 / GitHub 推送
- **P4 实链** — TronLink Nile 部署 / TronScan 验证包(Flatten)
- **P5 收尾** — 备份恢复演练 / 缺陷清单汇总

进度矩阵:`docs/dogfooding-matrix.md` · 开发日志:`docs/journal.md`
