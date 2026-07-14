// P11: deploy v5 — v4 plus the P10 lessons — to Nile over the user's Chrome.
// Changes vs p10/p10b: assembly Base64 + slimmed SVG (public-node CPU cap:
// 4.07M-gas tokenURI answered OutOfTimeException; now 1.46M), EXACT-match
// instance row selection (the p10b substring match hit sealRenderer and the
// auto-confirmer signed it — v4's renderer is sealed forever), and the
// renderer compile phase baked in (the IDE compiles the ACTIVE FILE's graph;
// the core deliberately does not import the renderer). No sealing here.
const fs = require('fs')
const path = require('path')
const { chromium } = require('/Users/tron/Object/trontech/tron-remix/node_modules/@playwright/test')

const SCRATCH = '/private/tmp/claude-501/-Users-tron-Object-tronSmart-ThreeRealmsCards/7673a2a2-3274-43b4-a714-1dd2ad4e7c0f/scratchpad'
const REPO = '/Users/tron/Object/tronSmart/ThreeRealmsCards'
const ROOT = REPO + '/contracts'
const WS = 'three-realms-v2'
const OLD_DEPLOYS = ['TEzyMokXwNqJteoSGC1v4rerK4mkfYE1f9', 'TYK5P6bUBGuadpjyB9aZ6nVSDEj98PfSWR', 'THRSFpEVownGtVx7WjdzYbbvqbTsD3iywJ']
const FILES = [
  'types/CardTypes.sol', 'utils/StrUtils.sol', 'libs/Base64.sol', 'libs/CardCodec.sol',
  'access/Suzerain.sol',
  'interfaces/ITRC165.sol', 'interfaces/ITRC721.sol', 'interfaces/ITRC721Metadata.sol',
  'interfaces/ITRC721Receiver.sol', 'interfaces/IRenderer.sol',
  'render/CardRenderer.sol',
  'PeachPavilion.sol', 'ThreeRealmsCards.sol'
]
const notes = []
const log = (m) => console.log('[p11]', m)
const note = (m) => { notes.push(m); console.log('[p11][NOTE]', m) }

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

  if (!await page.locator('[data-id="filePanelFileExplorerTree"]').isVisible().catch(() => false)) {
    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    await page.locator('[data-id="filePanelFileExplorerTree"]').waitFor({ timeout: 15_000 })
  }
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
  log(`files: ${wrote.written} written, ${wrote.verified}/${FILES.length} verified in workspace`)
  if (wrote.verified !== FILES.length) throw new Error('workspace file verification failed')
  if (wrote.written > 0) {
    await page.waitForTimeout(6000) // let BrowserFS/localStorage flush (J-005 family)
    await page.reload({ waitUntil: 'load' }); try { const w = page.locator('button:has-text("I Understand")'); await w.waitFor({ state: 'visible', timeout: 5000 }); await w.click() } catch (e) {}
    await page.waitForTimeout(4000)
  }
  if (!await page.locator('[data-id="filePanelFileExplorerTree"]').isVisible().catch(() => false)) { await page.locator('#icon-panel div[plugin="filePanel"]').click(); await page.waitForTimeout(1500) }

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

  await page.waitForTimeout(5000) // let the app settle before driving plugins

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
    log('compiled the 13-file v5 graph on ' + (v0820 || 'current version'))
  }

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
    // LAST matching entry — the book may still hold earlier deploys
    return page.evaluate((n) => {
      let found = ''
      for (const e of Array.from(document.querySelectorAll('[data-id="recorderAddressBookEntry"]'))) {
        const nm = e.querySelector('[data-id="recorderAddressBookName"]')
        if (nm && nm.innerText.trim() === n) { const ad = e.querySelector('[data-id="recorderAddressBookAddress"]'); if (ad) found = ad.innerText.trim() }
      }
      return found
    }, name)
  }

  // fee limit cap 1000 TRX: the v4 graph is bigger than v3's 4.26M energy
  await page.locator('#gasLimit').fill('1000000000')
  log('fee limit raised to 1000 TRX (cap)')

  // ---------------- deploy the v4 cards contract
  await page.locator('#runTabView select[class^="contractNames"]').selectOption('ThreeRealmsCards')
  log('DEPLOY ThreeRealmsCards (v5) — auto-confirming TronLink…')
  await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
  const cards = page.locator('.instance').first()
  await untilVisible(cards, 240_000, 'cards instance')
  await cards.locator('[data-id="universalDappUiTitleExpander"]').click()
  const cardsAddr = await grabAddr('ThreeRealmsCards')
  if (!isTAddr(cardsAddr) || OLD_DEPLOYS.includes(cardsAddr)) {
    note('address book returned old/empty cards address: ' + cardsAddr)
    throw new Error('could not identify the fresh v5 address')
  }
  log('cards (v5) deployed at ' + cardsAddr)
  fs.writeFileSync(SCRATCH + '/p11-cards-addr.txt', cardsAddr)

  // EXACT function-name match on the row's button — substring matching is
  // how p10b accidentally sealed v4 ('renderer' also matched 'sealRenderer')
  const rowIn = (inst, fn) => inst
    .locator('div[class*="contractProperty"]')
    .filter({ has: page.locator('button', { hasText: new RegExp('^' + fn + '$') }) })
    .first()
  const call = async (inst, fn, arg, waitMs) => {
    const r = rowIn(inst, fn)
    if (arg !== undefined) await r.locator('input').first().fill(String(arg))
    await r.locator('button').first().click()
    const deadline = Date.now() + (waitMs || 3000)
    while (Date.now() < deadline) { await tryConfirmPopup(); await page.waitForTimeout(1000) }
    return (await inst.innerText()).replace(/\s+/g, ' ')
  }

  // ---------------- genesis
  log('GENESIS mint — auto-confirming TronLink…')
  await call(cards, 'mintPeachGardenGenesis', account, 8000)
  let ok = false
  for (let i = 0; i < 30; i++) { const t = await call(cards, 'balanceOf', account, 2500); if (/balanceOf[^]*?\b3\b/.test(t)) { ok = true; break } }
  log(ok ? 'GENESIS confirmed on Nile: balanceOf==3' : 'balanceOf not 3 yet')
  if (!ok) note('genesis balance not confirmed')

  // ---------------- deploy the renderer: the IDE compiles the ACTIVE file's
  // graph, and the core does not import CardRenderer — open it and recompile,
  // polling the compiled list for CONTENT (the J-013 stale-panel lesson)
  if (!await page.locator('[data-id="filePanelFileExplorerTree"]').isVisible().catch(() => false)) {
    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    await page.waitForTimeout(1000)
  }
  const nodeOf = (p) => page.locator(`[data-id="treeViewLitreeViewItem${p}"]`)
  const rTarget = 'contracts/render/CardRenderer.sol'
  let rOpened = false
  for (let r = 0; r < 20 && !rOpened; r++) {
    if (await nodeOf(rTarget).isVisible().catch(() => false)) { await nodeOf(rTarget).click({ force: true }); rOpened = true; break }
    for (const dir of ['contracts', 'contracts/render']) {
      if (!await nodeOf(dir).isVisible().catch(() => false)) continue
      const childVisible = dir === 'contracts'
        ? await nodeOf('contracts/render').isVisible().catch(() => false)
        : await nodeOf(rTarget).isVisible().catch(() => false)
      if (!childVisible) { await nodeOf(dir).click({ force: true }).catch(() => {}); await page.waitForTimeout(1200) }
    }
    await page.waitForTimeout(800)
  }
  if (!rOpened) throw new Error('could not open ' + rTarget)
  await page.waitForTimeout(800)
  await page.locator('#icon-panel div[plugin="solidity"]').click()
  await page.waitForTimeout(1000)
  await page.locator('[data-id="compilerContainerCompileBtn"]').click()
  let rListed = ''
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(2000)
    rListed = (await page.locator('[data-id="compiledContracts"]').innerText().catch(() => '')) || ''
    if (/CardRenderer/.test(rListed)) break
    if (i === 20) await page.locator('[data-id="compilerContainerCompileBtn"]').click().catch(() => {})
  }
  if (!/CardRenderer/.test(rListed)) { note('compile never listed CardRenderer: ' + rListed.slice(0, 120)); throw new Error('renderer compile') }
  log('compiled the CardRenderer graph')
  await page.locator('#icon-panel div[plugin="udapp"]').click()
  await page.waitForTimeout(1500)
  await page.locator('#gasLimit').fill('1000000000')
  await page.locator('#runTabView select[class^="contractNames"]').selectOption('CardRenderer')
  log('DEPLOY CardRenderer — auto-confirming TronLink…')
  await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
  const renderer = page.locator('.instance').nth(1)
  await untilVisible(renderer, 240_000, 'renderer instance')
  const rendererAddr = await grabAddr('CardRenderer')
  if (!isTAddr(rendererAddr)) { note('no renderer address: ' + rendererAddr); throw new Error('renderer address') }
  log('CardRenderer deployed at ' + rendererAddr)
  fs.writeFileSync(SCRATCH + '/p10-renderer-addr.txt', rendererAddr)

  // ---------------- wire it up
  log('setRenderer(' + rendererAddr.slice(0, 8) + '…) — auto-confirming TronLink…')
  await call(cards, 'setRenderer', rendererAddr, 8000)
  let wired = false
  for (let i = 0; i < 20; i++) {
    const t = await call(cards, 'renderer', undefined, 2500)
    if (t.includes(rendererAddr)) { wired = true; break }
  }
  log(wired ? 'renderer wired: renderer() == CardRenderer' : 'renderer() readback pending')
  if (!wired) note('renderer wiring not confirmed via UI readback')

  // ---------------- two-layer decode straight from the UI (best-effort; the
  // authoritative check is the TronGrid query that follows this script)
  const uriText = await call(cards, 'tokenURI', 2, 3000)
  const m = uriText.match(/data:application\/json;base64,([A-Za-z0-9+/=]+)/)
  if (m) {
    try {
      const meta = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))
      if (meta.image && meta.image.startsWith('data:image/svg+xml;base64,')) {
        const svg = Buffer.from(meta.image.slice(26), 'base64').toString('utf8')
        log('tokenURI(2) carries an SVG image (' + svg.length + ' chars); contains Guan Yu: ' + svg.includes('Guan Yu'))
      } else {
        note('tokenURI(2) decoded but image missing/odd: ' + JSON.stringify(Object.keys(meta)))
      }
    } catch (e) { note('UI tokenURI base64 likely clipped (' + m[1].length + ' chars) — rely on TronGrid check') }
  } else {
    note('tokenURI not visible in UI text — rely on TronGrid check')
  }
  await page.screenshot({ path: SCRATCH + '/p11-genesis.png' })

  console.log('CARDS_ADDR=' + cardsAddr)
  console.log('RENDERER_ADDR=' + rendererAddr)
  await browser.close().catch(() => {})
  console.log('NOTES-BEGIN'); notes.forEach((x) => console.log('- ' + x)); console.log('NOTES-END')
  console.log('P11-OK')
})().catch((e) => { console.error('P11-FAIL', e); process.exit(1) })
