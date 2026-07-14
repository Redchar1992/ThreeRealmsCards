// P12-B: continuation of p12 — the tally deploy landed on chain (TronLink
// whitelist signed silently) while stale instances fooled the UI checks.
// Resume: attach both contracts At Address, seat the throne, sign, redeem.
// Original plan: 虎符演武 — deploy TigerTally against the live v5 cards, seat it on the
// throne (two-step), have the marshal sign a bearer MintOrder via TronLink's
// typed-data popup, verify the signature encoding LOCALLY against the
// contract's own domainSeparator (chainId recovered by brute-matching), then
// redeem on chain through page-context tronWeb. Zhuge Liang #4 should exist
// when the dust settles.
const fs = require('fs')
const path = require('path')
const { chromium } = require('/Users/tron/Object/trontech/tron-remix/node_modules/@playwright/test')
const { ethers } = require('/Users/tron/Object/tronSmart/ThreeRealmsCards/node_modules/ethers')

const SCRATCH = '/private/tmp/claude-501/-Users-tron-Object-tronSmart-ThreeRealmsCards/7673a2a2-3274-43b4-a714-1dd2ad4e7c0f/scratchpad'
const REPO = '/Users/tron/Object/tronSmart/ThreeRealmsCards'
const ROOT = REPO + '/contracts'
const WS = 'three-realms-v2'
const CARDS_B58 = 'TDQ9k3oqaV1tErua4uft1ZnndV96oFBH4X' // v5
const MARSHAL_HEX = '0x1f960e7e84aaa63ef073b52568cf77a7d5262043' // TCrDi83… as 20-byte
const ZERO_B58 = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'
const TALLY_B58 = 'TMUmN6NKSyvAR6CJq2U8ndsCjXB2Uc7T19' // deployed by p12, tx f3b02d40…
const FILES = [
  'types/CardTypes.sol', 'utils/StrUtils.sol', 'libs/Base64.sol', 'libs/CardCodec.sol',
  'access/Suzerain.sol',
  'interfaces/ITRC165.sol', 'interfaces/ITRC721.sol', 'interfaces/ITRC721Metadata.sol',
  'interfaces/ITRC721Receiver.sol', 'interfaces/IRenderer.sol',
  'render/CardRenderer.sol',
  'PeachPavilion.sol', 'ThreeRealmsCards.sol', 'TigerTally.sol'
]
const ZHUGE = { general: 'Zhuge Liang', faction: 1, rarity: 4, attack: 35, intellect: 100, command: 95, charisma: 92, series: 'Tiger Tally' }
const TYPES = {
  MintOrder: [
    { name: 'to', type: 'address' }, { name: 'card', type: 'Card' },
    { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint64' },
  ],
  Card: [
    { name: 'general', type: 'string' }, { name: 'faction', type: 'uint8' },
    { name: 'rarity', type: 'uint8' }, { name: 'attack', type: 'uint8' },
    { name: 'intellect', type: 'uint8' }, { name: 'command', type: 'uint8' },
    { name: 'charisma', type: 'uint8' }, { name: 'series', type: 'string' },
  ],
}
const notes = []
const log = (m) => console.log('[p12]', m)
const note = (m) => { notes.push(m); console.log('[p12][NOTE]', m) }

const B58A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const b58ToHex20 = (a) => {
  let n = 0n
  for (const ch of a) n = n * 58n + BigInt(B58A.indexOf(ch))
  const hex = n.toString(16).padStart(50, '0') // 25 bytes
  return '0x' + hex.slice(2, 42)
}

const grid = async (body) => {
  const res = await fetch('https://nile.trongrid.io/wallet/triggerconstantcontract', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return res.json()
}
const constCall = async (contract, selector, parameter) => {
  const d = await grid({ owner_address: 'TCrDi83pUoK17GbwxN1SckM3YNXzahWvoN', contract_address: contract, function_selector: selector, parameter: parameter || '', visible: true })
  return (d.constant_result || [''])[0] || ''
}

;(async () => {
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
        const btn = p.locator([
          'button:has-text("Confirm")', 'button:has-text("确认")', 'button:has-text("Accept")',
          'button:has-text("Sign")', 'button[class*="confirm"]', 'div[class*="btn"][class*="confirm"]'
        ].join(', ')).first()
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
  const untilVisible = async (locator, totalMs, label) => {
    const deadline = Date.now() + totalMs
    while (Date.now() < deadline) {
      if (await locator.isVisible().catch(() => false)) return
      await deOverlay(); await tryConfirmPopup()
      await page.waitForTimeout(2000)
    }
    throw new Error('timeout waiting for ' + label)
  }
  const rowIn = (inst, fn) => inst
    .locator('div[class*="contractProperty"]')
    .filter({ has: page.locator('button', { hasText: new RegExp('^' + fn + '$') }) })
    .first()
  const call = async (inst, fn, arg, waitMs) => {
    await deOverlay()
    const r = rowIn(inst, fn)
    if (arg !== undefined) await r.locator('input').first().fill(String(arg), { force: true })
    await r.locator('button').first().click({ force: true })
    const deadline = Date.now() + (waitMs || 3000)
    while (Date.now() < deadline) { await tryConfirmPopup(); await page.waitForTimeout(1000) }
    return (await inst.innerText()).replace(/\s+/g, ' ')
  }
  const nodeOf = (p) => page.locator(`[data-id="treeViewLitreeViewItem${p}"]`)
  const compileUntil = async (marker) => {
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await page.waitForTimeout(1000)
    await deOverlay()
    await page.locator('[data-id="compilerContainerCompileBtn"]').click({ force: true })
    let listed = ''
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(2000)
      listed = (await page.locator('[data-id="compiledContracts"]').innerText().catch(() => '')) || ''
      if (marker.test(listed)) return
      if (i === 20) { await deOverlay(); await page.locator('[data-id="compilerContainerCompileBtn"]').click({ force: true }).catch(() => {}) }
    }
    throw new Error('compile never matched ' + marker + ': ' + listed.slice(0, 120))
  }

  // ---------------- ensure the TigerTally graph is compiled (At Address
  // needs the artifact); the tree may or may not show the file post-HMR
  if (!await page.locator('[data-id="filePanelFileExplorerTree"]').isVisible().catch(() => false)) {
    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    await page.waitForTimeout(1200)
  }
  const file = nodeOf('contracts/TigerTally.sol')
  const folder = nodeOf('contracts')
  for (let r = 0; r < 20; r++) {
    if (await file.isVisible().catch(() => false)) { await file.click({ force: true }); break }
    if (await folder.isVisible().catch(() => false)) { await folder.click({ force: true }).catch(() => {}); await page.waitForTimeout(1200) }
    await page.waitForTimeout(800)
    if (r === 19) throw new Error('could not open TigerTally.sol')
  }
  await page.waitForTimeout(800)
  await compileUntil(/TigerTally/)
  log('TigerTally graph compiled (artifact ready)')

  // ---------------- injected env + fee limit
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
  if (!/^T/.test(account)) throw new Error('injected account unavailable')
  log('account: ' + account)
  await page.locator('#gasLimit').fill('1000000000')

  const tallyAddr = TALLY_B58
  fs.writeFileSync(SCRATCH + '/p12-tally-addr.txt', tallyAddr)

  // ---------------- attach the tally At Address
  await page.locator('#runTabView select[class^="contractNames"]').selectOption('TigerTally')
  await page.locator('#runTabView input[class*="ataddressinput"]').fill(tallyAddr)
  await page.locator('#runTabView button:has-text("At Address")').click({ force: true })
  await page.waitForTimeout(2500)

  // ---------------- attach cards v5 At Address

  await page.locator('#runTabView select[class^="contractNames"]').selectOption('ThreeRealmsCards')
  await page.locator('#runTabView input[class*="ataddressinput"]').fill(CARDS_B58)
  await page.locator('#runTabView button:has-text("At Address")').click({ force: true })
  await page.waitForTimeout(2500)
  // instance titles show TRUNCATED addresses (journal P6: no data-id carries
  // the full address) — match the ellipsis form too
  const instFor = async (marker) => {
    const short = marker.slice(0, 5) + '...' + marker.slice(-5)
    const n = await page.locator('.instance').count()
    for (let i = 0; i < n; i++) {
      const inst = page.locator('.instance').nth(i)
      const txt = await inst.evaluate((el) => el.textContent).catch(() => '')
      if (txt.includes(marker) || txt.includes(short)) return inst
    }
    throw new Error('instance not found for ' + marker + ' (' + short + ')')
  }
  const tallyInst = await instFor(tallyAddr)
  const cardsInst = await instFor(CARDS_B58)
  for (const inst of [tallyInst, cardsInst]) {
    if (!await inst.locator('div[class*="contractProperty"]').first().isVisible().catch(() => false)) {
      await inst.locator('[data-id="universalDappUiTitleExpander"]').click({ force: true })
      await page.waitForTimeout(600)
    }
  }
  log('cards v5 attached At Address')

  // ---------------- seat the tally: pass + accept (skip if already seated)
  const tallyHexPre = b58ToHex20(tallyAddr)
  const seatedAlready = (await constCall(CARDS_B58, 'suzerain()')).endsWith(tallyHexPre.slice(2))
  if (seatedAlready) log('throne already seated — skipping pass/accept')
  else {
  log('passSuzerainty(tally) — auto-confirming…')
  await call(cardsInst, 'passSuzerainty', tallyAddr, 8000)
  log('acceptSuzerainty() via tally — auto-confirming…')
  await call(tallyInst, 'acceptSuzerainty', undefined, 8000)
  let seated = false
  for (let i = 0; i < 20; i++) {
    const res = await constCall(CARDS_B58, 'suzerain()')
    if (res.endsWith(tallyHexPre.slice(2))) { seated = true; break }
    await new Promise((r) => setTimeout(r, 3000))
  }
  if (!seated) throw new Error('tally never became suzerain on chain')
  }
  log('CHAIN CHECK: cards.suzerain() == tally — the throne is seated')

  // ---------------- recover the true chainId from the chain's own separator
  const sepOnChain = '0x' + (await constCall(tallyAddr, 'domainSeparator()'))
  const candidates = [3448148188, 728126428, 2494104990, 1, 11111]
  let chainId = 0
  for (const c of candidates) {
    const h = ethers.TypedDataEncoder.hashDomain({ name: 'Three Realms Tiger Tally', version: '1', chainId: c, verifyingContract: tallyHexPre })
    if (h === sepOnChain) { chainId = c; break }
  }
  if (!chainId) throw new Error('could not match domainSeparator to any candidate chainId: ' + sepOnChain)
  log('chainId recovered from domainSeparator: ' + chainId)

  // ---------------- marshal signs the bearer tally (TronLink typed data)
  const deadline = Math.floor(Date.now() / 1000) + 7 * 86400
  const orderForDigest = { to: '0x' + '0'.repeat(40), card: ZHUGE, nonce: 1, deadline }
  const canonicalDigest = ethers.TypedDataEncoder.hash(
    { name: 'Three Realms Tiger Tally', version: '1', chainId, verifyingContract: tallyHexPre },
    TYPES, orderForDigest
  )
  const digestOnChain = '0x' + (await constCall(tallyAddr, 'digestOf((address,(string,uint8,uint8,uint8,uint8,uint8,uint8,string),uint256,uint64))',
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['tuple(address,tuple(string,uint8,uint8,uint8,uint8,uint8,uint8,string),uint256,uint64)'],
      [[orderForDigest.to, [ZHUGE.general, ZHUGE.faction, ZHUGE.rarity, ZHUGE.attack, ZHUGE.intellect, ZHUGE.command, ZHUGE.charisma, ZHUGE.series], orderForDigest.nonce, orderForDigest.deadline]]
    ).slice(2)))
  if (digestOnChain !== canonicalDigest) throw new Error(`digest mismatch: chain ${digestOnChain} vs local ${canonicalDigest}`)
  log('digest cross-checked: chain == ethers encoder')

  const variants = [
    { label: 'base58 addrs', domainAddr: tallyAddr, to: ZERO_B58 },
    { label: '0x addrs', domainAddr: tallyHexPre, to: '0x' + '0'.repeat(40) },
    { label: 'mixed', domainAddr: tallyAddr, to: '0x' + '0'.repeat(40) },
  ]
  let signature = ''
  for (const variant of variants) {
    log(`signTypedData attempt (${variant.label}) — auto-confirming TronLink…`)
    const signPromise = page.evaluate(async ({ domainAddr, to, card, nonce, deadline, chainId, types }) => {
      const tw = window.tronWeb
      return tw.trx._signTypedData(
        { name: 'Three Realms Tiger Tally', version: '1', chainId, verifyingContract: domainAddr },
        types, { to, card, nonce, deadline }
      )
    }, { domainAddr: variant.domainAddr, to: variant.to, card: ZHUGE, nonce: 1, deadline, chainId, types: TYPES }).catch((e) => ({ err: String(e).slice(0, 160) }))
    for (let i = 0; i < 20; i++) { if (await tryConfirmPopup()) break; await page.waitForTimeout(1000) }
    const res = await signPromise
    if (typeof res === 'string' && /^0x[0-9a-fA-F]{130}$/.test(res)) {
      const recovered = ethers.recoverAddress(canonicalDigest, res).toLowerCase()
      if (recovered === MARSHAL_HEX.toLowerCase()) { signature = res; log('signature verified locally (' + variant.label + ')'); break }
      note(`variant ${variant.label}: recovered ${recovered}, not the marshal — trying next`)
    } else {
      note(`variant ${variant.label}: signTypedData failed: ${JSON.stringify(res).slice(0, 160)}`)
    }
  }
  if (!signature) throw new Error('no signing variant produced a marshal-valid signature')
  fs.writeFileSync(SCRATCH + '/p12-signature.txt', signature)

  // ---------------- redeem via page tronWeb (tuple params beat the UI input)
  const artifact = JSON.parse(fs.readFileSync(REPO + '/artifacts/contracts/TigerTally.sol/TigerTally.json', 'utf8'))
  log('redeem(order, sig) — auto-confirming TronLink…')
  const redeemPromise = page.evaluate(async ({ abi, addr, order, sig }) => {
    const tw = window.tronWeb
    const c = await tw.contract(abi, addr)
    const tx = await c.redeem(order, sig).send({ feeLimit: 1_000_000_000 })
    return typeof tx === 'string' ? tx : JSON.stringify(tx).slice(0, 100)
  }, {
    abi: artifact.abi, addr: tallyAddr,
    order: ['410000000000000000000000000000000000000000',
      [ZHUGE.general, ZHUGE.faction, ZHUGE.rarity, ZHUGE.attack, ZHUGE.intellect, ZHUGE.command, ZHUGE.charisma, ZHUGE.series],
      1, deadline],
    sig: signature,
  }).catch((e) => ({ err: String(e).slice(0, 240) }))
  for (let i = 0; i < 30; i++) { if (await tryConfirmPopup()) break; await page.waitForTimeout(1000) }
  const redeemRes = await redeemPromise
  if (redeemRes && redeemRes.err) { note('redeem send error: ' + redeemRes.err); throw new Error('redeem failed') }
  log('redeem tx: ' + redeemRes)

  // ---------------- chain verification
  let minted = 0
  for (let i = 0; i < 30; i++) {
    minted = parseInt((await constCall(CARDS_B58, 'totalMinted()')) || '0', 16)
    if (minted >= 4) break
    await new Promise((r) => setTimeout(r, 3000))
  }
  if (minted < 4) throw new Error('totalMinted never reached 4 (got ' + minted + ')')
  const owner4 = await constCall(CARDS_B58, 'ownerOf(uint256)', '4'.padStart(64, '0'))
  const broken = parseInt(await constCall(tallyAddr, 'tallyBroken(uint256)', '1'.padStart(64, '0')), 16)
  log(`CHAIN CHECK: totalMinted==${minted}, ownerOf(4) tail==${owner4.slice(-8)}, tallyBroken(1)==${broken}`)
  await page.screenshot({ path: SCRATCH + '/p12-redeemed.png' })

  console.log('TALLY_ADDR=' + tallyAddr)
  await browser.close().catch(() => {})
  console.log('NOTES-BEGIN'); notes.forEach((x) => console.log('- ' + x)); console.log('NOTES-END')
  console.log('P12-OK')
})().catch((e) => { console.error('P12-FAIL', e); process.exit(1) })
