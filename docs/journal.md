# Dogfooding 日志

发现条目用 J-xxx 编号;缺陷回流 tron-remix 时在条目后标注对应 commit/issue。

## 2026-07-13 · P0 立项

**做了什么**:Home「New Workspace」→ 模板选 `trc721-minimal` → 工作区 `three-realms` 创建成功,`contracts/TRC721Minimal.sol` 落位并自动打开;一键编译通过(builtin,本地零网络);持久浏览器 profile 建立(`../.tronide-profile`),跨会话保留工作区。截图:`journal/p0-workspace.png`。

**发现**:

- **J-001(产品讨论)**:新工作区默认编译器版本停在 `0.8.6+commit.0e36fba0`,而版本选择器旁的推荐徽章是 `0.8.27 / 0.5.18`——默认值与推荐值不一致,新用户第一次编译用的不是推荐版本。建议:默认跟随 TVM 推荐,或徽章加"点击切换"。
- **J-002(UX 噪音)**:每次编译弹出两条堆叠 toast(`compilerMetadata is modifying contracts/artifacts/….json` ×2)。合法行为但高频噪音,建议合并为一条或降级为状态栏提示。

**顺畅**:模板→编译链路零摩擦;welcome modal 一次即消;编译产物面板即时出现。

## 2026-07-13 · P1 合约开发

**做了什么**:`ThreeRealmsCards.sol` 经 **AI create_file 工具链路**(确认框展示路径→确认→落盘,模型响应为脚本化 mock,真实模型链路 7-10 已单独实测)写入工作区;实时 lint 红绿验证(注入 `tx.origin`+无可见性函数 → 三条标注亮起 → 还原 → 全部消散);文件树右键 **Format code** 归一化缩进(prettier 重排,8844→10255 字节);**optimizer ON** 编译通过(0.8.6);切 **0.8.27** 远程版本 6~9s 加载并编译通过;**UML** 出图 + Copy Mermaid 落盘 `docs/uml/ThreeRealmsCards.mmd`;**静态分析** Gas 7 / Advisory 80;**闲置自动保存**(~5s)生效。合约:TRC-721 核心面 + 武将四维/阵营/稀有度 + 一次性「桃园」创世(刘关张 LEGEND)+ 全链上 data-URI 元数据。截图:`journal/p1-*.png`。

**发现**:

- **J-003(可用性)**:浏览器重启后 IDE 总是落在 `default_workspace`,不恢复上次使用的工作区——而**编译器版本选择却是持久的**(还停在上次的 0.8.27)。持久化口径不一致:多工作区用户每次开门都要手动切换。
- **J-004(J-001 强化)**:0.8.27 远程二进制在正常网络下 6~9 秒即加载编译成功——"默认 0.8.6、推荐 0.8.27"的差距没有网络成本借口,默认应跟随推荐。叠加 J-003:上次选了远程版本 + 断网重启的组合,首编译要等 120s 才回落 builtin。
- **J-005(数据丢失面,待专项验证)**:浏览器**非正常退出**(进程被杀)后,退出前不久创建的工作区文件两次丢失(两次驱动脚本崩溃后复跑,文件需重建);**干净关闭后文件完整存活**(探针验证 10255/2535 字节俱在)。怀疑 BrowserFS AsyncMirror 惰性回写窗口。计划 P5 做 kill-probe 专项(写入→立即杀进程→重启验证),若坐实是真实用户场景的数据丢失级问题(崩溃/强关标签页丢最近编辑)。
- **J-006(噪音)**:静态分析对这份 ~200 行、风格干净的合约给出 **80 条 Advisory**(命名/require 提醒类)。徽章已排除 advisory(前序修复),但面板内噪音仍大,建议默认折叠 Advisory 分组。
- 驱动层小坑(供 e2e 参考,非产品缺陷):`#optimize` 是 bootstrap custom-checkbox,label 拦截点击,要点 `label[for="optimize"]`;静态分析面板激活前错过 `compileFinished` 事件,Run 保持禁用,需面板开着时重编译(Ctrl+S)唤醒。

**顺畅**:AI 工具确认链路、lint 亮/灭、Format、UML(类图正确区分 +public/-private 成员)、autosave 全部一次通过;0.8.27 远程加载体验好。

## 2026-07-13 · P2 本地链(15:40 批)

**做了什么**:VM(JavaScript VM Tron)部署 `ThreeRealmsCards` → `mintPeachGardenGenesis` 一次成功、**二次正确 revert**(one-shot 守卫)→ 读回三连全对(`balanceOf`=3、`cardOf(1)`=刘备/桃园、`tokenURI(2)` base64 解码=关羽 #2/Attack 97,样本落 `docs/metadata/token-2-guanyu.json`)→ recorder 存 `scenario.json`(45.9KB,归档 `scenarios/genesis-flow.scenario.json`)→ **Export to TronBox** 下载工程包(解包归档 `exports/tronbox/`)→ 清空实例后**回放重建状态**(新实例 balanceOf 仍=3)→ **调试器**对创世交易步进 5 步正常。截图:`journal/p2-*.png`。

**发现**:

- **J-007(静默失败)**:「清空实例 + 回放」之后再点 **Export to TronBox 毫无反应**——无下载、无提示。根因是回放结束时 recorder `clearAll()` 清空了在录事务,导出无货可打;但按钮不禁用也不提示"无可导出交易",用户只会觉得按钮坏了。建议:无记录时禁用按钮或给出明确 toast(与本仓库一贯的"静默失败必须可见"原则一致)。
- **J-008(导出正确性)**:导出的 `migrations/2_deploy_contracts.js` 把**已 revert 的第二次创世调用原样输出为可执行步骤**——在真网跑该 migration 必然中途失败。导出器对不可译步骤有"生成 TODO 注释"的既有约定,失败交易应同样标注(如 `// TODO: this call REVERTED in the VM — review before migrating`)而不是无差别导出。
- 顺手确认:回放在失败步骤(第二次创世)停住、成功步骤的状态保留——与录制器设计一致。

**顺畅**:部署/交互/读回、scenario 存取与回放、调试器步进、TronBox 包结构(contracts + migrations + config + README)都一次通过;`tokenURI` 全链上 base64 在 VM 上直接可解。
