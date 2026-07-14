// P9-B: the hardened v3 features through the IDE UI (VM), covering input paths
// no prior phase exercised:
//   1. TRC-165 supportsInterface(bytes4) — the bytes4 argument path
//   2. JSON escaping — mintCard with a name carrying " and \ ; tokenURI must
//      still base64-decode to JSON that JSON.parse accepts (Str.escapeJson)
//   3. two-step suzerainty — passSuzerainty(B) → switch txorigin to B →
//      acceptSuzerainty() → suzerain()==B ; then the address(0) cancel path
const fs = require('fs')
const path = require('path')
const { chromium } = require('/Users/tron/Object/trontech/tron-remix/node_modules/@playwright/test')

const PROFILE = '/Users/tron/Object/tronSmart/.tronide-profile'
const SCRATCH = '/private/tmp/claude-501/-Users-tron-Object-trontech-tron-remix/c95bc390-5ff2-4f7e-bf42-32d5fed2d83a/scratchpad'
const REPO = '/Users/tron/Object/tronSmart/ThreeRealmsCards'
const ROOT = REPO + '/contracts'
const WS = 'three-realms-v2'
const FILES = (() => {
  const out = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir || '.'), { withFileTypes: true })) {
      const rel = dir ? dir + '/' + e.name : e.name
      if (e.isDirectory()) { if (e.name !== 'mocks') walk(rel) } else if (e.name.endsWith('.sol')) out.push(rel)
    }
  }
  walk('')
  return out.sort()
})()
const notes = []
const log = (m) => console.log('[p9b]', m)
const note = (m) => { notes.push(m); console.log('[p9b][NOTE]', m) }

;(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1440, height: 900 } })
  const page = ctx.pages()[0] || await ctx.newPage()
  await page.goto('http://localhost:18080/', { waitUntil: 'load', timeout: 120_000 })
  const deOverlay = async () => {
    await page.evaluate(() => document.querySelectorAll('#webpack-dev-server-client-overlay').forEach((e) => e.remove())).catch(() => {})
    await page.addStyleTag({ content: '#webpack-dev-server-client-overlay { display: none !important; }' }).catch(() => {})
  }
  await deOverlay()
  try { const w = page.locator('button:has-text("I Understand")'); await w.waitFor({ state: 'visible', timeout: 4000 }); await w.click() } catch (e) {}
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 60_000 }).catch(() => {})

  // ---------------- workspace bootstrap (idempotent, from p9-a)
  if (!await page.locator('[data-id="filePanelFileExplorerTree"]').isVisible().catch(() => false)) {
    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    await page.locator('[data-id="filePanelFileExplorerTree"]').waitFor({ timeout: 15_000 })
  }
  const wsOptions = await page.evaluate(() => {
    const s = document.querySelector('select[data-id="workspacesSelect"]')
    return s ? Array.from(s.options).map((o) => o.value) : []
  })
  if (!wsOptions.includes(WS)) {
    await page.locator('[data-id="workspaceCreate"]').click()
    const nameInput = page.locator('input[data-id="modalDialogCustomPromptTextCreate"]')
    await nameInput.waitFor({ state: 'visible', timeout: 5000 })
    await nameInput.fill(WS)
    await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()
    await page.waitForTimeout(2500)
  } else if ((await page.locator('select[data-id="workspacesSelect"]').inputValue().catch(() => '?')) !== WS) {
    await page.locator('select[data-id="workspacesSelect"]').selectOption(WS)
    await page.waitForTimeout(2000)
  }
  await page.waitForFunction(() => !!window.remixFileSystem, null, { timeout: 30_000 })
  const desired = FILES.map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')])
  const wrote = await page.evaluate(({ ws, files }) => {
    const fsx = window.remixFileSystem
    const mkdirp = (p) => { const parts = p.split('/'); let acc = ''; for (const part of parts) { acc = acc ? acc + '/' + part : part; try { fsx.mkdirSync(acc) } catch (e) {} } }
    // Free localStorage quota BEFORE writing: compile artifacts + a saved
    // scenario accumulate and, on the BrowserFS LocalStorage backend (~5MB),
    // a normal workspace write starts throwing quota errors (the J-005/J-009
    // family). They are regenerated on the next compile.
    const rmrf = (p) => { try { const ents = fsx.readdirSync(p); for (const e of ents) { const f = p + '/' + e; let d = false; try { d = fsx.statSync(f).isDirectory() } catch (er) {} if (d) rmrf(f); else { try { fsx.unlinkSync(f) } catch (er) {} } } try { fsx.rmdirSync(p) } catch (er) {} } catch (e) {} }
    rmrf(`.workspaces/${ws}/contracts/artifacts`)
    try { fsx.unlinkSync(`.workspaces/${ws}/contracts/scenario.json`) } catch (e) {}
    let written = 0; let quotaHit = false
    try {
      for (const [rel, content] of files) {
        const full = `.workspaces/${ws}/contracts/${rel}`
        let cur = null; try { cur = fsx.readFileSync(full, 'utf8') } catch (e) {}
        if (cur === content) continue
        mkdirp(full.split('/').slice(0, -1).join('/')); fsx.writeFileSync(full, content); written++
      }
    } catch (e) { quotaHit = String((e && e.message) || e) }
    let verified = 0
    for (const [rel, content] of files) { try { if (fsx.readFileSync(`.workspaces/${ws}/contracts/${rel}`, 'utf8') === content) verified++ } catch (e) {} }
    return { written, verified, quotaHit }
  }, { ws: WS, files: desired })
  if (wrote.quotaHit) note('J-005/J-009 corroboration: BrowserFS LocalStorage write threw mid-run even after freeing artifacts (' + wrote.quotaHit + ')')
  log(`workspace ${WS}: ${wrote.written} written, ${wrote.verified}/${FILES.length} verified`)
  if (wrote.verified !== FILES.length) throw new Error('workspace verify (' + wrote.verified + '/' + FILES.length + ')')
  if (wrote.written > 0) {
    await page.waitForTimeout(6000)
    await page.reload({ waitUntil: 'load' }); await deOverlay()
    try { const w = page.locator('button:has-text("I Understand")'); await w.waitFor({ state: 'visible', timeout: 5000 }); await w.click() } catch (e) {}
    await page.waitForTimeout(4000)
    if (!await page.locator('[data-id="filePanelFileExplorerTree"]').isVisible().catch(() => false)) { await page.locator('#icon-panel div[plugin="filePanel"]').click(); await page.waitForTimeout(1500) }
  }

  // open main contract, compile on builtin, deploy in VM
  const file = page.locator('[data-id="treeViewLitreeViewItemcontracts/ThreeRealmsCards.sol"]')
  if (!await file.isVisible().catch(() => false)) { const folder = page.locator('[data-id="treeViewLitreeViewItemcontracts"]'); if (await folder.isVisible().catch(() => false)) { await folder.click(); await page.waitForTimeout(1200) } }
  await file.click(); await page.waitForTimeout(1000)
  await page.locator('#icon-panel div[plugin="solidity"]').click(); await page.waitForTimeout(1000)
  const builtinVal = await page.evaluate(() => { const s = document.querySelector('#versionSelector'); const o = s && Array.from(s.options).find((x) => x.value === 'builtin'); return o ? o.value : '' })
  if (builtinVal && (await page.locator('#versionSelector').inputValue().catch(() => '')) !== builtinVal) { await page.locator('#versionSelector').selectOption(builtinVal); await page.waitForTimeout(3000) }
  await page.locator('[data-id="compilerContainerCompileBtn"]').click()
  await page.locator('[data-id="compiledContracts"]').waitFor({ timeout: 120_000 })
  log('compiled on ' + (builtinVal || 'current'))

  await page.locator('#icon-panel div[plugin="udapp"]').click()
  await page.locator('select[id="selectExEnvOptions"]').selectOption({ label: 'JavaScript VM (Tron)' })
  await page.waitForTimeout(1500)
  const accounts = await page.evaluate(() => { const s = document.querySelector('#runTabView #txorigin'); return s ? Array.from(s.options).map((o) => o.value) : [] })
  if (accounts.length < 2) throw new Error('need 2 accounts')
  const [acctA, acctB] = accounts
  log(`accounts A=${acctA.slice(0, 10)}… B=${acctB.slice(0, 10)}…`)

  const setFrom = async (acct) => { await page.locator('#runTabView #txorigin').selectOption(acct); await page.waitForTimeout(500) }
  await setFrom(acctA)
  const deployBtn = page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' })
  await page.locator('#runTabView select[class^="contractNames"]').selectOption('ThreeRealmsCards')
  await deployBtn.click()
  const inst = page.locator('.instance').first()
  await inst.waitFor({ timeout: 30_000 })
  await inst.locator('[data-id="universalDappUiTitleExpander"]').click()
  log('deployed + expanded ThreeRealmsCards')

  // A function's row, identified by its exact button title (so 'suzerain' does
  // not also match 'passSuzerainty').
  const rowFor = (fn) => inst.locator('div[class*="contractProperty"]').filter({ has: page.locator(`button[title^="${fn} - "]`) }).first()
  // fill the COLLAPSED combined input (one field taking all args, comma-joined;
  // the per-arg expanded inputs are hidden by default) and click the action.
  const callWith = async (fn, argStr) => {
    const r = rowFor(fn)
    if (argStr !== undefined && argStr !== null) await r.locator('input:visible').first().fill(argStr)
    await r.locator(`button[title^="${fn} - "]`).first().click()
    await page.waitForTimeout(1300)
  }
  // Decoded reads render as instance-level tree nodes ("0: bool: true",
  // "0: address: 0x…"). Prior calls' nodes persist and tokenURI's JSON expands
  // into many nested nodes, so `.last()` is wrong — filter by the expected
  // Solidity return type and take the most recent match.
  const decodedOfType = async (type) => {
    const texts = await page.locator('.instance [data-id^="treeViewLi"]').allInnerTexts().catch(() => [])
    const hits = texts.map((t) => t.replace(/\s+/g, ' ')).filter((t) => new RegExp(`:\\s*${type}:`, 'i').test(t))
    return hits.length ? hits[hits.length - 1] : ''
  }
  const readCall = async (fn, argStr, type) => { await callWith(fn, argStr); return type ? decodedOfType(type) : (await page.locator('.instance [data-id^="treeViewLi"]').last().innerText().catch(() => '')).replace(/\s+/g, ' ') }

  // genesis so a suzerain + some tokens exist (A is suzerain)
  await callWith('mintPeachGardenGenesis', acctA)
  log('genesis minted (A is suzerain)')

  // ===== 1. TRC-165 supportsInterface(bytes4) — the bytes4 input path
  const checkIface = async (id) => {
    const out = await readCall('supportsInterface', id, 'bool')
    return /:\s*bool:\s*true/i.test(out) ? true : (/:\s*bool:\s*false/i.test(out) ? false : ('?:' + out.slice(-80)))
  }
  const trc721 = await checkIface('0x80ac58cd')
  const metadata = await checkIface('0x5b5e139f')
  const bogus = await checkIface('0xffffffff')
  log(`TRC-165: TRC721(0x80ac58cd)=${trc721}, Metadata(0x5b5e139f)=${metadata}, bogus(0xffffffff)=${bogus}`)
  if (trc721 === true && metadata === true && bogus === false) log('TRC-165 VERIFIED via UI bytes4 input — supportsInterface answers correctly')
  else note(`TRC-165 mismatch: expected true/true/false, got ${trc721}/${metadata}/${bogus}`)

  // ===== 2. JSON escaping — mint a card whose name carries " and \
  // Card tuple: [general, faction, rarity, attack, intellect, command, charisma, series]
  const nastyName = 'Cao "Mengde" \\ Cao'
  const cardTuple = JSON.stringify([nastyName, 0, 3, 92, 98, 95, 80, 'Wei "Kingdom"'])
  // collapsed combined input: "address to, tuple card" → `to, [tuple]`
  await callWith('mintCard', `${acctA}, ${cardTuple}`)
  await page.waitForTimeout(800)
  // the new token id: genesis minted 3 (ids 1..3), so mintCard makes id 4
  const uriOut = await readCall('tokenURI', '4')
  let m = uriOut.match(/data:application\/json;base64,([A-Za-z0-9+/=]+)/)
  if (!m) { const b64 = uriOut.match(/([A-Za-z0-9+/]{80,}={0,2})/); if (b64) m = [null, b64[1]] }
  if (m && m[1]) {
    const jsonStr = Buffer.from(m[1], 'base64').toString('utf8')
    fs.writeFileSync(SCRATCH + '/p9b-token4.json', jsonStr)
    let parsed = null
    try { parsed = JSON.parse(jsonStr) } catch (e) { note('JSON escape FAILED — tokenURI(4) is not valid JSON: ' + String(e).slice(0, 80) + ' :: ' + jsonStr.slice(0, 160)) }
    if (parsed) {
      if (parsed.name && parsed.name.includes('"Mengde"') && parsed.name.includes('\\')) log('JSON ESCAPE VERIFIED — tokenURI(4) base64 decodes to valid JSON; name preserves the " and \\: ' + JSON.stringify(parsed.name))
      else note('JSON parsed but name did not preserve the escaped chars: ' + JSON.stringify(parsed.name))
    }
  } else { note('no base64 metadata in tokenURI(4): ' + uriOut.slice(-160)) }

  // ===== 3. two-step suzerainty transfer + cancel.
  // The fork returns addresses base58-encoded, while the account dropdown is
  // hex — so assert encoding-AGNOSTICALLY by comparing read values to each
  // other: the throne must move to exactly the staged heir.
  const addrOf = (decoded) => (decoded.match(/address:\s*([0-9A-Za-z]+)/) || [])[1] || ''
  const isZero = (a) => /^(0x)?0{40}$/i.test(a) || /^T1111111111111111111111111111/.test(a) // base58 zero
  await setFrom(acctA)
  const suzBefore = addrOf(await readCall('suzerain', undefined, 'address'))
  await callWith('passSuzerainty', acctB)
  const heir = addrOf(await readCall('heirApparent', undefined, 'address'))
  const suzStill = addrOf(await readCall('suzerain', undefined, 'address'))
  log(`passSuzerainty(B): staged heir=${heir.slice(0, 10)}… (differs from lord ${suzBefore.slice(0, 10)}…: ${heir !== suzBefore}); suzerain unchanged: ${suzStill === suzBefore}`)
  // accept from B — the account switch is the crux of the two-step design
  await setFrom(acctB)
  await callWith('acceptSuzerainty')
  const suzAfter = addrOf(await readCall('suzerain', undefined, 'address'))
  const moved = suzAfter === heir && suzAfter !== suzBefore && heir && !isZero(heir)
  if (moved) log(`TWO-STEP SUZERAINTY VERIFIED — throne moved from ${suzBefore.slice(0, 8)}… to the staged heir ${suzAfter.slice(0, 8)}… only after acceptSuzerainty() from B (account switch drove step 2)`)
  else note(`two-step suzerainty mismatch: before=${suzBefore.slice(0, 12)} heir=${heir.slice(0, 12)} after=${suzAfter.slice(0, 12)}`)

  // cancel path: suzerain B stages a pass to A then cancels via address(0)
  await setFrom(acctB)
  await callWith('passSuzerainty', acctA)
  const heirStaged = addrOf(await readCall('heirApparent', undefined, 'address'))
  await callWith('passSuzerainty', '0x0000000000000000000000000000000000000000')
  const heirAfterCancel = addrOf(await readCall('heirApparent', undefined, 'address'))
  if (!isZero(heirStaged) && isZero(heirAfterCancel)) log('CANCEL PATH VERIFIED — a staged heir was cleared to the zero address by passSuzerainty(0)')
  else note(`cancel path: staged=${heirStaged.slice(0, 12)} afterCancel=${heirAfterCancel.slice(0, 16)} (expected non-zero then zero)`)

  await page.screenshot({ path: SCRATCH + '/p9b-final.png' })
  await ctx.close()
  console.log('NOTES-BEGIN'); notes.forEach((x) => console.log('- ' + x)); console.log('NOTES-END')
  console.log('P9B-OK')
})().catch((e) => { console.error('P9B-FAIL', e); process.exit(1) })
