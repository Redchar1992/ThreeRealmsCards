const fs = require('fs')
const { chromium } = require('/Users/tron/Object/trontech/tron-remix/node_modules/@playwright/test')
const SCRATCH = '/private/tmp/claude-501/-Users-tron-Object-trontech-tron-remix/607fd892-ece0-473d-8492-66232f2e46ae/scratchpad'
const REPO = '/Users/tron/Object/tronSmart/ThreeRealmsCards'
const log = (m) => console.log('[p4r]', m)
const notes = []
const note = (m) => { notes.push(m); console.log('[p4r][NOTE]', m) }
;(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 20_000 })
  const page = browser.contexts()[0].pages().find((p) => p.url().includes('localhost:18080'))
  await page.bringToFront()
  // kill the dev-server overlay now and forever (this document)
  await page.evaluate(() => document.querySelectorAll('#webpack-dev-server-client-overlay').forEach((e) => e.remove()))
  await page.addStyleTag({ content: '#webpack-dev-server-client-overlay { display: none !important; }' }).catch(() => {})

  const instance = page.locator('.instance').first()
  await instance.waitFor({ timeout: 15_000 })
  // expand if collapsed (title-only text means collapsed)
  if (!await instance.locator('div[class*="contractProperty"]').first().isVisible().catch(() => false)) {
    await instance.locator('[data-id="universalDappUiTitleExpander"]').click()
    await page.waitForTimeout(800)
  }
  const account = await page.evaluate(() => {
    const sel = document.querySelector('#runTabView #txorigin')
    return sel && sel.options.length ? sel.options[0].value : ''
  })
  const row = (fn) => instance.locator('div[class*="contractProperty"]', { hasText: fn }).first()
  const callAndText = async (fn, arg, waitMs) => {
    const r = row(fn)
    if (arg !== undefined) await r.locator('input').first().fill(String(arg))
    await r.locator('button').first().click()
    await page.waitForTimeout(waitMs || 2500)
    return (await instance.innerText()).replace(/\s+/g, ' ')
  }
  let ok = false
  for (let i = 0; i < 12; i++) {
    const txt = await callAndText('balanceOf', account, 2500)
    if (/balanceOf[^]*?\b3\b/.test(txt)) { ok = true; break }
  }
  log(ok ? 'balanceOf(owner) == 3 on Nile' : 'balanceOf still not 3')
  if (!ok) note('balanceOf did not reach 3')
  const cardTxt = await callAndText('cardOf', 1, 2500)
  if (cardTxt.includes('Liu Bei')) log('cardOf(1) => Liu Bei from Nile')
  else note('cardOf(1) unexpected: ' + cardTxt.slice(-160))
  const uriTxt = await callAndText('tokenURI', 2, 2500)
  const m = uriTxt.match(/data:application\/json;base64,([A-Za-z0-9+/=]+)/)
  if (m && Buffer.from(m[1], 'base64').toString('utf8').includes('Guan Yu')) log('tokenURI(2) decodes (Guan Yu) from Nile')
  else note('tokenURI unexpected')
  const b58 = ((await instance.innerText()).match(/T[1-9A-HJ-NP-Za-km-z]{33}/) || [])[0] || ''
  if (b58) { log('contract address: ' + b58); fs.writeFileSync(SCRATCH + '/p4-address.txt', b58) }
  await page.screenshot({ path: SCRATCH + '/p4-genesis.png' })

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
  if (await save.isVisible().catch(() => false)) { await save.click(); await page.waitForTimeout(1200) }
  await page.locator('[data-id="contractVerificationGeneratePackage"]').click()
  await page.waitForTimeout(2500)
  const pkg = await page.locator('[data-id="contractVerificationPackageHistory"]').innerText().catch(() => '')
  log('package: ' + pkg.split('\n').slice(0, 2).join(' | '))
  await page.screenshot({ path: SCRATCH + '/p4-verification.png' })
  if (flat) fs.writeFileSync(REPO + '/exports/verification-flattened.sol', flat)
  await browser.close().catch(() => {})
  console.log('NOTES-BEGIN'); notes.forEach((x) => console.log('- ' + x)); console.log('NOTES-END')
  console.log('P4R-OK')
})().catch((e) => { console.error('P4R-FAIL', e); process.exit(1) })
