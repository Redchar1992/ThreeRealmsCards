// P2: local-chain dogfooding — VM deploy, Peach Garden genesis mint + reads,
// recorder save/replay, debugger stepping, TronBox export.
const fs = require('fs')
const { chromium } = require('/Users/tron/Object/trontech/tron-remix/node_modules/@playwright/test')

const PROFILE = '/Users/tron/Object/tronSmart/.tronide-profile'
const SCRATCH = '/private/tmp/claude-501/-Users-tron-Object-trontech-tron-remix/607fd892-ece0-473d-8492-66232f2e46ae/scratchpad'
const REPO = '/Users/tron/Object/tronSmart/ThreeRealmsCards'
const FILE = 'contracts/ThreeRealmsCards.sol'
const notes = []
const log = (m) => console.log('[p2]', m)
const note = (m) => { notes.push(m); console.log('[p2][NOTE]', m) }

;(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1440, height: 900 } })
  const page = ctx.pages()[0] || await ctx.newPage()
  await page.goto('http://localhost:18080/', { waitUntil: 'load', timeout: 120_000 })
  try { await page.addStyleTag({ content: '#webpack-dev-server-client-overlay { display: none !important; }' }) } catch (e) {}
  try { const w = page.locator('button:has-text("I Understand")'); await w.waitFor({ state: 'visible', timeout: 4000 }); await w.click() } catch (e) {}
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 60_000 }).catch(() => {})
  const ws = await page.locator('select[data-id="workspacesSelect"]').inputValue().catch(() => '?')
  if (ws !== 'three-realms') { await page.locator('select[data-id="workspacesSelect"]').selectOption('three-realms'); log('switched to three-realms (J-003 again: loaded ' + ws + ')') }
  await page.waitForTimeout(1500)

  // open the contract so the udapp dropdown follows it (known gotcha)
  const item = page.locator(`[data-id="treeViewLitreeViewItem${FILE}"]`)
  if (!await item.isVisible().catch(() => false)) {
    const folder = page.locator('[data-id="treeViewLitreeViewItemcontracts"]')
    if (await folder.isVisible().catch(() => false)) await folder.click()
  }
  await item.click()
  await page.waitForTimeout(800)

  // ---------------- A: compile on the fast local 0.8.6, open udapp, deploy
  await page.locator('#icon-panel div[plugin="solidity"]').click()
  const v086 = await page.evaluate(() => {
    const sel = document.querySelector('#versionSelector')
    const o = sel && Array.from(sel.options).find((x) => x.value.includes('0.8.6'))
    return o ? o.value : ''
  })
  if (v086 && (await page.locator('#versionSelector').inputValue().catch(() => '')) !== v086) {
    await page.locator('#versionSelector').selectOption(v086)
    await page.waitForTimeout(4000)
  }
  await page.locator('[data-id="compilerContainerCompileBtn"]').click()
  await page.locator('[data-id="compiledContracts"]').waitFor({ timeout: 150_000 })
  log('A: compiled')

  await page.locator('#icon-panel div[plugin="udapp"]').click()
  await page.locator('select[id="selectExEnvOptions"]').selectOption({ label: 'JavaScript VM (Tron)' })
  await page.locator('#runTabView select[class^="contractNames"]').selectOption('ThreeRealmsCards')
  const account = await page.evaluate(() => {
    const sel = document.querySelector('#runTabView #txorigin')
    return sel && sel.options.length ? sel.options[0].value : ''
  })
  if (!account) { note('A: no VM account available!'); throw new Error('no account') }
  log('A: first VM account ' + account.slice(0, 12) + '…')
  await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
  const instance = page.locator('.instance').first()
  await instance.waitFor({ timeout: 30_000 })
  await instance.locator('[data-id="universalDappUiTitleExpander"]').click()
  log('A: deployed, instance expanded')

  const row = (fn) => instance.locator('div[class*="contractProperty"]', { hasText: fn }).first()
  const callAndText = async (fn, arg) => {
    const r = row(fn)
    if (arg !== undefined) await r.locator('input').first().fill(String(arg))
    await r.locator('button').first().click()
    await page.waitForTimeout(1200)
    return (await instance.innerText()).replace(/\s+/g, ' ')
  }

  // ---------------- B: genesis mint + reads
  await callAndText('mintPeachGardenGenesis', account)
  await page.waitForTimeout(800)
  let txt = await callAndText('balanceOf', account)
  if (/balanceOf[^]*?3/.test(txt)) log('B: balanceOf(owner) == 3 after genesis')
  else note('B: unexpected balanceOf output: ' + txt.slice(-160))
  txt = await callAndText('cardOf', 1)
  if (txt.includes('Liu Bei') && txt.includes('Peach Garden')) log('B: cardOf(1) => Liu Bei / Peach Garden')
  else note('B: cardOf(1) missing expected fields: ' + txt.slice(-200))
  txt = await callAndText('tokenURI', 2)
  const m = txt.match(/data:application\/json;base64,([A-Za-z0-9+/=]+)/)
  if (m) {
    const json = Buffer.from(m[1], 'base64').toString('utf8')
    if (json.includes('"Guan Yu #2"') && json.includes('"Attack","value":97')) {
      log('B: tokenURI(2) decodes to valid metadata (Guan Yu, Attack 97)')
      fs.mkdirSync(REPO + '/docs/metadata', { recursive: true })
      fs.writeFileSync(REPO + '/docs/metadata/token-2-guanyu.json', json + '\n')
    } else note('B: tokenURI JSON unexpected: ' + json.slice(0, 200))
  } else note('B: no data-URI found in tokenURI output: ' + txt.slice(-200))
  // genesis re-mint must revert (one-shot guard)
  const before = await page.locator('[data-shared="txLoggerDebugButton"]').count()
  await callAndText('mintPeachGardenGenesis', account)
  txt = (await page.evaluate(() => document.querySelector('#journal, .terminal, #terminalView') ? document.querySelector('#journal, .terminal, #terminalView').innerText : '')).replace(/\s+/g, ' ')
  if (/genesis already minted|revert/i.test(txt)) log('B: second genesis correctly reverts (one-shot guard)')
  else note('B: second genesis revert not visible in terminal (check manually)')
  await page.screenshot({ path: SCRATCH + '/p2-b-genesis.png' })

  // ---------------- C: recorder save
  const recorderCard = page.locator('div[class*="cardContainer"]').filter({ hasText: 'Transactions recorded' })
  await recorderCard.locator('i[class*="arrow"]').first().click()
  await page.locator('i.savetransaction').click()
  const okBtn = page.locator('#modal-footer-ok')
  await okBtn.waitFor({ timeout: 10_000 })
  await okBtn.click()
  // the save auto-opens scenario.json as a tab (the tree span stays hidden
  // while the Deploy & Run side panel is focused)
  await page.locator('remix-tab[id$="scenario.json"]').waitFor({ timeout: 20_000 })
  log('C: scenario.json saved and auto-opened (deploy + genesis recorded)')

  // ---------------- F(moved): TronBox export while the recording is live
  const card2 = page.locator('div[class*="cardContainer"]').filter({ hasText: 'Transactions recorded' })
  const exportBtn = page.locator('[data-id="recorderExportTronbox"]')
  if (!await exportBtn.isVisible().catch(() => false)) await card2.locator('i[class*="arrow"]').first().click()
  const dl = page.waitForEvent('download', { timeout: 30_000 })
  await exportBtn.click()
  const download = await dl
  const zipPath = SCRATCH + '/tronbox-export.zip'
  await download.saveAs(zipPath)
  log('F: TronBox project downloaded (' + download.suggestedFilename() + ')')

  // ---------------- D: clear + replay
  await page.locator('[data-id="deployAndRunClearInstances"]').click()
  await page.waitForTimeout(1000)
  await page.locator('i.runtransaction').click()
  await page.locator('.instance').first().waitFor({ timeout: 30_000 })
  const inst2 = page.locator('.instance').first()
  await inst2.locator('[data-id="universalDappUiTitleExpander"]').click()
  const r2 = inst2.locator('div[class*="contractProperty"]', { hasText: 'balanceOf' }).first()
  await r2.locator('input').first().fill(account)
  await r2.locator('button').first().click()
  await page.waitForTimeout(1500)
  const replayTxt = (await inst2.innerText()).replace(/\s+/g, ' ')
  if (/balanceOf[^]*?3/.test(replayTxt)) log('D: replay re-created state — balanceOf(owner) == 3 on the new instance')
  else note('D: replay state mismatch: ' + replayTxt.slice(-160))

  // ---------------- E: debug the genesis mint
  const dbgButtons = page.locator('[data-shared="txLoggerDebugButton"]')
  const n = await dbgButtons.count()
  if (!n) note('E: no debug buttons in terminal')
  else {
    await dbgButtons.last().click()
    await page.locator('[data-id="buttonNavigatorJumpPreviousBreakpoint"]').waitFor({ timeout: 60_000 })
    for (let i = 0; i < 5; i++) { await page.locator('[data-id="buttonNavigatorIntoForward"]').click(); await page.waitForTimeout(300) }
    const step = await page.locator('[data-id="stepdetail"]').innerText().catch(() => '')
    log('E: debugger stepped 5x — ' + step.split('\n').slice(0, 2).join(' / '))
    await page.screenshot({ path: SCRATCH + '/p2-e-debugger.png' })
  }

  await ctx.close()

  console.log('NOTES-BEGIN'); notes.forEach((x) => console.log('- ' + x)); console.log('NOTES-END')
  console.log('P2-OK')
})().catch((e) => { console.error('P2-FAIL', e); process.exit(1) })
