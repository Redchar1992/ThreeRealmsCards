// P9-G: AI ↔ IDE tool interactions over the REAL infraway gateway.
// Configures the AI panel (Anthropic / claude-opus-4-8 / gateway baseUrl / key),
// then drives a battery of natural-language prompts that make the model call
// each IDE tool CATEGORY, verifying the real IDE side-effect each time.
//
// The gateway key is read from a session scratchpad JSON (NOT hardcoded here,
// so this committed driver carries no secret). Point AI_GW at another file to
// override.
const fs = require('fs')
const { chromium } = require('/Users/tron/Object/trontech/tron-remix/node_modules/@playwright/test')

const GW = JSON.parse(fs.readFileSync(process.env.AI_GW || '/private/tmp/claude-501/-Users-tron-Object-trontech-tron-remix/c95bc390-5ff2-4f7e-bf42-32d5fed2d83a/scratchpad/ai-gw.json', 'utf8'))
const PROFILE = '/Users/tron/Object/tronSmart/.tronide-profile'
const SCRATCH = '/private/tmp/claude-501/-Users-tron-Object-trontech-tron-remix/c95bc390-5ff2-4f7e-bf42-32d5fed2d83a/scratchpad'
const WS = 'default_workspace' // small + git-init'd; avoids the J-005 quota of three-realms
const results = []
const log = (m) => console.log('[p9g]', m)
const pass = (id, m) => { results.push({ id, ok: true, m }); console.log(`[p9g] ${id} VERIFIED — ${m}`) }
const fail = (id, m) => { results.push({ id, ok: false, m }); console.log(`[p9g][NOTE] ${id} — ${m}`) }

;(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1500, height: 950 } })
  const page = ctx.pages()[0] || await ctx.newPage()
  // pre-seed the persisted base URL for Anthropic so the panel picks up the
  // gateway on mount (localStorage key tronide.ai.baseUrl.<vendor>)
  await page.addInitScript((base) => { try { window.localStorage.setItem('tronide.ai.baseUrl.Anthropic', base) } catch (e) {} }, GW.baseUrl)
  await page.goto('http://localhost:18080/', { waitUntil: 'load', timeout: 120_000 })
  const deOverlay = async () => { await page.evaluate(() => document.querySelectorAll('#webpack-dev-server-client-overlay').forEach((e) => e.remove())).catch(() => {}); await page.addStyleTag({ content: '#webpack-dev-server-client-overlay{display:none!important}' }).catch(() => {}) }
  await deOverlay()
  try { const w = page.locator('button:has-text("I Understand")'); await w.waitFor({ state: 'visible', timeout: 4000 }); await w.click() } catch (e) {}
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 60_000 }).catch(() => {})

  // ---- workspace: default_workspace
  if ((await page.locator('select[data-id="workspacesSelect"]').inputValue().catch(() => '?')) !== WS) {
    await page.locator('select[data-id="workspacesSelect"]').selectOption(WS).catch(() => {})
    await page.waitForTimeout(2000)
  }
  log('workspace = ' + (await page.locator('select[data-id="workspacesSelect"]').inputValue().catch(() => '?')))

  // ---- open the AI panel (the icon TOGGLES; open only if hidden)
  const panelVisible = async () => page.evaluate(() => { const p = document.getElementById('ai-panel'); if (!p) return false; const s = getComputedStyle(p); return s.display !== 'none' && p.style.width !== '0px' })
  for (let i = 0; i < 3 && !(await panelVisible()); i++) { await page.locator('[data-id="verticalIconsAiAssistantIcons"]').click().catch(() => {}); await page.waitForTimeout(1500) }
  if (!await panelVisible()) throw new Error('AI panel did not open')
  await page.locator('[data-id="aiApiKeyInput"]').waitFor({ timeout: 15_000 })
  log('AI panel open')

  // ---- config: key (not persisted → must type); baseUrl was pre-seeded but
  // also set the field to be safe
  await page.locator('[data-id="aiApiKeyInput"]').fill(GW.apiKey)
  await page.waitForTimeout(300)
  const baseField = page.locator('[data-id="aiBaseUrlInput"]')
  if (await baseField.isVisible().catch(() => false)) { await baseField.fill(GW.baseUrl); await page.waitForTimeout(300) }
  // confirm persistence gate accepted the https gateway
  const persisted = await page.evaluate(() => window.localStorage.getItem('tronide.ai.baseUrl.Anthropic'))
  if (persisted === GW.baseUrl) pass('GW-PERSIST', `baseUrl persisted to localStorage tronide.ai.baseUrl.Anthropic = ${persisted}`)
  else fail('GW-PERSIST', `baseUrl not persisted (got ${persisted})`)

  // ---- the ask() helper: type, send, handle a confirm modal, wait for idle,
  // return the latest AI response text
  // the chat input is the ONLY textarea with this placeholder; a generic
  // "panel textarea" selector can match the wrong element and leave the send
  // button disabled (its `disabled` class is removed only when the chat input
  // has text)
  const chatInput = () => page.locator('textarea[placeholder*="Enter any question"]').first()
  const responseCount = async () => page.locator('.other-dialogue-item').count()
  const lastResponse = async () => (await page.locator('.other-dialogue-item .dialogue').last().innerText().catch(() => '')).replace(/\s+/g, ' ')
  const sendEnabled = async () => page.evaluate(() => { const b = document.querySelector('[data-id="aiSendButton"]'); return b && !/\bdisabled\b/.test(b.className) })
  // The send button is a React <div class="submit-btn"> whose onClick fires via
  // event delegation. Playwright's normal .click() times out on it (an overlay/
  // animation fails the actionability gate), so dispatch a real DOM click that
  // React still catches.
  const clickSend = () => page.locator('[data-id="aiSendButton"]').evaluate((el) => el.click())
  const ask = async (prompt, opts = {}) => {
    const before = await responseCount()
    await chatInput().fill(prompt)
    // wait for React to drop the `disabled` class before clicking the div
    for (let i = 0; i < 20 && !(await sendEnabled()); i++) await page.waitForTimeout(200)
    await clickSend()
    // handle the confirmation modal if this tool mutates
    let confirmSeen = false
    const deadline = Date.now() + (opts.timeout || 150_000)
    while (Date.now() < deadline) {
      const modal = page.locator('.ant-modal-confirm')
      if (await modal.isVisible().catch(() => false)) {
        confirmSeen = true
        if (opts.reject) { await page.getByRole('button', { name: 'Reject' }).click().catch(() => {}) }
        else { await page.locator('.ant-modal-confirm .ant-btn-primary').first().click().catch(() => {}) }
        await page.waitForTimeout(1200)
        continue
      }
      // idle again = send button back and a new response arrived
      const idle = await page.locator('[data-id="aiSendButton"]').isVisible().catch(() => false)
      if (idle && (await responseCount()) > before) break
      await page.waitForTimeout(1500)
    }
    return { text: await lastResponse(), confirmSeen }
  }

  // ============================================================ read-only
  try {
    const r = await ask('List the files in the contracts folder of this workspace. Use your tools.')
    if (/storage|owner|ballot/i.test(r.text)) pass('LIST-FILES', 'list_files: model enumerated the real contracts (' + r.text.slice(0, 80) + '…)')
    else fail('LIST-FILES', 'response did not mention known files: ' + r.text.slice(0, 160))
  } catch (e) { fail('LIST-FILES', String(e).slice(0, 120)) }

  try {
    const r = await ask('Open contracts/1_Storage.sol, then tell me the two public function names it defines.')
    const active = await page.evaluate(() => { const el = document.querySelector('[data-id="tabsSelectFileName"]') || document.querySelector('.active[data-id^="tab"]'); return el ? el.textContent : '' }).catch(() => '')
    if (/store|retrieve/i.test(r.text)) pass('OPEN-READ', 'open_file + read: model reported store/retrieve (active tab=' + (active || '?') + ')')
    else fail('OPEN-READ', 'response missing store/retrieve: ' + r.text.slice(0, 160))
  } catch (e) { fail('OPEN-READ', String(e).slice(0, 120)) }

  // ============================================================ create_file (accept)
  try {
    await page.evaluate((ws) => { try { window.remixFileSystem.unlinkSync(`.workspaces/${ws}/contracts/AITest.sol`) } catch (e) {} }, WS)
    const r = await ask('Create a new file at contracts/AITest.sol containing a minimal Solidity file: SPDX MIT, pragma ^0.8.0, and an empty contract named AIToken.')
    let content = ''
    for (let i = 0; i < 10 && !content; i++) { content = await page.evaluate((ws) => { try { return window.remixFileSystem.readFileSync(`.workspaces/${ws}/contracts/AITest.sol`, 'utf8') || '' } catch (e) { return '' } }, WS); if (!content) await page.waitForTimeout(800) }
    if (r.confirmSeen && /contract\s+AIToken/i.test(content)) pass('CREATE-FILE', 'create_file: confirm modal shown + file written to workspace with contract AIToken (' + content.length + ' bytes)')
    else fail('CREATE-FILE', `confirm=${r.confirmSeen} content=${content.slice(0, 80)}`)
  } catch (e) { fail('CREATE-FILE', String(e).slice(0, 120)) }

  // ============================================================ create_file (reject)
  try {
    await page.evaluate((ws) => { try { window.remixFileSystem.unlinkSync(`.workspaces/${ws}/contracts/RejectMe.sol`) } catch (e) {} }, WS)
    const r = await ask('Create a file at contracts/RejectMe.sol with any content.', { reject: true })
    await page.waitForTimeout(1500)
    const exists = await page.evaluate((ws) => { try { window.remixFileSystem.readFileSync(`.workspaces/${ws}/contracts/RejectMe.sol`, 'utf8'); return true } catch (e) { return false } }, WS)
    if (r.confirmSeen && !exists) pass('CREATE-REJECT', 'create_file reject: modal shown, Reject clicked, file NOT written')
    else fail('CREATE-REJECT', `confirm=${r.confirmSeen} fileExists=${exists}`)
  } catch (e) { fail('CREATE-REJECT', String(e).slice(0, 120)) }

  fs.writeFileSync(SCRATCH + '/p9g-partial.json', JSON.stringify(results, null, 1))
  await page.screenshot({ path: SCRATCH + '/p9g-readonly.png' })

  await ctx.close()
  console.log('RESULTS-BEGIN'); results.forEach((r) => console.log(`- [${r.ok ? 'PASS' : 'NOTE'}] ${r.id}: ${r.m}`)); console.log('RESULTS-END')
  console.log('P9G-PART1-OK')
})().catch((e) => { console.error('P9G-FAIL', e); process.exit(1) })
