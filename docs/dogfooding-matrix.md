# TronIDE 功能覆盖矩阵

状态:☐ 未做 · ◐ 部分 · ✅ 完成。「发现」列填 journal 条目编号。

| # | 功能 | 阶段 | 状态 | 发现 |
|---|---|---|---|---|
| 1 | Home 欢迎/工作区状态 | P0 | ✅ | — |
| 2 | 工作区模板(trc721-minimal) | P0 | ✅ | — |
| 3 | 编译器(builtin/版本选择) | P0/P1 | ✅ | J-001(部分撤回), J-002 已修, J-004 |
| 4 | 实时 lint(边写边标注) | P1 | ✅ | — |
| 5 | AI 面板(explain/工具循环) | P1 | ◐ | 工具循环 UI 已走(mock 模型);真模型链路 7-10 已实测 |
| 6 | AI 工作区动作(create_file) | P1 | ✅ | 确认框→落盘字节一致 |
| 7 | 右键菜单 / Format code | P1 | ✅ | Format 归一化缩进 |
| 8 | 自动保存 | P1 | ✅ | ~5s 防抖落盘 |
| 9 | Solidity UML 类图 | P1 | ✅ | mermaid 落盘 docs/uml |
| 10 | 静态分析面板 | P1 | ✅ | J-006 已修(Advisory 默认折叠) |
| 11 | 编译器 optimizer/runs 配置 | P1 | ✅ | optimizer ON 编译过 |
| 12 | VM 部署 + 交互 | P2 | ✅ | 创世 mint/读回/revert 守卫全过 |
| 13 | 交易记录器(录制/回放) | P2 | ✅ | 回放重建状态;失败步骤停住 |
| 14 | 调试器(步进) | P2 | ✅ | 创世 tx 步进正常 |
| 15 | Export to TronBox | P2 | ✅ | J-007 撤回, J-008 已修 |
| 16 | Git 面板(init/branch/commit) | P3 | ✅ | 自动 init、快照 commit、ide-workspace 分支 |
| 17 | GitHub OAuth/token + push | P3 | ✅ | PAT 内存连接 + 经代理真实 push(CI 未覆盖面) |
| 18 | git clone(经 CORS 代理) | P3 | ✅ | 公开仓库克隆回新工作区 |
| 19 | TronLink 实链部署(Nile) | P4 | ☐ | |
| 20 | Flatten + Contract Verification | P4 | ☐ | |
| 21 | Export/Restore Zip 备份 | P5 | ☐ | |
| 22 | 全局搜索/替换 | P1+ | ☐ | |
