# 三分天下 · Three Realms Cards

[![CI](https://github.com/Redchar1992/ThreeRealmsCards/actions/workflows/ci.yml/badge.svg)](https://github.com/Redchar1992/ThreeRealmsCards/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Solidity](https://img.shields.io/badge/solidity-0.8.20-363636)
![Coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)

**TRON 上按审计级工程实践打造的全链上、模块化 TRC-721 —— 同时是 [TronIDE](https://github.com/tronweb3/TronIDE) 的一份完整、诚实的 dogfooding 案例研究。**

[English](README.md) · 简体中文

三国武将卡牌：魏 / 蜀 / 吴 / 群四阵营，N → LEGEND 五档稀有度，武力 / 智力 / 统率 / 魅力四维（0–100），以及一次性的**「桃园」创世**——刘备、关羽、张飞 LEGEND 1/1，铸后永封。元数据——连同经可封印 SVG 渲染器生成的**卡面本身**——整体以 data URI 上链：没有会过期的 IPFS pin，没有会宕的元数据服务器——链在，卡就完整。

## 这个仓库值得一读的理由

- **零依赖的 TRC-721 参考实现**：完整核心面 + 元数据扩展——双重载 `safeTransferFrom`（try/catch 受体探测）、`type(X).interfaceId` 编译器计算的 TRC-165（不手抄魔法常量）、`ownerOf` / `balanceOf` / `getApproved` 规范级回滚语义、两步 owner 移交、全程自定义错误。不引 OpenZeppelin：上链的每个字节都在本仓库内，一次通读即可完成审计面覆盖。
- **全链上元数据与卡面**：`Card → JSON → Base64 → data:` URI 之外，`CardRenderer`（丹青）用纯 Solidity 画出 SVG 卡面（阵营配色边框、稀有度星级、四维属性条），以嵌套 `data:image/svg+xml;base64` 内嵌。用户字符串链上做 JSON **和** XML 双重转义；渲染器坏掉或作恶时 `tokenURI` 优雅降级为无图元数据而非整体报废；主公可 `sealRenderer()` 把卡面永久封印。
- **故意刁钻的 Solidity**：文件级类型与自由函数、`global` using-for、别名命名导入、同文件双路径导入陷阱、public 状态变量覆写接口函数、`unchecked`、assembly 守卫、reverting `receive`/`fallback`——每一处都是为了压测编译器、拍平器、UML、linter 与分析器而放置，并注明了 *为什么*。详见 [docs/architecture.md](docs/architecture.md)。
- **71 个测试、100% 覆盖率、CI 闸门**：语句 / 分支 / 函数 / 行全部 100%（mocks 除外），回退即 CI 失败。含链上 Base64 / 十进制 / JSON 转义 / XML 转义对参考实现的差分测试、每张 SVG 的 XML 良构校验、safe transfer 受体行为矩阵、种子随机转账风暴对账。
- **真实的 dogfooding 战役、诚实的账本**：从脚手架、编辑、lint、编译，到 VM 部署、调试、录制回放、TronBox 导出、git 推送、TronLink 实链部署、拍平与验证包——全程在 TronIDE 内完成，走遍 23 项 IDE 功能，提交 13 条发现：6 条修复入库（带回归门禁）、**3 条经严格复验后诚实撤回**（自己的误判也记账）。详见 [docs/case-study.md](docs/case-study.md)。

> **审计状态**：按审计级实践工程化，**尚未经外部审计**。托管真实价值前请先读 [SECURITY.md](SECURITY.md)。

## 合约结构

```text
contracts/
├── ThreeRealmsCards.sol        TRC-721 卡牌主合约
│   ├── interfaces/
│   │   ├── ITRC165.sol         接口探测
│   │   ├── ITRC721.sol         核心面（is ITRC165）—— 9 函数 XOR = 0x80ac58cd
│   │   ├── ITRC721Metadata.sol name / symbol / tokenURI（is ITRC721）
│   │   ├── ITRC721Receiver.sol safe transfer 受体钩子
│   │   └── IRenderer.sol       可插拔卡面钩子（进 Card，出图像 URI）
│   ├── access/Suzerain.sol     两步 Ownable（主公）：指定继承人 → 继承人接受
│   ├── render/CardRenderer.sol 丹青 —— 纯链上 SVG 卡面
│   ├── types/CardTypes.sol     文件级枚举、Card 结构、自由函数、global using-for
│   ├── libs/CardCodec.sol      Card → data:application/json;base64（含 JSON 转义）
│   ├── libs/Base64.sol         assembly 编码器（公共节点 CPU 时限所迫——见文档）
│   └── utils/StrUtils.sol      toString / equal / escapeJson / escapeXml
├── PeachPavilion.sol           桃园馆礼物托管：存卡指定继承人、继承人领取；
│                               拒收绕过托管的裸 safeTransferFrom
└── mocks/TestMocks.sol         仅测试用替身 —— 切勿部署
```

## Nile 测试网在线实例

| 版本 | 合约 | 地址 | 备注 |
|---|---|---|---|
| **v5（当前）** | `ThreeRealmsCards` + `CardRenderer` | [`TDQ9k3oqaV1tErua4uft1ZnndV96oFBH4X`](https://nile.tronscan.org/#/contract/TDQ9k3oqaV1tErua4uft1ZnndV96oFBH4X) · [`TAsJa3bb…`](https://nile.tronscan.org/#/contract/TAsJa3bbao3Kk71KMM2TDkpTBqPKvCT4KJ) | 链上 SVG 卡面已生效；三张创世卡 `tokenURI` 均可经公共节点读出 |
| v4（历史） | 渲染层首发 | [`THRSFpEV…`](https://nile.tronscan.org/#/contract/THRSFpEVownGtVx7WjdzYbbvqbTsD3iywJ) | 驱动 bug 误封印渲染器；4.07M gas 的 tokenURI 被公共节点拒读——均如实记录 |
| v3（历史） | 加固版 11 文件 | [`TYK5P6bU…`](https://nile.tronscan.org/#/contract/TYK5P6bUBGuadpjyB9aZ6nVSDEj98PfSWR) | `supportsInterface` 与两步移交链上验证 |
| v2（历史） | 模块化 9 文件 | [`TEzyMokX…`](https://nile.tronscan.org/#/contract/TEzyMokXwNqJteoSGC1v4rerK4mkfYE1f9) | `cardKeyOf`（global using-for）真链验证 |
| v1（历史） | 单文件 | [`TBig1iST…`](https://nile.tronscan.org/#/contract/TBig1iST9AW2vUrcQZ2nDTCtL3kf7gb18V) | 战役首次部署 |

交易、部署账户、能耗数据、事故实录与验证材料见 [deployments/nile.md](deployments/nile.md)。

## 快速开始

```bash
npm install
npm test              # 71 个用例，约 2 秒，无需本地 TRON 节点
npm run coverage      # istanbul 报告；CI 强制 100%
npx hardhat compile   # solc 0.8.20，evm target paris（不让 PUSH0 跑在 TVM 前面）
```

Hardhat 套件是**逻辑回归层**：本代码库用到的一切在上游 solc + EVM 与 TVM 上指令等价，单元测试因此可以随处秒级运行。链上集成（能量模型、TronLink 签名、TronScan 验证）由 TronIDE 场景回放（`scenarios/`）与 TronBox 导出（`exports/tronbox/`）另行覆盖。

## Dogfooding 战役

**23** 项 IDE 功能端到端走遍 · **13** 条发现（J-001…J-013）· **6** 条修复入库并带回归门禁 · **3** 条复验后诚实撤回 · **2** 条归因到 LocalStorage 后端共同根因、列入上游 IndexedDB 迁移 · **2** 次经 TronLink 真实签名上链 Nile。

- 阶段：P0 立项 → P1 合约开发 → P2 本地链 → P3 版本管理 → P4 实链（v1）→ P5 备份演练收官 → P6 模块化刁钻架构 → P7 新架构上 Nile（v2）→ P8 加固版上 Nile（v3）。
- 完整日志（中文一手记录）：[docs/journal.md](docs/journal.md) · 功能矩阵：[docs/dogfooding-matrix.md](docs/dogfooding-matrix.md) · 英文案例综述：[docs/case-study.md](docs/case-study.md)。

## 开发备忘（战役运维信息）

- 开发主战场：TronIDE dev build，工作区 `three-realms-v2`（v1 时期为 `three-realms`），持久浏览器 profile 在 `../.tronide-profile`。
- 本仓库是规范镜像：IDE 工作区的合约 / 脚本定期同步至此；`tools/` 是驱动各阶段的 Playwright 脚本，`docs/` 记录 dogfooding 进展。
- 合约改动后同步方向为 仓库 → IDE 工作区：直接跑 `tools/p8-nile-v3.cjs`（`FILES` 已含全部 11 文件，幂等写入 + 内容校验，可安全重跑）。

## 许可证

[MIT](LICENSE)
