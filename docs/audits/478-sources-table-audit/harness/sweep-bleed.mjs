// Sweep ciblé : à quelles largeurs la page /sources déborde-t-elle sa coquille,
// et quel élément est le plus à droite ? (la table /methodologie en témoin)
// Le run 2 persiste les mesures : evidence/sweep-bleed.json (le run 1 ne
// les loggeait qu'en console — rien à committer).
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9779
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

const profil = await mkdtemp(path.join(tmpdir(), 'lusk-sweep-'))
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profil}`,
  '--no-first-run', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' })

const LARGEURS = [320, 340, 360, 375, 390, 420, 480, 560, 640, 700, 768, 820, 900, 1024, 1100, 1280, 1440, 1920]

try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break } catch { await sommeil(250) } }
  const cible = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
  const cdp = await Cdp.connecter(cible.webSocketDebuggerUrl)
  await cdp.envoyer('Page.enable'); await cdp.envoyer('Network.enable'); await cdp.envoyer('Network.setCacheDisabled', { cacheDisabled: true })

  const naviguer = async (chemin, pret) => {
    await cdp.envoyer('Page.navigate', { url: 'http://127.0.0.1:4173' + chemin })
    for (let i = 0; i < 150; i++) { await sommeil(150)
      const ok = await cdp.envoyer('Runtime.evaluate', { expression: `(()=>{try{return Boolean(${pret})}catch{return false}})()`, returnByValue: true }).catch(() => null)
      if (ok?.result?.value) return }
    throw new Error('jamais prêt ' + chemin)
  }

  const mesures = []
  for (const w of LARGEURS) {
    await cdp.envoyer('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 700 })
    await naviguer('/sources', `document.querySelectorAll('article.source-record').length > 0`)
    const s = await cdp.envoyer('Runtime.evaluate', { expression: `(() => {
      const doc = document.documentElement
      const coquille = document.querySelector('.page')
      let maxRight = 0, pire = '', pireTexte = ''
      for (const el of document.querySelectorAll('.sources-page *')) {
        const r = el.getBoundingClientRect()
        if (r.width && r.right > maxRight) { maxRight = r.right; pire = el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]; pireTexte = el.textContent.replace(/\\s+/g,' ').trim().slice(0,60) }
      }
      const coquilleRight = Math.round(coquille.getBoundingClientRect().right)
      return { scroll: doc.scrollWidth, client: doc.clientLeft ? doc.clientWidth : 0, coquilleDroite: coquilleRight, maxRight: Math.round(maxRight), pire, pireTexte,
        debordementCoquille: Math.round(maxRight - coquilleRight) }
    })()`, returnByValue: true })
    const v = s.result.value
    mesures.push({ largeur: w, page: 'sources', ...v })
    console.log(`w=${String(w).padStart(4)}  sources  scrollDoc=${v.scroll} coquilleDroite=${v.coquilleDroite} maxDroite=${v.maxRight} (${v.pire}) débordeCoquilleDe=${v.debordementCoquille}px  « ${v.pireTexte} »`)

    if ([768, 1024, 1440].includes(w)) {
      await naviguer('/methodologie?onglet=sources&section=mobilite', `document.querySelectorAll('#panneau-sources table.sources-tableau tbody tr').length > 0`)
      const m = await cdp.envoyer('Runtime.evaluate', { expression: `(() => {
        const doc = document.documentElement
        const table = document.querySelector('table.sources-tableau')
        const coquille = document.querySelector('.methodologie__panneau')
        return { scroll: doc.scrollWidth, tableW: Math.round(table.getBoundingClientRect().width), coquilleW: Math.round(coquille.getBoundingClientRect().width),
          deborde: Math.round(table.getBoundingClientRect().right - coquille.getBoundingClientRect().right) }
      })()`, returnByValue: true })
      const mv = m.result.value
      mesures.push({ largeur: w, page: 'methodes-mobilite', ...mv })
      console.log(`        methodes-mobilite  scrollDoc=${mv.scroll} table=${mv.tableW}px coquille=${mv.coquilleW}px tableDébordeCoquille=${mv.deborde}px`)
    }
  }
  const sortie = path.resolve(process.argv[2] ?? 'docs/audits/478-sources-table-audit/evidence/sweep-bleed.json')
  await mkdir(path.dirname(sortie), { recursive: true })
  await writeFile(sortie, JSON.stringify(mesures, null, 2))
  console.log(`Sweep écrit dans ${sortie}`)
  await cdp.envoyer('Target.closeTarget', { targetId: cible.id }).catch(() => {})
  cdp.ws.close()
} finally { chrome.kill(); await rm(profil, { recursive: true, force: true }).catch(() => {}) }
