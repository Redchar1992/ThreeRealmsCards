// Disaster-recovery drill for real: fresh profile, restore the 6.1MB backup
// through the restorebackupzip plugin, verify the workspaces came back.
const { chromium } = require('/Users/tron/Object/trontech/tron-remix/node_modules/@playwright/test')
const SCRATCH = '/private/tmp/claude-501/-Users-tron-Object-trontech-tron-remix/607fd892-ece0-473d-8492-66232f2e46ae/scratchpad'
const ZIP = SCRATCH + '/p5-backup.zip'
const log = (m) => console.log('[drill]', m)
;(async () => {
  const ctx = await chromium.launchPersistentContext('/Users/tron/Object/tronSmart/.tronide-profile', { headless: true, viewport: { width: 1440, height: 900 } })
  const page = ctx.pages()[0] || await ctx.newPage()
  await page.goto('http://localhost:18080/', { waitUntil: 'load', timeout: 120_000 })
  try { const w = page.locator('button:has-text("I Understand")'); await w.waitFor({ state: 'visible', timeout: 8000 }); await w.click() } catch (e) {}
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ state: 'attached', timeout: 60_000 })
  log('fresh profile booted: ' + await page.locator('select[data-id="workspacesSelect"]').inputValue().catch(() => '?'))

  await page.locator('#icon-panel div[plugin="pluginManager"]').click()
  const search = page.locator('input[placeholder*="Search"], [data-id="pluginManagerComponentSearchInput"]').first()
  if (await search.isVisible().catch(() => false)) await search.fill('restorebackupzip')
  await page.locator('[data-id="pluginManagerComponentActivateButtonrestorebackupzip"]').click()
  const iframe = page.frameLocator('iframe#plugin-restorebackupzip')
  await page.locator('iframe#plugin-restorebackupzip').waitFor({ state: 'visible', timeout: 20_000 })
  await iframe.locator('#file-input').setInputFiles(ZIP)
  const importBtn = iframe.locator('.importfile')
  await importBtn.waitFor({ state: 'visible', timeout: 20_000 })
  let importing = true
  const clicker = (async () => {
    const t0 = Date.now()
    while (importing && Date.now() - t0 < 300_000) {
      try {
        const remember = page.locator('#remember')
        if (await remember.isVisible().catch(() => false)) { if (!await remember.isChecked()) await remember.click() }
        const ok = page.locator('#modal-footer-ok')
        if (await ok.isVisible().catch(() => false)) await ok.click()
      } catch (e) { /* keep going */ }
      await new Promise((r) => setTimeout(r, 400))
    }
  })()
  log('importing 6.1MB backup — bounded at 5 minutes…')
  await importBtn.click()
  let contract = ''
  const t0 = Date.now()
  while (Date.now() - t0 < 300_000) {
    await new Promise((r) => setTimeout(r, 3000))
    contract = await Promise.race([
      page.evaluate(() => { try { return window.remixFileSystem.readFileSync('.workspaces/three-realms/contracts/ThreeRealmsCards.sol', 'utf8') } catch (e) { return '' } }),
      new Promise((r) => setTimeout(() => r('__EVAL_HUNG__'), 10_000))
    ])
    if (contract === '__EVAL_HUNG__') { log('page frozen mid-import (evaluate hung) — the localStorage funnel choked again'); break }
    if (contract) break
  }
  importing = false
  if (contract && contract !== '__EVAL_HUNG__') {
    log('RESTORED: three-realms contract back (' + contract.length + ' bytes, took ' + Math.round((Date.now() - t0) / 1000) + 's)')
    // reboot and confirm the workspace list + search
    await page.reload({ waitUntil: 'load' }).catch(() => {})
    try { const w = page.locator('button:has-text("I Understand")'); await w.waitFor({ state: 'visible', timeout: 8000 }); await w.click() } catch (e) {}
    await page.waitForTimeout(4000)
    const wsList = await page.evaluate(() => { const s = document.querySelector('select[data-id="workspacesSelect"]'); return s ? Array.from(s.options).map((o) => o.value) : [] })
    log('workspaces after reboot: ' + wsList.join(', '))
    if (wsList.includes('three-realms')) {
      await page.locator('select[data-id="workspacesSelect"]').selectOption('three-realms')
      await page.waitForTimeout(2000)
      await page.locator('[data-id="verticalIconsKindglobalSearch"]').click()
      const input = page.locator('[data-id="globalSearchInput"]')
      await input.waitFor({ state: 'visible', timeout: 10_000 })
      await input.fill('Guan Yu')
      await page.waitForTimeout(3000)
      const panel = await page.locator('[data-id="globalSearchPanel"]').innerText().catch(() => '')
      log('search "Guan Yu": contract hit=' + /ThreeRealmsCards\.sol/.test(panel) + ', scenario hit=' + /scenario\.json/.test(panel))
      await page.screenshot({ path: SCRATCH + '/p5-search.png' })
    }
  }
  await ctx.close().catch(() => {})
  console.log('DRILL-DONE')
  process.exit(0)
})().catch((e) => { console.error('DRILL-FAIL', e); process.exit(1) })
