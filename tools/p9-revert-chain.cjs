// P9-A: the revert full-chain — deploy the hardened v3 in the VM, record a
// flow that CONTAINS a real revert (safeTransferFrom to PeachPavilion, which
// rejects bare safe deliveries), then prove the whole downstream chain the
// 2026-07-14 tron-remix fixes promise: scenario.json carries failed:true on
// exactly the reverted step, the TronBox export fences it as a commented
// REVERTED TODO while live steps stay live, and the failed tx is debuggable.
// Also collects J-012 evidence (custom errors shown raw, not by name).
const fs = require('fs')
const path = require('path')
const { chromium } = require('/Users/tron/Object/trontech/tron-remix/node_modules/@playwright/test')

const PROFILE = '/Users/tron/Object/tronSmart/.tronide-profile'
const SCRATCH = '/private/tmp/claude-501/-Users-tron-Object-trontech-tron-remix/c95bc390-5ff2-4f7e-bf42-32d5fed2d83a/scratchpad'
const REPO = '/Users/tron/Object/tronSmart/ThreeRealmsCards'
const ROOT = REPO + '/contracts'
const WS = 'three-realms-v2'
// the deployable graph, derived from the repo so new files (IRenderer,
// render/CardRenderer, …) can never fall out of sync again; mocks are
// test-only doubles and stay out of the workspace
const FILES = (() => {
  const out = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir || '.'), { withFileTypes: true })) {
      const rel = dir ? dir + '/' + e.name : e.name
      if (e.isDirectory()) { if (e.name !== 'mocks') walk(rel) } else if (e.name.endsWith('.sol')) out.push(rel)
    }
  }
  walk('')
  return out.sort()
})()
const notes = []
const log = (m) => console.log('[p9a]', m)
const note = (m) => { notes.push(m); console.log('[p9a][NOTE]', m) }

;(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1440, height: 900 } })
  const page = ctx.pages()[0] || await ctx.newPage()
  await page.goto('http://localhost:18080/', { waitUntil: 'load', timeout: 120_000 })
  const deOverlay = async () => {
    await page.evaluate(() => document.querySelectorAll('#webpack-dev-server-client-overlay').forEach((e) => e.remove())).catch(() => {})
    await page.addStyleTag({ content: '#webpack-dev-server-client-overlay { display: none !important; }' }).catch(() => {})
  }
  await deOverlay()
  try { const w = page.locator('button:has-text("I Understand")'); await w.waitFor({ state: 'visible', timeout: 4000 }); await w.click() } catch (e) {}
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 60_000 }).catch(() => {})

  // ---------------- workspace: select or create three-realms-v2, then write
  // the 11-file graph idempotently (this headless profile never saw the
  // hardened files — P7/P8 ran over the user's Chrome)
  if (!await page.locator('[data-id="filePanelFileExplorerTree"]').isVisible().catch(() => false)) {
    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    await page.locator('[data-id="filePanelFileExplorerTree"]').waitFor({ timeout: 15_000 })
  }
  const wsOptions = await page.evaluate(() => {
    const s = document.querySelector('select[data-id="workspacesSelect"]')
    return s ? Array.from(s.options).map((o) => o.value) : []
  })
  if (!wsOptions.includes(WS)) {
    await page.locator('[data-id="workspaceCreate"]').click()
    const nameInput = page.locator('input[data-id="modalDialogCustomPromptTextCreate"]')
    await nameInput.waitFor({ state: 'visible', timeout: 5000 })
    await nameInput.fill(WS)
    await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()
    await page.waitForTimeout(2500)
    log('created workspace ' + WS + ' (profile had: ' + wsOptions.join(', ') + ')')
  } else if ((await page.locator('select[data-id="workspacesSelect"]').inputValue().catch(() => '?')) !== WS) {
    await page.locator('select[data-id="workspacesSelect"]').selectOption(WS)
    await page.waitForTimeout(2000)
    log('switched to existing workspace ' + WS)
  } else {
    log(`workspace already ${WS} (restore-on-boot marker held)`)
  }
  // idempotent content-compare write (p8 pattern — dodges the J-005 race)
  const desired = FILES.map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')])
  const wrote = await page.evaluate(({ ws, files }) => {
    const fsx = window.remixFileSystem
    const mkdirp = (p) => { const parts = p.split('/'); let acc = ''; for (const part of parts) { acc = acc ? acc + '/' + part : part; try { fsx.mkdirSync(acc) } catch (e) {} } }
    let written = 0
    for (const [rel, content] of files) {
      const full = `.workspaces/${ws}/contracts/${rel}`
      let cur = null
      try { cur = fsx.readFileSync(full, 'utf8') } catch (e) {}
      if (cur === content) continue
      mkdirp(full.split('/').slice(0, -1).join('/'))
      fsx.writeFileSync(full, content)
      written++
    }
    let verified = 0
    for (const [rel, content] of files) { try { if (fsx.readFileSync(`.workspaces/${ws}/contracts/${rel}`, 'utf8') === content) verified++ } catch (e) {} }
    return { written, verified }
  }, { ws: WS, files: desired })
  log(`files: ${wrote.written} written, ${wrote.verified}/${FILES.length} verified`)
  if (wrote.verified !== FILES.length) throw new Error('workspace file verification failed')
  if (wrote.written > 0) {
    await page.waitForTimeout(6000) // let BrowserFS flush (J-005 family)
    await page.reload({ waitUntil: 'load' })
    await deOverlay()
    try { const w = page.locator('button:has-text("I Understand")'); await w.waitFor({ state: 'visible', timeout: 5000 }); await w.click() } catch (e) {}
    await page.waitForTimeout(4000)
    if (!await page.locator('[data-id="filePanelFileExplorerTree"]').isVisible().catch(() => false)) {
      await page.locator('#icon-panel div[plugin="filePanel"]').click()
      await page.waitForTimeout(1500)
    }
  }

  // open the main contract so the udapp dropdown follows it
  const file = page.locator('[data-id="treeViewLitreeViewItemcontracts/ThreeRealmsCards.sol"]')
  if (!await file.isVisible().catch(() => false)) {
    const folder = page.locator('[data-id="treeViewLitreeViewItemcontracts"]')
    if (await folder.isVisible().catch(() => false)) { await folder.click(); await page.waitForTimeout(1200) }
  }
  await file.click()
  await page.waitForTimeout(1000)

  // ---------------- compile on the BUILTIN 0.8.20 (value 'builtin'): loads
  // locally in seconds; a REMOTE 0.8.20 pin means a 26MB download that times
  // out on this machine (the known slow-network trap)
  await page.locator('#icon-panel div[plugin="solidity"]').click()
  await page.waitForTimeout(1000)
  const builtinVal = await page.evaluate(() => {
    const s = document.querySelector('#versionSelector')
    if (!s) return ''
    const o = Array.from(s.options).find((x) => x.value === 'builtin') ||
      Array.from(s.options).find((x) => /builtin/i.test(x.textContent || ''))
    return o ? o.value : ''
  })
  if (builtinVal && (await page.locator('#versionSelector').inputValue().catch(() => '')) !== builtinVal) {
    await page.locator('#versionSelector').selectOption(builtinVal)
    await page.waitForTimeout(3000)
  }
  await page.locator('[data-id="compilerContainerCompileBtn"]').click()
  await page.locator('[data-id="compiledContracts"]').waitFor({ timeout: 120_000 })
  log('compiled the hardened graph on ' + (builtinVal || 'current version'))

  // ---------------- VM env, two accounts
  await page.locator('#icon-panel div[plugin="udapp"]').click()
  await page.locator('select[id="selectExEnvOptions"]').selectOption({ label: 'JavaScript VM (Tron)' })
  await page.waitForTimeout(1500)
  const accounts = await page.evaluate(() => {
    const s = document.querySelector('#runTabView #txorigin')
    return s ? Array.from(s.options).map((o) => o.value) : []
  })
  if (accounts.length < 2) { note('need 2 VM accounts, got ' + accounts.length); throw new Error('accounts') }
  const [acctA, acctB] = accounts
  log(`VM accounts A=${acctA.slice(0, 10)}… B=${acctB.slice(0, 10)}…`)

  // ---------------- deploy ThreeRealmsCards (records step 1)
  const deployBtn = page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' })
  await page.locator('#runTabView select[class^="contractNames"]').selectOption('ThreeRealmsCards')
  await deployBtn.click()
  const cardInstance = page.locator('.instance').first()
  await cardInstance.waitFor({ timeout: 30_000 })
  // The visible title ellipsizes the address (TVm22...AYG9R) — the FULL value
  // lives in an attribute of the copy widget inside the instance subtree.
  const extractAddr = (el) => {
    const re = /(0x[0-9a-fA-F]{40}|41[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33})/
    const nodes = [el, ...el.querySelectorAll('*')]
    for (const n of nodes) {
      for (const a of Array.from(n.attributes || [])) {
        const v = String(a.value)
        if (v.includes('...')) continue
        const m = v.match(re)
        if (m) return m[1]
      }
    }
    const m = el.textContent.match(re)
    return m ? m[1] : ('NOMATCH:' + el.textContent.replace(/\s+/g, ' ').slice(0, 200))
  }
  const cardAddr = await cardInstance.evaluate(extractAddr)
  if (cardAddr.startsWith('NOMATCH')) { note('could not extract card instance address — ' + cardAddr); throw new Error('cardAddr') }
  log('deployed ThreeRealmsCards at ' + cardAddr.slice(0, 12) + '…')

  // ---------------- genesis mint (records step 2)
  await cardInstance.locator('[data-id="universalDappUiTitleExpander"]').click()
  const rowIn = (instance, fn) => instance.locator('div[class*="contractProperty"]', { hasText: fn }).first()
  const genesis = rowIn(cardInstance, 'mintPeachGardenGenesis')
  await genesis.locator('input').first().fill(acctA)
  await genesis.locator('button').first().click()
  await page.waitForTimeout(1500)
  const bal = rowIn(cardInstance, 'balanceOf')
  await bal.locator('input').first().fill(acctA)
  await bal.locator('button').first().click()
  await page.waitForTimeout(1200)
  const balTxt = (await cardInstance.innerText()).replace(/\s+/g, ' ')
  if (/balanceOf[^]*?3/.test(balTxt)) log('genesis minted — balanceOf(A) == 3')
  else note('unexpected balanceOf after genesis: ' + balTxt.slice(-160))

  // ---------------- deploy PeachPavilion(card) (records step 3; created{ts}
  // constructor reference must resolve in the export).
  // The udapp dropdown follows the CURRENT FILE, and the card does not import
  // the pavilion — open PeachPavilion.sol and recompile so it appears.
  await page.locator('#icon-panel div[plugin="filePanel"]').click()
  await page.waitForTimeout(800)
  const pavFile = page.locator('[data-id="treeViewLitreeViewItemcontracts/PeachPavilion.sol"]')
  if (!await pavFile.isVisible().catch(() => false)) {
    await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    await page.waitForTimeout(1000)
  }
  await pavFile.click()
  await page.waitForTimeout(800)
  await page.locator('#icon-panel div[plugin="solidity"]').click()
  await page.waitForTimeout(800)
  await page.locator('[data-id="compilerContainerCompileBtn"]').click()
  await page.waitForTimeout(4000)
  await page.locator('#icon-panel div[plugin="udapp"]').click()
  await page.waitForTimeout(1000)
  await page.locator('#runTabView select[class^="contractNames"]').selectOption('PeachPavilion')
  const ctorInput = page.locator('#runTabView div[class*="contractActionsContainer"] input').first()
  await ctorInput.fill(cardAddr)
  await deployBtn.click()
  await page.waitForTimeout(2500)
  const instances = page.locator('.instance')
  if (await instances.count() < 2) { note('pavilion instance did not appear'); throw new Error('pavilion') }
  const pavInstance = instances.nth(1)
  const pavAddr = await pavInstance.evaluate(extractAddr)
  if (pavAddr.startsWith('NOMATCH')) { note('could not extract pavilion address — ' + pavAddr); throw new Error('pavAddr') }
  log('deployed PeachPavilion at ' + pavAddr.slice(0, 12) + '…')

  // ---------------- THE REVERT (records step 4): bare safeTransferFrom to the
  // pavilion — it rejects gifts that bypass the escrow (GiftsOnlyViaDeposit,
  // surfaced by the card as ReceiverRejected). Use the 3-arg overload: pick
  // the safeTransferFrom row whose collapsed input does NOT mention bytes.
  const journalBefore = ((await page.locator('#journal').textContent().catch(() => '')) || '').length
  const stfRows = cardInstance.locator('div[class*="contractProperty"]', { hasText: 'safeTransferFrom' })
  const stfCount = await stfRows.count()
  let stf3 = null
  for (let i = 0; i < stfCount; i++) {
    const ph = await stfRows.nth(i).locator('input').first().getAttribute('placeholder').catch(() => '')
    if (ph && !/bytes/.test(ph)) { stf3 = stfRows.nth(i); break }
  }
  if (!stf3) { note('could not find the 3-arg safeTransferFrom row (' + stfCount + ' rows)'); throw new Error('stf') }
  await stf3.locator('input').first().fill(`${acctA}, ${pavAddr}, 1`)
  await stf3.locator('button').first().click()
  await page.waitForTimeout(2500)
  const revertSlice = (((await page.locator('#journal').textContent().catch(() => '')) || '').slice(journalBefore)).replace(/\s+/g, ' ')
  if (/revert|errored/i.test(revertSlice)) log('safeTransferFrom(A, pavilion, 1) reverted as designed')
  else note('revert not visible in terminal: ' + revertSlice.slice(-200))
  // J-012 evidence: does the terminal name the custom error?
  if (/ReceiverRejected|GiftsOnlyViaDeposit/.test(revertSlice)) {
    log('J-012 UPDATE: terminal decoded the custom error by name!')
  } else {
    note('J-012 evidence: custom error NOT named in terminal (raw revert only); excerpt: ' + revertSlice.slice(-260))
  }

  // ---------------- successful safe transfer to an EOA (records step 5)
  await stf3.locator('input').first().fill(`${acctA}, ${acctB}, 2`)
  await stf3.locator('button').first().click()
  await page.waitForTimeout(2000)
  const owner2 = rowIn(cardInstance, 'ownerOf')
  await owner2.locator('input').first().fill('2')
  await owner2.locator('button').first().click()
  await page.waitForTimeout(1500)
  // the decoded call output lands in a value node under the ownerOf row
  const ownOut = (await owner2.evaluate((el) => el.textContent).catch(() => '')).replace(/\s+/g, ' ')
  const bTail = acctB.toLowerCase().replace(/^0x/, '')
  if (ownOut.toLowerCase().includes(bTail)) log('safeTransferFrom(A, B, 2) landed — ownerOf(2) == B')
  else note('ownerOf(2) readback not confirmed in UI (non-fatal; transfer tx did not revert): ' + ownOut.slice(-160))
  await page.screenshot({ path: SCRATCH + '/p9a-after-flow.png' })

  // ---------------- save scenario, verify the failed stamp
  const recCount = await page.locator('[title="The number of recorded transactions"]').innerText().catch(() => '?')
  log('recorder count before save: ' + recCount)
  // clear any stale scenario.json so an empty/old file cannot masquerade as
  // this run's save
  await page.evaluate((ws) => { try { window.remixFileSystem.unlinkSync(`.workspaces/${ws}/contracts/scenario.json`) } catch (e) {} }, WS)
  const recorderCard = page.locator('div[class*="cardContainer"]').filter({ hasText: 'Transactions recorded' })
  // expand only if the save icon is not already visible (re-clicking the arrow
  // would TOGGLE the card shut — the panel-toggle gotcha)
  if (!await page.locator('i.savetransaction').isVisible().catch(() => false)) {
    await recorderCard.locator('i[class*="arrow"]').first().click()
    await page.waitForTimeout(500)
  }
  await page.locator('i.savetransaction').click()
  const okBtn = page.locator('#modal-footer-ok')
  await okBtn.waitFor({ timeout: 10_000 })
  await okBtn.click()
  await page.waitForTimeout(2500)
  // dismiss any lingering modal (a follow-up confirm/notice) before touching
  // the file tree — a static-backdrop modal intercepts pointer events
  const dismissModals = async () => {
    for (let i = 0; i < 4; i++) {
      const modal = page.locator('[data-id="modalDialogContainer"] .modal, #modal-dialog.modal')
      if (!await modal.isVisible().catch(() => false)) return
      const ok = page.locator('#modal-footer-ok')
      if (await ok.isVisible().catch(() => false)) { await ok.click().catch(() => {}) }
      else await page.keyboard.press('Escape').catch(() => {})
      await page.waitForTimeout(600)
    }
  }
  await dismissModals()
  // don't depend on the auto-opened tab (its id/visibility varies with the
  // active side panel) — poll the filesystem directly. The scenario lands in
  // the CURRENT file's directory (fileManager.currentPath()); the current
  // file is PeachPavilion.sol, so that is contracts/.
  // Ground truth = open contracts/scenario.json in the tree and read its
  // editor buffer (BrowserFS readFileSync is unreliable in this headless
  // profile — a known read-path artifact; the editor is what the file
  // manager actually served).
  await page.locator('#icon-panel div[plugin="filePanel"]').click()
  await page.waitForTimeout(800)
  const scFile = page.locator('[data-id="treeViewLitreeViewItemcontracts/scenario.json"]')
  if (!await scFile.isVisible().catch(() => false)) {
    const folder = page.locator('[data-id="treeViewLitreeViewItemcontracts"]')
    if (await folder.isVisible().catch(() => false)) { await folder.click(); await page.waitForTimeout(1000) }
  }
  let scenarioRaw = ''
  if (await scFile.isVisible().catch(() => false)) {
    await scFile.click()
    await page.waitForTimeout(1200)
    scenarioRaw = await page.evaluate(() => {
      const el = document.getElementById('input')
      return el && el.editor ? el.editor.getSession().getValue() : ''
    })
  }
  log(`scenario.json editor buffer: ${scenarioRaw.length} bytes`)
  if (!scenarioRaw || !scenarioRaw.trim().startsWith('{')) {
    note(`could not read scenario.json content via editor (got ${scenarioRaw.length} bytes); recorder count was ${recCount}. Falling back to export-only verification.`)
    scenarioRaw = ''
  }
  // scenario.json stamp check (best-effort — the export below is the decisive
  // proof since it reads the LIVE recorder, not this file)
  let stampOK = null
  if (scenarioRaw) {
    try {
      const scenario = JSON.parse(scenarioRaw)
      const txs = scenario.transactions || []
      const failedSteps = txs.filter((t) => t.record && t.record.failed === true)
      const stfSteps = txs.filter((t) => t.record && t.record.name === 'safeTransferFrom')
      log(`scenario: ${txs.length} steps, ${stfSteps.length} safeTransferFrom, ${failedSteps.length} stamped failed`)
      stampOK = (failedSteps.length === 1 && failedSteps[0].record.name === 'safeTransferFrom')
      if (stampOK) log('failed:true stamped on EXACTLY the reverted safeTransferFrom (scenario.json)')
      else note(`scenario stamp: expected 1 failed safeTransferFrom, got ${failedSteps.length} (${failedSteps.map((t) => t.record.name).join(',') || 'none'})`)
      fs.writeFileSync(SCRATCH + '/p9a-scenario.json', scenarioRaw)
    } catch (e) { note('scenario.json parse failed: ' + String(e).slice(0, 100)) }
  }

  // ---------------- TronBox export (reads the LIVE recorder) — the decisive
  // end-to-end proof of BOTH halves of the fix: stamp + fence
  await page.locator('#icon-panel div[plugin="udapp"]').click()
  await page.waitForTimeout(800)
  if (!await page.locator('i.savetransaction').isVisible().catch(() => false)) {
    await recorderCard.locator('i[class*="arrow"]').first().click()
    await page.waitForTimeout(500)
  }
  const exportBtn = page.locator('[data-id="recorderExportTronbox"]')
  const dl = page.waitForEvent('download', { timeout: 30_000 })
  await exportBtn.click()
  const download = await dl
  const zipPath = SCRATCH + '/p9a-tronbox-export.zip'
  await download.saveAs(zipPath)
  log('TronBox export downloaded')

  // unzip the migration and assert the fence: the reverted safeTransferFrom is
  // a commented REVERTED TODO, while deploy/genesis/successful-transfer are live
  let migration = ''
  try {
    // execFileSync + arg array: no shell, no interpolation
    migration = require('child_process').execFileSync('unzip', ['-p', zipPath, 'migrations/2_deploy_contracts.js'], { encoding: 'utf8', maxBuffer: 8 << 20 })
  } catch (e) { note('unzip -p failed: ' + String(e.message || e).slice(0, 120)) }
  if (migration) {
    fs.writeFileSync(SCRATCH + '/p9a-migration.js', migration)
    const liveDeploys = (migration.match(/^\s*await deployer\.deploy\(/gm) || []).length
    const liveSTF = (migration.match(/^\s*await \w+\.safeTransferFrom\(/gm) || []).length
    const fencedSTF = (migration.match(/^\s*\/\/ await \w+\.safeTransferFrom\(/gm) || []).length
    const hasReverted = /REVERTED/.test(migration)
    log(`migration: ${liveDeploys} live deploy(s), ${liveSTF} live safeTransferFrom, ${fencedSTF} fenced safeTransferFrom, REVERTED marker=${hasReverted}`)
    if (fencedSTF === 1 && liveSTF === 1 && hasReverted) {
      log('FENCE VERIFIED: reverted safeTransferFrom is a commented REVERTED TODO; the successful one stays live — J-008 chain holds end-to-end on a real project')
    } else {
      note(`FENCE MISMATCH: expected 1 fenced + 1 live safeTransferFrom with REVERTED marker; got fenced=${fencedSTF} live=${liveSTF} marker=${hasReverted}`)
    }
  } else {
    note('could not read migration from export zip (adm-zip missing?) — inspect ' + zipPath)
  }

  // ---------------- debugger on the FAILED tx
  const dbgButtons = page.locator('[data-shared="txLoggerDebugButton"]')
  const dbgCount = await dbgButtons.count()
  // the reverted safeTransfer is the 3rd-from-last tx (revert, success, ownerOf-call order varies);
  // find the debug button inside the terminal block that mentions the revert
  let debugged = false
  const errBlock = page.locator('#journal span:has-text("errored"), #journal span:has-text("revert")').last()
  try {
    const blockDbg = page.locator('#journal .px-4:has-text("errored") [data-shared="txLoggerDebugButton"], #journal div:has-text("errored") [data-shared="txLoggerDebugButton"]').last()
    if (await blockDbg.isVisible().catch(() => false)) {
      await blockDbg.click()
      debugged = 'targeted'
    }
  } catch (e) {}
  if (!debugged && dbgCount) {
    // fallback: debug buttons are appended in tx order; the reverted tx is the
    // antepenultimate transact (revert, then success transfer; ownerOf is a call)
    await dbgButtons.nth(Math.max(0, dbgCount - 2)).click()
    debugged = 'positional'
  }
  if (debugged) {
    const nav = page.locator('[data-id="buttonNavigatorIntoForward"]')
    try {
      await nav.waitFor({ timeout: 60_000 })
      for (let i = 0; i < 8; i++) { await nav.click(); await page.waitForTimeout(250) }
      const step = await page.locator('[data-id="stepdetail"]').innerText().catch(() => '')
      log(`debugger opened on a tx (${debugged}) and stepped 8x — ` + step.split('\n').slice(0, 2).join(' / '))
      await page.screenshot({ path: SCRATCH + '/p9a-debugger.png' })
    } catch (e) {
      note('debugger did not open for the selected tx: ' + String(e).slice(0, 120))
    }
  } else {
    note('no debug button found for the reverted tx (' + dbgCount + ' total)')
  }

  await ctx.close()
  console.log('NOTES-BEGIN'); notes.forEach((x) => console.log('- ' + x)); console.log('NOTES-END')
  console.log('P9A-OK')
})().catch((e) => { console.error('P9A-FAIL', e); process.exit(1) })
