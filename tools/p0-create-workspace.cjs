// P0: create the `three-realms` workspace from the trc721-minimal template in
// TronIDE (dev server on :18080), inside a PERSISTENT browser profile so the
// workspace survives across dogfooding sessions.
const { chromium } = require('/Users/tron/Object/trontech/tron-remix/node_modules/@playwright/test')

const PROFILE = '/Users/tron/Object/tronSmart/.tronide-profile'
const SHOT = '/private/tmp/claude-501/-Users-tron-Object-trontech-tron-remix/607fd892-ece0-473d-8492-66232f2e46ae/scratchpad/p0-workspace.png'

;(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1440, height: 900 } })
  const page = ctx.pages()[0] || await ctx.newPage()
  const log = (m) => console.log('[p0]', m)

  await page.goto('http://localhost:18080/', { waitUntil: 'load', timeout: 120_000 })
  try { await page.addStyleTag({ content: '#webpack-dev-server-client-overlay { display: none !important; }' }) } catch (e) {}
  const welcome = page.locator('button:has-text("I Understand")')
  try { await welcome.waitFor({ state: 'visible', timeout: 5000 }); await welcome.click(); log('welcome modal dismissed') } catch (e) { log('no welcome modal') }
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 60_000 })
  log('home ready')

  // if a previous run already created it, just verify and exit idempotently
  const wsSelect = page.locator('select[data-id="workspacesSelect"]')
  const existing = await page.evaluate(() => {
    const sel = document.querySelector('select[data-id="workspacesSelect"]')
    return sel ? Array.from(sel.options).map((o) => o.value) : []
  })
  if (existing.includes('three-realms')) {
    log('workspace already exists — selecting it')
    await wsSelect.selectOption('three-realms')
  } else {
    await page.locator('[data-id="workspaceCreate"]').click()
    const nameInput = page.locator('input[data-id="modalDialogCustomPromptTextCreate"]')
    await nameInput.waitFor({ state: 'visible', timeout: 5000 })
    await nameInput.fill('three-realms')
    await page.locator('select[data-id="modalDialogCustomSelectTemplate"]').selectOption('trc721-minimal')
    await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()
    log('workspace created from trc721-minimal')
  }

  // template file seeded and opened
  await page.locator('remix-tab[id$="TRC721Minimal.sol"]').waitFor({ timeout: 15_000 })
  const item = page.locator('[data-id="treeViewLitreeViewItemcontracts/TRC721Minimal.sol"]')
  if (!await item.isVisible().catch(() => false)) {
    const contracts = page.locator('[data-id="treeViewLitreeViewItemcontracts"]')
    if (await contracts.isVisible().catch(() => false)) await contracts.click()
  }
  log('template file present: contracts/TRC721Minimal.sol')

  // compile smoke: the builtin compiler handles this locally (no network)
  await page.locator('#icon-panel div[plugin="solidity"]').click()
  await page.locator('[data-id="compilerContainerCompileBtn"]').click()
  await page.locator('[data-id="compiledContracts"]').waitFor({ timeout: 60_000 })
  const compiled = await page.locator('[data-id="compiledContracts"]').textContent()
  log('compiled contracts: ' + (compiled || '').trim())

  // record the editor content hash so P1 diffs are honest
  const source = await page.evaluate(() => {
    const el = document.getElementById('input')
    return el && el.editor ? el.editor.session.getValue() : ''
  })
  log('seeded source bytes: ' + source.length)

  await page.screenshot({ path: SHOT, fullPage: false })
  log('screenshot: ' + SHOT)
  await ctx.close()
  console.log('P0-OK')
})().catch((e) => { console.error('P0-FAIL', e); process.exit(1) })
