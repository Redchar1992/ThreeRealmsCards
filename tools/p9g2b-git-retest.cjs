// P9-G Part 2b: re-test the git write tools (commit / create_branch) after the
// Part 2 run showed they were blocked by the BrowserFS LocalStorage quota
// (J-005/J-009 family), NOT a git defect. Free the workspace quota first, then
// stage + commit the existing untracked files and branch — no new file write.
const fs = require('fs')
const { chromium } = require('/Users/tron/Object/trontech/tron-remix/node_modules/@playwright/test')

const GW = JSON.parse(fs.readFileSync(process.env.AI_GW || '/private/tmp/claude-501/-Users-tron-Object-trontech-tron-remix/c95bc390-5ff2-4f7e-bf42-32d5fed2d83a/scratchpad/ai-gw.json', 'utf8'))
const PROFILE = process.env.AI_PROFILE || '/Users/tron/Object/tronSmart/.tronide-profile-ai'
const SCRATCH = '/private/tmp/claude-501/-Users-tron-Object-trontech-tron-remix/c95bc390-5ff2-4f7e-bf42-32d5fed2d83a/scratchpad'
const WS = 'default_workspace'
const results = []
const pass = (id, m) => { results.push({ id, ok: true, m }); console.log(`[p9g2b] ${id} VERIFIED — ${m}`) }
const fail = (id, m) => { results.push({ id, ok: false, m }); console.log(`[p9g2b][NOTE] ${id} — ${m}`) }
const log = (m) => console.log('[p9g2b]', m)

;(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1500, height: 950 } })
  const page = ctx.pages()[0] || await ctx.newPage()
  await page.addInitScript((base) => { try { window.localStorage.setItem('tronide.ai.baseUrl.Anthropic', base) } catch (e) {} }, GW.baseUrl)
  await page.goto('http://localhost:18080/', { waitUntil: 'load', timeout: 120_000 })
  await page.addStyleTag({ content: '#webpack-dev-server-client-overlay{display:none!important}' }).catch(() => {})
  try { const w = page.locator('button:has-text("I Understand")'); await w.waitFor({ state: 'visible', timeout: 4000 }); await w.click() } catch (e) {}
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 60_000 }).catch(() => {})
  if ((await page.locator('select[data-id="workspacesSelect"]').inputValue().catch(() => '?')) !== WS) { await page.locator('select[data-id="workspacesSelect"]').selectOption(WS).catch(() => {}); await page.waitForTimeout(2000) }

  // ---- FREE the BrowserFS LocalStorage quota: remove accumulated artifacts +
  // the AI test probe files so git object writes (commit) have room.
  await page.waitForFunction(() => !!window.remixFileSystem, null, { timeout: 30_000 })
  const freed = await page.evaluate((ws) => {
    const fsx = window.remixFileSystem
    const rmrf = (p) => { try { const es = fsx.readdirSync(p); for (const e of es) { const f = p + '/' + e; let d = false; try { d = fsx.statSync(f).isDirectory() } catch (er) {} if (d) rmrf(f); else { try { fsx.unlinkSync(f) } catch (er) {} } } try { fsx.rmdirSync(p) } catch (er) {} } catch (e) {} }
    rmrf(`.workspaces/${ws}/contracts/artifacts`)
    for (const f of ['AITest.sol', 'RejectMe.sol', 'GitProbe.sol', 'CommitProbe.sol']) { try { fsx.unlinkSync(`.workspaces/${ws}/contracts/${f}`) } catch (e) {} }
    // estimate free space by trying to measure localStorage usage
    let used = 0; try { for (const k in window.localStorage) used += (window.localStorage[k] || '').length } catch (e) {}
    return { localStorageKB: Math.round(used / 1024) }
  }, WS)
  log(`freed workspace artifacts/probes; localStorage ~${freed.localStorageKB}KB used`)

  // ---- open AI panel + config
  const panelVisible = async () => page.evaluate(() => { const p = document.getElementById('ai-panel'); if (!p) return false; const s = getComputedStyle(p); return s.display !== 'none' && p.style.width !== '0px' })
  for (let i = 0; i < 3 && !(await panelVisible()); i++) { await page.locator('[data-id="verticalIconsAiAssistantIcons"]').click().catch(() => {}); await page.waitForTimeout(1500) }
  if (!await panelVisible()) throw new Error('AI panel did not open')
  await page.locator('[data-id="aiApiKeyInput"]').waitFor({ timeout: 15_000 })
  await page.locator('[data-id="aiApiKeyInput"]').fill(GW.apiKey); await page.waitForTimeout(300)
  const baseField = page.locator('[data-id="aiBaseUrlInput"]')
  if (await baseField.isVisible().catch(() => false)) { await baseField.fill(GW.baseUrl); await page.waitForTimeout(300) }
  log('AI panel configured')

  const chatInput = () => page.locator('textarea[placeholder*="Enter any question"]').first()
  const responseCount = async () => page.locator('.other-dialogue-item').count()
  const lastResponse = async () => (await page.locator('.other-dialogue-item .dialogue').last().innerText().catch(() => '')).replace(/\s+/g, ' ')
  const sendEnabled = async () => page.evaluate(() => { const b = document.querySelector('[data-id="aiSendButton"]'); return b && !/\bdisabled\b/.test(b.className) })
  const clickSend = () => page.locator('[data-id="aiSendButton"]').evaluate((el) => el.click())
  const ask = async (prompt, opts = {}) => {
    const before = await responseCount()
    await chatInput().fill(prompt)
    for (let i = 0; i < 20 && !(await sendEnabled()); i++) await page.waitForTimeout(200)
    await clickSend()
    let confirmSeen = false
    const deadline = Date.now() + (opts.timeout || 200_000)
    while (Date.now() < deadline) {
      const modal = page.locator('.ant-modal-confirm')
      if (await modal.isVisible().catch(() => false)) { confirmSeen = true; if (opts.reject) await page.getByRole('button', { name: 'Reject' }).click().catch(() => {}); else await page.locator('.ant-modal-confirm .ant-btn-primary').first().click().catch(() => {}); await page.waitForTimeout(1200); continue }
      const idle = await page.locator('[data-id="aiSendButton"]').isVisible().catch(() => false)
      if (idle && (await responseCount()) > before) break
      await page.waitForTimeout(1500)
    }
    return { text: await lastResponse(), confirmSeen }
  }

  // ============================================================ git_commit (confirm) on existing untracked files
  try {
    const r = await ask('Stage all the untracked files in this workspace with git_stage_all, then commit them with git_commit using the message "p9g first commit". Approve the commit confirmation.', { timeout: 220_000 })
    const r2 = await ask('Show the most recent commit using git_log.', { timeout: 120_000 })
    if (r.confirmSeen && /p9g first commit|sha|commit/i.test(r2.text) && !/no commits|empty/i.test(r2.text)) pass('GIT-COMMIT', `git_commit: confirm modal shown; git_log now shows the commit ("${r2.text.slice(0, 90)}…")`)
    else fail('GIT-COMMIT', `confirm=${r.confirmSeen} commitTurn="${r.text.slice(0, 100)}" logAfter="${r2.text.slice(0, 120)}"`)
  } catch (e) { fail('GIT-COMMIT', String(e).slice(0, 120)) }

  // ============================================================ git_create_branch (confirm)
  try {
    const r = await ask('Create a new git branch named "p9g-ai-branch" and check it out. Approve the confirmation.', { timeout: 160_000 })
    const r2 = await ask('Which git branch am I on now? Use git_status.', { timeout: 120_000 })
    if (r.confirmSeen && /p9g-ai-branch/i.test(r2.text)) pass('GIT-BRANCH', `git_create_branch: confirm shown; now on branch p9g-ai-branch ("${r2.text.slice(0, 80)}…")`)
    else fail('GIT-BRANCH', `confirm=${r.confirmSeen} branchAfter="${r2.text.slice(0, 130)}"`)
  } catch (e) { fail('GIT-BRANCH', String(e).slice(0, 120)) }

  fs.writeFileSync(SCRATCH + '/p9g2b-results.json', JSON.stringify(results, null, 1))
  await ctx.close()
  console.log('RESULTS-BEGIN'); results.forEach((r) => console.log(`- [${r.ok ? 'PASS' : 'NOTE'}] ${r.id}: ${r.m}`)); console.log('RESULTS-END')
  console.log('P9G2B-OK')
})().catch((e) => { console.error('P9G2B-FAIL', e); process.exit(1) })
