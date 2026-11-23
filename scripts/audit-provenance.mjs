#!/usr/bin/env node
/**
 * audit-provenance.mjs — the provenance density/repetition/placement harness
 * (issue #480).
 *
 * Renders real fiche pages (Vite dev server + headless Chrome, the #449 loop)
 * and measures every SOURCE/VINTAGE fragment per theme tab: its rendered
 * height, absolute position, owning subgroup/figure, plus verbatim-repetition
 * groups and the proportion of the fiche occupied by provenance material.
 * Diagnostic only — it writes reports under docs/audits/ and touches no
 * production copy, no payload contract.
 *
 * Usage:
 *   node scripts/audit-provenance.mjs                      # full panel below
 *   node scripts/audit-provenance.mjs --no-serve           # external server
 *   node scripts/audit-provenance.mjs --base http://127.0.0.1:5199 \
 *        --out docs/audits --territoires commune:35238 epci:243500139 \
 *        --themes mobilite milieux --largeur 1440
 *
 * Prerequisites: Node ≥ 20, Chrome at the standard path (or $CHROME_PATH).
 * With --serve (default) the script starts `npm run dev` in app/ itself
 * (port 5199, strictPort) and stops it afterwards — ONE repeatable command.
 * It never reads pipeline/data and never runs R.
 */

import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CHROME =
  process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

/** The representative panel (#449 panel carried over): one métropole commune,
 *  one rural commune, one EPCI (rural), one EPCI (métropole), one département,
 *  the région — now across the six post-#408 themes (programmes first). */
const TERRITOIRES_DEFAUT = [
  { id: '35238', nom: 'Rennes' },
  { id: '22001', nom: 'L’Allineuc' },
  { id: '200067460', nom: 'Loudéac Communauté – Bretagne Centre' },
  { id: '243500139', nom: 'Rennes Métropole' },
  { id: '35', nom: 'Ille-et-Vilaine' },
  { id: '53', nom: 'Bretagne' },
]

const THEMES_DEFAUT = [
  'programmes',
  'demographie',
  'mobilite',
  'habitat',
  'economie',
  'milieux',
]

const PORT_SERVEUR = 5199
const BASE_DEFAUT = `http://127.0.0.1:${PORT_SERVEUR}`
const HARNESSE = '__audit-harness.html'

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parserCli(argv) {
  const opts = {
    base: BASE_DEFAUT,
    out: resolve('docs/audits'),
    territoires: null,
    themes: null,
    largeur: 1440,
    budget: 20_000,
    serve: true,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--base') opts.base = argv[++i]
    else if (a === '--out') opts.out = resolve(argv[++i])
    else if (a === '--budget') opts.budget = Number(argv[++i])
    else if (a === '--largeur') opts.largeur = Number(argv[++i])
    else if (a === '--no-serve') opts.serve = false
    else if (a === '--serve') opts.serve = true
    else if (a === '--territoires') {
      opts.territoires = []
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        const [type, id] = argv[++i].split(':')
        opts.territoires.push({ id, nom: id, type })
      }
    } else if (a === '--themes') {
      opts.themes = []
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) opts.themes.push(argv[++i])
    }
  }
  return opts
}

// ---------------------------------------------------------------------------
// Dev server lifecycle (--serve)
// ---------------------------------------------------------------------------

/** Un serveur de dev peut n'écouter qu'une pile (vite lie localhost → ::1
 *  possible sur Windows) : sonder IPv4 ET IPv6 avant de conclure au port libre,
 *  sinon un serveur déjà vivant passe pour un port libre et le redémarrage
 *  échoue sur strictPort. */
function portEcoute(base) {
  const url = new URL(base)
  const port = Number(url.port) || 80
  const hotes = [...new Set([url.hostname, '127.0.0.1', '::1'])]
    .filter((h) => h !== 'localhost')
  return Promise.all(
    hotes.map(
      (hote) =>
        new Promise((resoudre) => {
          const s = connect({ host: hote, port }, () => {
            s.destroy()
            resoudre(true)
          })
          s.on('error', () => resoudre(false))
        }),
    ),
  ).then((resultats) => resultats.some(Boolean))
}

function attendre(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Vite lie `localhost` — sur Windows Node peut ne servir que ::1, rendant
 * http://127.0.0.1 mort bien qu'un serveur tourne. Si la base bouclée ne
 * répond pas mais que l'autre pile oui, basculer la base (Chrome et le fetch
 * de territoires.json suivent). Une base non-bouclée est respectée telle quelle.
 */
async function assurerBaseJoignable(base) {
  const url = new URL(base)
  const boucles = ['127.0.0.1', '::1']
  if (!boucles.includes(url.hostname)) return base
  const repond = async (u) => {
    try {
      const r = await fetch(new URL('/data/territoires.json', u))
      return r.ok
    } catch {
      return false
    }
  }
  if (await repond(url)) return base
  // NB : le setter `.hostname` refuse silencieusement de changer de famille
  // d'adresse (IPv4 ↔ IPv6) — construire l'origine alternative en chaîne.
  const suffixe = url.port ? `:${url.port}` : ''
  const altOrigine = url.hostname === '127.0.0.1' ? `http://[::1]${suffixe}` : `http://127.0.0.1${suffixe}`
  if (await repond(altOrigine)) {
    console.log(`→ ${base} ne répond pas mais ${altOrigine} oui — base basculée`)
    return altOrigine
  }
  throw new Error(`ni ${url.origin} ni ${altOrigine} ne servent /data/territoires.json`)
}

/** Start `npm run dev` in app/ and resolve once the port answers. */
async function demarrerServeur(base) {
  if (await portEcoute(base)) {
    console.log(`✓ un serveur écoute déjà sur ${base} — réutilisé (aucun démarrage)`)
    return null
  }
  console.log(`→ démarrage du serveur de dev sur ${base} …`)
  const journal = openSync(join(tmpdir(), 'lusk-audit-dev.log'), 'a')
  // Windows : un .cmd exige un interpréteur (Node ≥ 18.20 refuse sinon) ;
  // taskkill /T déracine l'arbre npm→vite à l'arrêt.
  const enfant = spawn(
    process.platform === 'win32' ? 'cmd.exe' : 'npm',
    process.platform === 'win32'
      ? ['/d', '/s', '/c', `npm run dev -- --port=${PORT_SERVEUR} --strictPort`]
      : ['run', 'dev', '--', `--port=${PORT_SERVEUR}`, '--strictPort'],
    {
      cwd: resolve('app'),
      stdio: ['ignore', journal, journal],
      windowsVerbatimArguments: process.platform === 'win32',
    },
  )
  for (let i = 0; i < 120; i++) {
    if (enfant.exitCode !== null) {
      throw new Error(`le serveur de dev s'est arrêté (code ${enfant.exitCode}) — voir %TEMP%\\lusk-audit-dev.log`)
    }
    if (await portEcoute(base)) {
      console.log('✓ serveur prêt')
      return enfant
    }
    await attendre(500)
  }
  throw new Error('le serveur de dev n’a répondu à temps')
}

function arreterServeur(enfant) {
  if (!enfant || enfant.exitCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(enfant.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    enfant.kill('SIGTERM')
  }
}

// ---------------------------------------------------------------------------
// Headless Chrome rendering through the generated harness page
// ---------------------------------------------------------------------------

/**
 * The harness page: an iframe loads the REAL fiche route (same origin), waits
 * for its wait-set gate to clear, freezes animations, measures, and prints the
 * result as JSON into <pre id="sortie"> — which `chrome --dump-dom` captures.
 * Generated here so the committed tooling stays one file.
 */
const HTML_HARNESSE = `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><title>harnais</title>
<style>html,body{margin:0;padding:0;background:#fff}iframe{border:0;display:block}</style>
</head>
<body>
<iframe id="cadre" title="fiche"></iframe>
<pre id="sortie">AUDIT_EN_COURS</pre>
<script>
(function () {
  var q = new URLSearchParams(location.search)
  var cible = q.get('cible')
  var largeur = Number(q.get('w') || '1440')
  var cadre = document.getElementById('cadre')
  cadre.style.width = largeur + 'px'
  cadre.style.height = '40000px'
  var t0 = Date.now()

  function pret(doc) {
    if (!doc) return false
    var contenu = doc.querySelector('.fiche-contenu')
    if (!contenu) return false
    if (doc.querySelector('.fiche-chargement-contenu')) return false
    if (doc.querySelector('.etat-erreur') || doc.querySelector('.etat-vide')) return 'erreur'
    // au moins une couture de provenance doit être posée (ou 10 s virtuelles écoulées)
    var coutures = doc.querySelectorAll('.estampille-vintage,.lecture-source,.programme-vintage,.subvention-vintage,.estampille-snapshot')
    return coutures.length > 0 || Date.now() - t0 > 10000
  }

  function mesurer(win) {
    var doc = win.document
    var rectAbs = function (el) {
      var r = el.getBoundingClientRect()
      return { h: Math.round(r.height * 10) / 10, top: Math.round(r.top + win.scrollY) }
    }
    var coutures = [
      ['vintage-figure', '.estampille-vintage'],
      ['source-lecture', '.lecture-source'],
      ['estampille-snapshot', '.estampille-snapshot'],
      ['vintage-programme', '.programme-vintage'],
      ['vintage-subvention', '.subvention-vintage'],
      ['provenance-subvention', '.subvention-provenance'],
      ['fraicheur-pied', '.pied-fraicheur']
    ]
    var fragments = []
    coutures.forEach(function (paire) {
      var role = paire[0], sel = paire[1]
      doc.querySelectorAll(sel).forEach(function (el) {
        var g = rectAbs(el)
        var section = el.closest('section[data-groupe]')
        var carte = el.closest('[data-clef]')
        fragments.push({
          role: role,
          texte: el.textContent.replace(/\\s+/g, ' ').trim(),
          hauteur: g.h,
          haut: g.top,
          groupe: section ? section.getAttribute('data-groupe') : null,
          clef: carte ? carte.getAttribute('data-clef') : null,
          dansCarte: !!el.closest('.carte-figure')
        })
      })
    })
    // le contexte : chaque figure de la grille et chaque sous-groupe
    var figures = []
    doc.querySelectorAll('[data-clef]').forEach(function (el) {
      if (!el.closest('.grille-indicateurs')) return
      var g = rectAbs(el)
      figures.push({
        clef: el.getAttribute('data-clef'),
        hauteur: g.h,
        haut: g.top,
        avecVintage: !!el.querySelector('.estampille-vintage')
      })
    })
    var sections = []
    doc.querySelectorAll('section[data-groupe]').forEach(function (el) {
      var g = rectAbs(el)
      sections.push({ groupe: el.getAttribute('data-groupe'), hauteur: g.h, haut: g.top })
    })
    var corps = doc.querySelector('.fiche-corps')
    var contenu = doc.querySelector('.fiche-contenu')
    var badges = doc.querySelectorAll('.programme-badge').length
    return {
      hauteurPage: doc.documentElement.scrollHeight,
      hauteurCorps: corps ? Math.round(corps.getBoundingClientRect().height) : null,
      hauteurContenu: contenu ? Math.round(contenu.getBoundingClientRect().height) : null,
      nbSousGroupes: sections.length,
      nbFigures: figures.length,
      nbBadges: badges,
      sections: sections,
      figures: figures,
      fragments: fragments
    }
  }

  function terminer(doc, statut) {
    var resultat = { statut: statut }
    try { resultat = Object.assign(resultat, mesurer(cadre.contentWindow)) } catch (e) { resultat.erreurMesure = String(e) }
    document.getElementById('sortie').textContent = 'AUDIT_JSON:' + JSON.stringify(resultat)
  }

  cadre.addEventListener('load', function () {
    var tick = function () {
      var doc
      try { doc = cadre.contentDocument } catch (e) { doc = null }
      var etat = pret(doc)
      if (etat === 'erreur') { terminer(doc, 'erreur'); return }
      if (etat) {
        // geler les animations/transitions pour des rectangles stables, laisser
        // les polices et les canvas se poser un battement, puis mesurer.
        try {
          var st = doc.createElement('style')
          st.textContent = '*{animation:none!important;transition:none!important}'
          doc.head.appendChild(st)
        } catch (e) {}
        setTimeout(function () { terminer(doc, 'ok') }, 1200)
        return
      }
      if (Date.now() - t0 > 15000) { terminer(doc, 'timeout'); return }
      setTimeout(tick, 100)
    }
    setTimeout(tick, 150)
  })

  cadre.src = cible
})()
</script>
</body></html>`

function rendreChrome(url, budget, profil, largeur) {
  const r = spawnSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--force-device-scale-factor=1',
      `--window-size=${largeur + 40},1400`,
      `--user-data-dir=${profil}`,
      `--virtual-time-budget=${budget}`,
      '--timeout=90000',
      '--dump-dom',
      url,
    ],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 180_000 },
  )
  if (r.error && r.error.code !== undefined && r.stdout === '') throw r.error
  return r.stdout ?? ''
}

// ---------------------------------------------------------------------------
// HTML → text helpers (same discipline as audit-prose.mjs)
// ---------------------------------------------------------------------------

function decoderEntites(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function extraireJson(dom) {
  const m = dom.match(/<pre id="sortie">([\s\S]*?)<\/pre>/i)
  if (!m) return { statut: 'sans-sortie' }
  const brut = decoderEntites(m[1])
  const j = brut.indexOf('AUDIT_JSON:')
  if (j === -1) return { statut: brut.trim() === 'AUDIT_EN_COURS' ? 'en-cours' : 'sans-marqueur' }
  try {
    return JSON.parse(brut.slice(j + 'AUDIT_JSON:'.length))
  } catch (e) {
    return { statut: 'json-invalide', detail: String(e) }
  }
}

// ---------------------------------------------------------------------------
// Aggregation — repetition groups and page-level shares
// ---------------------------------------------------------------------------

/** Collapse the DATES of a stamp so « INSEE — X · 2023 · réf. D · publ. D »
 *  groups with itself across fiches; the identity (source·version) remains. */
function clefRepetition(texte) {
  return texte
    .replace(/\d{1,2}\s[\p{L}.]+\s\d{4}/gu, 'D')
    .replace(/\s+/g, ' ')
    .trim()
}

function agregerPage(page) {
  const frag = page.fragments ?? []
  const onglet = frag.filter((f) => f.role !== 'fraicheur-pied')
  const pied = frag.filter((f) => f.role === 'fraicheur-pied')

  const hauteurParRole = {}
  for (const f of frag) hauteurParRole[f.role] = Math.round(((hauteurParRole[f.role] ?? 0) + f.hauteur) * 10) / 10

  // verbatim repetition WITHIN the tab (identical normalized text, same role)
  const groupes = new Map()
  for (const f of onglet) {
    const clef = `${f.role}::${clefRepetition(f.texte)}`
    if (!groupes.has(clef)) groupes.set(clef, { role: f.role, exemple: f.texte, n: 0, hauteurUnite: f.hauteur })
    groupes.get(clef).n += 1
  }
  const repetitions = [...groupes.values()]
    .filter((g) => g.n > 1)
    .map((g) => ({
      role: g.role,
      exemple: g.exemple,
      n: g.n,
      hauteurUnite: g.hauteurUnite,
      gachisPx: Math.round((g.n - 1) * g.hauteurUnite * 10) / 10,
    }))
    .sort((a, b) => b.gachisPx - a.gachisPx)

  const hauteurProvenanceOnglet = Math.round(onglet.reduce((s, f) => s + f.hauteur, 0) * 10) / 10
  const hauteurCorps = page.hauteurCorps ?? null
  return {
    ...page,
    agregats: {
      nbFragmentsProvenance: onglet.length,
      hauteurProvenanceOnglet,
      partDuCorps: hauteurCorps ? Math.round((hauteurProvenanceOnglet / hauteurCorps) * 1000) / 10 : null,
      hauteurParRole,
      repetitions,
      gachisTotalPx: Math.round(repetitions.reduce((s, r) => s + r.gachisPx, 0) * 10) / 10,
    },
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function principal() {
  const opts = parserCli(process.argv.slice(2))
  const territoires = opts.territoires ?? TERRITOIRES_DEFAUT
  const themes = opts.themes ?? THEMES_DEFAUT

  const cheminHarnesse = join(resolve('app'), HARNESSE)
  writeFileSync(cheminHarnesse, HTML_HARNESSE)

  let serveur = null
  const profil = join(tmpdir(), `lusk-audit-provenance-${Date.now()}`)
  mkdirSync(profil, { recursive: true })

  try {
    if (opts.serve) serveur = await demarrerServeur(opts.base)
    opts.base = await assurerBaseJoignable(opts.base)

    // Resolve each territoire's real type from the committed reference table.
    const rep = await fetch(`${opts.base}/data/territoires.json`).then((r) => r.json())
    const inventaire = []
    for (const territoire of territoires) {
      const ref = rep.find((x) => x.territoire === territoire.id)
      if (!ref) throw new Error(`territoire inconnu dans territoires.json : ${territoire.id}`)
      for (const theme of themes) {
        const cible = `/territoire/${ref.type}/${territoire.id}?theme=${theme}`
        const url = `${opts.base}/${HARNESSE}?cible=${encodeURIComponent(cible)}&w=${opts.largeur}`
        process.stdout.write(`→ ${territoire.id} · ${theme} … `)
        const dom = rendreChrome(url, opts.budget, profil, opts.largeur)
        const mesure = extraireJson(dom)
        mesure.statut === 'ok'
          ? console.log(`${(mesure.fragments ?? []).length} fragments de provenance`)
          : console.log(`STATUT ${mesure.statut}`)
        inventaire.push(agregerPage({ territoire: territoire.id, nom: ref.nom, type: ref.type, theme, url: cible, largeur: opts.largeur, ...mesure }))
      }
    }

    // Cross-panel repetition: the same stamp text recurring ACROSS fiches.
    const global = new Map()
    for (const p of inventaire) {
      for (const f of p.fragments ?? []) {
        if (f.role === 'fraicheur-pied') continue
        const clef = `${clefRepetition(f.texte)}`
        if (!global.has(clef)) global.set(clef, { exemple: f.texte, roles: new Set(), n: 0, pages: new Set() })
        const g = global.get(clef)
        g.n += 1
        g.roles.add(f.role)
        g.pages.add(`${p.territoire}/${p.theme}`)
      }
    }
    const repetitionsGlobales = [...global.values()]
      .map((g) => ({ exemple: g.exemple, n: g.n, nbPages: g.pages.size, roles: [...g.roles].join('+') }))
      .sort((a, b) => b.n - a.n)

    mkdirSync(opts.out, { recursive: true })
    writeFileSync(
      join(opts.out, 'provenance-inventory.json'),
      JSON.stringify({ panneau: { territoires, themes, largeur: opts.largeur }, pages: inventaire, repetitionsGlobales }, null, 2),
    )

    // Readable summary
    const md = [
      '# Inventaire de la provenance rendue (audit #480)',
      '',
      `_Généré par \`node scripts/audit-provenance.mjs\` contre ${opts.base} — largeur ${opts.largeur}px._`,
      '',
      '| territoire | thème | fig. | frag. | px provenance | corps px | part | gâchis répétition |',
      '|---|---|---|---|---|---|---|---|',
    ]
    for (const p of inventaire) {
      md.push(
        `| ${p.territoire} ${p.nom} | ${p.theme} | ${p.nbFigures ?? '—'} | ${p.agregats?.nbFragmentsProvenance ?? '—'} | ${p.agregats?.hauteurProvenanceOnglet ?? '—'} | ${p.hauteurCorps ?? '—'} | ${p.agregats?.partDuCorps ?? '—'} % | ${p.agregats?.gachisTotalPx ?? '—'} px |`,
      )
    }
    md.push('', '## Répétitions par page (verbatim, même onglet)', '')
    for (const p of inventaire) {
      const reps = p.agregats?.repetitions ?? []
      if (reps.length === 0) continue
      md.push(`### ${p.territoire} — ${p.theme}`, '')
      for (const r of reps) md.push(`- **×${r.n}** [${r.role}] (${r.hauteurUnite}px/u, gâchis ${r.gachisPx}px) \`${r.exemple.slice(0, 160)}\``)
      md.push('')
    }
    md.push('## Répétitions globales du panneau (même chaîne, fiches différentes)', '')
    for (const r of repetitionsGlobales.filter((x) => x.n > 3).slice(0, 40)) {
      md.push(`- **×${r.n}** sur ${r.nbPages} pages [${r.roles}] \`${r.exemple.slice(0, 160)}\``)
    }
    writeFileSync(join(opts.out, 'provenance-inventory.md'), md.join('\n'))

    console.log(`\n✓ ${inventaire.length} pages → ${join(opts.out, 'provenance-inventory.{json,md}')}`)
  } finally {
    arreterServeur(serveur)
    rmSync(profil, { recursive: true, force: true })
    rmSync(cheminHarnesse, { force: true })
  }
}

principal().catch((e) => {
  console.error(e)
  process.exit(1)
})
