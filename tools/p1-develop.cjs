// P1: develop ThreeRealmsCards.sol inside TronIDE, dogfooding the editor/AI/
// analysis surface. Phases A..H, journal observations collected as they occur.
const fs = require('fs')
const { chromium } = require('/Users/tron/Object/trontech/tron-remix/node_modules/@playwright/test')

const PROFILE = '/Users/tron/Object/tronSmart/.tronide-profile'
const SCRATCH = '/private/tmp/claude-501/-Users-tron-Object-trontech-tron-remix/607fd892-ece0-473d-8492-66232f2e46ae/scratchpad'
const REPO = '/Users/tron/Object/tronSmart/ThreeRealmsCards'
const GW = 'https://tron-pw-gateway.mock'
const FILE = 'contracts/ThreeRealmsCards.sol'
const SOURCE = fs.readFileSync(SCRATCH + '/ThreeRealmsCards.sol', 'utf8')
const notes = []
const log = (m) => console.log('[p1]', m)
const note = (m) => { notes.push(m); console.log('[p1][NOTE]', m) }

;(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: true,
    viewport: { width: 1440, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write']
  })
  const page = ctx.pages()[0] || await ctx.newPage()

  // -- mock Anthropic gateway: turn1 = create_file(tool_use), turn2 = done
  let gwCalls = 0
  await page.route(GW + '/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    gwCalls++
    const common = { id: 'msg_' + gwCalls, type: 'message', role: 'assistant', model: 'claude-opus-4-8', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
    if (gwCalls === 1) {
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ ...common, content: [
          { type: 'text', text: 'Creating the Three Realms card contract.' },
          { type: 'tool_use', id: 'tu_1', name: 'create_file', input: { path: FILE, content: SOURCE } }
        ], stop_reason: 'tool_use' }) })
    }
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json',
      body: JSON.stringify({ ...common, content: [{ type: 'text', text: 'P1-CREATED' }], stop_reason: 'end_turn' }) })
  })

  await page.goto('http://localhost:18080/', { waitUntil: 'load', timeout: 120_000 })
  try { await page.addStyleTag({ content: '#webpack-dev-server-client-overlay { display: none !important; }' }) } catch (e) {}
  try { const w = page.locator('button:has-text("I Understand")'); await w.waitFor({ state: 'visible', timeout: 4000 }); await w.click() } catch (e) {}
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 60_000 }).catch(() => {})
  const ws = await page.locator('select[data-id="workspacesSelect"]').inputValue().catch(() => '?')
  log('workspace on load: ' + ws)
  if (ws !== 'three-realms') {
    await page.locator('select[data-id="workspacesSelect"]').selectOption('three-realms')
    note('J? persistent profile did NOT restore last workspace (loaded ' + ws + ')')
  } else {
    log('persistent profile restored three-realms across sessions — good')
  }

  const readSaved = (p) => page.evaluate((path) => {
    try {
      const select = document.querySelector('#workspacesSelect')
      const w = (select && select.value) || 'default_workspace'
      return window.remixFileSystem.readFileSync(`.workspaces/${w}/${path}`, 'utf8')
    } catch (e) { return '' }
  }, p)

  // ---------------- Phase A: AI create_file through the real confirm chain
  const existing = await readSaved(FILE)
  if (existing) {
    log('A: file already exists (rerun) — skipping AI create')
  } else {
    await page.locator('[data-id="aiApiKeyInput"]').fill('sk-p1-dogfood-123')
    await page.locator('[data-id="aiBaseUrlInput"]').fill(GW)
    await page.locator('.textarea-wrapper textarea').fill('请创建 contracts/ThreeRealmsCards.sol —— 三分天下卡牌合约(TRC721 + 武将属性 + 桃园创世 + 链上元数据)')
    await page.locator('.textarea-wrapper textarea').press('Enter')
    const confirmModal = page.locator('.ant-modal-confirm')
    await confirmModal.waitFor({ state: 'visible', timeout: 20_000 })
    const modalText = await confirmModal.innerText()
    if (!modalText.includes(FILE)) note('A: confirm modal missing the file path!')
    await confirmModal.locator('.ant-btn-primary').click()
    await page.getByText('P1-CREATED').first().waitFor({ timeout: 20_000 })
    log('A: AI create_file confirmed and loop completed')
  }
  const saved = await readSaved(FILE)
  if (saved === SOURCE) log('A: workspace file byte-identical to payload (' + saved.length + ' bytes)')
  else note('A: saved file differs from payload! saved=' + saved.length + ' vs ' + SOURCE.length)

  // open it in the editor
  const item = page.locator(`[data-id="treeViewLitreeViewItem${FILE}"]`)
  if (!await item.isVisible().catch(() => false)) {
    const folder = page.locator('[data-id="treeViewLitreeViewItemcontracts"]')
    if (await folder.isVisible().catch(() => false)) await folder.click()
  }
  await item.click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: SCRATCH + '/p1-a-created.png' })

  // ---------------- Phase B: live lint — dirty edit flags, clean edit drains
  const lintAnns = () => page.evaluate(() => {
    const el = document.getElementById('input')
    const anns = (el && el.editor && el.editor.session.getAnnotations()) || []
    return anns.filter((a) => /\[(spdx|pragma|func-visibility|state-visibility|avoid-tx-origin|no-selfdestruct|avoid-throw|avoid-sha3|reason-string|contract-name-capwords)\]/.test(a.text)).map((a) => a.text)
  })
  const dirty = SOURCE.replace('    constructor() {', '    function backdoor() { require(tx.origin == contractOwner); }\n    constructor() {')
  await page.evaluate((s) => { document.getElementById('input').editor.session.setValue(s) }, dirty)
  let anns = []
  for (let i = 0; i < 20; i++) { await page.waitForTimeout(500); anns = await lintAnns(); if (anns.length) break }
  const hasVis = anns.some((t) => t.includes('[func-visibility]'))
  const hasTxo = anns.some((t) => t.includes('[avoid-tx-origin]'))
  const hasRs = anns.some((t) => t.includes('[reason-string]'))
  if (hasVis && hasTxo && hasRs) log('B: lint flagged the dirty edit live (func-visibility + avoid-tx-origin + reason-string)')
  else note('B: lint annotations incomplete on dirty edit: ' + JSON.stringify(anns))
  await page.evaluate((s) => { document.getElementById('input').editor.session.setValue(s) }, SOURCE)
  for (let i = 0; i < 20; i++) { await page.waitForTimeout(500); anns = await lintAnns(); if (!anns.length) break }
  if (!anns.length) log('B: annotations drained after reverting to clean source')
  else note('B: annotations did not drain: ' + JSON.stringify(anns))

  // save current state before formatting (editor -> disk via autosave is slow; force Ctrl+S)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s')
  await page.waitForTimeout(1200)

  // ---------------- Phase C: Format code from the file-tree context menu
  const mangled = SOURCE.replace(/^    function _factionName/m, '         function _factionName')
  await page.evaluate((s) => { document.getElementById('input').editor.session.setValue(s) }, mangled)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s')
  await page.waitForTimeout(1200)
  await item.click({ button: 'right' })
  const fmt = page.locator('[id="menuitemformat code"]')
  await fmt.waitFor({ state: 'visible', timeout: 10_000 })
  await fmt.click()
  let formatted = ''
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(600)
    formatted = await readSaved(FILE)
    if (formatted && !formatted.includes('         function _factionName')) break
  }
  if (formatted.includes('    function _factionName')) log('C: Format code normalized the mangled indentation in place')
  else note('C: Format did not normalize indentation (still mangled or unchanged)')

  // ---------------- Phase D: compile with optimizer enabled
  await page.locator('#icon-panel div[plugin="solidity"]').click()
  const opt = page.locator('#optimize').first()
  await opt.waitFor({ timeout: 15_000 })
  // the version choice PERSISTS across sessions (unlike the workspace choice);
  // pin the fast local 0.8.6 for this phase so D never depends on the network
  const v086 = await page.evaluate(() => {
    const sel = document.querySelector('#versionSelector')
    const o = sel && Array.from(sel.options).find((x) => x.value.includes('0.8.6'))
    return o ? o.value : ''
  })
  if (v086) {
    const cur = await page.locator('#versionSelector').inputValue().catch(() => '')
    if (cur !== v086) {
      await page.locator('#versionSelector').selectOption(v086)
      await page.waitForTimeout(4000)
    }
  }
  // bootstrap custom checkbox: the label intercepts pointer events
  if (!await opt.isChecked().catch(() => false)) await page.locator('label[for="optimize"]').click()
  await page.locator('[data-id="compilerContainerCompileBtn"]').click()
  await page.locator('[data-id="compiledContracts"]').waitFor({ timeout: 150_000 })
  let compiledTxt = await page.locator('[data-id="compiledContracts"]').textContent()
  if ((compiledTxt || '').includes('ThreeRealmsCards')) log('D: compiled with optimizer ON: ' + compiledTxt.trim())
  else note('D: compile result unexpected: ' + compiledTxt)

  // ---------------- Phase E: try switching to the recommended 0.8.27
  const verSel = page.locator('#versionSelector')
  const before = await verSel.inputValue().catch(() => '')
  const target = await page.evaluate(() => {
    const sel = document.querySelector('#versionSelector')
    if (!sel) return ''
    const o = Array.from(sel.options).find((x) => x.value.includes('0.8.27'))
    return o ? o.value : ''
  })
  if (!target) {
    note('E: no 0.8.27 option offered in the version selector (list source may be unreachable) — staying on ' + before)
  } else {
    log('E: switching version ' + before + ' -> ' + target + ' (up to 140s)')
    const t0 = Date.now()
    await verSel.selectOption(target)
    let outcome = 'timeout'
    for (let i = 0; i < 47; i++) {
      await page.waitForTimeout(3000)
      const toast = await page.locator('[data-shared="tooltipPopup"]').allInnerTexts().catch(() => [])
      if (toast.some((t) => /built-in compiler/i.test(t))) { outcome = 'fallback-to-builtin'; break }
      const v = await verSel.inputValue().catch(() => '')
      const loaded = await page.evaluate(() => {
        const btn = document.querySelector('[data-id="compilerContainerCompileBtn"]')
        return btn && !btn.disabled
      })
      if (v.includes('0.8.27') && loaded) {
        await page.locator('[data-id="compilerContainerCompileBtn"]').click()
        try {
          await page.locator('[data-id="compiledContracts"]').waitFor({ timeout: 30_000 })
          outcome = 'loaded-and-compiled'
        } catch (e) { outcome = 'loaded-but-compile-timeout' }
        break
      }
    }
    note(`E: 0.8.27 switch outcome = ${outcome} after ${Math.round((Date.now() - t0) / 1000)}s`)
    if (outcome !== 'loaded-and-compiled') {
      await verSel.selectOption(before).catch(() => {})
      await page.waitForTimeout(3000)
      await page.locator('[data-id="compilerContainerCompileBtn"]').click()
      await page.locator('[data-id="compiledContracts"]').waitFor({ timeout: 90_000 }).catch(() => {})
      log('E: reverted to ' + before + ' and recompiled')
    }
  }

  // ---------------- Phase F: UML diagram + Copy Mermaid
  if (await page.locator('#icon-panel div[plugin="solidityUml"]').count() === 0) {
    await page.locator('#icon-panel div[plugin="pluginManager"]').click()
    await page.locator('[data-id="pluginManagerComponentActivateButtonsolidityUml"]').click()
    await page.locator('#icon-panel div[plugin="solidityUml"]').waitFor({ timeout: 10_000 })
  }
  await page.locator('#icon-panel div[plugin="solidityUml"]').click()
  await page.locator('[data-id="solidityUmlPanel"]').waitFor({ timeout: 10_000 })
  await page.locator('[data-id="umlGenerate"]').click()
  await page.locator('[data-id="umlDiagram"] svg').first().waitFor({ timeout: 60_000 })
  const umlStatus = await page.locator('[data-id="umlStatus"]').innerText().catch(() => '')
  log('F: UML rendered — ' + umlStatus.trim())
  await page.locator('[data-id="umlCopy"]').click()
  await page.waitForTimeout(500)
  const mermaid = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))
  if (mermaid && mermaid.includes('classDiagram')) {
    fs.mkdirSync(REPO + '/docs/uml', { recursive: true })
    fs.writeFileSync(REPO + '/docs/uml/ThreeRealmsCards.mmd', mermaid)
    log('F: Copy Mermaid -> docs/uml/ThreeRealmsCards.mmd (' + mermaid.length + ' chars)')
  } else note('F: clipboard mermaid missing or malformed (' + (mermaid || '').slice(0, 40) + ')')
  await page.screenshot({ path: SCRATCH + '/p1-f-uml.png' })

  // ---------------- Phase G: static analysis
  if (await page.locator('#icon-panel div[plugin="solidityStaticAnalysis"]').count() === 0) {
    await page.locator('#icon-panel div[plugin="pluginManager"]').click()
    await page.locator('[data-id="pluginManagerComponentActivateButtonsolidityStaticAnalysis"]').click()
    await page.locator('#icon-panel div[plugin="solidityStaticAnalysis"]').waitFor({ timeout: 10_000 })
  }
  await page.locator('#icon-panel div[plugin="solidityStaticAnalysis"]').click()
  await page.waitForTimeout(1000)
  // the panel missed compileFinished events fired before its activation, so
  // Run starts disabled — recompile with the panel listening (Ctrl/Meta+S
  // triggers save+compile of the current file via the compile-tab handler)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s')
  const runBtn = page.locator('[data-id="staticAnalysisRunBtn"], button:has-text("Run")').first()
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000)
    if (await runBtn.isEnabled().catch(() => false)) { await runBtn.click(); break }
    const s = await page.locator('[data-id="staticAnalysisCategorySummary"]').innerText().catch(() => '')
    if (s) break // autorun already produced results
  }
  let summary = ''
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1000)
    summary = await page.locator('[data-id="staticAnalysisCategorySummary"]').innerText().catch(() => '')
    if (summary) break
  }
  log('G: static analysis summary: ' + (summary || '(none rendered)').replace(/\n/g, ' | '))
  await page.screenshot({ path: SCRATCH + '/p1-g-analysis.png' })

  // ---------------- Phase H: autosave check + extract to repo
  await page.locator('#icon-panel div[plugin="filePanel"]').click().catch(() => {})
  await item.click()
  await page.waitForTimeout(500)
  const MARK = '// autosave-probe ' + gwCalls
  await page.evaluate((m) => {
    const ed = document.getElementById('input').editor
    ed.session.insert({ row: 1, column: 0 }, m + '\n')
  }, MARK)
  let auto = ''
  for (let i = 0; i < 16; i++) { await page.waitForTimeout(700); auto = await readSaved(FILE); if (auto.includes(MARK)) break }
  if (auto.includes(MARK)) log('H: idle autosave persisted the edit without Ctrl+S')
  else note('H: autosave did not persist the probe within ~11s')
  // remove the probe and save explicitly
  await page.evaluate(() => {
    const ed = document.getElementById('input').editor
    ed.session.removeFullLines(1, 1)
  })
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s')
  await page.waitForTimeout(1500)
  const finalSrc = await readSaved(FILE)
  fs.writeFileSync(REPO + '/contracts/ThreeRealmsCards.sol', finalSrc)
  log('H: extracted ' + finalSrc.length + ' bytes -> repo contracts/ThreeRealmsCards.sol')

  await ctx.close()
  console.log('NOTES-BEGIN'); notes.forEach((n) => console.log('- ' + n)); console.log('NOTES-END')
  console.log('P1-OK')
})().catch((e) => { console.error('P1-FAIL', e); process.exit(1) })
