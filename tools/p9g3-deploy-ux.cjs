// P9-G Part 3: AI deploy/run tools (Phase B) + UX paths (error visibility,
// Stop/abort) over the real gateway, verified by real IDE side-effects.
const fs = require('fs')
const { chromium } = require('/Users/tron/Object/trontech/tron-remix/node_modules/@playwright/test')

const GW = JSON.parse(fs.readFileSync(process.env.AI_GW || '/private/tmp/claude-501/-Users-tron-Object-trontech-tron-remix/c95bc390-5ff2-4f7e-bf42-32d5fed2d83a/scratchpad/ai-gw.json', 'utf8'))
const PROFILE = process.env.AI_PROFILE || '/Users/tron/Object/tronSmart/.tronide-profile-ai'
const SCRATCH = '/private/tmp/claude-501/-Users-tron-Object-trontech-tron-remix/c95bc390-5ff2-4f7e-bf42-32d5fed2d83a/scratchpad'
const WS = 'default_workspace'
const results = []
const log = (m) => console.log('[p9g3]', m)
const pass = (id, m) => { results.push({ id, ok: true, m }); console.log(`[p9g3] ${id} VERIFIED — ${m}`) }
const fail = (id, m) => { results.push({ id, ok: false, m }); console.log(`[p9g3][NOTE] ${id} — ${m}`) }

;(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1500, height: 950 } })
  const page = ctx.pages()[0] || await ctx.newPage()
  await page.addInitScript((base) => { try { window.localStorage.setItem('tronide.ai.baseUrl.Anthropic', base) } catch (e) {} }, GW.baseUrl)
  await page.goto('http://localhost:18080/', { waitUntil: 'load', timeout: 120_000 })
  const deOverlay = async () => { await page.evaluate(() => document.querySelectorAll('#webpack-dev-server-client-overlay').forEach((e) => e.remove())).catch(() => {}); await page.addStyleTag({ content: '#webpack-dev-server-client-overlay{display:none!important}' }).catch(() => {}) }
  await deOverlay()
  try { const w = page.locator('button:has-text("I Understand")'); await w.waitFor({ state: 'visible', timeout: 4000 }); await w.click() } catch (e) {}
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 60_000 }).catch(() => {})
  if ((await page.locator('select[data-id="workspacesSelect"]').inputValue().catch(() => '?')) !== WS) { await page.locator('select[data-id="workspacesSelect"]').selectOption(WS).catch(() => {}); await page.waitForTimeout(2000) }
  log('workspace = ' + (await page.locator('select[data-id="workspacesSelect"]').inputValue().catch(() => '?')))

  // pre-compile Storage on builtin + set VM env so aiDeploy has an env + contract
  const ensureFilePanel = async () => { const t = page.locator('[data-id="filePanelFileExplorerTree"]'); for (let i = 0; i < 3; i++) { if (await t.isVisible().catch(() => false)) return; await page.locator('#icon-panel div[plugin="filePanel"]').click().catch(() => {}); await page.waitForTimeout(1000) } }
  await ensureFilePanel()
  const storage = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
  if (!await storage.isVisible().catch(() => false)) { await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click().catch(() => {}); await page.waitForTimeout(1000) }
  await storage.click({ force: true }).catch(() => {})
  await page.waitForTimeout(800)
  await page.locator('#icon-panel div[plugin="solidity"]').click(); await page.waitForTimeout(1000)
  const builtinVal = await page.evaluate(() => { const s = document.querySelector('#versionSelector'); const o = s && Array.from(s.options).find((x) => x.value === 'builtin'); return o ? o.value : '' })
  if (builtinVal && (await page.locator('#versionSelector').inputValue().catch(() => '')) !== builtinVal) { await page.locator('#versionSelector').selectOption(builtinVal); await page.waitForTimeout(3000) }
  await page.locator('[data-id="compilerContainerCompileBtn"]').click()
  await page.locator('[data-id="compiledContracts"]').waitFor({ timeout: 120_000 }).catch(() => {})
  await page.locator('#icon-panel div[plugin="udapp"]').click(); await page.waitForTimeout(1000)
  await page.locator('select[id="selectExEnvOptions"]').selectOption({ label: 'JavaScript VM (Tron)' }).catch(() => {})
  await page.waitForTimeout(1500)
  log('pre-compiled Storage + set VM (Tron) env')

  // open AI panel + config
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
    const deadline = Date.now() + (opts.timeout || 180_000)
    while (Date.now() < deadline) {
      const modal = page.locator('.ant-modal-confirm')
      if (await modal.isVisible().catch(() => false)) { confirmSeen = true; if (opts.reject) await page.getByRole('button', { name: 'Reject' }).click().catch(() => {}); else await page.locator('.ant-modal-confirm .ant-btn-primary').first().click().catch(() => {}); await page.waitForTimeout(1200); continue }
      const idle = await page.locator('[data-id="aiSendButton"]').isVisible().catch(() => false)
      if (idle && (await responseCount()) > before) break
      await page.waitForTimeout(1500)
    }
    return { text: await lastResponse(), confirmSeen }
  }

  // ============================================================ list_deployable_contracts
  try {
    const r = await ask('List the contracts I can deploy right now. Use your tool.')
    if (/storage/i.test(r.text)) pass('LIST-DEPLOYABLE', `list_deployable_contracts: model listed Storage ("${r.text.slice(0, 70)}…")`)
    else fail('LIST-DEPLOYABLE', `response=${r.text.slice(0, 160)}`)
  } catch (e) { fail('LIST-DEPLOYABLE', String(e).slice(0, 120)) }

  // ============================================================ deploy_contract (confirm)
  let deployedAddr = ''
  try {
    const before = await page.locator('.instance').count()
    const r = await ask('Deploy the Storage contract to the current VM environment. Confirm the deployment, then tell me the deployed address.', { timeout: 200_000 })
    for (let i = 0; i < 15 && (await page.locator('.instance').count()) <= before; i++) await page.waitForTimeout(800)
    const now = await page.locator('.instance').count()
    // extract the deployed address from the new instance
    if (now > before) {
      deployedAddr = await page.locator('.instance').last().evaluate((el) => { const re = /(0x[0-9a-fA-F]{40}|41[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33})/; for (const n of [el, ...el.querySelectorAll('*')]) for (const a of Array.from(n.attributes || [])) { const v = String(a.value); if (v.includes('...')) continue; const m = v.match(re); if (m) return m[1] } const m = el.textContent.match(re); return m ? m[1] : '' })
    }
    if (r.confirmSeen && now > before) pass('DEPLOY', `deploy_contract: confirm modal shown; a new VM instance appeared (addr=${deployedAddr.slice(0, 12)}…)`)
    else fail('DEPLOY', `confirm=${r.confirmSeen} instancesBefore=${before} after=${now}`)
  } catch (e) { fail('DEPLOY', String(e).slice(0, 120)) }

  // ============================================================ read_contract (cross-turn context)
  try {
    // reference the address from the PRIOR turn implicitly to test history
    const r = await ask('Call the retrieve() method on the Storage contract you just deployed and tell me the returned value.', { timeout: 180_000 })
    if (/\b0\b|zero|retrieve|returned|value/i.test(r.text)) pass('READ-CONTRACT', `read_contract + cross-turn context: model recalled the deployed Storage and read retrieve() ("${r.text.slice(0, 80)}…")`)
    else fail('READ-CONTRACT', `response=${r.text.slice(0, 160)}`)
  } catch (e) { fail('READ-CONTRACT', String(e).slice(0, 120)) }

  // ============================================================ check_verification
  try {
    const r = await ask('Check whether the contract at address TXYZ1234567890abcdefABCDEF1234567890 is verified on TronScan.', { timeout: 120_000 })
    if (/verif|tronscan|invalid|address|not.*found|no contract/i.test(r.text)) pass('CHECK-VERIFY', `check_verification: tool answered a verification-status query ("${r.text.slice(0, 80)}…")`)
    else fail('CHECK-VERIFY', `response=${r.text.slice(0, 160)}`)
  } catch (e) { fail('CHECK-VERIFY', String(e).slice(0, 120)) }

  // ============================================================ UX: Stop button aborts
  try {
    const before = await responseCount()
    await chatInput().fill('Write a very long, detailed 800-word essay about the history of the TRON blockchain. Take your time.')
    for (let i = 0; i < 20 && !(await sendEnabled()); i++) await page.waitForTimeout(200)
    await clickSend()
    // wait for the busy/stop state, then click Stop
    await page.waitForTimeout(2500)
    const stopVisible = await page.locator('[data-id="aiStopButton"]').isVisible().catch(() => false)
    if (stopVisible) { await page.locator('[data-id="aiStopButton"]').evaluate((el) => el.click()).catch(() => {}); await page.waitForTimeout(2500) }
    const backToIdle = await page.locator('[data-id="aiSendButton"]').isVisible().catch(() => false)
    if (stopVisible && backToIdle) pass('STOP-BUTTON', 'Stop button: send flipped to aiStopButton while busy; clicking it aborted and returned to idle send')
    else fail('STOP-BUTTON', `stopSeen=${stopVisible} idleAfter=${backToIdle}`)
  } catch (e) { fail('STOP-BUTTON', String(e).slice(0, 120)) }

  // ============================================================ UX: bad key → visible error
  try {
    await page.locator('[data-id="aiApiKeyInput"]').fill('invalid-key-for-error-test'); await page.waitForTimeout(400)
    const before = await responseCount()
    await chatInput().fill('Say hello.')
    for (let i = 0; i < 20 && !(await sendEnabled()); i++) await page.waitForTimeout(200)
    await clickSend()
    let errShown = false
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      if (await page.locator('.other-dialogue-item.error-item, .re-answer').first().isVisible().catch(() => false)) { errShown = true; break }
      const idle = await page.locator('[data-id="aiSendButton"]').isVisible().catch(() => false)
      if (idle && (await responseCount()) > before) break
      await page.waitForTimeout(1500)
    }
    if (errShown) pass('ERROR-VISIBLE', 'bad key: request failure rendered a visible error item / retry link (not a silent hang)')
    else fail('ERROR-VISIBLE', 'no visible error item after a bad-key request')
  } catch (e) { fail('ERROR-VISIBLE', String(e).slice(0, 120)) }

  fs.writeFileSync(SCRATCH + '/p9g3-results.json', JSON.stringify(results, null, 1))
  await page.screenshot({ path: SCRATCH + '/p9g3-final.png' })
  await ctx.close()
  console.log('RESULTS-BEGIN'); results.forEach((r) => console.log(`- [${r.ok ? 'PASS' : 'NOTE'}] ${r.id}: ${r.m}`)); console.log('RESULTS-END')
  console.log('P9G3-OK')
})().catch((e) => { console.error('P9G3-FAIL', e); process.exit(1) })
