// P5: backup/restore drill + global search — the last two matrix rows.
// Drill: export the full-FS zip, dirty the contract, restore, verify the
// original bytes came back. All through supported UI flows.
const fs = require('fs')
const { chromium } = require('/Users/tron/Object/trontech/tron-remix/node_modules/@playwright/test')

const PROFILE = '/Users/tron/Object/tronSmart/.tronide-profile'
const SCRATCH = '/private/tmp/claude-501/-Users-tron-Object-trontech-tron-remix/607fd892-ece0-473d-8492-66232f2e46ae/scratchpad'
const WS = 'three-realms'
const FILE = 'contracts/ThreeRealmsCards.sol'
const MARK = '// p5-dirty-marker'
const notes = []
const log = (m) => console.log('[p5]', m)
const note = (m) => { notes.push(m); console.log('[p5][NOTE]', m) }

;(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1440, height: 900 } })
  const page = ctx.pages()[0] || await ctx.newPage()
  await page.goto('http://localhost:18080/', { waitUntil: 'load', timeout: 120_000 })
  try { await page.addStyleTag({ content: '#webpack-dev-server-client-overlay { display: none !important; }' }) } catch (e) {}
  try { const w = page.locator('button:has-text("I Understand")'); await w.waitFor({ state: 'visible', timeout: 4000 }); await w.click() } catch (e) {}
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 60_000 })
  const ws = await page.locator('select[data-id="workspacesSelect"]').inputValue()
  log('workspace on boot: ' + ws + (ws === WS ? ' (restore fix holding)' : ''))
  if (ws !== WS) { await page.locator('select[data-id="workspacesSelect"]').selectOption(WS); await page.waitForTimeout(1500) }

  const readSaved = (p) => page.evaluate(({ w, f }) => {
    try { return window.remixFileSystem.readFileSync(`.workspaces/${w}/${f}`, 'utf8') } catch (e) { return '' }
  }, { w: WS, f: p })

  let original = await readSaved(FILE)
  if (!original) { note('contract missing from three-realms!'); throw new Error('no contract') }
  if (original.includes(MARK)) {
    log('stripping a leftover marker from a previous run')
    await page.evaluate(({ w, f, m }) => {
      const clean = window.remixFileSystem.readFileSync(`.workspaces/${w}/${f}`, 'utf8').split('\n').filter((l) => !l.includes(m)).join('\n')
      window.remixFileSystem.writeFileSync(`.workspaces/${w}/${f}`, clean)
    }, { w: WS, f: FILE, m: MARK })
    original = await readSaved(FILE)
  }
  log('original contract: ' + original.length + ' bytes')

  // ---------------- A: export the backup zip (Git Workflow panel)
  const advToggle = page.locator('[data-id="landingAdvancedToolsToggle"]')
  if (await advToggle.textContent().then((t) => /Show/.test(t || '')).catch(() => false)) await advToggle.click()
  await page.locator('[data-id="landingGitWorkflowPanel"]').waitFor({ timeout: 10_000 })
  const dl = page.waitForEvent('download', { timeout: 60_000 })
  await page.locator('[data-id="landingGitPrepare"]').click()
  const download = await dl
  const zipPath = SCRATCH + '/p5-backup.zip'
  await download.saveAs(zipPath)
  log('A: backup exported (' + download.suggestedFilename() + ', ' + fs.statSync(zipPath).size + ' bytes)')

  // ---------------- B: dirty the contract, save
  const item = page.locator(`[data-id="treeViewLitreeViewItem${FILE}"]`)
  if (!await page.locator('[data-id="filePanelFileExplorerTree"]').isVisible().catch(() => false)) {
    await page.locator('#icon-panel div[plugin="filePanel"]').click()
  }
  if (!await item.isVisible().catch(() => false)) {
    await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    await page.waitForTimeout(1000)
  }
  await item.click()
  await page.locator('#input').waitFor({ timeout: 10_000 })
  await page.evaluate((m) => {
    const ed = document.getElementById('input').editor
    ed.focus()
    ed.session.insert({ row: 1, column: 0 }, m + '\n')
  }, MARK)
  await page.keyboard.press('Meta+s')
  let dirty = ''
  for (let i = 0; i < 12; i++) { // shortcut save or the ~5s idle autosave
    await page.waitForTimeout(1000)
    dirty = await readSaved(FILE)
    if (dirty.includes(MARK)) break
  }
  if (dirty.includes(MARK)) log('B: contract dirtied and saved (' + dirty.length + ' bytes)')
  else note('B: dirty marker did not persist')

  // ---------------- C: restore the zip via the restorebackupzip plugin
  if (await page.locator('iframe#plugin-restorebackupzip').count() === 0) {
    await page.locator('#icon-panel div[plugin="pluginManager"]').click()
    const search = page.locator('input[placeholder*="Search"], [data-id="pluginManagerComponentSearchInput"]').first()
    if (await search.isVisible().catch(() => false)) await search.fill('restorebackupzip')
    await page.locator('[data-id="pluginManagerComponentActivateButtonrestorebackupzip"]').click()
  }
  const iframe = page.frameLocator('iframe#plugin-restorebackupzip')
  await page.locator('iframe#plugin-restorebackupzip').waitFor({ state: 'visible', timeout: 15_000 })
  await iframe.locator('#file-input').setInputFiles(zipPath)
  const importBtn = iframe.locator('.importfile')
  await importBtn.waitFor({ state: 'visible', timeout: 15_000 })
  // auto-accept the write-permission modals while the import runs
  let importing = true
  const clicker = (async () => {
    while (importing) {
      try {
        const remember = page.locator('#remember')
        if (await remember.isVisible().catch(() => false)) { if (!await remember.isChecked()) await remember.click() }
        const ok = page.locator('#modal-footer-ok')
        if (await ok.isVisible().catch(() => false)) await ok.click()
      } catch (e) { /* keep clicking */ }
      await page.waitForTimeout(300)
    }
  })()
  await importBtn.click()
  // the restore overwrites the dirty file — poll until the marker is gone
  let restored = ''
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1500)
    restored = await readSaved(FILE)
    if (restored && !restored.includes(MARK)) break
  }
  importing = false
  await clicker
  if (restored === original) log('C: restore round-trip OK — original bytes back (' + restored.length + ')')
  else if (restored && !restored.includes(MARK)) note('C: marker gone but bytes differ: ' + restored.length + ' vs ' + original.length)
  else note('C: restore did not revert the file (marker still present)')
  await page.screenshot({ path: SCRATCH + '/p5-restore.png' })

  // ---------------- D: global search across the workspace
  await page.locator('[data-id="verticalIconsKindglobalSearch"]').click()
  const input = page.locator('[data-id="globalSearchInput"]')
  await input.waitFor({ state: 'visible', timeout: 10_000 })
  await input.fill('Guan Yu')
  await page.waitForTimeout(2500)
  const panel = await page.locator('[data-id="globalSearchPanel"]').innerText().catch(() => '')
  if (/ThreeRealmsCards\.sol/.test(panel)) log('D: global search hits the contract for "Guan Yu"')
  else note('D: search results unexpected: ' + panel.slice(0, 200).replace(/\s+/g, ' '))
  if (/scenario\.json/.test(panel)) log('D: …and scenario.json too (cross-file hit)')
  await page.screenshot({ path: SCRATCH + '/p5-search.png' })

  await ctx.close()
  console.log('NOTES-BEGIN'); notes.forEach((x) => console.log('- ' + x)); console.log('NOTES-END')
  console.log('P5-OK')
})().catch((e) => { console.error('P5-FAIL', e); process.exit(1) })
