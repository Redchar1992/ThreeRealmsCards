// P7: deploy the NEW 9-file architecture to Nile over the user's Chrome.
// Light workspace three-realms-v2 with the full folder structure written
// directly (9 small .sol files ~15KB — well under the localStorage quota that
// bit the PNG-bearing clone in J-009). Build on 0.8.20 (builtin, no download).
const fs = require('fs')
const path = require('path')
const { chromium } = require('/Users/tron/Object/trontech/tron-remix/node_modules/@playwright/test')

const SCRATCH = '/private/tmp/claude-501/-Users-tron-Object-trontech-tron-remix/607fd892-ece0-473d-8492-66232f2e46ae/scratchpad'
const REPO = '/Users/tron/Object/tronSmart/ThreeRealmsCards'
const ROOT = REPO + '/contracts'
const WS = 'three-realms-v2'
const FILES = [
  'types/CardTypes.sol', 'utils/StrUtils.sol', 'libs/Base64.sol', 'libs/CardCodec.sol',
  'access/Suzerain.sol', 'interfaces/ITRC721.sol', 'interfaces/ITRC721Metadata.sol',
  'PeachPavilion.sol', 'ThreeRealmsCards.sol'
]
const notes = []
const log = (m) => console.log('[p7]', m)
const note = (m) => { notes.push(m); console.log('[p7][NOTE]', m) }

;(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 20_000 })
  const ctx = browser.contexts()[0]
  let page = ctx.pages().find((p) => p.url().includes('localhost:18080'))
  if (!page) { page = await ctx.newPage(); await page.goto('http://localhost:18080/', { waitUntil: 'load', timeout: 120_000 }) }
  await page.bringToFront()
  await page.evaluate(() => document.querySelectorAll('#webpack-dev-server-client-overlay').forEach((e) => e.remove()))
  await page.addStyleTag({ content: '#webpack-dev-server-client-overlay { display: none !important; }' }).catch(() => {})
  try { const w = page.locator('button:has-text("I Understand")'); await w.waitFor({ state: 'visible', timeout: 5000 }); await w.click() } catch (e) {}
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ state: 'attached', timeout: 60_000 })

  // the file panel must be the active side panel before the create icon shows
  if (!await page.locator('[data-id="filePanelFileExplorerTree"]').isVisible().catch(() => false)) {
    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    await page.locator('[data-id="filePanelFileExplorerTree"]').waitFor({ timeout: 15_000 })
  }
  // create or select the v2 workspace
  const opts = await page.evaluate(() => { const s = document.querySelector('select[data-id="workspacesSelect"]'); return s ? Array.from(s.options).map((o) => o.value) : [] })
  if (!opts.includes(WS)) {
    await page.locator('[data-id="workspaceCreate"]').click()
    const nameInput = page.locator('input[data-id="modalDialogCustomPromptTextCreate"]')
    await nameInput.waitFor({ state: 'visible', timeout: 5000 })
    await nameInput.fill(WS)
    await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()
    await page.waitForTimeout(2500)
    log('created workspace ' + WS)
  } else {
    await page.locator('select[data-id="workspacesSelect"]').selectOption(WS)
    await page.waitForTimeout(1500)
    log('selected existing workspace ' + WS)
  }

  // write all 9 files directly (folders auto-created by BrowserFS via nested path)
  const wrote = await page.evaluate(({ ws, files }) => {
    const fsx = window.remixFileSystem
    const mkdirp = (p) => { const parts = p.split('/'); let acc = ''; for (const part of parts) { acc = acc ? acc + '/' + part : part; try { fsx.mkdirSync(acc) } catch (e) {} } }
    let n = 0
    for (const [rel, content] of files) {
      const full = `.workspaces/${ws}/contracts/${rel}`
      mkdirp(full.split('/').slice(0, -1).join('/'))
      fsx.writeFileSync(full, content)
      n++
    }
    return n
  }, { ws: WS, files: FILES.map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]) })
  log('wrote ' + wrote + ' contract files')
  await page.reload({ waitUntil: 'load' }); try { const w = page.locator('button:has-text("I Understand")'); await w.waitFor({ state: 'visible', timeout: 5000 }); await w.click() } catch (e) {}
  await page.waitForTimeout(2500)
  if (!await page.locator('[data-id="filePanelFileExplorerTree"]').isVisible().catch(() => false)) { await page.locator('#icon-panel div[plugin="filePanel"]').click(); await page.waitForTimeout(1200) }

  // open main contract
  const openFile = async (rel) => {
    const parts = ('contracts/' + rel).split('/')
    let acc = ''
    for (let i = 0; i < parts.length; i++) {
      acc = acc ? acc + '/' + parts[i] : parts[i]
      const node = page.locator(`[data-id="treeViewLitreeViewItem${acc}"]`)
      for (let r = 0; r < 5 && !await node.isVisible().catch(() => false); r++) {
        const parent = acc.split('/').slice(0, -1).join('/')
        if (parent) await page.locator(`[data-id="treeViewLitreeViewItem${parent}"]`).click({ force: true }).catch(() => {})
        await page.waitForTimeout(1000)
      }
      if (i === parts.length - 1) await node.click({ force: true })
    }
    await page.waitForTimeout(700)
  }
  await openFile('ThreeRealmsCards.sol')

  // pin 0.8.20 builtin
  await page.locator('#icon-panel div[plugin="solidity"]').click()
  const v0820 = await page.evaluate(() => { const s = document.querySelector('#versionSelector'); const o = s && Array.from(s.options).find((x) => x.value.includes('0.8.20')); return o ? o.value : '' })
  if (v0820 && (await page.locator('#versionSelector').inputValue().catch(() => '')) !== v0820) { await page.locator('#versionSelector').selectOption(v0820); await page.waitForTimeout(4000) }
  await page.locator('[data-id="compilerContainerCompileBtn"]').click()
  await page.locator('[data-id="compiledContracts"]').waitFor({ timeout: 180_000 })
  const compiled = await page.locator('[data-id="compiledContracts"]').innerText()
  if (!/ThreeRealmsCards/.test(compiled)) { note('compile did not produce ThreeRealmsCards: ' + compiled.slice(0, 120)); throw new Error('compile') }
  log('compiled the multi-file graph on ' + v0820)

  // injected env
  await page.locator('#icon-panel div[plugin="udapp"]').click()
  await page.locator('select[id="selectExEnvOptions"]').selectOption('injected')
  await page.waitForTimeout(3000)
  const account = await page.evaluate(() => { const s = document.querySelector('#runTabView #txorigin'); return s && s.options.length ? s.options[0].value : '' })
  if (!account) { note('no injected account — approve TronLink'); throw new Error('no account') }
  log('account: ' + account)

  const grabAddr = async (name) => {
    if (!await page.locator('[data-id="recorderAddressBookEntry"]').first().isVisible().catch(() => false)) {
      const card = page.locator('div[class*="cardContainer"]').filter({ hasText: 'Transactions recorded' })
      await card.locator('i[class*="arrow"]').first().click().catch(() => {})
      await page.waitForTimeout(800)
    }
    return page.evaluate((n) => {
      for (const e of Array.from(document.querySelectorAll('[data-id="recorderAddressBookEntry"]'))) {
        const nm = e.querySelector('[data-id="recorderAddressBookName"]')
        if (nm && nm.innerText.trim() === n) { const ad = e.querySelector('[data-id="recorderAddressBookAddress"]'); return ad ? ad.innerText.trim() : '' }
      }
      return ''
    }, name)
  }

  // deploy cards
  await page.locator('#runTabView select[class^="contractNames"]').selectOption('ThreeRealmsCards')
  log('DEPLOY ThreeRealmsCards — approve in TronLink if prompted…')
  await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
  const cards = page.locator('.instance').first()
  await cards.waitFor({ timeout: 240_000 })
  await cards.locator('[data-id="universalDappUiTitleExpander"]').click()
  const cardsAddr = await grabAddr('ThreeRealmsCards')
  log('cards deployed at ' + cardsAddr)
  fs.writeFileSync(SCRATCH + '/p7-cards-addr.txt', cardsAddr)

  const rowIn = (inst, fn) => inst.locator('div[class*="contractProperty"]', { hasText: fn }).first()
  const call = async (inst, fn, arg, waitMs) => {
    const r = rowIn(inst, fn)
    if (arg !== undefined) await r.locator('input').first().fill(String(arg))
    await r.locator('button').first().click()
    await page.waitForTimeout(waitMs || 3000)
    return (await inst.innerText()).replace(/\s+/g, ' ')
  }

  // genesis + reads
  log('GENESIS mint — approve in TronLink if prompted…')
  await call(cards, 'mintPeachGardenGenesis', account, 5000)
  let ok = false
  for (let i = 0; i < 30; i++) { const t = await call(cards, 'balanceOf', account, 2500); if (/balanceOf[^]*?\b3\b/.test(t)) { ok = true; break } }
  log(ok ? 'GENESIS confirmed on Nile: balanceOf==3' : 'balanceOf not 3 yet')
  if (!ok) note('genesis balance not confirmed')
  const key = await call(cards, 'cardKeyOf', 1, 2500)
  if (/0x[0-9a-f]{64}/i.test(key)) log('cardKeyOf(1) bytes32 on-chain (global using-for)')
  else note('cardKeyOf odd')
  const uri = await call(cards, 'tokenURI', 2, 2500)
  const m = uri.match(/data:application\/json;base64,([A-Za-z0-9+/=]+)/)
  if (m && Buffer.from(m[1], 'base64').toString('utf8').includes('Guan Yu')) log('tokenURI(2) decodes (Guan Yu) on Nile')
  else note('tokenURI odd')
  await page.screenshot({ path: SCRATCH + '/p7-genesis.png' })

  console.log('CARDS_ADDR=' + cardsAddr)
  await browser.close().catch(() => {})
  console.log('NOTES-BEGIN'); notes.forEach((x) => console.log('- ' + x)); console.log('NOTES-END')
  console.log('P7-OK')
})().catch((e) => { console.error('P7-FAIL', e); process.exit(1) })
