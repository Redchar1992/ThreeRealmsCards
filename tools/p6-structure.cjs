// P6 phase 1: feed the 9-file architecture through the AI create_file chain,
// then compile (0.8.20), provoke the 0.8.6 pragma error, lint, flatten BOTH
// roots, UML, static analysis. Findings print as NOTEs.
const fs = require('fs')
const path = require('path')
const { chromium } = require('/Users/tron/Object/trontech/tron-remix/node_modules/@playwright/test')

const PROFILE = '/Users/tron/Object/tronSmart/.tronide-profile'
const SCRATCH = '/private/tmp/claude-501/-Users-tron-Object-trontech-tron-remix/607fd892-ece0-473d-8492-66232f2e46ae/scratchpad'
const ROOT = '/Users/tron/Object/tronSmart/ThreeRealmsCards/contracts'
const GW = 'https://tron-pw-gateway.mock'
const ORDER = [
  'types/CardTypes.sol', 'utils/StrUtils.sol', 'libs/Base64.sol', 'libs/CardCodec.sol',
  'access/Suzerain.sol', 'interfaces/ITRC721.sol', 'interfaces/ITRC721Metadata.sol',
  'PeachPavilion.sol', 'ThreeRealmsCards.sol'
]
const notes = []
const log = (m) => console.log('[p6]', m)
const note = (m) => { notes.push(m); console.log('[p6][NOTE]', m) }

;(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1440, height: 900 } })
  const page = ctx.pages()[0] || await ctx.newPage()

  // mock model: one tool_use per turn — create each file in ORDER, then done
  let turn = 0
  await page.route(GW + '/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const common = { id: 'm' + turn, type: 'message', role: 'assistant', model: 'claude-opus-4-8', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
    const file = ORDER[turn]
    turn++
    if (file) {
      const content = fs.readFileSync(path.join(ROOT, file), 'utf8')
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ ...common, content: [{ type: 'tool_use', id: 'tu' + turn, name: 'create_file', input: { path: 'contracts/' + file, content } }], stop_reason: 'tool_use' }) })
    }
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json',
      body: JSON.stringify({ ...common, content: [{ type: 'text', text: 'P6-SCAFFOLDED' }], stop_reason: 'end_turn' }) })
  })

  await page.goto('http://localhost:18080/', { waitUntil: 'load', timeout: 120_000 })
  try { await page.addStyleTag({ content: '#webpack-dev-server-client-overlay { display: none !important; }' }) } catch (e) {}
  try { const w = page.locator('button:has-text("I Understand")'); await w.waitFor({ state: 'visible', timeout: 5000 }); await w.click() } catch (e) {}
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ state: 'attached', timeout: 60_000 })
  const ws = await page.locator('select[data-id="workspacesSelect"]').inputValue().catch(() => '?')
  log('boot workspace: ' + ws)
  if (ws !== 'three-realms') { await page.locator('select[data-id="workspacesSelect"]').selectOption('three-realms'); await page.waitForTimeout(1500) }

  // ---------------- A: AI scaffolds 9 files, one confirm modal per file
  await page.locator('[data-id="aiApiKeyInput"]').fill('sk-p6-dogfood')
  await page.locator('[data-id="aiBaseUrlInput"]').fill(GW)
  await page.locator('.textarea-wrapper textarea').fill('把三分天下重构为多文件架构:types/interfaces/libs/access + 主合约 + 桃园馆,共 9 个文件')
  await page.locator('.textarea-wrapper textarea').press('Enter')
  let confirmed = 0
  const t0 = Date.now()
  while (confirmed < ORDER.length && Date.now() - t0 < 180_000) {
    const modal = page.locator('.ant-modal-confirm')
    if (await modal.isVisible().catch(() => false)) {
      await modal.locator('.ant-btn-primary').click().catch(() => {})
      confirmed++
      await page.waitForTimeout(600)
    } else {
      await page.waitForTimeout(400)
    }
    if (await page.getByText('P6-SCAFFOLDED').first().isVisible().catch(() => false)) break
  }
  await page.getByText('P6-SCAFFOLDED').first().waitFor({ timeout: 30_000 })
  log('A: AI scaffold complete — ' + confirmed + ' confirmations clicked')
  // verify byte-identity of every file
  let mismatch = 0
  for (const f of ORDER) {
    const got = await page.evaluate((p) => { try { return window.remixFileSystem.readFileSync('.workspaces/three-realms/' + p, 'utf8') } catch (e) { return '' } }, 'contracts/' + f)
    if (got !== fs.readFileSync(path.join(ROOT, f), 'utf8')) { mismatch++; note('A: byte mismatch in ' + f + ' (' + got.length + ' bytes)') }
  }
  if (!mismatch) log('A: all 9 files byte-identical in the workspace')

  const openFile = async (rel) => {
    if (!await page.locator('[data-id="filePanelFileExplorerTree"]').isVisible().catch(() => false)) {
      await page.locator('#icon-panel div[plugin="filePanel"]').click()
      await page.waitForTimeout(800)
    }
    const parts = ('contracts/' + rel).split('/')
    let acc = ''
    for (let i = 0; i < parts.length; i++) {
      acc = acc ? acc + '/' + parts[i] : parts[i]
      const node = page.locator(`[data-id="treeViewLitreeViewItem${acc}"]`)
      for (let r = 0; r < 4; r++) {
        if (await node.isVisible().catch(() => false)) break
        const parent = acc.split('/').slice(0, -1).join('/')
        if (parent) await page.locator(`[data-id="treeViewLitreeViewItem${parent}"]`).click().catch(() => {})
        await page.waitForTimeout(700)
      }
      if (i === parts.length - 1) await node.click()
      else if (!await page.locator(`[data-id="treeViewLitreeViewItem${acc + '/' + parts[i + 1]}"]`).isVisible().catch(() => false)) await node.click()
    }
    await page.waitForTimeout(600)
  }

  // ---------------- B: compile the main root on 0.8.20 (builtin)
  await openFile('ThreeRealmsCards.sol')
  await page.locator('#icon-panel div[plugin="solidity"]').click()
  const pick = async (frag) => page.evaluate((fr) => {
    const sel = document.querySelector('#versionSelector')
    const o = sel && Array.from(sel.options).find((x) => x.value.includes(fr))
    return o ? o.value : ''
  }, frag)
  const v0820 = await pick('0.8.20')
  const target = v0820 || await pick('0.8.27')
  if (!target) note('B: neither 0.8.20 nor 0.8.27 offered in the version list!')
  else {
    if ((await page.locator('#versionSelector').inputValue().catch(() => '')) !== target) {
      await page.locator('#versionSelector').selectOption(target)
      await page.waitForTimeout(4000)
    }
    log('B: compiler = ' + target)
  }
  await page.locator('[data-id="compilerContainerCompileBtn"]').click()
  try {
    await page.locator('[data-id="compiledContracts"]').waitFor({ timeout: 180_000 })
    const names = await page.evaluate(() => {
      const sel = document.querySelector('#runTabView select[class^="contractNames"], select[class^="contractNames"]')
      return document.querySelector('[data-id="compiledContracts"]').innerText
    })
    log('B: main root compiled — ' + names.trim().replace(/\s+/g, ' '))
  } catch (e) {
    const errText = await page.locator('.remixui_errorBlobs, [data-id="compiledErrors"], .error').first().innerText().catch(() => '(no error panel found)')
    note('B: main root FAILED to compile: ' + errText.slice(0, 300).replace(/\s+/g, ' '))
  }
  await page.screenshot({ path: SCRATCH + '/p6-b-compile.png' })

  // ---------------- B2: compile the pavilion root (odd ../contracts path)
  await openFile('PeachPavilion.sol')
  await page.locator('#icon-panel div[plugin="solidity"]').click()
  await page.locator('[data-id="compilerContainerCompileBtn"]').click()
  await page.waitForTimeout(6000)
  const pavOk = await page.locator('[data-id="compiledContracts"]').innerText().catch(() => '')
  if (/PeachPavilion/.test(pavOk)) log('B2: pavilion compiled (odd ../contracts import resolved)')
  else {
    const err = await page.evaluate(() => (document.body.innerText.match(/[^\n]*(not found|ParserError|Error)[^\n]*/i) || ['(no visible error)'])[0])
    note('B2: pavilion compile issue — ' + err.slice(0, 250))
  }

  // ---------------- B3: 0.8.6 must FAIL with a readable pragma error
  const v086 = await pick('0.8.6+')
  if (v086) {
    await page.locator('#versionSelector').selectOption(v086)
    await page.waitForTimeout(4000)
    await page.locator('[data-id="compilerContainerCompileBtn"]').click()
    await page.waitForTimeout(6000)
    const bodyErr = await page.evaluate(() => (document.body.innerText.match(/[^\n]*pragma[^\n]*/i) || ['(no pragma error visible)'])[0])
    log('B3: 0.8.6 error surface: ' + bodyErr.slice(0, 220).replace(/\s+/g, ' '))
    await page.locator('#versionSelector').selectOption(target)
    await page.waitForTimeout(4000)
  }

  // ---------------- C: lint on the tricky files (should be clean, not crash)
  for (const f of ['ThreeRealmsCards.sol', 'types/CardTypes.sol']) {
    await openFile(f)
    await page.waitForTimeout(1800)
    const anns = await page.evaluate(() => {
      const el = document.getElementById('input')
      return ((el && el.editor && el.editor.session.getAnnotations()) || []).filter((a) => /\[(spdx|pragma|func-visibility|state-visibility|avoid-tx-origin|no-selfdestruct|avoid-throw|avoid-sha3|reason-string|contract-name-capwords)\]/.test(a.text)).map((a) => a.text)
    })
    if (anns.length) note('C: lint flags on clean ' + f + ': ' + JSON.stringify(anns).slice(0, 200))
    else log('C: lint clean on ' + f + ' (global using / free functions parsed fine)')
  }

  // ---------------- D: flatten both roots via the verification panel
  const flattenCurrent = async (label) => {
    if (await page.locator('#icon-panel div[plugin="contractVerification"]').count() === 0) {
      await page.locator('#icon-panel div[plugin="pluginManager"]').click()
      await page.locator('[data-id="pluginManagerComponentActivateButtoncontractVerification"]').click()
      await page.locator('#icon-panel div[plugin="contractVerification"]').waitFor({ timeout: 10_000 })
    }
    await page.locator('#icon-panel div[plugin="contractVerification"]').click()
    await page.waitForTimeout(1200)
    await page.locator('[data-id="contractVerificationFlatten"]').click()
    await page.waitForTimeout(2500)
    const txt = await page.locator('[data-id="contractVerificationFlattenText"]').inputValue().catch(async () =>
      await page.locator('[data-id="contractVerificationFlattenText"]').innerText().catch(() => ''))
    return txt || ''
  }
  await openFile('ThreeRealmsCards.sol')
  const flatMain = await flattenCurrent('main')
  const dupCheck = (src, what) => {
    const hits = (src.match(new RegExp(what, 'g')) || []).length
    return hits
  }
  if (flatMain.length > 1000) {
    const structs = dupCheck(flatMain, 'struct Card')
    const usings = dupCheck(flatMain, 'using \\{ cardKey \\} for Card global')
    log(`D: main flattened ${flatMain.length} chars — struct Card ×${structs}, global using ×${usings}` + (structs === 1 ? ' (dedup OK)' : ''))
    if (structs !== 1) note('D: flatten duplicated the Card struct ×' + structs)
    fs.writeFileSync(SCRATCH + '/p6-flat-main.sol', flatMain)
  } else note('D: main flatten produced no/short output: ' + flatMain.length)
  await openFile('PeachPavilion.sol')
  const flatPav = await flattenCurrent('pavilion')
  if (flatPav.length > 500) {
    log('D: pavilion flattened ' + flatPav.length + ' chars (odd-path import survived)')
    fs.writeFileSync(SCRATCH + '/p6-flat-pav.sol', flatPav)
  } else note('D: pavilion flatten failed/empty: ' + flatPav.length)
  await page.screenshot({ path: SCRATCH + '/p6-d-flatten.png' })

  // ---------------- E: UML on the main contract
  await openFile('ThreeRealmsCards.sol')
  if (await page.locator('#icon-panel div[plugin="solidityUml"]').count() === 0) {
    await page.locator('#icon-panel div[plugin="pluginManager"]').click()
    await page.locator('[data-id="pluginManagerComponentActivateButtonsolidityUml"]').click()
    await page.locator('#icon-panel div[plugin="solidityUml"]').waitFor({ timeout: 10_000 })
  }
  await page.locator('#icon-panel div[plugin="solidityUml"]').click()
  await page.locator('[data-id="solidityUmlPanel"]').waitFor({ timeout: 10_000 })
  await page.locator('[data-id="umlGenerate"]').click()
  try {
    await page.locator('[data-id="umlDiagram"] svg').first().waitFor({ timeout: 60_000 })
    const svgText = await page.locator('[data-id="umlDiagram"]').innerText()
    const hasBase = /Suzerain/.test(svgText)
    log('E: UML rendered — shows Suzerain inheritance: ' + hasBase)
    if (!hasBase) note('E: UML missing the Suzerain base (multi-file inheritance not drawn)')
  } catch (e) {
    const st = await page.locator('[data-id="umlStatus"]').innerText().catch(() => '(none)')
    note('E: UML failed on the multi-file contract: ' + st.slice(0, 200))
  }
  await page.screenshot({ path: SCRATCH + '/p6-e-uml.png' })

  // ---------------- F: static analysis over the multi-file unit
  await openFile('ThreeRealmsCards.sol')
  if (await page.locator('#icon-panel div[plugin="solidityStaticAnalysis"]').count() === 0) {
    await page.locator('#icon-panel div[plugin="pluginManager"]').click()
    await page.locator('[data-id="pluginManagerComponentActivateButtonsolidityStaticAnalysis"]').click()
    await page.locator('#icon-panel div[plugin="solidityStaticAnalysis"]').waitFor({ timeout: 10_000 })
  }
  await page.locator('#icon-panel div[plugin="solidityStaticAnalysis"]').click()
  await page.waitForTimeout(800)
  await page.keyboard.press('Meta+s') // recompile with the panel listening
  let summary = ''
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(1200)
    summary = await page.locator('[data-id="staticAnalysisCategorySummary"]').innerText().catch(() => '')
    if (summary) break
  }
  log('F: static analysis: ' + (summary || '(no summary)').replace(/\s+/g, ' ').slice(0, 160))
  await page.screenshot({ path: SCRATCH + '/p6-f-analysis.png' })

  await ctx.close()
  console.log('NOTES-BEGIN'); notes.forEach((x) => console.log('- ' + x)); console.log('NOTES-END')
  console.log('P6S-OK')
})().catch((e) => { console.error('P6S-FAIL', e); process.exit(1) })
