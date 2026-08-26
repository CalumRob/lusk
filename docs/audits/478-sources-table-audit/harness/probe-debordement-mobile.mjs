// Sonde ponctuelle (rapport #478) : à 340px, QUEL descendant de la première
// carte /sources porte la largeur qui déborde ? Le serveur preview (4173)
// doit tourner — l'appelant le démarre et l'arrête.
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9781
const sommeil = (ms) => new Promise((r) => setTimeout(r, ms))

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.map = new Map()
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data)
      if (m.id && this.map.has(m.id)) { const { res, rej } = this.map.get(m.id); this.map.delete(m.id)
        m.error ? rej(new Error(m.error.message)) : res(m.result) } }) }
  static async connecter(url) { const ws = new WebSocket(url)
    await new Promise((ok, ko) => { ws.addEventListener('open', ok, { once: true }); ws.addEventListener('error', ko, { once: true }) })
    return new Cdp(ws) }
  envoyer(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((res, rej) => { this.map.set(id, { res, rej }); setTimeout(() => { if (this.map.has(id)) { this.map.delete(id); rej(new Error('timeout ' + method)) } }, 20000) }) }
}

const profil = await mkdtemp(path.join(tmpdir(), 'lusk-sonde-'))
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profil}`,
  '--no-first-run', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' })
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break } catch { await sommeil(250) } }
  const cible = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
  const cdp = await Cdp.connecter(cible.webSocketDebuggerUrl)
  await cdp.envoyer('Emulation.setDeviceMetricsOverride', { width: 340, height: 800, deviceScaleFactor: 1, mobile: true })
  await cdp.envoyer('Page.navigate', { url: 'http://127.0.0.1:4173/sources' })
  for (let i = 0; i < 120; i++) { await sommeil(250)
    const pret = await cdp.envoyer('Runtime.evaluate', { expression: `document.querySelectorAll('article.source-record').length > 0`, returnByValue: true }).catch(() => null)
    if (pret?.result?.result?.value) break }
  await sommeil(200)
  const r = await cdp.envoyer('Runtime.evaluate', { returnByValue: true, expression: `(() => {
    const carte = document.querySelector('article.source-record')
    const chaine = []
    let el = carte
    while (el && el !== document.body) {
      const cs = getComputedStyle(el)
      chaine.push({ sel: el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0],
        right: Math.round(el.getBoundingClientRect().right), width: Math.round(el.getBoundingClientRect().width),
        minW: cs.minWidth, padR: cs.paddingRight, ws: cs.whiteSpace, display: cs.display })
      el = el.parentElement
    }
    let pire = null, maxR = 0
    for (const d of carte.querySelectorAll('*')) { const rr = d.getBoundingClientRect(); if (rr.width && rr.right > maxR) { maxR = rr.right; pire = d } }
    const cs = pire ? getComputedStyle(pire) : null
    return { chaine: chaine.reverse(),
      pire: pire ? { sel: pire.tagName.toLowerCase() + '.' + String(pire.className).split(' ').join('.'), right: Math.round(maxR),
        texte: pire.textContent.replace(/\\s+/g,' ').trim().slice(0,50), minW: cs.minWidth, ws: cs.whiteSpace, display: cs.display } : null }
  })()` })
  console.log(JSON.stringify(r.result.value, null, 1))
  await cdp.envoyer('Target.closeTarget', { targetId: cible.id }).catch(() => {})
  cdp.ws.close()
} finally { chrome.kill(); await rm(profil, { recursive: true, force: true }).catch(() => {}) }
