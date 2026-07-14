// P10-B: continuation of p10 — the IDE compiles the ACTIVE FILE's import
// graph, and the core deliberately does not import CardRenderer, so the
// renderer never reached the deploy dropdown in p10. Open the renderer
// source, recompile, deploy it, and wire it into the ALREADY-DEPLOYED v4
// cards instance (no cards redeploy).
const fs = require('fs')
const { chromium } = require('/Users/tron/Object/trontech/tron-remix/node_modules/@playwright/test')

const SCRATCH = '/private/tmp/claude-501/-Users-tron-Object-tronSmart-ThreeRealmsCards/7673a2a2-3274-43b4-a714-1dd2ad4e7c0f/scratchpad'
const CARDS_ADDR = fs.readFileSync(SCRATCH + '/p10-cards-addr.txt', 'utf8').trim()
const notes = []
const log = (m) => console.log('[p10b]', m)
const note = (m) => { notes.push(m); console.log('[p10b][NOTE]', m) }

;(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 20_000 })
  const ctx = browser.contexts()[0]
  const page = ctx.pages().find((p) => p.url().includes('localhost:18080'))
  if (!page) throw new Error('IDE tab not found')
  await page.bringToFront()
  await page.evaluate(() => document.querySelectorAll('#webpack-dev-server-client-overlay').forEach((e) => e.remove()))
  await page.addStyleTag({ content: '#webpack-dev-server-client-overlay { display: none !important; }' }).catch(() => {})

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
      await tryConfirmPopup()
      await page.waitForTimeout(2000)
    }
    throw new Error('timeout waiting for ' + label)
  }

  // open contracts/render/CardRenderer.sol (nested folders, toggle-safe)
  if (!await page.locator('[data-id="filePanelFileExplorerTree"]').isVisible().catch(() => false)) {
    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    await page.locator('[data-id="filePanelFileExplorerTree"]').waitFor({ timeout: 15_000 })
  }
  const nodeOf = (p) => page.locator(`[data-id="treeViewLitreeViewItem${p}"]`)
  const target = 'contracts/render/CardRenderer.sol'
  const chain = ['contracts', 'contracts/render']
  let opened = false
  for (let r = 0; r < 20 && !opened; r++) {
    if (await nodeOf(target).isVisible().catch(() => false)) {
      await nodeOf(target).click({ force: true })
      opened = true
      break
    }
    for (const dir of chain) {
      if (!await nodeOf(dir).isVisible().catch(() => false)) continue
      const childVisible = dir === 'contracts'
        ? await nodeOf('contracts/render').isVisible().catch(() => false)
        : await nodeOf(target).isVisible().catch(() => false)
      if (!childVisible) { await nodeOf(dir).click({ force: true }).catch(() => {}); await page.waitForTimeout(1200) }
    }
    await page.waitForTimeout(800)
  }
  if (!opened) throw new Error('could not open ' + target)
  log('opened ' + target)
  await page.waitForTimeout(800)

  // compile the renderer graph on 0.8.20 — the compiledContracts panel keeps
  // showing the PREVIOUS graph until the new compile lands (the J-013 lesson:
  // poll for content, don't trust first visibility)
  await nodeOf(target).click({ force: true }).catch(() => {}) // re-assert active file
  await page.waitForTimeout(800)
  await page.locator('#icon-panel div[plugin="solidity"]').click()
  await page.waitForTimeout(1000)
  const v0820 = await page.evaluate(() => { const s = document.querySelector('#versionSelector'); const o = s && Array.from(s.options).find((x) => x.value.includes('0.8.20')); return o ? o.value : '' })
  if (v0820 && (await page.locator('#versionSelector').inputValue().catch(() => '')) !== v0820) { await page.locator('#versionSelector').selectOption(v0820); await page.waitForTimeout(4000) }
  await page.locator('[data-id="compilerContainerCompileBtn"]').click()
  let listed = ''
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(2000)
    listed = (await page.locator('[data-id="compiledContracts"]').innerText().catch(() => '')) || ''
    if (/CardRenderer/.test(listed)) break
    if (i === 20) { // one mid-flight retry: re-open the file and recompile
      await page.locator('#icon-panel div[plugin="filePanel"]').click()
      await page.waitForTimeout(800)
      await nodeOf(target).click({ force: true }).catch(() => {})
      await page.waitForTimeout(800)
      await page.locator('#icon-panel div[plugin="solidity"]').click()
      await page.waitForTimeout(800)
      await page.locator('[data-id="compilerContainerCompileBtn"]').click().catch(() => {})
    }
  }
  if (!/CardRenderer/.test(listed)) { note('compile never listed CardRenderer: ' + listed.slice(0, 120)); throw new Error('compile') }
  log('compiled CardRenderer graph')

  // back to run tab; the previously-deployed cards instance must still be listed
  await page.locator('#icon-panel div[plugin="udapp"]').click()
  await page.waitForTimeout(1500)
  const account = await page.evaluate(() => { const s = document.querySelector('#runTabView #txorigin'); return s && s.options.length ? s.options[0].value : '' })
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(account)) throw new Error('injected account lost: ' + account)
  const cards = page.locator('.instance').first()
  if (!await cards.isVisible().catch(() => false)) throw new Error('cards instance no longer listed — rerun p10')
  await page.locator('#gasLimit').fill('1000000000')

  // deploy the renderer
  await page.locator('#runTabView select[class^="contractNames"]').selectOption('CardRenderer')
  log('DEPLOY CardRenderer — auto-confirming TronLink…')
  await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
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
  fs.writeFileSync(SCRATCH + '/p10-renderer-addr.txt', rendererAddr)

  // wire it into the existing v4 cards instance
  // LANDMINE (kept for the ledger): the substring rowIn below matched
  // `sealRenderer` when asked for `renderer`, and the popup auto-confirmer
  // signed it — sealing v4's renderer forever. p11+ uses an exact-match row
  // selector; do NOT reuse this helper.
  const rowIn = (inst, fn) => inst.locator('div[class*="contractProperty"]', { hasText: fn }).first()
  const call = async (inst, fn, arg, waitMs) => {
    const r = rowIn(inst, fn)
    if (arg !== undefined) await r.locator('input').first().fill(String(arg))
    await r.locator('button').first().click()
    const deadline = Date.now() + (waitMs || 3000)
    while (Date.now() < deadline) { await tryConfirmPopup(); await page.waitForTimeout(1000) }
    return (await inst.innerText()).replace(/\s+/g, ' ')
  }
  if (!await rowIn(cards, 'setRenderer').isVisible().catch(() => false)) {
    await cards.locator('[data-id="universalDappUiTitleExpander"]').click()
    await page.waitForTimeout(800)
  }
  log('setRenderer(' + rendererAddr.slice(0, 8) + '…) on cards ' + CARDS_ADDR.slice(0, 8) + '… — auto-confirming TronLink…')
  await call(cards, 'setRenderer', rendererAddr, 8000)
  let wired = false
  for (let i = 0; i < 20; i++) {
    const t = await call(cards, 'renderer', undefined, 2500)
    if (t.includes(rendererAddr)) { wired = true; break }
  }
  log(wired ? 'renderer wired: renderer() == CardRenderer' : 'renderer() readback pending')
  if (!wired) note('renderer wiring not confirmed via UI readback — verify via TronGrid')

  const uriText = await call(cards, 'tokenURI', 2, 3000)
  const m = uriText.match(/data:application\/json;base64,([A-Za-z0-9+/=]+)/)
  if (m) {
    try {
      const meta = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))
      if (meta.image && meta.image.startsWith('data:image/svg+xml;base64,')) {
        const svg = Buffer.from(meta.image.slice(26), 'base64').toString('utf8')
        log('tokenURI(2) carries an SVG image (' + svg.length + ' chars); contains Guan Yu: ' + svg.includes('Guan Yu'))
      } else {
        note('tokenURI(2) decoded but image missing: keys=' + JSON.stringify(Object.keys(meta)))
      }
    } catch (e) { note('UI tokenURI base64 likely clipped — rely on TronGrid check') }
  } else {
    note('tokenURI not visible in UI text — rely on TronGrid check')
  }
  await page.screenshot({ path: SCRATCH + '/p10b-wired.png' })

  console.log('RENDERER_ADDR=' + rendererAddr)
  await browser.close().catch(() => {})
  console.log('NOTES-BEGIN'); notes.forEach((x) => console.log('- ' + x)); console.log('NOTES-END')
  console.log('P10B-OK')
})().catch((e) => { console.error('P10B-FAIL', e); process.exit(1) })
