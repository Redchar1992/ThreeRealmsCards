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

## 2026-07-13 · 缺陷回流与更正

**已修进 IDE**(tron-remix `release/v2.3.2`,17/17 回归绿):

- **J-002 ✅ 修复**(`879535f07`):compilerMetadata 的 artifacts 写入不再弹 "is modifying" toast。
- **J-003 ✅ 修复**(`879535f07`):最后使用的工作区跨会话恢复(localStorage 标记 + boot 优先恢复,含失效回退);新 TC-WS-RESTORE-1 @gate。
- **J-006 ✅ 修复**(`540d7e00d`):静态分析结果分组可折叠,Advisory 组默认收起,Security/Gas 保持展开;TC-SA-003 @gate。
- **J-008 ✅ 修复**(`b44b9c93c`):recorder 给 revert 交易补 `failed` 标记,TronBox 导出把失败步骤按 TODO 约定注释输出(回放语义不变,TC-REC-006 仍绿);TC-REC-EXP-1 @gate。

**更正(诚实记账)**:

- **J-001 大部分撤回**:推荐版本徽章本来就是可点击按钮(`onClick=handleLoadVersion`),P0 走读时未尝试点击。残余问题仅"默认值是否跟随推荐"——考虑到默认本地版本秒开、推荐版本一键可达,现状合理,不改。
- **J-007 撤回**:`exportTronboxProject` 对空录制**已有** "Nothing to export" 模态(且相邻场景有 spec 覆盖);P2 观察到的"静默"是驱动脚本只等 download 事件、未检查模态——驱动盲区,非产品缺陷。
- **J-005 根因确认**:并非 AsyncMirror——`main.js` 的 BrowserFS 用 **LocalStorage 后端**,Chromium 对 localStorage 惰性落盘,浏览器进程级崩溃丢最近写入(正常关闭安全)。治本 = 迁移 IndexedDB 后端 + 存量数据迁移,已列 v2.3.3 设计项。

## 2026-07-13 · P3 版本管理

**做了什么**:GitHub PAT 经 Home 面板连接(内存态,面板显示 Redchar1992)→ Git 面板确认工作区已自动 init → Stage all + commit「IDE workspace snapshot」→ 新建并切到 `ide-workspace` 分支 → 添加 remote → **经 CORS 代理真实 push 成功**(服务端核实分支与提交均到位——这是 CI 里从未跑过的带真实凭据推送路径)→ 用 clone 流把仓库克隆回全新工作区(README 落位)。**J-003 修复当场自验**:重启浏览器后 IDE 恢复到 three-realms,不再落 default_workspace。截图:`journal/p3-*.png`。

**发现**:本阶段零新缺陷。推送/克隆链路(含 token 内存化、代理转发)在真实凭据下一次通过;唯一注意点是 push 前若未连接 token,面板会给出明确引导文案(设计如此,非缺陷)。

## 2026-07-13 · P4 Nile 实链

**做了什么**:CDP 接管用户 Chrome(TronLink 解锁,Nile)→ 因浏览器 profile 不互通,轻量方式重建工作区(`three-realms-live`,只写合约文件)→ 编译 → Injected TronWeb 部署(用户 TronLink 签名)→ **`ThreeRealmsCards` 上链 Nile:`TBig1iST9AW2vUrcQZ2nDTCtL3kf7gb18V`** → 创世 mint 上链 → 链上读回三连全对(`balanceOf`=3、刘备、关羽元数据 data-URI 当场解码)→ Flatten(10374 字符,`exports/verification-flattened.sol`)+ 验证包生成。部署与铸造交易见 `deployments/nile.md`。

**发现**:

- **J-009(真缺陷,LocalStorage 后端家族)**:IDE 克隆**含图片的中型仓库**(本仓库,含若干截图 PNG)在已有 ~2MB 存量的 profile 里**中途失败**,且留下"已选中的空工作区"(`.workspaces/ThreeRealmsCards` 存在但空,文件树空白,reload 不恢复)。根因指向 localStorage 配额(~5MB,二进制还要 base64 膨胀 33%)。失败回切(D17)未覆盖此变体;错误文案未捕获到(面板状态被后续 reload 冲掉),待专项复现。修复方向与 J-005 同:IndexedDB 后端迁移(配额升到 GB 级)+ 克隆前预检仓库体积/配额。
- **签名时效观察(非缺陷)**:TRON 交易 ~60 秒过期;首次部署弹窗签晚了,IDE 终端明确报 `Transaction signature timed out. Please try again.`(可见失败,处理正确)。重试即成。
- **驱动经验**:webpack dev-server 报错遮罩 iframe 会拦截页面点击,驱动每次注入隐藏 CSS;双浏览器 profile(无头 dogfooding vs 用户真机)工作区数据不互通是 localStorage 特性,属预期。

**顺畅**:Injected TronWeb 环境切换、部署/mint 的钱包弹窗链路、链上读回、Flatten 全部一次通过;全链上 data-URI 元数据在真链上原样可解——MVP 技术路线闭环。

**P4 追补**:验证包首次生成失败是驱动漏填合约地址(面板红框拦截正确);补填 `TBig1iST…` + 切 Nile 后包生成成功(`ThreeRealmsCards · Nile`),Check status 返回"合约存在、源码未验证"——与实况一致。TronScan 源码提交按设计保留为手动步骤,材料已备齐。

## 2026-07-13 · P5 收官 + J-009/J-010 定案

**J-009 修复落地**(tron-remix `45cbfee28`):克隆失败路径修复"最后使用"标记(即使回切失败,重启也不再落进半成品工作区)+ 配额错误人话化;TC-GIT-R4 @gate(离线构造:代理请求 abort)。受控复现的额外发现:**配额写入风暴会冻结页面**(四次复现三次僵死)——LocalStorage 后端家族证据 +1。

**P5 备份/恢复演练**:
- **导出 ✓**:Home「Export Workspace Zip」出 6.1MB 全量备份(107 文件),离线解包验证合约/scenario 俱在。
- **恢复 = J-010(真缺陷,数据可用性级)**:`restorebackupzip` 插件对 Home 全量备份的 `tronideBackup/.workspaces/<ws>/…` 路径结构无感知,把全部内容写进 **`/.workspaces/.workspaces/…` 嵌套黑洞**——数据完好(尸检读到合约 10255 字节)但任何 UI 都无法到达;更会让工作区列表出现幽灵项 `.workspaces`(此前误判为"损坏"的现象即源于此)。现有 e2e 是空转断言(未删文件即恢复,原文件本来就在)。插件是 348KB 压缩 vendored bundle,修复需重建/替换 → **v2.3.3 工作项**(与 J-005/J-009 的 IndexedDB 迁移同批处理最优)。
- **戏剧性副产品**:恢复冻结 + 硬杀导致无头 profile 报废——**J-005 数据丢失场景全链路实证**。全部有价值数据因"仓库 + GitHub + 链上"三处冗余零损失,凭备份思路重建环境十分钟完成——这本身就是给用户的最佳实践示范。
- **全局搜索 ✓**:跨文件检索命中合约(scenario 无该词,单命中为正确行为)。

**战役总账**:矩阵 22 项 = 20✅ + 1◐(备份恢复,J-010)+ 1◐(AI 真模型链路另测);发现 J-001~J-010 共 10 条:**5 修复入库**(J-002/003/006/008/009,含 @gate 回归 6 条)、**2 诚实撤回**(J-001/J-007,驱动盲区)、**2 定为 v2.3.3 设计项**(J-005/J-010,同根:LocalStorage 后端 → IndexedDB 迁移)、**1 产品观察**(签名时效)。「三分天下」从零到 Nile 上链 + 创世铸造,全程 IDE 内完成。

## 2026-07-13 · P6 多文件刁钻架构轮

**架构升级**:单合约 → **9 文件**(types/interfaces/libs/access + 双可部署合约),故意堆满冷门写法:文件级 struct/enum/自由函数/自定义错误、`using {cardKey} for Card global`、别名命名导入(`Str as S`)、跨目录相对导入、`../contracts/` 同文件双路径陷阱、映射公共变量覆写接口函数、纯函数覆写 view 接口、assembly、try/catch 双分支、unchecked、reverting receive/fallback、不可变接口引用。新增 `PeachPavilion` 礼物托管合约(存卡指定继承人、跨账户领取)。

**全管线重测结果**:

- ✅ AI 连续 9 次 `create_file` 工具链(9 个确认框依次点过),工作区字节级一致
- ✅ 0.8.20(builtin)编译 7 文件依赖图一次通过;`../contracts/` 双路径被解析器正确归一
- ✅ 拍平:主图 13464 字符,`struct Card` ×1、global using ×1(去重正确),入库 `exports/ThreeRealmsCards_flat.sol`
- ✅ UML 画出跨文件继承(Suzerain);静态分析 Security 2 / Gas 12 / Advisory 79(默认折叠生效)
- ✅ VM 链上:双合约部署(构造参数传址)、创世、**global using 的 `cardKeyOf` 链上返回 bytes32**、库管线 tokenURI 解码、**托管全流程**(approve→deposit→错误账户领取被拒→切账户领取成功)
- ✅ 全局搜索跨新文件命中

**新发现**:

- **J-011 ✅ 当场修复**(tron-remix `b3a841d05`):linter 对**文件级自由函数**误报 func-visibility(自由函数不允许写可见性)——SourceUnit 直属函数豁免;TC-LINT-008 @gate 双向钉死。
- **J-012(增强项)**:VM 终端对**自定义错误不按名解码**(`NotDesignatedHeir` 只显示原始 revert)——ABI 在手,可解码;require 字符串时代的遗留,建议 v2.3.3 补。
- **J-013 → 完全撤回(第三次诚实撤回)**:严格复验证伪两个子claim。①"版本不匹配静默失败":0.8.6 是远程大文件,本机下载没完成,实际用已加载的 0.8.27 正常编译成功——加载失败路径本就有处理(按钮禁用+图标 "compiler load failed" 标题+autoFallbackToBuiltin 横幅,已被 TC-CMP-VER-006/007 覆盖);之前只等 4 秒是探针假象。②"编译失败不清旧产物":制造真语法错误后合约下拉框清空、Compilation Details 消失、错误正常显示——P6 看到的"陈旧"只是两次成功编译间的轮询时序。**教训:J-001/J-007/J-013 三次撤回都源于探针过度解读;"先严格验证再定论"是这套 dogfooding 的核心纪律**。
- 观察 ×2(驱动/UX,非缺陷):Flatten 跟随**最后一次编译**的合约而非当前文件(无提示,可加);实例标题被 CSS 大写化且无 data-id 携带地址(自动化要走 recorder 地址簿)。

## 2026-07-14 · 新架构上 Nile

**做了什么**:9 文件架构直接写入轻量工作区 `three-realms-v2`(15KB 纯文本,避开 J-009 的 PNG 撑爆问题)→ 0.8.20 builtin 编译整依赖图 → Injected TronWeb 部署 → **新 `ThreeRealmsCards` 上链 Nile: `TEzyMokXwNqJteoSGC1v4rerK4mkfYE1f9`** → 创世 mint 上链。链上直查确认:`genesisSealed=true / totalMinted=3 / balanceOf=3`;`tokenURI(2)` 解码 = Guan Yu #2 / SHU(库 base64 管线真链可用);**`cardKeyOf(1)=0xaef847e7…` — global using-for 在真链上生效**。详见 `deployments/nile.md`(v2)。

**过程小结**:部署+创世两笔真实签名成功;点击遮罩(webpack overlay)拦了一次读回重试,但交易早已上链,改用 TronWeb 直查链上状态确认——**读链比读 UI 更可靠**。PeachPavilion 托管需第二个 Nile 账户,真链未部署,VM 已全验。至此三分天下从单合约演进到模块化架构并两度上链,dogfooding 战役全部收官。

## 2026-07-14 · 战役后:加固轮 + 开源标杆化 + P8 重部署

**合约加固**(commit `4956323`):两步主公移交(`passSuzerainty` 指定 → `acceptSuzerainty` 生效,address(0) 取消)、`safeTransferFrom`×2 + `ITRC721Receiver` try/catch 受体探测、TRC-165(`type().interfaceId` 编译器计算)、`ownerOf`/`balanceOf`/`getApproved` 规范级回滚、`tokenURI` JSON 转义(`Str.escapeJson`);`PeachPavilion` 拒收绕过托管的裸 safe 投递。**标杆化**(commits `37d3e82`/`7bf3eaf`):Hardhat 逻辑回归 54 用例、语句/分支/函数/行覆盖率 100%(CI 硬闸门,GitHub Actions 全绿);双语 README、architecture/case-study/SECURITY/CONTRIBUTING/LICENSE;仓库 description/topics/homepage 补齐。

**P8 · 加固版上 Nile(v3)**:`tools/p8-nile-v3.cjs`(p7 改造:11 文件、TronLink 弹窗自动确认、幂等工作区写入)——**`TYK5P6bUBGuadpjyB9aZ6nVSDEj98PfSWR`**,创世已铸。TronGrid 直查:`genesisSealed=true`、`totalMinted=3`、`supportsInterface(0x80ac58cd / 0x5b5e139f)=true`、`(0xffffffff)=false`、`heirApparent=0` —— 加固 ABI 链上实证(TRC-165 只存在于加固版,是最干净的"新代码已上链"证明)。详见 `deployments/nile.md`(v3)。

**过程发现**:

- **J-014(观察,UI 提示面待复核)**:默认 fee limit 400,000,000 sun 对加固版部署不足——首次尝试 `OUT_OF_ENERGY` 上链失败(tx `7876ad49…`,`energy_usage_total` 恰好 4,000,000,与 Nile 100 sun/energy 换算吻合;白付 23.885 TRX 手续费),实需 4,260,454。较大合约的用户会撞同一堵墙。建议:部署前按字节码估算能量、fee limit 不足时预警;`OUT_OF_ENERGY` 失败后给出"上调 fee limit"引导。(本轮驱动脚本未截获 IDE 终端对该失败的提示样式,正式提缺陷前需复核——J-013 的教训。)
- **驱动教训 ×2**(非产品缺陷):①直接写 BrowserFS 后立即 reload 会撞 J-005 惰性落盘竞态,首跑成功第二跑树空——改为"内容比对、幂等写入、无变更不 reload"后根除;②udapp 环境切换可能静默回落 JS VM,`0x5B38…` 假账户能骗过"非空"断言——账户校验必须认 T 地址格式。
- **TronLink 弹窗自动确认可行**:CDP 上下文能枚举并点击扩展弹窗完成签名(仅限脚本自己刚发起的测试网交易);首次确认把站点加入白名单后,后续交易静默签名,连弹窗都不再出现。

## 2026-07-14 · P10/P11:链上 SVG 渲染层 —— 两次部署与三个教训

**渲染层落地**(commit `1f2197a`):`CardRenderer`(丹青)纯 Solidity 画 SVG 卡面(阵营配色/稀有度星级/四维条/LEGEND 光环),经 `IRenderer` 挂进核心,`setRenderer`/`sealRenderer`(单向封印),tokenURI try/catch 优雅降级 + 渲染器输出 JSON 转义防注入;`Str.escapeXml`(实体化 + 控制字符剥离);测试 54→71,覆盖率保持全 100%。

**P10(v4,`THRSFpEV…` + `TCPVf7pG…`)——发现三连**:

1. **编译作用域**:IDE 编译的是**当前打开文件**的依赖图;核心按设计不 import 渲染器 → `CardRenderer` 不在部署下拉框。驱动必须"打开渲染器文件→重编译→再部署"(p10 卡死于此,p10b 补上)。
2. **误封印事故(P10 最贵一课)**:p10b 读回循环用子串匹配选实例行,`renderer` 命中 `sealRenderer`,弹窗自动确认器把它签了——**v4 渲染器被无意永久封印**(链上可见后续 4 笔 `RendererSealed` revert)。测试网无损,主网即事故。根修:实例行选择器改**精确匹配**(p11 起);教训:**模糊选择器 + 自动签名 = 不可逆链上变更**。
3. **J-015(链侧观察,公共节点硬约束)**:v4 的 tokenURI(SVG + 双层逐字节 base64)实测 **4.07M gas**,TronGrid 公共节点常量调用直接 `OutOfTimeException` 拒读——钱包/市场经公共节点将看不到元数据。**"全链上美术"必须把 tokenURI 塞进公共节点的 CPU 预算**,这是路线级约束,不是实现细节。

**性能修复**(assembly Base64 + SVG 标记瘦身):tokenURI 4.07M → **1.46M gas(-64%)**,imageURI 1.27M → 0.26M;差分测试(RFC 向量 + 种子随机 vs Node 编码器)跨换血全绿——差分安全网正是为这种"重写热点"时刻准备的。原循环版编码器留在 git 历史。

**P11(v5,当前:`TDQ9k3oq…` + 渲染器 `TAsJa3bb…`,未封印)**:途中再踩两坑——webpack 遮罩 iframe 在 reload 后复活拦截点击(修:每步点击前 deOverlay + force 点击),HMR 整页重载洗掉实例面板(修:**At Address** 把已上链实例挂回,免重部署)。终态链上验证:`renderer()` 精确匹配、`rendererSealed=false`、创世三卡 **tokenURI 全部经公共节点读出**(SVG 各 ~2.1KB,五星 LEGEND 卡面完整)。

**驱动纪律沉淀**(p11/p11b 已固化):精确匹配行选择器、deOverlay 常态化、编译产物按内容轮询(J-013 姿势)、幂等工作区写入(J-005 姿势)、At Address 恢复路径、封印类不可逆操作一律不自动化。

## 2026-07-14 · P12:虎符演武 —— EIP-712 签名铸卡上真链

**合约**(commit `c71afe1`):`TigerTally` 零依赖 EIP-712——嵌套结构体哈希(MintOrder 内嵌完整 Card)、动态 domain(`block.chainid`)、不记名/定向+代付双券型、`voidTally` 作废(签名不可撤但可作废)、防延展 `ecrecover`(仅 65 字节、low-s、v∈{27,28} 且 0/1 规范化);虎符经两步移交**出任 suzerain**——两步制存在的意义(合约受让必须主动 accept)由此实证——全部王座权能配元帅直通道 + `returnSuzerainty` 逃生门。测试 71→92,覆盖率保持全 100%,链上 digest 与 ethers `TypedDataEncoder` 差分锚定。

**Nile 演武**(`TMUmN6NKSyvAR6CJq2U8ndsCjXB2Uc7T19`):部署→就任(链上核验 suzerain==tally)→元帅经 **TronLink typed-data 弹窗**签发不记名虎符→持券人兑现(tx `015290ec…`)→**诸葛亮 #4 铸成**(智力 100/LEGEND/系列 Tiger Tally)。核验:totalMinted=4、ownerOf(4)=元帅、tallyBroken(1)=true、tokenURI(4) 公共节点可读。

**方法论沉淀**:

- **chainId 不用猜**:对候选值逐一算 `hashDomain` 与链上 `domainSeparator()` 比对——Nile 实测 3448148188。任何 EIP-712 跨链集成都该这么做而不是查文档硬编码。
- **签名先本地验再上链**:`_signTypedData` 拿到签名后,先用 ethers 对**权威 digest** 做 `recoverAddress`,恢复出元帅地址才发交易——编码变体(base58/hex 地址)的不确定性在链下消化,一笔失败交易都不用付。tronweb 的 base58 输入变体一次即中。
- **驱动坑 ×3(全部旧课重修)**:①残留实例让"等新实例"检查空转,部署静默上链(白名单免弹窗)——用链查真相;②实例标题是截断地址(P6 原话"自动化要走地址簿"),全地址匹配永假——补截断形匹配;③自研驱动的元组类型串把 Card 的 6 个 uint8 写成 7 个——**差分对拍(链上 digestOf vs 本地 encoder)当场抓获**,这正是给 digestOf 留 public 的原因。
