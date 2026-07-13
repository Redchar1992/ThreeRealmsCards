// P6 phase 2: VM chain round for the modular build — deploy both roots, the
// gift-escrow cross-account flow (wrong claimer first: custom-error rendering
// quality), global-using read, corrected flatten of the MAIN root, precise
// 0.8.6 error capture.
const fs = require('fs')
const { chromium } = require('/Users/tron/Object/trontech/tron-remix/node_modules/@playwright/test')

const PROFILE = '/Users/tron/Object/tronSmart/.tronide-profile'
const SCRATCH = '/private/tmp/claude-501/-Users-tron-Object-trontech-tron-remix/607fd892-ece0-473d-8492-66232f2e46ae/scratchpad'
const REPO = '/Users/tron/Object/tronSmart/ThreeRealmsCards'
const notes = []
const log = (m) => console.log('[p6c]', m)
const note = (m) => { notes.push(m); console.log('[p6c][NOTE]', m) }

;(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1440, height: 900 } })
  const page = ctx.pages()[0] || await ctx.newPage()
  await page.goto('http://localhost:18080/', { waitUntil: 'load', timeout: 120_000 })
  try { await page.addStyleTag({ content: '#webpack-dev-server-client-overlay { display: none !important; }' }) } catch (e) {}
  try { const w = page.locator('button:has-text("I Understand")'); await w.waitFor({ state: 'visible', timeout: 5000 }); await w.click() } catch (e) {}
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ state: 'attached', timeout: 60_000 })
  if ((await page.locator('select[data-id="workspacesSelect"]').inputValue().catch(() => '?')) !== 'three-realms') {
    await page.locator('select[data-id="workspacesSelect"]').selectOption('three-realms')
    await page.waitForTimeout(1500)
  }

  const openFile = async (rel) => {
    if (!await page.locator('[data-id="filePanelFileExplorerTree"]').isVisible().catch(() => false)) {
      await page.locator('#icon-panel div[plugin="filePanel"]').click()
      await page.waitForTimeout(800)
    }
    const parts = ('contracts/' + rel).split('/')
    let acc = ''
    for (let i = 0; i < parts.length; i++) {
      acc = acc ? acc + '/' + parts[i] : parts[i]
      const node = page.locator(`[data-id="treeViewLitreeViewItem${acc}"]`)
      for (let r = 0; r < 4; r++) {
        if (await node.isVisible().catch(() => false)) break
        const parent = acc.split('/').slice(0, -1).join('/')
        if (parent) await page.locator(`[data-id="treeViewLitreeViewItem${parent}"]`).click().catch(() => {})
        await page.waitForTimeout(700)
      }
      if (i === parts.length - 1) await node.click()
    }
    await page.waitForTimeout(600)
  }
  const compileCurrent = async (expectName) => {
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await page.locator('[data-id="compilerContainerCompileBtn"]').click()
    // the compiled list may hold STALE content from the previous root —
    // poll until the expected root actually appears
    let txt = ''
    for (let i = 0; i < 80; i++) {
      await page.waitForTimeout(1500)
      txt = await page.locator('[data-id="compiledContracts"]').innerText().catch(() => '')
      if (txt.includes(expectName)) return txt
    }
    note('compile: ' + expectName + ' never appeared; last=' + txt.trim().slice(0, 100))
    return txt
  }

  // pin 0.8.20
  await page.locator('#icon-panel div[plugin="solidity"]').click()
  const v0820 = await page.evaluate(() => {
    const sel = document.querySelector('#versionSelector')
    const o = sel && Array.from(sel.options).find((x) => x.value.includes('0.8.20'))
    return o ? o.value : ''
  })
  if (v0820 && (await page.locator('#versionSelector').inputValue().catch(() => '')) !== v0820) {
    await page.locator('#versionSelector').selectOption(v0820)
    await page.waitForTimeout(4000)
  }

  // ---------------- A: deploy cards + genesis
  await openFile('ThreeRealmsCards.sol')
  await compileCurrent('ThreeRealmsCards')
  await page.locator('#icon-panel div[plugin="udapp"]').click()
  await page.locator('select[id="selectExEnvOptions"]').selectOption({ label: 'JavaScript VM (Tron)' })
  await page.waitForTimeout(1500)
  const accounts = await page.evaluate(() => {
    const sel = document.querySelector('#runTabView #txorigin')
    return sel ? Array.from(sel.options).map((o) => o.value) : []
  })
  if (accounts.length < 2) { note('A: fewer than 2 VM accounts (' + accounts.length + ') — gift flow needs two'); }
  const lord = accounts[0]
  const heir = accounts[1] || accounts[0]
  log('A: lord=' + lord.slice(0, 10) + '… heir=' + heir.slice(0, 10) + '…')
  await page.locator('#runTabView select[class^="contractNames"]').selectOption('ThreeRealmsCards')
  await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
  const cards = page.locator('.instance').first()
  await cards.waitFor({ timeout: 30_000 })
  await cards.locator('[data-id="universalDappUiTitleExpander"]').click()
  // the visible title is CSS-uppercased (regexes on innerText silently die) —
  // the instance data-id carries the raw address
  // raw addresses live in the recorder ADDRESS BOOK (the visible instance
  // title is CSS-uppercased and carries no data-id)
  const grabDeployedAddr = async (name) => {
    if (!await page.locator('[data-id="recorderAddressBookEntry"]').first().isVisible().catch(() => false)) {
      const card = page.locator('div[class*="cardContainer"]').filter({ hasText: 'Transactions recorded' })
      await card.locator('i[class*="arrow"]').first().click().catch(() => {})
      await page.waitForTimeout(800)
    }
    return page.evaluate((n) => {
      const entries = Array.from(document.querySelectorAll('[data-id="recorderAddressBookEntry"]'))
      for (const e of entries) {
        const nm = e.querySelector('[data-id="recorderAddressBookName"]')
        if (nm && nm.innerText.trim() === n) {
          const ad = e.querySelector('[data-id="recorderAddressBookAddress"]')
          return ad ? ad.innerText.trim() : ''
        }
      }
      return ''
    }, name)
  }
  const cardsAddr = await grabDeployedAddr('ThreeRealmsCards')
  log('A: cards deployed at ' + (cardsAddr || '(unresolved)'))
  if (!cardsAddr) throw new Error('cards address unresolved')
  const rowIn = (inst, fn) => inst.locator('div[class*="contractProperty"]', { hasText: fn }).first()
  const call = async (inst, fn, arg, waitMs) => {
    const r = rowIn(inst, fn)
    if (arg !== undefined) await r.locator('input').first().fill(String(arg))
    await r.locator('button').first().click()
    await page.waitForTimeout(waitMs || 1500)
    return (await inst.innerText()).replace(/\s+/g, ' ')
  }
  await call(cards, 'mintPeachGardenGenesis', lord, 2500)
  let txt = await call(cards, 'balanceOf', lord)
  if (/balanceOf[^]*?3/.test(txt)) log('A: genesis minted (balanceOf==3)')
  else note('A: genesis balance wrong: ' + txt.slice(-120))

  // global using-for on-chain: cardKeyOf(1) returns a bytes32
  txt = await call(cards, 'cardKeyOf', 1)
  if (/cardKeyOf[^]*?0x[0-9a-f]{64}/i.test(txt)) log('A: cardKeyOf(1) returns bytes32 (global using-for works on-chain)')
  else note('A: cardKeyOf output odd: ' + txt.slice(-140))
  txt = await call(cards, 'tokenURI', 2)
  const m = txt.match(/data:application\/json;base64,([A-Za-z0-9+/=]+)/)
  if (m && Buffer.from(m[1], 'base64').toString('utf8').includes('Guan Yu')) log('A: tokenURI(2) decodes via the library pipeline (Guan Yu)')
  else note('A: tokenURI odd')

  // ---------------- B: deploy the pavilion with the cards address
  await openFile('PeachPavilion.sol')
  await compileCurrent('PeachPavilion')
  await page.locator('#icon-panel div[plugin="udapp"]').click()
  await page.locator('#runTabView select[class^="contractNames"]').selectOption('PeachPavilion')
  const diag2 = await page.evaluate(() => Array.from(document.querySelectorAll('#runTabView input')).slice(0, 8).map((e) => e.placeholder || e.title || e.name || '(bare)'))
  log('B: deploy-area inputs: ' + JSON.stringify(diag2))
  const ctorInput = page.locator('#runTabView input[placeholder*="cardContract"], #runTabView input[title*="cardContract"]').first()
  if (await ctorInput.isVisible().catch(() => false)) await ctorInput.fill(cardsAddr)
  else {
    note('B: constructor input not found by placeholder/title — using the input nearest Deploy')
    await page.locator('#runTabView button[data-id="Deploy - transact (not payable)"]').first().locator('xpath=preceding::input[1]').fill(cardsAddr)
  }
  await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
  await page.waitForTimeout(2500)
  const instances = page.locator('.instance')
  if (await instances.count() < 2) { note('B: pavilion instance missing'); throw new Error('no pavilion') }
  const pav = instances.nth(1)
  await pav.locator('[data-id="universalDappUiTitleExpander"]').click()
  const pavAddr = await grabDeployedAddr('PeachPavilion')
  log('B: pavilion deployed at ' + pavAddr)

  // ---------------- C: gift flow — approve, deposit for heir
  await call(cards, 'approve', pavAddr + ', 3', 2000)
  await call(pav, 'depositGift', '3, ' + heir, 2500)
  txt = await call(cards, 'ownerOf', 3)
  if (txt.toLowerCase().includes(pavAddr.toLowerCase().slice(0, 20))) log('C: card #3 held in escrow by the pavilion')
  else note('C: escrow ownership odd: ' + txt.slice(-140))

  // wrong claimer first: the giver tries to claim — custom error must surface
  const journalBefore = await page.evaluate(() => (document.querySelector('#journal') || {}).innerText || '')
  await call(pav, 'claimGift', 3, 2500)
  const journalAfter = await page.evaluate(() => (document.querySelector('#journal') || {}).innerText || '')
  const delta = journalAfter.slice(journalBefore.length)
  if (/NotDesignatedHeir/.test(delta)) log('C: wrong-claimer revert DECODED to the custom error name — excellent')
  else if (/revert|errored|failed/i.test(delta)) note('C: wrong-claimer reverted but the custom error was NOT decoded by name (raw revert only) — terminal shows: ' + delta.trim().split('\n').slice(-3).join(' | ').slice(0, 200))
  else note('C: wrong-claimer claim did not visibly fail?!')

  // switch to the heir and claim properly
  await page.locator('#runTabView #txorigin').selectOption(heir)
  await page.waitForTimeout(800)
  await call(pav, 'claimGift', 3, 2500)
  txt = await call(cards, 'ownerOf', 3)
  if (txt.toLowerCase().includes(heir.toLowerCase().slice(0, 20))) log('C: heir claimed card #3 — cross-account escrow round-trip complete')
  else note('C: post-claim owner odd: ' + txt.slice(-140))
  await page.locator('#runTabView #txorigin').selectOption(lord)
  await page.screenshot({ path: SCRATCH + '/p6-c-escrow.png' })

  // ---------------- D: corrected flatten — main root, freshly compiled
  await openFile('ThreeRealmsCards.sol')
  await compileCurrent('ThreeRealmsCards')
  await page.locator('#icon-panel div[plugin="contractVerification"]').click()
  await page.waitForTimeout(1200)
  await page.locator('[data-id="contractVerificationFlatten"]').click()
  await page.waitForTimeout(2500)
  const flat = await page.locator('[data-id="contractVerificationFlattenText"]').inputValue().catch(async () =>
    await page.locator('[data-id="contractVerificationFlattenText"]').innerText().catch(() => ''))
  const fromMain = /Flattened by TronIDE from contracts\/ThreeRealmsCards\.sol/.test(flat)
  const structCount = (flat.match(/struct Card/g) || []).length
  const usingCount = (flat.match(/using \{ cardKey \} for Card global/g) || []).length
  log(`D: flatten target=main:${fromMain} len=${flat.length} structCard×${structCount} globalUsing×${usingCount}`)
  if (!fromMain || structCount !== 1 || usingCount !== 1) note('D: flatten of the 7-file graph is off (see counts above)')
  else fs.writeFileSync(REPO + '/exports/ThreeRealmsCards_flat.sol', flat)

  // ---------------- E: precise 0.8.6 error capture
  await page.locator('#icon-panel div[plugin="solidity"]').click()
  const v086 = await page.evaluate(() => {
    const sel = document.querySelector('#versionSelector')
    const o = sel && Array.from(sel.options).find((x) => x.value.includes('0.8.6+'))
    return o ? o.value : ''
  })
  if (v086) {
    await page.locator('#versionSelector').selectOption(v086)
    await page.waitForTimeout(4000)
    await page.locator('[data-id="compilerContainerCompileBtn"]').click()
    await page.waitForTimeout(6000)
    const err = await page.evaluate(() => {
      const els = document.querySelectorAll('.remixui_errorBlobs, [data-id="compiledErrors"], .alert-danger, .error')
      for (const el of els) { const t = (el.innerText || '').trim(); if (t) return t }
      return ''
    })
    if (/requires different compiler version|pragma/i.test(err)) log('E: 0.8.6 pragma error surfaced clearly: "' + err.slice(0, 160).replace(/\s+/g, ' ') + '"')
    else note('E: 0.8.6 error rendering unclear: "' + err.slice(0, 200).replace(/\s+/g, ' ') + '"')
    await page.locator('#versionSelector').selectOption(v0820)
    await page.waitForTimeout(3000)
  }

  await ctx.close()
  console.log('NOTES-BEGIN'); notes.forEach((x) => console.log('- ' + x)); console.log('NOTES-END')
  console.log('P6C-OK')
})().catch((e) => { console.error('P6C-FAIL', e); process.exit(1) })
