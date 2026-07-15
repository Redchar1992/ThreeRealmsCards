// P9-E + P9-F: two IDE surfaces P9 never exercised, on the P13/P14 contracts.
//  E) 桃园馆 v2 time windows — is the JS VM's block.timestamp advanceable?
//     Tests claim-inside-window, non-heir reject, giver-can't-reclaim-inside,
//     and the CAPABILITY PROBE: can we ever cross claimBy to reclaim? If the
//     VM freezes time, time-windowed contracts are only half-testable in-IDE.
//  F) 市集 CardBazaar payable/callValue — the Value field + a full TRX cycle
//     (list → buy with callValue → withdraw), plus a WrongTribute value revert
//     recorded, extending the J-008 revert-stamp check to a value-bearing path.
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
  const walk = (dir) => { for (const e of fs.readdirSync(path.join(ROOT, dir || '.'), { withFileTypes: true })) { const rel = dir ? dir + '/' + e.name : e.name; if (e.isDirectory()) { if (e.name !== 'mocks') walk(rel) } else if (e.name.endsWith('.sol')) out.push(rel) } }
  walk(''); return out.sort()
})()
const notes = []
const log = (m) => console.log('[p9ef]', m)
const note = (m) => { notes.push(m); console.log('[p9ef][NOTE]', m) }
const nowSec = () => Math.floor(Date.now() / 1000)

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

  // Clicking an ALREADY-ACTIVE side-panel icon TOGGLES it shut (the panel-
  // toggle gotcha). Open the file panel only when its tree is not visible.
  const ensureFilePanel = async () => {
    const tree = page.locator('[data-id="filePanelFileExplorerTree"]')
    for (let i = 0; i < 3; i++) {
      if (await tree.isVisible().catch(() => false)) return
      await page.locator('#icon-panel div[plugin="filePanel"]').click().catch(() => {})
      await page.waitForTimeout(1200)
    }
  }

  // ---- workspace bootstrap (idempotent; frees quota first — J-005 family)
  await ensureFilePanel()
  const wsOptions = await page.evaluate(() => { const s = document.querySelector('select[data-id="workspacesSelect"]'); return s ? Array.from(s.options).map((o) => o.value) : [] })
  if (!wsOptions.includes(WS)) {
    await page.locator('[data-id="workspaceCreate"]').click()
    const ni = page.locator('input[data-id="modalDialogCustomPromptTextCreate"]'); await ni.waitFor({ state: 'visible', timeout: 5000 }); await ni.fill(WS)
    await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click(); await page.waitForTimeout(2500)
  } else if ((await page.locator('select[data-id="workspacesSelect"]').inputValue().catch(() => '?')) !== WS) { await page.locator('select[data-id="workspacesSelect"]').selectOption(WS); await page.waitForTimeout(2000) }
  await page.waitForFunction(() => !!window.remixFileSystem, null, { timeout: 30_000 })
  const desired = FILES.map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')])
  const wrote = await page.evaluate(({ ws, files }) => {
    const fsx = window.remixFileSystem
    const mkdirp = (p) => { const parts = p.split('/'); let acc = ''; for (const part of parts) { acc = acc ? acc + '/' + part : part; try { fsx.mkdirSync(acc) } catch (e) {} } }
    const rmrf = (p) => { try { const ents = fsx.readdirSync(p); for (const e of ents) { const f = p + '/' + e; let d = false; try { d = fsx.statSync(f).isDirectory() } catch (er) {} if (d) rmrf(f); else { try { fsx.unlinkSync(f) } catch (er) {} } } try { fsx.rmdirSync(p) } catch (er) {} } catch (e) {} }
    rmrf(`.workspaces/${ws}/contracts/artifacts`); try { fsx.unlinkSync(`.workspaces/${ws}/contracts/scenario.json`) } catch (e) {}
    let written = 0
    for (const [rel, content] of files) { const full = `.workspaces/${ws}/contracts/${rel}`; let cur = null; try { cur = fsx.readFileSync(full, 'utf8') } catch (e) {} if (cur === content) continue; mkdirp(full.split('/').slice(0, -1).join('/')); fsx.writeFileSync(full, content); written++ }
    let verified = 0; for (const [rel, content] of files) { try { if (fsx.readFileSync(`.workspaces/${ws}/contracts/${rel}`, 'utf8') === content) verified++ } catch (e) {} }
    return { written, verified }
  }, { ws: WS, files: desired })
  log(`workspace: ${wrote.written} written, ${wrote.verified}/${FILES.length} verified`)
  if (wrote.verified !== FILES.length) throw new Error('workspace verify')
  if (wrote.written > 0) { await page.waitForTimeout(6000); await page.reload({ waitUntil: 'load' }); await deOverlay(); try { const w = page.locator('button:has-text("I Understand")'); await w.waitFor({ state: 'visible', timeout: 5000 }); await w.click() } catch (e) {}; await page.waitForTimeout(4000); await ensureFilePanel() }

  // compile on builtin
  const openAndCompile = async (fileRel) => {
    await ensureFilePanel()
    await page.waitForTimeout(800)
    const f = page.locator(`[data-id="treeViewLitreeViewItemcontracts/${fileRel}"]`)
    const folder = page.locator('[data-id="treeViewLitreeViewItemcontracts"]')
    let opened = false
    for (let r = 0; r < 12 && !opened; r++) {
      if (await f.isVisible().catch(() => false)) { await f.click({ force: true }); opened = true; break }
      if (await folder.isVisible().catch(() => false)) { await folder.click({ force: true }).catch(() => {}); await page.waitForTimeout(1000) }
      else await page.waitForTimeout(800)
    }
    if (!opened) throw new Error('could not open contracts/' + fileRel)
    await page.waitForTimeout(700)
    await page.locator('#icon-panel div[plugin="solidity"]').click(); await page.waitForTimeout(700)
    const bv = await page.evaluate(() => { const s = document.querySelector('#versionSelector'); const o = s && Array.from(s.options).find((x) => x.value === 'builtin'); return o ? o.value : '' })
    if (bv && (await page.locator('#versionSelector').inputValue().catch(() => '')) !== bv) { await page.locator('#versionSelector').selectOption(bv); await page.waitForTimeout(3000) }
    await page.locator('[data-id="compilerContainerCompileBtn"]').click()
    await page.locator('[data-id="compiledContracts"]').waitFor({ timeout: 120_000 })
  }
  await openAndCompile('ThreeRealmsCards.sol')
  log('compiled')

  // VM env, accounts
  await page.locator('#icon-panel div[plugin="udapp"]').click()
  await page.locator('select[id="selectExEnvOptions"]').selectOption({ label: 'JavaScript VM (Tron)' })
  await page.waitForTimeout(1500)
  const accounts = await page.evaluate(() => { const s = document.querySelector('#runTabView #txorigin'); return s ? Array.from(s.options).map((o) => o.value) : [] })
  if (accounts.length < 2) throw new Error('need 2 accounts')
  const [acctA, acctB] = accounts
  log(`accounts A=${acctA.slice(0, 10)}… B=${acctB.slice(0, 10)}…`)
  const setFrom = async (a) => { await page.locator('#runTabView #txorigin').selectOption(a); await page.waitForTimeout(400) }
  const setValueSun = async (sun) => {
    // #value + #unit(sun). Set unit to the base unit and fill the amount.
    await page.evaluate((v) => {
      const u = document.querySelector('#unit'); if (u) { u.value = Array.from(u.options).find((o) => /sun/i.test(o.textContent))?.value ?? u.value; u.dispatchEvent(new Event('change', { bubbles: true })) }
      const val = document.querySelector('#value'); if (val) { val.value = String(v); val.dispatchEvent(new Event('input', { bubbles: true })); val.dispatchEvent(new Event('change', { bubbles: true })) }
    }, sun)
    await page.waitForTimeout(300)
  }

  const extractAddr = (el) => {
    const re = /(0x[0-9a-fA-F]{40}|41[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33})/
    for (const n of [el, ...el.querySelectorAll('*')]) { for (const a of Array.from(n.attributes || [])) { const v = String(a.value); if (v.includes('...')) continue; const m = v.match(re); if (m) return m[1] } }
    const m = el.textContent.match(re); return m ? m[1] : ''
  }
  const ensureUdapp = async () => {
    if (!await page.locator('#runTabView select[class^="contractNames"]').isVisible().catch(() => false)) {
      await page.locator('#icon-panel div[plugin="udapp"]').click(); await page.waitForTimeout(1200)
    }
  }
  // deploy a contract (optionally with one ctor arg) and return its instance + address
  const deploy = async (name, ctorArg) => {
    await ensureUdapp()
    // the contractNames dropdown reflects the CURRENT compilation; the caller
    // compiles the defining file first for non-card contracts
    await page.locator('#runTabView select[class^="contractNames"]').selectOption(name)
    if (ctorArg !== undefined) { const ci = page.locator('#runTabView div[class*="contractActionsContainer"] input:visible').first(); await ci.fill(ctorArg) }
    const before = await page.locator('.instance').count()
    await page.locator('button[data-id^="Deploy - transact"]').first().click()
    await page.waitForTimeout(2500)
    for (let i = 0; i < 20 && await page.locator('.instance').count() <= before; i++) await page.waitForTimeout(500)
    const idx = (await page.locator('.instance').count()) - 1
    const instance = page.locator('.instance').nth(idx)
    await instance.locator('[data-id="universalDappUiTitleExpander"]').click().catch(() => {})
    const addr = await instance.evaluate(extractAddr)
    return { instance, addr, idx }
  }
  // instance-scoped call/read helpers
  const H = (instance) => {
    const rowFor = (fn) => instance.locator('div[class*="contractProperty"]').filter({ has: page.locator(`button[title^="${fn} - "]`) }).first()
    const callWith = async (fn, argStr) => { const r = rowFor(fn); if (argStr !== undefined && argStr !== null) await r.locator('input:visible').first().fill(argStr); await r.locator(`button[title^="${fn} - "]`).first().click(); await page.waitForTimeout(1300) }
    const nodesOfType = async (type) => { const t = await instance.locator('[data-id^="treeViewLi"]').allInnerTexts().catch(() => []); return t.map((x) => x.replace(/\s+/g, ' ')).filter((x) => new RegExp(`:\\s*${type || '\\w+'}:`, 'i').test(x)) }
    const readCall = async (fn, argStr, type) => { await callWith(fn, argStr); for (let i = 0; i < 12; i++) { const h = await nodesOfType(type); if (h.length) return h[h.length - 1]; await page.waitForTimeout(400) } return '' }
    return { rowFor, callWith, readCall }
  }
  const journalTail = async () => (((await page.locator('#journal').textContent().catch(() => '')) || '')).replace(/\s+/g, ' ')
  const didRevert = async (before) => { const t = await journalTail(); return /revert|errored/i.test(t.slice(before.length)) }
  // getters return addresses base58-encoded and uints as "uint256"; normalize.
  const addrOf = (decoded) => (decoded.match(/address:\s*([0-9A-Za-z]+)/) || [])[1] || ''
  const uintOf = (decoded) => (decoded.replace(/\s/g, '').match(/uint\d*:(\d+)/) || [])[1] || ''

  // ---- card: deploy + genesis (A holds tokens 1,2,3)
  await setFrom(acctA)
  const card = await deploy('ThreeRealmsCards')
  log('deployed ThreeRealmsCards ' + card.addr.slice(0, 12) + '…')
  const cardH = H(card.instance)
  await cardH.callWith('mintPeachGardenGenesis', acctA)
  log('genesis minted — A holds tokens 1,2,3')

  // PeachPavilion / CardBazaar import the card INTERFACE, not vice-versa, so
  // compiling ThreeRealmsCards.sol did NOT include them — compile each file
  // before deploying it. The deployed card instance persists across recompiles.
  await openAndCompile('PeachPavilion.sol')
  const pav = await deploy('PeachPavilion', card.addr)
  log('deployed PeachPavilion ' + pav.addr.slice(0, 12) + '…')
  await openAndCompile('CardBazaar.sol')
  const baz = await deploy('CardBazaar', card.addr)
  log('deployed CardBazaar ' + baz.addr.slice(0, 12) + '…')
  const pavH = H(pav.instance); const bazH = H(baz.instance)
  const ownerB58 = async (tokenId) => addrOf(await cardH.readCall('ownerOf', String(tokenId), 'address'))

  // learn A's base58 form: A owns tokens 1,2,3 after genesis (getters return
  // base58, the account dropdown is hex — compare base58-to-base58)
  const aB58 = await ownerB58(1)
  log('A base58 = ' + aB58)

  // ============================================================ P9-E: TIME
  // approve pavilion for tokens 1 and 3 (A owns them)
  await setFrom(acctA)
  await cardH.callWith('approve', `${pav.addr}, 1`)
  await cardH.callWith('approve', `${pav.addr}, 3`)

  // E1 — happy path: deposit token 1 for heir B with a generous window, B claims
  const farClaimBy = nowSec() + 3600
  await pavH.callWith('depositGift', `1, ${acctB}, ${farClaimBy}`)
  await setFrom(acctB)
  let jb = await journalTail()
  await pavH.callWith('claimGift', '1')
  const claimReverted = await didRevert(jb)
  const bB58 = await ownerB58(1) // token 1 now held by whoever claimed (B)
  if (!claimReverted && bB58 && bB58 !== aB58) log(`E1 VERIFIED — heir claimed inside the window; ownerOf(1)=${bB58.slice(0, 8)}… (B, ≠ giver A)`)
  else note(`E1 claim inside window failed: reverted=${claimReverted} owner1=${bB58} aB58=${aB58}`)

  // E2 — non-heir reject: deposit token 3 for B, A (non-heir) tries claim → revert
  await setFrom(acctA)
  await pavH.callWith('depositGift', `3, ${acctB}, ${farClaimBy}`)
  jb = await journalTail()
  await pavH.callWith('claimGift', '3') // still A (non-heir)
  if (await didRevert(jb)) log('E2 VERIFIED — non-heir claimGift reverts (NotDesignatedHeir)')
  else note('E2 non-heir claim did not revert')

  // E3 — giver can't reclaim INSIDE window
  jb = await journalTail()
  await pavH.callWith('reclaimGift', '3') // A is giver, but window open
  if (await didRevert(jb)) log('E3 VERIFIED — giver reclaim inside window reverts (GiftStillClaimable)')
  else note('E3 giver-inside-window reclaim did not revert')

  // E4 — CAPABILITY PROBE: can we cross claimBy to reclaim after expiry?
  // approve + deposit token 2 with a claimBy just past wall-clock now, then
  // send state-changing txs + real waits and retry reclaim. Success ⇒ the VM
  // advances block.timestamp; perpetual GiftStillClaimable ⇒ frozen time.
  await cardH.callWith('approve', `${pav.addr}, 2`)
  const nearClaimBy = nowSec() + 3
  await pavH.callWith('depositGift', `2, ${acctB}, ${nearClaimBy}`)
  let reclaimed = false
  for (let round = 0; round < 6 && !reclaimed; round++) {
    await page.waitForTimeout(2500) // real time passes
    // force new blocks with cheap state-changing txs (self-approve token 1)
    await setFrom(acctA)
    await cardH.callWith('approve', `${acctA}, 1`).catch(() => {})
    jb = await journalTail()
    await pavH.callWith('reclaimGift', '2')
    if (!(await didRevert(jb))) reclaimed = true
    else log(`E4 probe round ${round}: reclaim still reverts (VM time <= claimBy=${nearClaimBy}, wall=${nowSec()})`)
  }
  if (reclaimed) {
    const owner2 = await ownerB58(2)
    log(`E4 CAPABILITY: VM block.timestamp ADVANCES — reclaim succeeded after the 3s window expired (real waits + txs crossed claimBy); ownerOf(2)=${owner2.slice(0, 8)}… back to giver A: ${owner2 === aB58}. Time-windowed contracts ARE testable in the in-IDE JS VM.`)
  } else {
    note('E4 CAPABILITY (IDE limitation candidate): after 6 rounds of txs + ~15s wall time, reclaimGift never cleared GiftStillClaimable — the JS VM appears to FREEZE block.timestamp (genesis time), so expiry/deadline paths of time-windowed contracts are NOT testable in the in-IDE VM. Needs strict confirmation before filing.')
  }

  // ============================================================ P9-F: VALUE
  // A lists token 1 (A holds it again? No — B holds 1 from E1). Use B's token 1.
  // Simpler: A still holds nothing tradable cleanly; list from whoever owns it.
  // A owns token 2 again if reclaimed; else own set is messy. Use a fresh path:
  // B owns token 1 (from E1). B lists it, A buys with callValue, B withdraws.
  const PRICE = 1000000 // 1 TRX in sun
  await setFrom(acctB)
  await cardH.callWith('approve', `${baz.addr}, 1`)
  await bazH.callWith('list', `1, ${PRICE}`)
  log(`F: B listed token 1 at ${PRICE} sun`)

  // F1 — WRONG value reverts (WrongTribute) and is recorded as a value revert
  await setFrom(acctA)
  await setValueSun(PRICE - 1)
  jb = await journalTail()
  await bazH.callWith('buy', '1')
  const wrongReverted = await didRevert(jb)
  if (wrongReverted) log('F1 VERIFIED — buy with wrong callValue reverts (WrongTribute); value-bearing revert recorded')
  else note('F1 wrong-value buy did not revert')

  // F2 — correct callValue: A buys, card moves to A, proceeds credited to B
  await setValueSun(PRICE)
  jb = await journalTail()
  await bazH.callWith('buy', '1')
  const buyReverted = await didRevert(jb)
  await setValueSun(0) // reset value so later reads/txs aren't payable-tainted
  const owner1After = await ownerB58(1)
  const proceeds = uintOf(await bazH.readCall('pendingProceeds', acctB, 'uint256'))
  if (!buyReverted && owner1After === aB58 && proceeds === String(PRICE)) {
    log(`F2 VERIFIED — buy with exact callValue: ownerOf(1)=A (${owner1After.slice(0, 8)}…), pendingProceeds[B]==${proceeds} sun (payable msg.value through the UI Value field + pull-ledger credit)`)
  } else {
    note(`F2 partial: reverted=${buyReverted} owner1After=${owner1After.slice(0, 10)} (aB58=${aB58.slice(0, 10)}) proceeds=${proceeds}`)
  }

  // F3 — B withdraws proceeds (pull payment), ledger zeroes
  await setFrom(acctB)
  jb = await journalTail()
  await bazH.callWith('withdraw')
  const wdReverted = await didRevert(jb)
  const proceedsAfter = uintOf(await bazH.readCall('pendingProceeds', acctB, 'uint256'))
  if (!wdReverted && proceedsAfter === '0') log('F3 VERIFIED — withdraw() paid B and zeroed the pull ledger (checks-effects-interactions)')
  else note(`F3 withdraw: reverted=${wdReverted} proceedsAfter=${proceedsAfter}`)

  await page.screenshot({ path: SCRATCH + '/p9ef-final.png' })
  await ctx.close()
  console.log('NOTES-BEGIN'); notes.forEach((x) => console.log('- ' + x)); console.log('NOTES-END')
  console.log('P9EF-OK')
})().catch((e) => { console.error('P9EF-FAIL', e); process.exit(1) })
