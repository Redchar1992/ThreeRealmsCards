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
  const desired = FILES.map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')])
  const wrote = await page.evaluate(({ ws, files }) => {
    const fsx = window.remixFileSystem
    const mkdirp = (p) => { const parts = p.split('/'); let acc = ''; for (const part of parts) { acc = acc ? acc + '/' + part : part; try { fsx.mkdirSync(acc) } catch (e) {} } }
    let written = 0
    for (const [rel, content] of files) {
      const full = `.workspaces/${ws}/contracts/${rel}`
      let cur = null; try { cur = fsx.readFileSync(full, 'utf8') } catch (e) {}
      if (cur === content) continue
      mkdirp(full.split('/').slice(0, -1).join('/')); fsx.writeFileSync(full, content); written++
    }
    let verified = 0
    for (const [rel, content] of files) { try { if (fsx.readFileSync(`.workspaces/${ws}/contracts/${rel}`, 'utf8') === content) verified++ } catch (e) {} }
    return { written, verified }
  }, { ws: WS, files: desired })
  log(`workspace ${WS}: ${wrote.written} written, ${wrote.verified}/${FILES.length} verified`)
  if (wrote.verified !== FILES.length) throw new Error('workspace verify')
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
  // the decoded return of the LAST read renders in an instance-level tree node
  // ("0: bool: true", "0: address: 0x…", "0: string: …")
  const lastDecoded = async () => (await page.locator('.instance [data-id^="treeViewLi"]').last().innerText().catch(() => '')).replace(/\s+/g, ' ')
  const readCall = async (fn, argStr) => { await callWith(fn, argStr); return lastDecoded() }

  // genesis so a suzerain + some tokens exist (A is suzerain)
  await callWith('mintPeachGardenGenesis', acctA)
  log('genesis minted (A is suzerain)')

  // ===== 1. TRC-165 supportsInterface(bytes4) — the bytes4 input path
  const checkIface = async (id) => {
    const out = await readCall('supportsInterface', id)
    return /:\s*bool:\s*true|:\s*true\b/i.test(out) ? true : (/:\s*bool:\s*false|:\s*false\b/i.test(out) ? false : ('?:' + out.slice(-80)))
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

  // ===== 3. two-step suzerainty transfer + cancel
  const bTail = acctB.toLowerCase().replace(/^0x/, '')
  const addrMatches = (decoded, tail) => decoded.toLowerCase().replace(/\s/g, '').includes(tail)
  // pass to B (from A)
  await setFrom(acctA)
  await callWith('passSuzerainty', acctB)
  const heirRow = await readCall('heirApparent')
  const heirIsB = addrMatches(heirRow, bTail)
  const suzStillA = await readCall('suzerain')
  log(`passSuzerainty(B): heirApparent==B? ${heirIsB}; suzerain still A? ${!addrMatches(suzStillA, bTail)}`)
  // accept from B — the account switch is the crux of the two-step design
  await setFrom(acctB)
  await callWith('acceptSuzerainty')
  const after = await readCall('suzerain')
  const suzerainIsB = addrMatches(after, bTail)
  if (heirIsB && suzerainIsB) log('TWO-STEP SUZERAINTY VERIFIED — passSuzerainty(B) then acceptSuzerainty() from B moved the throne; account switch drove the second step')
  else note(`two-step suzerainty mismatch: heirIsB=${heirIsB}, suzerainIsB=${suzerainIsB} (after=${after.slice(-90)})`)

  // cancel path: suzerain B stages a pass to A then cancels via address(0)
  await setFrom(acctB)
  await callWith('passSuzerainty', acctA)
  await callWith('passSuzerainty', '0x0000000000000000000000000000000000000000')
  const heirAfterCancel = await readCall('heirApparent')
  const zeroHeir = /:\s*address:\s*(0x)?0{40}\b/i.test(heirAfterCancel) || /\b0x0{40}\b/.test(heirAfterCancel.replace(/\s/g, ''))
  if (zeroHeir) log('CANCEL PATH VERIFIED — passSuzerainty(0) cleared heirApparent to the zero address')
  else note('cancel path: heirApparent not clearly zero after passSuzerainty(0): ' + heirAfterCancel.slice(-90))

  await page.screenshot({ path: SCRATCH + '/p9b-final.png' })
  await ctx.close()
  console.log('NOTES-BEGIN'); notes.forEach((x) => console.log('- ' + x)); console.log('NOTES-END')
  console.log('P9B-OK')
})().catch((e) => { console.error('P9B-FAIL', e); process.exit(1) })
