// P4 (take 2): real-chain dogfooding over the user's Chrome. The repo clone
// path dies on the localStorage quota (J-009), so this build creates a light
// workspace and writes ONLY the contract file through the UI.
const fs = require('fs')
const { chromium } = require('/Users/tron/Object/trontech/tron-remix/node_modules/@playwright/test')

const SCRATCH = '/private/tmp/claude-501/-Users-tron-Object-trontech-tron-remix/607fd892-ece0-473d-8492-66232f2e46ae/scratchpad'
const REPO = '/Users/tron/Object/tronSmart/ThreeRealmsCards'
const WS = 'three-realms-live'
const FILE = 'ThreeRealmsCards.sol' // workspace root: no folders, no images
const SOURCE = fs.readFileSync(REPO + '/contracts/ThreeRealmsCards.sol', 'utf8')
const notes = []
const log = (m) => console.log('[p4]', m)
const note = (m) => { notes.push(m); console.log('[p4][NOTE]', m) }

async function cleanBoot (page) {
  await page.reload({ waitUntil: 'load' }).catch(() => {})
  try { const w = page.locator('button:has-text("I Understand")'); await w.waitFor({ state: 'visible', timeout: 4000 }); await w.click() } catch (e) {}
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 60_000 }).catch(() => {})
  if (!await page.locator('[data-id="filePanelFileExplorerTree"]').isVisible().catch(() => false)) {
    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    await page.locator('[data-id="filePanelFileExplorerTree"]').waitFor({ timeout: 15_000 })
  }
}

;(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 20_000 })
  const ctx = browser.contexts()[0]
  let page = ctx.pages().find((p) => p.url().includes('localhost:18080'))
  if (!page) { page = await ctx.newPage(); await page.goto('http://localhost:18080/', { waitUntil: 'load', timeout: 120_000 }) }
  await page.bringToFront()
  await cleanBoot(page)

  let ws = await page.locator('select[data-id="workspacesSelect"]').inputValue().catch(() => '?')
  log('workspace after boot: ' + ws)
  if (ws !== WS) {
    const options = await page.evaluate(() => Array.from(document.querySelector('select[data-id="workspacesSelect"]').options).map((o) => o.value))
    if (options.includes(WS)) {
      await page.locator('select[data-id="workspacesSelect"]').selectOption(WS)
    } else {
      await page.locator('[data-id="workspaceCreate"]').click()
      const nameInput = page.locator('input[data-id="modalDialogCustomPromptTextCreate"]')
      await nameInput.waitFor({ state: 'visible', timeout: 5000 })
      await nameInput.fill(WS)
      await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()
    }
    await page.waitForTimeout(2000)
    await cleanBoot(page)
    ws = await page.locator('select[data-id="workspacesSelect"]').inputValue().catch(() => '?')
    log('workspace ready: ' + ws)
  }

  // seed the contract at the workspace root if missing
  const hasFile = await page.evaluate(({ w, f }) => {
    try { return window.remixFileSystem.readFileSync(`.workspaces/${w}/${f}`, 'utf8').length > 0 } catch (e) { return false }
  }, { w: WS, f: FILE })
  if (!hasFile) {
    await page.locator('[data-id="fileExplorerNewFilecreateNewFile"]').click()
    const blank = page.locator('[data-id$="/blank"]').first()
    await blank.waitFor({ state: 'visible', timeout: 10_000 })
    // the inline rename editor must own the focus before typing lands
    const editable = blank.locator('[contenteditable="true"]').first()
    await editable.waitFor({ state: 'visible', timeout: 10_000 })
    await editable.click()
    await page.waitForTimeout(300)
    await page.keyboard.type(FILE)
    await page.keyboard.press('Enter')
    await page.locator(`[data-id="treeViewLitreeViewItem${FILE}"]`).waitFor({ timeout: 20_000 })
    await page.locator(`[data-id="treeViewLitreeViewItem${FILE}"]`).click()
    await page.locator('#input').waitFor({ timeout: 10_000 })
    await page.evaluate((src) => { document.getElementById('input').editor.session.setValue(src) }, SOURCE)
    await page.keyboard.press('Meta+s')
    await page.waitForTimeout(1500)
    log('contract seeded at workspace root (' + SOURCE.length + ' bytes)')
  } else {
    await page.locator(`[data-id="treeViewLitreeViewItem${FILE}"]`).click()
    await page.waitForTimeout(800)
    log('contract already present')
  }

  // TronLink injection sanity
  const inj = await page.evaluate(() => ({
    tronWeb: !!window.tronWeb,
    addr: (window.tronWeb && window.tronWeb.defaultAddress && window.tronWeb.defaultAddress.base58) || null,
    host: (window.tronWeb && window.tronWeb.fullNode && window.tronWeb.fullNode.host) || ''
  }))
  if (!inj.tronWeb) { note('TronLink not injected'); throw new Error('no injection') }
  if (!/nile/i.test(inj.host)) note('network host is not Nile: ' + inj.host)
  log('injected: ' + inj.addr + ' @ ' + inj.host)

  // compile
  await page.locator('#icon-panel div[plugin="solidity"]').click()
  await page.locator('[data-id="compilerContainerCompileBtn"]').click()
  await page.locator('[data-id="compiledContracts"]').waitFor({ timeout: 150_000 })
  log('compiled')

  // udapp on Injected TronWeb
  await page.locator('#icon-panel div[plugin="udapp"]').click()
  await page.locator('select[id="selectExEnvOptions"]').selectOption('injected')
  await page.waitForTimeout(3000)
  const account = await page.evaluate(() => {
    const sel = document.querySelector('#runTabView #txorigin')
    return sel && sel.options.length ? sel.options[0].value : ''
  })
  if (!account) { note('no injected account — approve the TronLink site connection and rerun'); throw new Error('no account') }
  log('account: ' + account)
  await page.locator('#runTabView select[class^="contractNames"]').selectOption('ThreeRealmsCards')

  log('DEPLOY: sending — approve in TronLink if prompted…')
  await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
  const instance = page.locator('.instance').first()
  await instance.waitFor({ timeout: 240_000 })
  await instance.locator('[data-id="universalDappUiTitleExpander"]').click()
  const instTitle = (await instance.innerText()).split('\n')[0]
  log('deployed instance: ' + instTitle.trim())
  await page.screenshot({ path: SCRATCH + '/p4-deploy.png' })

  const row = (fn) => instance.locator('div[class*="contractProperty"]', { hasText: fn }).first()
  const callAndText = async (fn, arg, waitMs) => {
    const r = row(fn)
    if (arg !== undefined) await r.locator('input').first().fill(String(arg))
    await r.locator('button').first().click()
    await page.waitForTimeout(waitMs || 2000)
    return (await instance.innerText()).replace(/\s+/g, ' ')
  }

  log('GENESIS: sending — approve in TronLink if prompted…')
  await callAndText('mintPeachGardenGenesis', account, 4000)
  let ok = false
  for (let i = 0; i < 30; i++) {
    const txt = await callAndText('balanceOf', account, 2500)
    if (/balanceOf[^]*?\b3\b/.test(txt)) { ok = true; break }
  }
  if (ok) log('GENESIS confirmed on-chain: balanceOf(owner) == 3')
  else note('balanceOf did not reach 3 — check the tx in TronLink/TronScan')

  const cardTxt = await callAndText('cardOf', 1, 2500)
  if (cardTxt.includes('Liu Bei')) log('cardOf(1) reads back Liu Bei from Nile')
  else note('cardOf(1) unexpected: ' + cardTxt.slice(-160))
  const uriTxt = await callAndText('tokenURI', 2, 2500)
  const m = uriTxt.match(/data:application\/json;base64,([A-Za-z0-9+/=]+)/)
  if (m && Buffer.from(m[1], 'base64').toString('utf8').includes('Guan Yu')) log('tokenURI(2) decodes on-chain (Guan Yu)')
  else note('tokenURI read unexpected')
  await page.screenshot({ path: SCRATCH + '/p4-genesis.png' })

  const b58 = ((await instance.innerText()).match(/T[1-9A-HJ-NP-Za-km-z]{33}/) || [])[0] || ''
  if (b58) { log('contract address: ' + b58); fs.writeFileSync(SCRATCH + '/p4-address.txt', b58) }
  else note('could not parse the base58 address from: ' + instTitle)

  // Flatten + verification package
  if (await page.locator('#icon-panel div[plugin="contractVerification"]').count() === 0) {
    await page.locator('#icon-panel div[plugin="pluginManager"]').click()
    await page.locator('[data-id="pluginManagerComponentActivateButtoncontractVerification"]').click()
    await page.locator('#icon-panel div[plugin="contractVerification"]').waitFor({ timeout: 10_000 })
  }
  await page.locator('#icon-panel div[plugin="contractVerification"]').click()
  await page.waitForTimeout(1500)
  await page.locator('[data-id="contractVerificationFlatten"]').click()
  await page.locator('[data-id="contractVerificationFlattenText"]').waitFor({ timeout: 30_000 })
  const flat = await page.locator('[data-id="contractVerificationFlattenText"]').inputValue().catch(async () =>
    await page.locator('[data-id="contractVerificationFlattenText"]').innerText())
  log('flattened: ' + (flat || '').length + ' chars')
  const save = page.locator('[data-id="contractVerificationSaveFlatten"]')
  if (await save.isVisible().catch(() => false)) { await save.click(); await page.waitForTimeout(1500); log('flattened source saved into the workspace') }
  await page.locator('[data-id="contractVerificationGeneratePackage"]').click()
  await page.waitForTimeout(2500)
  const pkgHistory = await page.locator('[data-id="contractVerificationPackageHistory"]').innerText().catch(() => '')
  log('package history: ' + pkgHistory.split('\n').slice(0, 2).join(' | '))
  await page.screenshot({ path: SCRATCH + '/p4-verification.png' })
  if (flat) fs.writeFileSync(REPO + '/exports/verification-flattened.sol', flat)

  await browser.close().catch(() => {})
  console.log('NOTES-BEGIN'); notes.forEach((x) => console.log('- ' + x)); console.log('NOTES-END')
  console.log('P4-OK')
})().catch((e) => { console.error('P4-FAIL', e); process.exit(1) })
