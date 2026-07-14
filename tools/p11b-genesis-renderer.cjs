// P11-B: continuation of p11 after the webpack overlay iframe (recreated by a
// dev-server event AFTER the reload wiped the hiding CSS) intercepted clicks.
// Lessons applied: deOverlay() re-run before every click phase, force:true on
// instance-row buttons, EXACT-match rows, no sealing. Picks up the already-
// deployed v5 cards instance: genesis → renderer compile/deploy → wiring.
const fs = require('fs')
const { chromium } = require('/Users/tron/Object/trontech/tron-remix/node_modules/@playwright/test')

const SCRATCH = '/private/tmp/claude-501/-Users-tron-Object-tronSmart-ThreeRealmsCards/7673a2a2-3274-43b4-a714-1dd2ad4e7c0f/scratchpad'
const CARDS_ADDR = fs.readFileSync(SCRATCH + '/p11-cards-addr.txt', 'utf8').trim()
const notes = []
const log = (m) => console.log('[p11b]', m)
const note = (m) => { notes.push(m); console.log('[p11b][NOTE]', m) }

;(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 20_000 })
  const ctx = browser.contexts()[0]
  const page = ctx.pages().find((p) => p.url().includes('localhost:18080'))
  if (!page) throw new Error('IDE tab not found')
  await page.bringToFront()

  const deOverlay = async () => {
    await page.evaluate(() => document.querySelectorAll('#webpack-dev-server-client-overlay').forEach((e) => e.remove())).catch(() => {})
    await page.addStyleTag({ content: '#webpack-dev-server-client-overlay { display: none !important; pointer-events: none !important; }' }).catch(() => {})
  }
  await deOverlay()

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
          await p.bringToFront().catch(() => {})
          await btn.click({ timeout: 2000 }).catch(() => {})
          log('wallet confirm clicked')
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
      await deOverlay()
      await tryConfirmPopup()
      await page.waitForTimeout(2000)
    }
    throw new Error('timeout waiting for ' + label)
  }

  // EXACT function-name match (the p10b substring lesson)
  const rowIn = (inst, fn) => inst
    .locator('div[class*="contractProperty"]')
    .filter({ has: page.locator('button', { hasText: new RegExp('^' + fn + '$') }) })
    .first()
  const call = async (inst, fn, arg, waitMs) => {
    await deOverlay()
    const r = rowIn(inst, fn)
    if (arg !== undefined) await r.locator('input').first().fill(String(arg), { force: true })
    await r.locator('button').first().click({ force: true })
    const deadline = Date.now() + (waitMs || 3000)
    while (Date.now() < deadline) { await tryConfirmPopup(); await page.waitForTimeout(1000) }
    return (await inst.innerText()).replace(/\s+/g, ' ')
  }

  // generic helpers: open a file (top-level in contracts/) and compile until
  // the compiled list CONTAINS a marker (J-013 stale-panel lesson)
  const nodeOf = (p) => page.locator(`[data-id="treeViewLitreeViewItem${p}"]`)
  const openTopLevel = async (fileName) => {
    if (!await page.locator('[data-id="filePanelFileExplorerTree"]').isVisible().catch(() => false)) {
      await page.locator('#icon-panel div[plugin="filePanel"]').click()
      await page.waitForTimeout(1000)
    }
    await deOverlay()
    const file = nodeOf('contracts/' + fileName)
    const folder = nodeOf('contracts')
    for (let r = 0; r < 20; r++) {
      if (await file.isVisible().catch(() => false)) { await file.click({ force: true }); return }
      if (await folder.isVisible().catch(() => false)) {
        await folder.click({ force: true }).catch(() => {})
        await page.waitForTimeout(1200)
        if (await file.isVisible().catch(() => false)) { await file.click({ force: true }); return }
      }
      await page.waitForTimeout(1000)
    }
    throw new Error('could not open contracts/' + fileName)
  }
  const compileUntil = async (marker) => {
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await page.waitForTimeout(1000)
    await deOverlay()
    await page.locator('[data-id="compilerContainerCompileBtn"]').click({ force: true })
    let listedText = ''
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(2000)
      listedText = (await page.locator('[data-id="compiledContracts"]').innerText().catch(() => '')) || ''
      if (marker.test(listedText)) return
      if (i === 20) { await deOverlay(); await page.locator('[data-id="compilerContainerCompileBtn"]').click({ force: true }).catch(() => {}) }
    }
    throw new Error('compile never matched ' + marker + ': ' + listedText.slice(0, 120))
  }

  // the v5 cards instance from p11 — or reattach via At Address after the
  // HMR reload wiped the instance panel
  await page.locator('#icon-panel div[plugin="udapp"]').click()
  await page.waitForTimeout(1500)
  await deOverlay()
  const account = await page.evaluate(() => { const s = document.querySelector('#runTabView #txorigin'); return s && s.options.length ? s.options[0].value : '' })
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(account)) throw new Error('injected account lost: ' + account)
  let cards = page.locator('.instance').first()
  if (!await cards.isVisible().catch(() => false)) {
    log('cards instance not listed — attaching At Address ' + CARDS_ADDR)
    await openTopLevel('ThreeRealmsCards.sol')
    await compileUntil(/ThreeRealmsCards/)
    await page.locator('#icon-panel div[plugin="udapp"]').click()
    await page.waitForTimeout(1500)
    await deOverlay()
    await page.locator('#runTabView select[class^="contractNames"]').selectOption('ThreeRealmsCards')
    await page.locator('#runTabView input[class*="ataddressinput"]').fill(CARDS_ADDR)
    await page.locator('#runTabView button:has-text("At Address")').click({ force: true })
    await untilVisible(page.locator('.instance').first(), 30_000, 'attached cards instance')
    cards = page.locator('.instance').first()
    log('attached v5 cards instance At Address')
  }
  if (!await rowIn(cards, 'mintPeachGardenGenesis').isVisible().catch(() => false)) {
    await cards.locator('[data-id="universalDappUiTitleExpander"]').click({ force: true })
    await page.waitForTimeout(800)
  }
  await page.locator('#gasLimit').fill('1000000000')

  // ---------------- genesis on v5
  log('GENESIS mint on ' + CARDS_ADDR.slice(0, 8) + '… — auto-confirming TronLink…')
  await call(cards, 'mintPeachGardenGenesis', account, 8000)
  let ok = false
  for (let i = 0; i < 30; i++) { const t = await call(cards, 'balanceOf', account, 2500); if (/balanceOf[^]*?\b3\b/.test(t)) { ok = true; break } }
  log(ok ? 'GENESIS confirmed: balanceOf==3' : 'balanceOf not 3 yet')
  if (!ok) note('genesis balance not confirmed via UI — verify via TronGrid')

  // ---------------- open + compile the renderer graph (active-file scope)
  if (!await page.locator('[data-id="filePanelFileExplorerTree"]').isVisible().catch(() => false)) {
    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    await page.waitForTimeout(1000)
  }
  await deOverlay()
  const target = 'contracts/render/CardRenderer.sol'
  let opened = false
  for (let r = 0; r < 20 && !opened; r++) {
    if (await nodeOf(target).isVisible().catch(() => false)) { await nodeOf(target).click({ force: true }); opened = true; break }
    for (const dir of ['contracts', 'contracts/render']) {
      if (!await nodeOf(dir).isVisible().catch(() => false)) continue
      const childVisible = dir === 'contracts'
        ? await nodeOf('contracts/render').isVisible().catch(() => false)
        : await nodeOf(target).isVisible().catch(() => false)
      if (!childVisible) { await nodeOf(dir).click({ force: true }).catch(() => {}); await page.waitForTimeout(1200) }
    }
    await page.waitForTimeout(800)
  }
  if (!opened) throw new Error('could not open ' + target)
  await page.waitForTimeout(800)
  await compileUntil(/CardRenderer/)
  log('compiled the CardRenderer graph')

  // ---------------- deploy the renderer
  await page.locator('#icon-panel div[plugin="udapp"]').click()
  await page.waitForTimeout(1500)
  await deOverlay()
  await page.locator('#gasLimit').fill('1000000000')
  await page.locator('#runTabView select[class^="contractNames"]').selectOption('CardRenderer')
  log('DEPLOY CardRenderer — auto-confirming TronLink…')
  await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click({ force: true })
  const renderer = page.locator('.instance').nth(1)
  await untilVisible(renderer, 240_000, 'renderer instance')
  const rendererAddr = await page.evaluate(() => {
    let found = ''
    for (const e of Array.from(document.querySelectorAll('[data-id="recorderAddressBookEntry"]'))) {
      const nm = e.querySelector('[data-id="recorderAddressBookName"]')
      if (nm && nm.innerText.trim() === 'CardRenderer') { const ad = e.querySelector('[data-id="recorderAddressBookAddress"]'); if (ad) found = ad.innerText.trim() }
    }
    return found
  })
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(rendererAddr)) { note('no renderer address in book: ' + rendererAddr); throw new Error('renderer address') }
  log('CardRenderer deployed at ' + rendererAddr)
  fs.writeFileSync(SCRATCH + '/p11-renderer-addr.txt', rendererAddr)

  // ---------------- wire (setRenderer only; sealing stays a human decision)
  log('setRenderer(' + rendererAddr.slice(0, 8) + '…) — auto-confirming TronLink…')
  await call(cards, 'setRenderer', rendererAddr, 8000)
  let wired = false
  for (let i = 0; i < 20; i++) {
    const t = await call(cards, 'renderer', undefined, 2500)
    if (t.includes(rendererAddr)) { wired = true; break }
  }
  log(wired ? 'renderer wired: renderer() == CardRenderer' : 'renderer() readback pending — verify via TronGrid')
  await page.screenshot({ path: SCRATCH + '/p11b-wired.png' })

  console.log('RENDERER_ADDR=' + rendererAddr)
  await browser.close().catch(() => {})
  console.log('NOTES-BEGIN'); notes.forEach((x) => console.log('- ' + x)); console.log('NOTES-END')
  console.log('P11B-OK')
})().catch((e) => { console.error('P11B-FAIL', e); process.exit(1) })
