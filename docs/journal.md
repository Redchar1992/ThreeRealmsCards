# Dogfooding 日志

发现条目用 J-xxx 编号;缺陷回流 tron-remix 时在条目后标注对应 commit/issue。

## 2026-07-13 · P0 立项

**做了什么**:Home「New Workspace」→ 模板选 `trc721-minimal` → 工作区 `three-realms` 创建成功,`contracts/TRC721Minimal.sol` 落位并自动打开;一键编译通过(builtin,本地零网络);持久浏览器 profile 建立(`../.tronide-profile`),跨会话保留工作区。截图:`journal/p0-workspace.png`。

**发现**:

- **J-001(产品讨论)**:新工作区默认编译器版本停在 `0.8.6+commit.0e36fba0`,而版本选择器旁的推荐徽章是 `0.8.27 / 0.5.18`——默认值与推荐值不一致,新用户第一次编译用的不是推荐版本。建议:默认跟随 TVM 推荐,或徽章加"点击切换"。
- **J-002(UX 噪音)**:每次编译弹出两条堆叠 toast(`compilerMetadata is modifying contracts/artifacts/….json` ×2)。合法行为但高频噪音,建议合并为一条或降级为状态栏提示。

**顺畅**:模板→编译链路零摩擦;welcome modal 一次即消;编译产物面板即时出现。
