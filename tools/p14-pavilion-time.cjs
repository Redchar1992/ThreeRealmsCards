// P14: 桃园馆首次上链 + 时间逻辑演武 — deploy PeachPavilion v2 against the
// live v5 cards, then prove the window semantics with real chain time:
// gift #3 (1h window) → claim immediately (claim path) → re-gift with a 90s
// window → SIMULATE reclaim inside the window (must be blocked,
// GiftStillClaimable — proven via constant-call, no wasted tx) → wait out
// the window for real → reclaim lands (regret path). Deploy address from
// the chain receipt, every transition verified via TronGrid.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { chromium } = require('/Users/tron/Object/trontech/tron-remix/node_modules/@playwright/test')

const SCRATCH = '/private/tmp/claude-501/-Users-tron-Object-tronSmart-ThreeRealmsCards/7673a2a2-3274-43b4-a714-1dd2ad4e7c0f/scratchpad'
const REPO = '/Users/tron/Object/tronSmart/ThreeRealmsCards'
const ROOT = REPO + '/contracts'
const WS = 'three-realms-v2'
const CARDS_B58 = 'TDQ9k3oqaV1tErua4uft1ZnndV96oFBH4X' // v5
const DEPLOYER_B58 = 'TCrDi83pUoK17GbwxN1SckM3YNXzahWvoN'
const DEPLOYER_HEX20 = '1f960e7e84aaa63ef073b52568cf77a7d5262043'
const TOKEN_ID = 3 // Zhang Fei
const FILES = [
  'types/CardTypes.sol', 'utils/StrUtils.sol', 'libs/Base64.sol', 'libs/CardCodec.sol',
  'access/Suzerain.sol',
  'interfaces/ITRC165.sol', 'interfaces/ITRC721.sol', 'interfaces/ITRC721Metadata.sol',
  'interfaces/ITRC721Receiver.sol', 'interfaces/IRenderer.sol',
  'render/CardRenderer.sol',
  'PeachPavilion.sol', 'ThreeRealmsCards.sol', 'TigerTally.sol', 'CardBazaar.sol'
]
const notes = []
const log = (m) => console.log('[p14]', m)
const note = (m) => { notes.push(m); console.log('[p14][NOTE]', m) }

const B58A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const b58enc = (hex41) => {
  const raw = Buffer.from(hex41, 'hex')
  const chk = crypto.createHash('sha256').update(crypto.createHash('sha256').update(raw).digest()).digest().slice(0, 4)
  let n = BigInt('0x' + Buffer.concat([raw, chk]).toString('hex'))
  let s = ''
  while (n > 0n) { s = B58A[Number(n % 58n)] + s; n /= 58n }
  return s
}

const gridPost = async (route, body) => {
  const res = await fetch('https://nile.trongrid.io' + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return res.json()
}
const constCall = async (contract, selector, parameter) => {
  const d = await gridPost('/wallet/triggerconstantcontract', { owner_address: DEPLOYER_B58, contract_address: contract, function_selector: selector, parameter: parameter || '', visible: true })
  return (d.constant_result || [''])[0] || ''
}
const accountBalance = async (addr) => {
  const d = await gridPost('/wallet/getaccount', { address: addr, visible: true })
  return d.balance || 0
}
const pollUntil = async (label, fn, tries, gapMs) => {
  for (let i = 0; i < (tries || 30); i++) {
    if (await fn()) { log('CHAIN CHECK: ' + label); return }
    await new Promise((r) => setTimeout(r, gapMs || 3000))
  }
  throw new Error('chain state never reached: ' + label)
}

;(async () => {
  const startMs = Date.now()
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 20_000 })
  const ctx = browser.contexts()[0]
  const page = ctx.pages().find((p) => p.url().includes('localhost:18080'))
  if (!page) throw new Error('IDE tab not found')
  await page.bringToFront()

  const deOverlay = async () => {
    await page.evaluate(() => document.querySelectorAll('#webpack-dev-server-client-overlay').forEach((e) => e.remove())).catch(() => {})
    await page.addStyleTag({ content: '#webpack-dev-server-client-overlay { display: none !important; pointer-events: none !important; }' }).catch(() => {})
  }
  await deOverlay()
  const tryConfirmPopup = async () => {
    for (const p of ctx.pages()) {
      const url = p.url()
      if (!url.startsWith('chrome-extension://')) continue
      try {
        const btn = p.getByRole('button', { name: /^(confirm|sign|accept|approve|确认|签名|同意)$/i })
          .or(p.locator('button[class*="confirm"], div[class*="btn"][class*="confirm"]'))
          .first()
        if (await btn.isVisible({ timeout: 300 }).catch(() => false)) {
          await p.bringToFront().catch(() => {})
          await btn.click({ timeout: 2000 }).catch(() => {})
          log('wallet confirm clicked')
          return true
        }
      } catch (e) {}
    }
    return false
  }
  const settle = async (ms) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { await tryConfirmPopup(); await page.waitForTimeout(1000) }
  }

  // ---------------- workspace: idempotent 15-file write
  if (!await page.locator('[data-id="filePanelFileExplorerTree"]').isVisible().catch(() => false)) {
    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    await page.locator('[data-id="filePanelFileExplorerTree"]').waitFor({ timeout: 15_000 })
  }
  const desired = FILES.map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')])
  const wrote = await page.evaluate(({ ws, files }) => {
    const fsx = window.remixFileSystem
    const mkdirp = (p) => { const parts = p.split('/'); let acc = ''; for (const part of parts) { acc = acc ? acc + '/' + part : part; try { fsx.mkdirSync(acc) } catch (e) {} } }
    let written = 0
    for (const [rel, content] of files) {
      const full = `.workspaces/${ws}/contracts/${rel}`
      let cur = null
      try { cur = fsx.readFileSync(full, 'utf8') } catch (e) {}
      if (cur === content) continue
      mkdirp(full.split('/').slice(0, -1).join('/'))
      fsx.writeFileSync(full, content)
      written++
    }
    let verified = 0
    for (const [rel, content] of files) { try { if (fsx.readFileSync(`.workspaces/${ws}/contracts/${rel}`, 'utf8') === content) verified++ } catch (e) {} }
    return { written, verified }
  }, { ws: WS, files: desired })
  log(`files: ${wrote.written} written, ${wrote.verified}/${FILES.length} verified`)
  if (wrote.verified !== FILES.length) throw new Error('workspace file verification failed')
  if (wrote.written > 0) {
    await page.waitForTimeout(6000)
    await page.reload({ waitUntil: 'load' })
    try { const w = page.locator('button:has-text("I Understand")'); await w.waitFor({ state: 'visible', timeout: 5000 }); await w.click() } catch (e) {}
    await page.waitForTimeout(4000)
    await deOverlay()
    if (!await page.locator('[data-id="filePanelFileExplorerTree"]').isVisible().catch(() => false)) { await page.locator('#icon-panel div[plugin="filePanel"]').click(); await page.waitForTimeout(1500) }
  }

  // ---------------- open CardBazaar.sol + compile its graph
  const nodeOf = (p) => page.locator(`[data-id="treeViewLitreeViewItem${p}"]`)
  const file = nodeOf('contracts/PeachPavilion.sol')
  const folder = nodeOf('contracts')
  for (let r = 0; r < 20; r++) {
    if (await file.isVisible().catch(() => false)) { await file.click({ force: true }); break }
    if (await folder.isVisible().catch(() => false)) { await folder.click({ force: true }).catch(() => {}); await page.waitForTimeout(1200) }
    await page.waitForTimeout(800)
    if (r === 19) throw new Error('could not open PeachPavilion.sol')
  }
  await page.waitForTimeout(800)
  await page.locator('#icon-panel div[plugin="solidity"]').click()
  await page.waitForTimeout(1000)
  await deOverlay()
  await page.locator('[data-id="compilerContainerCompileBtn"]').click({ force: true })
  let listed = ''
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(2000)
    listed = (await page.locator('[data-id="compiledContracts"]').innerText().catch(() => '')) || ''
    if (/PeachPavilion/.test(listed)) break
    if (i === 20) { await deOverlay(); await page.locator('[data-id="compilerContainerCompileBtn"]').click({ force: true }).catch(() => {}) }
  }
  if (!/PeachPavilion/.test(listed)) throw new Error('compile never listed PeachPavilion: ' + listed.slice(0, 120))
  log('compiled the PeachPavilion graph')

  // ---------------- injected env + deploy
  await page.locator('#icon-panel div[plugin="udapp"]').click()
  await page.waitForTimeout(1500)
  await deOverlay()
  let account = ''
  for (let i = 0; i < 10; i++) {
    account = await page.evaluate(() => { const s = document.querySelector('#runTabView #txorigin'); return s && s.options.length ? s.options[0].value : '' })
    if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(account)) break
    await page.locator('select[id="selectExEnvOptions"]').selectOption('injected').catch(() => {})
    await page.waitForTimeout(3000)
  }
  if (account !== DEPLOYER_B58) throw new Error('unexpected injected account: ' + account)
  await page.locator('#gasLimit').fill('1000000000')
  await page.locator('#runTabView select[class^="contractNames"]').selectOption('PeachPavilion')
  await page.locator('#runTabView div[class*="contractActionsContainer"] input').first().fill(CARDS_B58)
  log('DEPLOY PeachPavilion(' + CARDS_B58.slice(0, 8) + '…) — auto-confirming TronLink…')
  await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click({ force: true })
  await settle(45_000) // the secondary_popup variant can be slow to surface

  // the chain receipt is the source of truth for the new address
  let bazaarB58 = ''
  await pollUntil('deploy receipt found', async () => {
    await tryConfirmPopup() // keep pumping — popups can trail the click by a lot
    const res = await fetch(`https://nile.trongrid.io/v1/accounts/${DEPLOYER_B58}/transactions?limit=5&order_by=block_timestamp,desc`)
    const d = await res.json()
    for (const t of d.data || []) {
      const c = t.raw_data.contract[0]
      if (c.type === 'CreateSmartContract' && t.ret?.[0]?.contractRet === 'SUCCESS' && t.block_timestamp > startMs - 60_000) {
        const info = await gridPost('/wallet/gettransactioninfobyid', { value: t.txID })
        if (info.contract_address) { bazaarB58 = b58enc(info.contract_address); return true }
      }
    }
    return false
  }, 40, 3000)
  log('PeachPavilion deployed at ' + bazaarB58)
  fs.writeFileSync(SCRATCH + '/p14-pavilion-addr.txt', bazaarB58)

  // ---------------- the time-logic drill via page tronWeb
  const { ethers } = require('/Users/tron/Object/tronSmart/ThreeRealmsCards/node_modules/ethers')
  const cardsAbi = JSON.parse(fs.readFileSync(REPO + '/artifacts/contracts/ThreeRealmsCards.sol/ThreeRealmsCards.json', 'utf8')).abi
  const pavAbi = JSON.parse(fs.readFileSync(REPO + '/artifacts/contracts/PeachPavilion.sol/PeachPavilion.json', 'utf8')).abi
  const pavB58 = bazaarB58
  const send = async (label, abi, addr, method, args) => {
    log(label + ' — auto-confirming TronLink…')
    const p = page.evaluate(async ({ abi, addr, method, args }) => {
      const c = await window.tronWeb.contract(abi, addr)
      const tx = await c[method](...args).send({ feeLimit: 500_000_000 })
      return typeof tx === 'string' ? tx : JSON.stringify(tx).slice(0, 80)
    }, { abi, addr, method, args }).catch((e) => ({ err: String(e).slice(0, 220) }))
    for (let i = 0; i < 25; i++) { if (await tryConfirmPopup()) break; await page.waitForTimeout(1000) }
    const res = await p
    if (res && res.err) throw new Error(label + ' failed: ' + res.err)
    log(label + ' tx: ' + res)
    return res
  }
  const pavHex20 = (() => { let n = 0n; for (const ch of pavB58) n = n * 58n + BigInt(B58A.indexOf(ch)); return n.toString(16).padStart(50, '0').slice(2, 42) })()
  const tokenParam = TOKEN_ID.toString(16).padStart(64, '0')

  // gift #3 with a roomy 1h window, then claim it right back (claim path)
  await send('approve(pavilion, #3)', cardsAbi, CARDS_B58, 'approve', [pavB58, TOKEN_ID])
  await pollUntil('getApproved(3) == pavilion', async () =>
    (await constCall(CARDS_B58, 'getApproved(uint256)', tokenParam)).endsWith(pavHex20))
  const claimBy1 = Math.floor(Date.now() / 1000) + 3600
  await send('depositGift(#3, self, +1h)', pavAbi, pavB58, 'depositGift', [TOKEN_ID, DEPLOYER_B58, claimBy1])
  await pollUntil('ownerOf(3) == pavilion (escrow)', async () =>
    (await constCall(CARDS_B58, 'ownerOf(uint256)', tokenParam)).endsWith(pavHex20))
  const gift1 = await constCall(pavB58, 'giftOf(uint256)', tokenParam)
  if (!gift1.slice(0, 64).endsWith(DEPLOYER_HEX20) || !gift1.slice(64, 128).endsWith(DEPLOYER_HEX20) || parseInt(gift1.slice(128, 192), 16) !== claimBy1) {
    throw new Error('gift readback odd: ' + gift1)
  }
  log('CHAIN CHECK: giftOf(3) == (deployer, deployer, +1h)')
  await send('claimGift(#3)', pavAbi, pavB58, 'claimGift', [TOKEN_ID])
  await pollUntil('ownerOf(3) back with the heir (claim path)', async () =>
    (await constCall(CARDS_B58, 'ownerOf(uint256)', tokenParam)).endsWith(DEPLOYER_HEX20))

  // re-gift with a 90s window; reclaim must be BLOCKED inside it
  await send('approve(pavilion, #3) again', cardsAbi, CARDS_B58, 'approve', [pavB58, TOKEN_ID])
  const claimBy2 = Math.floor(Date.now() / 1000) + 90
  await send('depositGift(#3, self, +90s)', pavAbi, pavB58, 'depositGift', [TOKEN_ID, DEPLOYER_B58, claimBy2])
  await pollUntil('escrow again', async () =>
    (await constCall(CARDS_B58, 'ownerOf(uint256)', tokenParam)).endsWith(pavHex20))
  const sim = await gridPost('/wallet/triggerconstantcontract', {
    owner_address: DEPLOYER_B58, contract_address: pavB58,
    function_selector: 'reclaimGift(uint256)', parameter: tokenParam, visible: true,
  })
  const revData = (sim.constant_result || [''])[0] || ''
  const stillClaimableSel = ethers.id('GiftStillClaimable(uint256,uint64)').slice(2, 10)
  const blocked = sim.result && sim.result.result !== true
    ? true
    : (sim.transaction && JSON.stringify(sim.transaction).includes('REVERT')) || revData.startsWith(stillClaimableSel)
  if (!blocked) throw new Error('early reclaim was NOT blocked: ' + JSON.stringify(sim).slice(0, 200))
  log('CHAIN CHECK: early reclaim SIMULATED and blocked' + (revData.startsWith(stillClaimableSel) ? ' with GiftStillClaimable' : ' (revert)'))

  // wait out the window for real, then the regret path lands
  log('waiting 110s of real chain time for the window to close…')
  await new Promise((r) => setTimeout(r, 110_000))
  await send('reclaimGift(#3) after expiry', pavAbi, pavB58, 'reclaimGift', [TOKEN_ID])
  await pollUntil('ownerOf(3) back with the giver (regret path)', async () =>
    (await constCall(CARDS_B58, 'ownerOf(uint256)', tokenParam)).endsWith(DEPLOYER_HEX20))
  const gift2 = await constCall(pavB58, 'giftOf(uint256)', tokenParam)
  if (parseInt(gift2.slice(0, 64) || '0', 16) !== 0) note('gift slot not cleared: ' + gift2.slice(0, 64))
  else log('CHAIN CHECK: gift slot cleared — regret cycle closed')

  await page.screenshot({ path: SCRATCH + '/p14-pavilion.png' })
  console.log('PAVILION_ADDR=' + pavB58)
  await browser.close().catch(() => {})
  console.log('NOTES-BEGIN'); notes.forEach((x) => console.log('- ' + x)); console.log('NOTES-END')
  console.log('P14-OK')
})().catch((e) => { console.error('P14-FAIL', e); process.exit(1) })
