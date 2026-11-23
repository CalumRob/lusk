/**
 * Audit #478 — boucle Chrome déterministe sur la page Sources actuelle
 * (origin/main), la table Méthodes historique (touche routée sur
 * /methodologie) et deux Pages d'indicateur (l'autre surface à fiches de
 * source), chacune aux vues par défaut ET « L'indicateur » (?vue=indicateur —
 * là où les .source-card s'ancrent). Aucune modification du code de
 * production : la boucle pilote le build existant par CDP (Chrome DevTools
 * Protocol), mesure le débordement horizontal (document ET coquille de
 * contenu — le run 1 ne mesurait que le scroll document et ratait le
 * dépassement interne), les longueurs pathologiques (cartes/cellules/fiches)
 * et dump les associations rendues (jeu ← consommateurs) pour comparaison
 * avec l'autorité publiée (theme_*.json).
 *
 * Usage :
 *   node docs/audits/478-sources-table-audit/harness/audit-sources.mjs \
 *        --url http://127.0.0.1:4173 --out docs/audits/478-sources-table-audit/evidence
 *
 * Déterminisme : largeurs fixes, attente par sondage du sélecteur prêt (pas de
 * délai magique), cache réseau désactivé, un profil Chrome jetable par run,
 * screenshots pleine page. Le même binaire + le même build ⇒ les mêmes sorties.
 */
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CDP_PORT = 9777

/** Les largeurs de l'audit — mobile, md, demi-desktop (lg), desktop, wide. */
const LARGEURS = [
  { slug: 'mobile', largeur: 375, hauteur: 812, mobile: true },
  { slug: 'md-768', largeur: 768, hauteur: 1024, mobile: false },
  { slug: 'half-desktop-1024', largeur: 1024, hauteur: 768, mobile: false },
  { slug: 'desktop-1440', largeur: 1440, hauteur: 900, mobile: false },
  { slug: 'wide-1920', largeur: 1920, hauteur: 1080, mobile: false },
]

/** Les pages auditées — l'actuelle, l'ancienne table, deux Pages d'indicateur. */
const PAGES = [
  { slug: 'sources', url: '/sources', pret: `document.querySelectorAll('article.source-record').length > 0` },
  { slug: 'methodes-mobilite', url: '/methodologie?onglet=sources&section=mobilite', pret: `document.querySelectorAll('#panneau-sources table.sources-tableau tbody tr').length > 0` },
  { slug: 'methodes-demographie', url: '/methodologie?onglet=sources&section=demographie', pret: `document.querySelectorAll('#panneau-sources table.sources-tableau tbody tr').length > 0` },
  { slug: 'methodes-habitat', url: '/methodologie?onglet=sources&section=habitat', pret: `document.querySelectorAll('#panneau-sources table.sources-tableau tbody tr').length > 0` },
  { slug: 'methodes-economie', url: '/methodologie?onglet=sources&section=economie', pret: `document.querySelectorAll('#panneau-sources table.sources-tableau tbody tr').length > 0` },
  { slug: 'methodes-milieux', url: '/methodologie?onglet=sources&section=milieux', pret: `document.querySelectorAll('#panneau-sources table.sources-tableau tbody tr').length > 0` },
  { slug: 'indicateur-conso-enaf', url: '/indicateurs/milieux/conso_enaf_annuel', pret: `Boolean(document.querySelector('.source-card')) || Boolean(document.querySelector('h1'))` },
  { slug: 'indicateur-tot-loss', url: '/indicateurs/mobilite/tot_loss_t', pret: `Boolean(document.querySelector('.source-card')) || Boolean(document.querySelector('h1'))` },
  // Les MÊMES pages sur la vue « L'indicateur » (?vue=indicateur) — c'est LÀ que
  // vivent les fiches de source embarquées (.source-card, la couture #398) ;
  // la vue par défaut Repères n'en monte aucune (premier run : fiches vides).
  { slug: 'indicateur-conso-enaf-lindicateur', url: '/indicateurs/milieux/conso_enaf_annuel?vue=indicateur', pret: `document.querySelectorAll('.source-card').length > 0` },
  { slug: 'indicateur-tot-loss-lindicateur', url: '/indicateurs/mobilite/tot_loss_t?vue=indicateur', pret: `document.querySelectorAll('.source-card').length > 0` },
]

const sommeil = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Le JS évalué dans la page — métriques de mise en page + dump des associations rendues. */
const JS_AUDIT = `(() => {
  const doc = document.documentElement
  const innerW = window.innerWidth
  const debordants = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0) continue
    if (r.right > innerW + 1 || r.left < -1) {
      const sel = el.tagName.toLowerCase()
        + (el.classList.length ? '.' + [...el.classList].slice(0, 3).join('.') : '')
      debordants.push({ sel, left: Math.round(r.left), right: Math.round(r.right) })
    }
  }
  // dédupliquer (les ancêtres débordent avec leurs enfants)
  const uniques = new Map()
  for (const d of debordants) { if (!uniques.has(d.sel)) uniques.set(d.sel, d) }

  const cartes = [...document.querySelectorAll('article.source-record')].map((carte) => {
    const consommateurs = [...carte.querySelectorAll('.source-record__consumers li')].map((li) => ({
      label: li.querySelector('a')?.textContent?.trim() ?? '',
      theme: li.querySelector('span')?.textContent?.replace(/^\\s*·\\s*/, '').trim() ?? '',
      href: li.querySelector('a')?.getAttribute('href') ?? null,
    }))
    return {
      ancre: carte.id,
      jeu: carte.querySelector('h2')?.textContent?.trim() ?? '',
      editeur: carte.querySelector('.source-record__publisher')?.textContent?.trim() ?? '',
      caveat: carte.querySelector('.source-record__caveat')?.textContent?.trim() ?? null,
      horloges: carte.querySelectorAll('.source-record__clocks dt').length,
      millésimesRendus: carte.querySelectorAll('.source-record__vintages li').length,
      replie: !carte.querySelector('.source-record__vintages li'),
      consommateurs,
      hauteurPx: Math.round(carte.getBoundingClientRect().height),
      libelleConsommateurMax: Math.max(0, ...consommateurs.map((c) => c.label.length)),
    }
  })

  // L'ancienne table (/methodologie) — lignes de jeu + cellules matrice.
  const lignes = [...document.querySelectorAll('table.sources-tableau tbody tr')].map((tr) => {
    const matrice = tr.querySelectorAll('.matrice-indicateurs .matrice-indicateur')
    return {
      classe: tr.className,
      nom: tr.querySelector('.cellule-source')?.textContent?.trim() ?? '',
      nomLen: (tr.querySelector('.cellule-source')?.textContent?.trim() ?? '').length,
      themes: [...tr.querySelectorAll('.puce-theme')].map((p) => p.textContent.trim()),
      indicateurs: [...matrice].map((m) => m.textContent.trim()),
      hauteurLignePx: Math.round(tr.getBoundingClientRect().height),
      hauteurCelluleIndicateurs: matrice.length ? Math.round(tr.querySelector('.matrice-indicateurs').getBoundingClientRect().height) : null,
    }
  })
  const table = document.querySelector('table.sources-tableau')
  const conteneur = document.querySelector('.methodologie__panneau')

  // Les fiches de source d'une Page d'indicateur (L'indicateur).
  const fichesIndicateur = [...document.querySelectorAll('.source-card')].map((fiche) => ({
    jeu: fiche.querySelector('h3')?.textContent?.trim() ?? '',
    texte: fiche.textContent.replace(/\s+/g, ' ').trim().slice(0, 400),
    hauteurPx: Math.round(fiche.getBoundingClientRect().height),
    millésimesRendus: fiche.querySelectorAll('ul li').length,
  }))

  // Le débordement de COQUILLE (le contenu qui dépasse la largeur du contenu
  // de la page, même quand le document ne scrolle pas — la mesure du run 1 ne
  // voyait que le scroll document). Le pire descendant de .page vs son bord droit.
  const coquilleEl = document.querySelector('.page')
  const coquilleDroite = coquilleEl ? Math.round(coquilleEl.getBoundingClientRect().right) : null
  let maxDroiteContenu = 0
  let pireContenu = ''
  for (const el of document.querySelectorAll('.page *')) {
    const r = el.getBoundingClientRect()
    if (r.width && r.right > maxDroiteContenu) {
      maxDroiteContenu = r.right
      pireContenu = el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]
    }
  }

  // Les têtes de section fantômes : « Millésimes et fraîcheur » rendu sans
  // aucune ligne (le h3 est inconditionnel, les li portent v-if="!replie").
  const sectionsMilimesVides = [...document.querySelectorAll('.source-record__vintages')].filter((ul) => ul.children.length === 0).length

  return {
    viewport: { innerWidth, innerHeight: window.innerHeight },
    scrollLargeurDoc: doc.scrollWidth,
    clientLargeurDoc: doc.clientWidth,
    debordementHorizontal: doc.scrollWidth - doc.clientWidth,
    coquilleDroite,
    maxDroiteContenu: Math.round(maxDroiteContenu),
    pireContenu,
    debordementCoquille: coquilleDroite === null ? null : Math.round(maxDroiteContenu - coquilleDroite),
    sectionsMilimesVides,
    debordants: [...uniques.values()].slice(0, 25),
    hauteurPagePx: Math.round(document.body.scrollHeight),
    nbCartesSource: cartes.length,
    cartes,
    nbLignesTable: lignes.length,
    lignes,
    tableLargeurPx: table ? Math.round(table.getBoundingClientRect().width) : null,
    conteneurLargeurPx: conteneur ? Math.round(conteneur.getBoundingClientRect().width) : null,
    fichesIndicateur,
    titrePage: document.querySelector('h1')?.textContent?.trim() ?? null,
    url: location.pathname + location.search,
  }
})()`

class Cdp {
  constructor(ws, id) {
    this.ws = ws
    this.id = id
    this.enAttente = new Map()
    ws.addEventListener('message', (evt) => {
      const msg = JSON.parse(evt.data)
      if (msg.id && this.enAttente.has(msg.id)) {
        const { resolve, reject } = this.enAttente.get(msg.id)
        this.enAttente.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      }
    })
  }
  static async connecter(wsUrl) {
    const ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', () => reject(new Error('WebSocket CDP refusé')), { once: true })
    })
    return new Cdp(ws, 0)
  }
  envoyer(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.enAttente.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.enAttente.has(id)) {
          this.enAttente.delete(id)
          reject(new Error(`CDP timeout: ${method}`))
        }
      }, 30000)
    })
  }
  fermer() { this.ws.close() }
}

async function jsonCdp(chemin, methode = 'GET') {
  const reponse = await fetch(`http://127.0.0.1:${CDP_PORT}${chemin}`, { method: methode })
  if (!reponse.ok) throw new Error(`${methode} ${chemin} → HTTP ${reponse.status}`)
  return reponse.json()
}

async function attendreChrome() {
  for (let i = 0; i < 60; i++) {
    try { return await jsonCdp('/json/version') } catch { await sommeil(250) }
  }
  throw new Error('Chrome DevTools injoignable sur le port ' + CDP_PORT)
}

async function evaluer(cdp, expression) {
  const resultat = await cdp.envoyer('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (resultat.exceptionDetails) throw new Error(`Exception page : ${JSON.stringify(resultat.exceptionDetails)}`)
  return resultat.result.value
}

async function auditerPage(base, page, largeur, dossierEvidence) {
  const cibles = await jsonCdp('/json/new?about:blank', 'PUT')
  const cdp = await Cdp.connecter(cibles.webSocketDebuggerUrl)
  const dossier = path.join(dossierEvidence, `${page.slug}--${largeur.slug}`)
  await mkdir(dossier, { recursive: true })
  try {
    await cdp.envoyer('Network.enable')
    await cdp.envoyer('Network.setBypassServiceWorker', { bypass: true })
    await cdp.envoyer('Network.setCacheDisabled', { cacheDisabled: true })
    await cdp.envoyer('Emulation.setDeviceMetricsOverride', {
      width: largeur.largeur, height: largeur.hauteur, deviceScaleFactor: 1, mobile: largeur.mobile,
    })
    await cdp.envoyer('Page.enable')
    await cdp.envoyer('Page.navigate', { url: base + page.url })
    let pret = false
    for (let i = 0; i < 120; i++) {
      await sommeil(250)
      try {
        pret = await evaluer(cdp, `(function(){ try { return Boolean(${page.pret}) } catch { return false } })()`)
      } catch { pret = false }
      if (pret) break
    }
    if (!pret) throw new Error(`Page jamais prête : ${page.url} @${largeur.slug}`)
    await sommeil(150) // laisser finir le dernier paint après le sélecteur
    const metriques = await evaluer(cdp, JS_AUDIT)
    const capture = await cdp.envoyer('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    await writeFile(path.join(dossier, 'metrics.json'), JSON.stringify({ page: page.url, largeur: largeur.largeur, ...metriques }, null, 2))
    await writeFile(path.join(dossier, 'shot.png'), Buffer.from(capture.data, 'base64'))
    return metriques
  } finally {
    await cdp.envoyer('Target.closeTarget', { targetId: cibles.id }).catch(() => {})
    cdp.fermer()
  }
}

async function main() {
  const args = process.argv.slice(2)
  const option = (nom, defaut) => {
    const i = args.indexOf(`--${nom}`)
    return i >= 0 ? args[i + 1] : defaut
  }
  const base = option('url', 'http://127.0.0.1:4173')
  const dossierEvidence = path.resolve(option('out', 'docs/audits/478-sources-table-audit/evidence'))
  await mkdir(dossierEvidence, { recursive: true })
  const profil = await mkdtemp(path.join(tmpdir(), 'lusk-audit-chrome-'))

  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profil}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--hide-scrollbars', '--mute-audio', '--window-size=1400,900',
    'about:blank',
  ], { stdio: 'ignore' })
  try {
    await attendreChrome()
    const resume = {}
    for (const page of PAGES) {
      for (const largeur of LARGEURS) {
        const m = await auditerPage(base, page, largeur, dossierEvidence)
        resume[`${page.slug} @${largeur.slug}`] = {
          debordementHorizontal: m.debordementHorizontal,
          debordementCoquille: m.debordementCoquille,
          sectionsMilimesVides: m.sectionsMilimesVides,
          debordants: m.debordants.length,
          hauteurPagePx: m.hauteurPagePx,
          nbCartesSource: m.nbCartesSource,
          nbLignesTable: m.nbLignesTable,
          nbFichesIndicateur: m.fichesIndicateur.length,
          maxHauteurFicheIndicateur: Math.max(0, ...m.fichesIndicateur.map((f) => f.hauteurPx)),
          maxHauteurCarte: Math.max(0, ...m.cartes.map((c) => c.hauteurPx)),
          maxIndicateursCellule: Math.max(0, ...m.lignes.map((l) => l.indicateurs.length)),
          maxHauteurCelluleIndicateurs: Math.max(0, ...m.lignes.map((l) => l.hauteurCelluleIndicateurs ?? 0)),
        }
        console.log(`✓ ${page.slug} @${largeur.slug} — bleed=${m.debordementHorizontal}px cartes=${m.nbCartesSource} lignes=${m.nbLignesTable}`)
      }
    }
    await writeFile(path.join(dossierEvidence, 'summary.json'), JSON.stringify(resume, null, 2))
    console.log(`\nRésumé écrit dans ${path.join(dossierEvidence, 'summary.json')}`)
  } finally {
    chrome.kill()
    await rm(profil, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
