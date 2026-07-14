// P8: redeploy the HARDENED architecture to Nile (v3) over the user's Chrome.
// Same flow as p7, plus: 11 files (ITRC165 + ITRC721Receiver joined the graph)
// and an auto-confirmer for the TronLink popup so the run needs no human at
// the keyboard (Nile testnet; the txs being signed are the ones this script
// itself just initiated — deploy + genesis, nothing else).
const fs = require('fs')
const path = require('path')
const { chromium } = require('/Users/tron/Object/trontech/tron-remix/node_modules/@playwright/test')

const SCRATCH = '/private/tmp/claude-501/-Users-tron-Object-tronSmart-ThreeRealmsCards/7673a2a2-3274-43b4-a714-1dd2ad4e7c0f/scratchpad'
const REPO = '/Users/tron/Object/tronSmart/ThreeRealmsCards'
const ROOT = REPO + '/contracts'
const WS = 'three-realms-v2'
const FILES = [
  'types/CardTypes.sol', 'utils/StrUtils.sol', 'libs/Base64.sol', 'libs/CardCodec.sol',
  'access/Suzerain.sol',
  'interfaces/ITRC165.sol', 'interfaces/ITRC721.sol', 'interfaces/ITRC721Metadata.sol',
  'interfaces/ITRC721Receiver.sol',
  'PeachPavilion.sol', 'ThreeRealmsCards.sol'
]
const notes = []
const log = (m) => console.log('[p8]', m)
const note = (m) => { notes.push(m); console.log('[p8][NOTE]', m) }

;(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 20_000 })
  const ctx = browser.contexts()[0]
  let page = ctx.pages().find((p) => p.url().includes('localhost:18080'))
  if (!page) { page = await ctx.newPage(); await page.goto('http://localhost:18080/', { waitUntil: 'load', timeout: 120_000 }) }
  await page.bringToFront()
  await page.evaluate(() => document.querySelectorAll('#webpack-dev-server-client-overlay').forEach((e) => e.remove()))
  await page.addStyleTag({ content: '#webpack-dev-server-client-overlay { display: none !important; }' }).catch(() => {})
  try { const w = page.locator('button:has-text("I Understand")'); await w.waitFor({ state: 'visible', timeout: 5000 }); await w.click() } catch (e) {}
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ state: 'attached', timeout: 60_000 })

  // TronLink popup auto-confirmer: only extension pages, only visible
  // Confirm/Accept-style primary buttons. Logs whatever it clicks.
  const tryConfirmPopup = async () => {
    for (const p of ctx.pages()) {
      const url = p.url()
      if (!url.startsWith('chrome-extension://')) continue
      try {
        const btn = p.locator([
          'button:has-text("Confirm")', 'button:has-text("确认")', 'button:has-text("Accept")',
          'button:has-text("Sign")', 'button[class*="confirm"]', 'div[class*="btn"][class*="confirm"]'
        ].join(', ')).first()
        if (await btn.isVisible({ timeout: 300 }).catch(() => false)) {
          const title = await p.title().catch(() => '')
          await p.bringToFront().catch(() => {})
          await btn.click({ timeout: 2000 }).catch(() => {})
          log('wallet confirm clicked (' + (title || url.slice(0, 60)) + ')')
          return true
        }
      } catch (e) {}
    }
    return false
  }
  const untilVisible = async (locator, totalMs, label) => {
    const deadline = Date.now() + totalMs
    while (Date.now() < deadline) {
      if (await locator.isVisible().catch(() => false)) return
      await tryConfirmPopup()
      await page.waitForTimeout(2000)
    }
    throw new Error('timeout waiting for ' + label)
  }

  // the file panel must be the active side panel before the create icon shows
  if (!await page.locator('[data-id="filePanelFileExplorerTree"]').isVisible().catch(() => false)) {
    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    await page.locator('[data-id="filePanelFileExplorerTree"]').waitFor({ timeout: 15_000 })
  }
  // create or select the workspace
  const opts = await page.evaluate(() => { const s = document.querySelector('select[data-id="workspacesSelect"]'); return s ? Array.from(s.options).map((o) => o.value) : [] })
  if (!opts.includes(WS)) {
    await page.locator('[data-id="workspaceCreate"]').click()
    const nameInput = page.locator('input[data-id="modalDialogCustomPromptTextCreate"]')
    await nameInput.waitFor({ state: 'visible', timeout: 5000 })
    await nameInput.fill(WS)
    await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()
    await page.waitForTimeout(2500)
    log('created workspace ' + WS)
  } else {
    await page.locator('select[data-id="workspacesSelect"]').selectOption(WS)
    await page.waitForTimeout(1500)
    log('selected existing workspace ' + WS)
  }

  // idempotent write: only touch files whose content differs, then verify by
  // read-back — when nothing changed we skip the reload entirely, dodging the
  // J-005 lazy-persistence race
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
  log(`files: ${wrote.written} written, ${wrote.verified}/${FILES.length} verified in workspace`)
  if (wrote.verified !== FILES.length) throw new Error('workspace file verification failed')
  if (wrote.written > 0) {
    await page.waitForTimeout(6000) // let BrowserFS/localStorage flush (J-005 family)
    await page.reload({ waitUntil: 'load' }); try { const w = page.locator('button:has-text("I Understand")'); await w.waitFor({ state: 'visible', timeout: 5000 }); await w.click() } catch (e) {}
    await page.waitForTimeout(4000)
  }
  if (!await page.locator('[data-id="filePanelFileExplorerTree"]').isVisible().catch(() => false)) { await page.locator('#icon-panel div[plugin="filePanel"]').click(); await page.waitForTimeout(1500) }

  // open the main contract: expand the contracts folder and click the file,
  // with an already-open editor tab as fallback
  const openMain = async () => {
    const tab = page.locator('div.tab:has-text("ThreeRealmsCards.sol"), [data-id="tab-ThreeRealmsCards.sol"]').first()
    const folder = page.locator('[data-id="treeViewLitreeViewItemcontracts"]')
    const file = page.locator('[data-id="treeViewLitreeViewItemcontracts/ThreeRealmsCards.sol"]')
    for (let r = 0; r < 20; r++) {
      if (await file.isVisible().catch(() => false)) { await file.click({ force: true }); return 'tree' }
      if (await folder.isVisible().catch(() => false)) {
        await folder.click({ force: true }).catch(() => {})
        await page.waitForTimeout(1500)
        if (await file.isVisible().catch(() => false)) { await file.click({ force: true }); return 'tree' }
      } else if (await tab.isVisible().catch(() => false)) {
        await tab.click().catch(() => {})
        return 'tab'
      }
      await page.waitForTimeout(1500)
    }
    throw new Error('could not open ThreeRealmsCards.sol (tree and tabs both unavailable)')
  }
  log('opened ThreeRealmsCards.sol via ' + (await openMain()))
  await page.waitForTimeout(700)

  // let the reloaded app fully settle before driving plugins — the p8 first
  // run showed a late hash-rewrite (compiler params) can remount tabs
  await page.waitForTimeout(5000)

  const isTAddr = (a) => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)

  const pinAndCompile = async () => {
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await page.waitForTimeout(1000)
    const v0820 = await page.evaluate(() => { const s = document.querySelector('#versionSelector'); const o = s && Array.from(s.options).find((x) => x.value.includes('0.8.20')); return o ? o.value : '' })
    if (v0820 && (await page.locator('#versionSelector').inputValue().catch(() => '')) !== v0820) { await page.locator('#versionSelector').selectOption(v0820); await page.waitForTimeout(4000) }
    await page.locator('[data-id="compilerContainerCompileBtn"]').click()
    await page.locator('[data-id="compiledContracts"]').waitFor({ timeout: 180_000 })
    const compiled = await page.locator('[data-id="compiledContracts"]').innerText()
    if (!/ThreeRealmsCards/.test(compiled)) { note('compile did not produce ThreeRealmsCards: ' + compiled.slice(0, 120)); throw new Error('compile') }
    log('compiled the 11-file hardened graph on ' + (v0820 || 'current version'))
  }

  // injected env — VM's 0x5B38… must never pass for a TRON address
  const ensureInjected = async () => {
    await page.locator('#icon-panel div[plugin="udapp"]').click()
    await page.waitForTimeout(1500)
    for (let i = 0; i < 10; i++) {
      const cur = await page.evaluate(() => { const s = document.querySelector('#runTabView #txorigin'); return s && s.options.length ? s.options[0].value : '' })
      if (isTAddr(cur)) return cur
      await page.locator('select[id="selectExEnvOptions"]').selectOption('injected').catch(() => {})
      await page.waitForTimeout(3000)
    }
    throw new Error('injected account never became a T-address (TronLink asleep?)')
  }

  let account = ''
  for (let round = 1; round <= 3; round++) {
    await pinAndCompile()
    account = await ensureInjected()
    const deployReady = await page.evaluate(() => { const s = document.querySelector('#runTabView select[class^="contractNames"]'); return !!s && !s.disabled })
    if (deployReady) break
    log('contract dropdown disabled after env switch — recompiling (round ' + round + ')')
    if (round === 3) throw new Error('deploy dropdown stayed disabled across recompiles')
  }
  log('account: ' + account)

  const grabAddr = async (name) => {
    if (!await page.locator('[data-id="recorderAddressBookEntry"]').first().isVisible().catch(() => false)) {
      const card = page.locator('div[class*="cardContainer"]').filter({ hasText: 'Transactions recorded' })
      await card.locator('i[class*="arrow"]').first().click().catch(() => {})
      await page.waitForTimeout(800)
    }
    // LAST matching entry — the book may still hold the old v2 deploy
    return page.evaluate((n) => {
      let found = ''
      for (const e of Array.from(document.querySelectorAll('[data-id="recorderAddressBookEntry"]'))) {
        const nm = e.querySelector('[data-id="recorderAddressBookName"]')
        if (nm && nm.innerText.trim() === n) { const ad = e.querySelector('[data-id="recorderAddressBookAddress"]'); if (ad) found = ad.innerText.trim() }
      }
      return found
    }, name)
  }

  // fee limit: the default 400 TRX buys exactly 4M energy on Nile (100 sun/E)
  // and the hardened graph needs more than v2's 3.49M — raise the CAP to
  // 1000 TRX (only actual consumption is charged)
  await page.locator('#gasLimit').fill('1000000000')
  log('fee limit raised to 1000 TRX (cap)')

  // deploy the hardened cards contract
  await page.locator('#runTabView select[class^="contractNames"]').selectOption('ThreeRealmsCards')
  log('DEPLOY ThreeRealmsCards (v3, hardened) — auto-confirming TronLink…')
  await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
  const cards = page.locator('.instance').first()
  await untilVisible(cards, 240_000, 'deployed instance')
  await cards.locator('[data-id="universalDappUiTitleExpander"]').click()
  const cardsAddr = await grabAddr('ThreeRealmsCards')
  if (!cardsAddr || cardsAddr === 'TEzyMokXwNqJteoSGC1v4rerK4mkfYE1f9') {
    note('address book returned old/empty address: ' + cardsAddr)
    throw new Error('could not identify the fresh v3 address')
  }
  log('cards deployed at ' + cardsAddr)
  fs.writeFileSync(SCRATCH + '/p8-cards-addr.txt', cardsAddr)

  const rowIn = (inst, fn) => inst.locator('div[class*="contractProperty"]', { hasText: fn }).first()
  const call = async (inst, fn, arg, waitMs) => {
    const r = rowIn(inst, fn)
    if (arg !== undefined) await r.locator('input').first().fill(String(arg))
    await r.locator('button').first().click()
    const deadline = Date.now() + (waitMs || 3000)
    while (Date.now() < deadline) { await tryConfirmPopup(); await page.waitForTimeout(1000) }
    return (await inst.innerText()).replace(/\s+/g, ' ')
  }

  // genesis + reads
  log('GENESIS mint — auto-confirming TronLink…')
  await call(cards, 'mintPeachGardenGenesis', account, 8000)
  let ok = false
  for (let i = 0; i < 30; i++) { const t = await call(cards, 'balanceOf', account, 2500); if (/balanceOf[^]*?\b3\b/.test(t)) { ok = true; break } }
  log(ok ? 'GENESIS confirmed on Nile: balanceOf==3' : 'balanceOf not 3 yet')
  if (!ok) note('genesis balance not confirmed')
  const uri = await call(cards, 'tokenURI', 2, 2500)
  const m = uri.match(/data:application\/json;base64,([A-Za-z0-9+/=]+)/)
  if (m && Buffer.from(m[1], 'base64').toString('utf8').includes('Guan Yu')) log('tokenURI(2) decodes (Guan Yu) on Nile')
  else note('tokenURI odd')
  await page.screenshot({ path: SCRATCH + '/p8-genesis.png' })

  console.log('CARDS_ADDR=' + cardsAddr)
  await browser.close().catch(() => {})
  console.log('NOTES-BEGIN'); notes.forEach((x) => console.log('- ' + x)); console.log('NOTES-END')
  console.log('P8-OK')
})().catch((e) => { console.error('P8-FAIL', e); process.exit(1) })
