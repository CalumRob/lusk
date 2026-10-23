// Sonde ponctuelle : anatomie d'une carte source (hauteurs par section) + sweep de largeurs.
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9778
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
    return new Promise((res, rej) => { this.map.set(id, { res, rej }); setTimeout(() => { if (this.map.has(id)) { this.map.delete(id); rej(new Error('timeout ' + method)) } }, 30000) }) }
}

const profil = await mkdtemp(path.join(tmpdir(), 'lusk-probe-'))
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profil}`,
  '--no-first-run', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' })
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break } catch { await sommeil(250) } }
  const cible = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
  const cdp = await Cdp.connecter(cible.webSocketDebuggerUrl)
  await cdp.envoyer('Page.enable'); await cdp.envoyer('Network.enable'); await cdp.envoyer('Network.setCacheDisabled', { cacheDisabled: true })

  // Anatomie de la carte korrigo Ã  375px
  await cdp.envoyer('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true })
  await cdp.envoyer('Page.navigate', { url: 'http://127.0.0.1:4173/sources' })
  for (let i = 0; i < 120; i++) { await sommeil(250)
    const pret = await cdp.envoyer('Runtime.evaluate', { expression: `document.querySelectorAll('article.source-record').length > 0`, returnByValue: true }).catch(() => null)
    if (pret?.result?.result?.value) break }
  await sommeil(200)
  const anatomie = await cdp.envoyer('Runtime.evaluate', { expression: `(() => {
    const carte = document.querySelector('#source-korrigo')
    const parties = [...carte.children].map((el) => ({
      tag: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ').join('.') : ''),
      h: Math.round(el.getBoundingClientRect().height),
      texte: el.textContent.replace(/\\s+/g,' ').trim().slice(0, 90),
    }))
    const dl = carte.querySelector('dl')
    const dts = dl ? [...dl.children].map((el) => ({ tag: el.tagName, h: Math.round(el.getBoundingClientRect().height), t: el.textContent.replace(/\\s+/g,' ').trim().slice(0, 70) })) : []
    return { hauteurCarte: Math.round(carte.getBoundingClientRect().height), parties, dts: dts.slice(0, 14) }
  })()`, returnByValue: true })
  console.log(JSON.stringify(anatomie.result.value, null, 2))

  // Sweep de largeurs : dÃ©bordement horizontal de /sources et de la table /methodologie
  const resultats = []
  for (let w = 320; w <= 1920; w += 20) {
    await cdp.envoyer('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 700 })
    const mesure = async (chemin, pret) => {
      await cdp.envoyer('Page.navigate', { url: 'http://127.0.0.1:4173' + chemin })
      for (let i = 0; i < 120; i++) { await sommeil(200)
        const ok = await cdp.envoyer('Runtime.evaluate', { expression: `(() => { try { return Boolean(${pret}) } catch { return false } })()`, returnByValue: true }).catch(() => null)
        if (ok?.result?.result?.value) break }
      await sommeil(80)
      return cdp.envoyer('Runtime.evaluate', { expression: `(() => {
        const doc = document.documentElement
        const coquille = document.querySelector('.page') || document.querySelector('main') || document.body
        let maxRight = 0, pire = ''
        for (const el of document.querySelectorAll('.page *')) {
          const r = el.getBoundingClientRect()
          if (r.width && r.right > maxRight) { maxRight = r.right; pire = el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0] }
        }
        return { scroll: doc.scrollWidth, client: doc.clientWidth, coquille: Math.round(coquille.getBoundingClientRect().width), maxRight: Math.round(maxRight), pire }
      })()`, returnByValue: true })
    }
    const s = await mesure('/sources', `document.querySelectorAll('article.source-record').length > 0`)
    const m = await mesure('/methodologie?onglet=sources&section=mobilite', `document.querySelectorAll('#panneau-sources table.sources-tableau tbody tr').length > 0`)
    resultats.push({ w, sources: s.result.value, methodes: m.result.value })
    console.log(`w=${w}  sources: scroll=${s.result.value.scroll} shell=${s.result.value.coquille} maxRight=${s.result.value.maxRight} (${s.result.value.pire})  |  methodes: scroll=${m.result.value.scroll} table=${m.result.value.maxRight}`)
  }
  await cdp.envoyer('Target.closeTarget', { targetId: cible.id }).catch(() => {})
  cdp.ws.close()
} finally { chrome.kill(); await rm(profil, { recursive: true, force: true }).catch(() => {}) }

