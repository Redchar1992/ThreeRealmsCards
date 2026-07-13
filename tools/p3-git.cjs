// P3: version-control dogfooding — IDE Git panel (init/stage/commit/branch),
// GitHub PAT connect, push through the CORS proxy, clone back into a fresh
// workspace. Token arrives via env GH_T (never written to disk).
const { chromium } = require('/Users/tron/Object/trontech/tron-remix/node_modules/@playwright/test')

const PROFILE = '/Users/tron/Object/tronSmart/.tronide-profile'
const SCRATCH = '/private/tmp/claude-501/-Users-tron-Object-trontech-tron-remix/607fd892-ece0-473d-8492-66232f2e46ae/scratchpad'
const REPO_URL = 'https://github.com/Redchar1992/ThreeRealmsCards.git'
const notes = []
const log = (m) => console.log('[p3]', m)
const note = (m) => { notes.push(m); console.log('[p3][NOTE]', m) }

;(async () => {
  if (!process.env.GH_T) throw new Error('GH_T env missing')
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1440, height: 900 } })
  const page = ctx.pages()[0] || await ctx.newPage()
  await page.goto('http://localhost:18080/', { waitUntil: 'load', timeout: 120_000 })
  try { await page.addStyleTag({ content: '#webpack-dev-server-client-overlay { display: none !important; }' }) } catch (e) {}
  try { const w = page.locator('button:has-text("I Understand")'); await w.waitFor({ state: 'visible', timeout: 4000 }); await w.click() } catch (e) {}
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 60_000 }).catch(() => {})

  // J-003 note: the fix persists the marker from THIS session on; first boot
  // after the fix may still land on default_workspace (no marker yet)
  const wsOnLoad = await page.locator('select[data-id="workspacesSelect"]').inputValue().catch(() => '?')
  log('workspace on load: ' + wsOnLoad + (wsOnLoad === 'three-realms' ? ' (J-003 restore works)' : ' (marker not yet written — expected on first post-fix boot)'))
  if (wsOnLoad !== 'three-realms') {
    await page.locator('select[data-id="workspacesSelect"]').selectOption('three-realms')
    await page.waitForTimeout(1500)
  }

  // ---------------- A: connect the GitHub token (PAT path, memory-only)
  // the token panel lives behind the collapsed Advanced tools section
  const advToggle = page.locator('[data-id="landingAdvancedToolsToggle"]')
  if (await advToggle.textContent().then((t) => /Show/.test(t || '')).catch(() => false)) await advToggle.click()
  await page.locator('[data-id="landingGithubTokenPanel"]').waitFor({ timeout: 10_000 })
  await page.locator('[data-id="landingGithubTokenConnect"]').click()
  const prompt = page.locator('[data-id="modalDialogCustomPromptText"]')
  await prompt.waitFor({ state: 'visible', timeout: 10_000 })
  await prompt.fill(process.env.GH_T)
  await page.locator('#modal-footer-ok').click()
  await page.waitForTimeout(2500)
  const who = await page.locator('[data-id="landingGithubTokenPanel"]').innerText().catch(() => '')
  if (/Redchar1992/.test(who)) log('A: token connected as Redchar1992')
  else note('A: token panel does not show the login: ' + who.slice(0, 120).replace(/\s+/g, ' '))

  // ---------------- B: git panel — stage all, commit, new branch
  if (await page.locator('#icon-panel div[plugin="gitPanel"]').count() === 0) {
    await page.locator('#icon-panel div[plugin="pluginManager"]').click()
    await page.locator('[data-id="pluginManagerComponentActivateButtongitPanel"]').click()
    await page.locator('#icon-panel div[plugin="gitPanel"]').waitFor({ timeout: 10_000 })
  }
  await page.locator('#icon-panel div[plugin="gitPanel"]').click()
  await page.locator('[data-id="gitPanel"]').waitFor({ state: 'visible', timeout: 15_000 })
  const initBtn = page.locator('[data-id="gitInit"]')
  if (await initBtn.isVisible().catch(() => false)) { await initBtn.click(); await page.waitForTimeout(1500); log('B: git init') }
  else log('B: workspace already a git repo (auto-init)')
  await page.locator('[data-id="gitBranchSelect"]').waitFor({ timeout: 15_000 })

  // stage + commit whatever P1/P2 left in the workspace
  const stageAll = page.locator('[data-id="gitStageAll"]')
  if (await stageAll.isEnabled().catch(() => false)) {
    await stageAll.click()
    await page.waitForTimeout(1500)
    await page.locator('[data-id="gitCommitMessage"]').fill('chore: IDE workspace snapshot — P1 contract + P2 scenario/artifacts')
    await page.locator('[data-id="gitCommit"]').click()
    await page.waitForTimeout(2500)
  } else log('B: nothing to stage (already committed on a previous run)')
  const logEntries = await page.locator('[data-id="gitLogEntry"]').count()
  if (logEntries > 0) log('B: history shows ' + logEntries + ' commit(s)')
  else note('B: no commits visible in history!')

  // create + switch to the ide-workspace branch (idempotent)
  const branchSel = page.locator('[data-id="gitBranchSelect"]')
  const branches = await branchSel.evaluate((sel) => Array.from(sel.options).map((o) => o.value))
  if (!branches.includes('ide-workspace')) {
    await page.locator('[data-id="gitNewBranch"]').click()
    const bPrompt = page.locator('[data-id="modalDialogCustomPromptText"]')
    await bPrompt.waitFor({ state: 'visible', timeout: 10_000 })
    await bPrompt.fill('ide-workspace')
    await page.locator('#modal-footer-ok').click()
    await page.waitForTimeout(2500)
  }
  await branchSel.selectOption('ide-workspace').catch(() => {})
  await page.waitForTimeout(2000)
  log('B: on branch ide-workspace')
  await page.screenshot({ path: SCRATCH + '/p3-b-gitpanel.png' })

  // ---------------- C: add remote + push through the CORS proxy
  const remoteUrlShown = await page.locator('[data-id="gitRemoteUrl"]').innerText().catch(() => '')
  if (!remoteUrlShown.includes('ThreeRealmsCards')) {
    await page.locator('[data-id="gitAddRemoteUrl"]').fill(REPO_URL)
    await page.locator('[data-id="gitAddRemote"]').click()
    await page.locator('[data-id="gitPush"]').waitFor({ timeout: 15_000 })
  }
  await page.locator('[data-id="gitPush"]').click()
  let pushStatus = ''
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(2000)
    pushStatus = await page.locator('[data-id="gitStatus"]').innerText().catch(() => '')
    if (/Pushed|failed|error/i.test(pushStatus)) break
  }
  if (/Pushed ide-workspace/i.test(pushStatus)) log('C: ' + pushStatus.trim())
  else note('C: push did not confirm: ' + pushStatus.trim())
  await page.screenshot({ path: SCRATCH + '/p3-c-push.png' })

  // ---------------- D: clone the repo back through the proxy (fresh workspace)
  await page.locator('[data-id="gitCloneUrl"]').fill(REPO_URL)
  await page.locator('[data-id="gitClone"]').click()
  let cloned = false
  try {
    await page.waitForFunction(() => {
      const sel = document.querySelector('select[data-id="workspacesSelect"]')
      return sel && sel.value === 'ThreeRealmsCards'
    }, undefined, { timeout: 120_000 })
    cloned = true
  } catch (e) { note('D: clone did not land within 120s: ' + (await page.locator('[data-id="gitStatus"]').innerText().catch(() => ''))) }
  if (cloned) {
    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    const readme = page.locator('[data-id="treeViewLitreeViewItemREADME.md"]')
    await readme.waitFor({ timeout: 20_000 })
    log('D: cloned into workspace ThreeRealmsCards — README.md present')
    await page.screenshot({ path: SCRATCH + '/p3-d-clone.png' })
  }

  // leave the session parked on three-realms so later phases resume there
  await page.locator('select[data-id="workspacesSelect"]').selectOption('three-realms')
  await page.waitForTimeout(1500)
  await ctx.close()

  // ---------------- E: J-003 self-validation — a fresh boot must restore it
  const ctx2 = await chromium.launchPersistentContext(PROFILE, { headless: true })
  const page2 = ctx2.pages()[0] || await ctx2.newPage()
  await page2.goto('http://localhost:18080/', { waitUntil: 'load', timeout: 60_000 })
  try { const w = page2.locator('button:has-text("I Understand")'); await w.waitFor({ state: 'visible', timeout: 4000 }); await w.click() } catch (e) {}
  await page2.waitForTimeout(4000)
  const restored = await page2.locator('select[data-id="workspacesSelect"]').inputValue().catch(() => '?')
  if (restored === 'three-realms') log('E: J-003 fix verified in the wild — fresh boot restored three-realms')
  else note('E: restore failed, fresh boot landed on ' + restored)
  await ctx2.close()

  console.log('NOTES-BEGIN'); notes.forEach((x) => console.log('- ' + x)); console.log('NOTES-END')
  console.log('P3-OK')
})().catch((e) => { console.error('P3-FAIL', e); process.exit(1) })
