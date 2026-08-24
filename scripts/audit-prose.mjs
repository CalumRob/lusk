#!/usr/bin/env node
/**
 * audit-prose.mjs — the editorial prose extraction harness (issue #449).
 *
 * Renders real fiche pages (dev server + headless Chrome) and inventories
 * EVERY rendered text fragment per theme tab, tagged by the seam that owns it
 * (lecture template / payload param / indicator label / rank chip / vintage /
 * snapshot stamp / app copy). The output feeds docs/audits/ reports; it never
 * modifies production copy.
 *
 * Usage:
 *   node scripts/audit-prose.mjs                       # default panel below
 *   node scripts/audit-prose.mjs --base http://localhost:5199 \
 *        --out docs/audits --territoires commune:35238 epci:243500139 \
 *        --themes apercu demographie mobilite
 *
 * Prerequisites: the Vite dev server must be running (app/ → npm run dev),
 * because /data/ is served by its payload middleware. Chrome must be installed
 * at the default path (or $CHROME_PATH).
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CHROME =
  process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

/** The representative panel: one métropole commune, one rural commune,
 *  one EPCI (rural), one EPCI (métropole), one département, the région. */
const TERRITOIRES_DEFAUT = [
  { id: '35238', nom: 'Rennes' },
  { id: '22001', nom: 'L’Allineuc' },
  { id: '200067460', nom: 'Loudéac Communauté – Bretagne Centre' },
  { id: '243500139', nom: 'Rennes Métropole' },
  { id: '35', nom: 'Ille-et-Vilaine' },
  { id: '53', nom: 'Bretagne' },
]

const THEMES_DEFAUT = ['apercu', 'demographie', 'mobilite', 'habitat', 'economie', 'milieux']

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseCli(argv) {
  const opts = {
    base: 'http://localhost:5199',
    out: resolve('docs/audits'),
    territoires: null,
    themes: null,
    budget: 20_000,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--base') opts.base = argv[++i]
    else if (a === '--out') opts.out = resolve(argv[++i])
    else if (a === '--budget') (opts.budget = Number(argv[++i]))
    else if (a === '--territoires') {
      opts.territoires = []
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        const [type, id] = argv[++i].split(':')
        opts.territoires.push({ id, nom: id })
      }
    } else if (a === '--themes') {
      opts.themes = []
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) opts.themes.push(argv[++i])
    }
  }
  return opts
}

// ---------------------------------------------------------------------------
// Headless Chrome rendering
// ---------------------------------------------------------------------------

function portEcoute(base) {
  const url = new URL(base)
  return new Promise((resoudre) => {
    const s = connect({ host: url.hostname, port: Number(url.port) || 80 }, () => {
      s.destroy()
      resoudre(true)
    })
    s.on('error', () => resoudre(false))
  })
}

function rendreChrome(url, budget, profil) {
  const r = spawnSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      `--user-data-dir=${profil}`,
      `--virtual-time-budget=${budget}`,
      '--timeout=60000',
      '--dump-dom',
      url,
    ],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 120_000 },
  )
  if (r.error && r.error.code !== undefined && r.stdout === '') throw r.error
  return r.stdout ?? ''
}

// ---------------------------------------------------------------------------
// HTML → text helpers (no dependencies)
// ---------------------------------------------------------------------------

function decoderEntites(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, '’')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è')
    .replace(/&agrave;/g, 'à')
    .replace(/&ccedil;/g, 'ç')
}

function texteInterne(html, joint = ' ') {
  return decoderEntites(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, joint)
      .replace(/\s+/g, ' '),
  ).trim()
}

/**
 * First element of the given tag+class → its FULL inner HTML (balanced enough
 * for the leaf elements the fiche renders; never stops at the first child).
 * `inline` joins children WITHOUT spaces — the reading sentence is a stack of
 * <span>/<strong>/<a> nodes whose tag boundaries are NOT visual spaces.
 */
function elementClasse(html, tag, classe, inline = false) {
  const m = html.match(
    new RegExp(`<${tag}[^>]*class="[^"]*\\b${classe}\\b[^"]*"[^>]*>([\\s\\S]*?)</${tag}>`, 'i'),
  )
  return m ? m[1] : null
}

function texteElement(html, tag, classe, inline = false) {
  const e = elementClasse(html, tag, classe)
  return e === null ? null : texteInterne(e, inline ? '' : ' ')
}

function texteClasse(html, classe, inline = false) {
  return texteElement(html, '[a-z0-9]+', classe, inline)
}

/** Every match of tag+class → extracted attribute + inner text. */
function tousClasse(html, tag, classe, inline = false) {
  const sorties = []
  const re = new RegExp(
    `<${tag}[^>]*class="[^"]*\\b${classe}\\b[^"]*"[^>]*>([\\s\\S]*?)</${tag}>`,
    'gi',
  )
  let m
  while ((m = re.exec(html)) !== null) sorties.push(texteInterne(m[1], inline ? '' : ' '))
  return sorties
}

// ---------------------------------------------------------------------------
// Page parsing — the seam-tagged fragment model
// ---------------------------------------------------------------------------

/**
 * One rendered page → structured fragments. Each fragment names the SEAM that
 * owns the words, per the issue's authority taxonomy:
 *   'lecture-template'   fixed words of the reading sentence (theme_<theme>.json)
 *   'lecture-param'      computed value injected into the sentence (histoires row)
 *   'sous-groupe-meta'   subgroup label + framing (theme_<theme>.json)
 *   'indicateur-label'   figure caption (indicator_labels)
 *   'figure-valeur'      the number + unit (payload value, app formatting)
 *   'rang-chip'          the direction-aware ordinal chip (aria phrase)
 *   'vintage-stamp'      source · version · dates (per-indicator provenance)
 *   'source-lecture'     the reading's Source line (vintages join)
 *   'estampille-snapshot' the Mobilité slow-clock stamp (selectors.ts copy)
 *   'nuage-contexte'     the chart's comparison subtitle (descriptionNuage)
 *   'apercu-programmes'  badge/subvention voices (apercu.ts copy + payload)
 *   'app-copy'           hardcoded UI strings (views/components)
 */
function analyserPage(dom, theme) {
  const fragments = []
  const pusher = (role, texte, extra = {}) => {
    if (texte !== null && texte !== undefined && texte !== '') {
      fragments.push({ role, texte, ...extra })
    }
  }

  // Honest error/empty states first — they are app-copy too.
  pusher('app-copy', texteClasse(dom, 'etat-texte'), { etat: 'erreur/vide' })
  pusher('app-copy', texteClasse(dom, 'apercu-vide'), { etat: 'apercu-vide' })

  // Fiche header identity.
  const h1 = dom.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  pusher('app-copy', h1 ? texteInterne(h1[1]) : null, { etat: 'h1' })
  pusher('app-copy', texteClasse(dom, 'puce-type'), { etat: 'puce-type' })
  for (const lien of tousClasse(dom, 'a', 'contexte-switcher-lien'))
    pusher('app-copy', lien, { etat: 'contexte-switcher' })

  if (theme === 'apercu') {
    // KPI anchors (dt = valeur, dd = libellé).
    const stats = dom.match(/<dl[^>]*class="[^"]*\bapercu-stats\b[^"]*"[^>]*>([\s\S]*?)<\/dl>/i)
    if (stats) {
      for (const kpi of stats[1].match(/<div[\s\S]*?<\/div>/g) ?? []) {
        pusher('figure-valeur', texteElement(kpi, 'dt', 'kpi-valeur'), { etat: 'apercu-kpi' })
        pusher('indicateur-label', texteElement(kpi, 'dd', 'kpi-libelle'), { etat: 'apercu-kpi' })
      }
    }
    // The portal link (the Région's aides).
    for (const lien of tousClasse(dom, 'a', 'programmes-lien'))
      pusher('app-copy', lien, { etat: 'programmes-lien' })
    // Programmes badges.
    for (const badge of dom.match(/<li[^>]*class="programme-badge"[\s\S]*?<\/li>\s*(?=<li|<\/ul)/gi) ?? []) {
      pusher('apercu-programmes', texteClasse(badge, 'puce-programme'), { etat: 'badge-sigle' })
      pusher('apercu-programmes', texteClasse(badge, 'programme-voix'), { etat: 'badge-voix' })
      for (const nom of tousClasse(badge, 'li', 'programme-nom'))
        pusher('apercu-programmes', nom, { etat: 'badge-nom' })
      pusher('apercu-programmes', texteClasse(badge, 'programme-rider'), { etat: 'badge-rider' })
      pusher('vintage-stamp', texteClasse(badge, 'programme-vintage'), { etat: 'badge-vintage' })
    }
    // Subventions block (the total already contains the « en AAAA » span).
    const total = texteClasse(dom, 'subvention-total', true)
    pusher('apercu-programmes', total, { etat: 'subvention-total' })
    for (const axe of dom.match(/<li[^>]*class="subvention-axe "?[^>]*>[\s\S]*?<\/li>/gi) ?? []) {
      pusher('figure-valeur', texteClasse(axe, 'subvention-axe-montant'), { etat: 'axe-montant' })
      pusher('indicateur-label', texteClasse(axe, 'subvention-axe-libelle'), { etat: 'axe-libelle' })
    }
    pusher('app-copy', texteClasse(dom, 'subvention-contexte'), { etat: 'subvention-contexte' })
    pusher('app-copy', texteClasse(dom, 'subvention-provenance'), { etat: 'subvention-provenance' })
    pusher('vintage-stamp', texteClasse(dom, 'subvention-vintage'), { etat: 'subvention-vintage' })
    pusher('app-copy', texteClasse(dom, 'programmes-vide'), { etat: 'programmes-vide' })
    return fragments
  }

  // Theme tab — overline then the shared subgroup anatomy.
  pusher('sous-groupe-meta', texteClasse(dom, 'onglet-theme-overline'), { etat: 'overline-theme' })

  for (const section of dom.match(/<section[^>]*class="[^"]*\bsous-groupe\b[^>]*>[\s\S]*?(?:<\/section>|$)/gi) ?? []) {
    const groupe = (section.match(/data-groupe="([^"]+)"/i) ?? [])[1] ?? '?'
    pusher('sous-groupe-meta', texteClasse(section, 'sous-groupe-titre'), { groupe, etat: 'label' })
    pusher('sous-groupe-meta', texteClasse(section, 'sous-groupe-cadrage'), { groupe, etat: 'framing' })
    pusher('lecture-template', texteElement(section, 'p', 'lecture-texte', true), {
      groupe,
      etat: 'lecture (template + params)',
    })
    pusher('nuage-contexte', texteElement(section, 'p', 'lecture-contexte', true), { groupe })
    // Source line — minus the « SOURCE » overline label.
    const sourceBrute = elementClasse(section, 'p', 'lecture-source')
    if (sourceBrute !== null) {
      const sansEtiquette = sourceBrute.replace(
        /<span[^>]*class="[^"]*\blecture-etiquette\b[^"]*"[^>]*>[\s\S]*?<\/span>/i,
        '',
      )
      pusher('source-lecture', texteInterne(sansEtiquette, ''), { groupe })
    }
    pusher('app-copy', texteClasse(section, 'lecture-absent'), { groupe, etat: 'lecture-indisponible' })

    for (const figure of section.match(/<figure[\s\S]*?<\/figure>/g) ?? []) {
      const clef = (figure.match(/data-clef="([^"]+)"/i) ?? [])[1] ?? '?'
      // valeur + unité (IndicatorFigure single-value form)
      const valeur = texteClasse(figure, 'valeur-numerique')
      const unite = texteClasse(figure, 'valeur-unite')
      pusher('figure-valeur', valeur !== null ? `${valeur}${unite ? ' ' + unite : ''}` : null, { groupe, clef })
      pusher('indicateur-label', texteClasse(figure, 'figure-indicateur-libelle'), { groupe, clef })
      pusher('app-copy', texteClasse(figure, 'figure-indicateur-rider'), { groupe, clef, etat: 'rider' })
      const puce = figure.match(/class="puce-rang"[^>]*aria-label="([^"]*)"/i)
      pusher('rang-chip', puce ? decoderEntites(puce[1]) : null, { groupe, clef })
      pusher('vintage-stamp', texteClasse(figure, 'estampille-vintage'), { groupe, clef })
      // multi-detail rows (tranches / DPE / pyramide bands / trajectoire)
      for (const tranche of figure.match(/<li[^>]*class="tranche"[^>]*>[\s\S]*?<\/li>/g) ?? []) {
        pusher('indicateur-label', texteClasse(tranche, 'tranche-libelle'), { groupe, clef, etat: 'detail-row' })
        pusher('figure-valeur', texteClasse(tranche, 'tranche-valeur'), { groupe, clef, etat: 'detail-row' })
      }
      for (const bande of tousClasse(figure, 'div', 'bande-age'))
        pusher('figure-valeur', bande, { groupe, clef, etat: 'pyramide-bande' })
      for (const lettre of tousClasse(figure, 'span', 'dpe-lettre'))
        pusher('indicateur-label', lettre, { groupe, clef, etat: 'dpe-lettre' })
      for (const partDpe of tousClasse(figure, 'span', 'dpe-part'))
        pusher('figure-valeur', partDpe, { groupe, clef, etat: 'dpe-part' })
      for (const point of tousClasse(figure, 'li', 'point'))
        pusher('figure-valeur', point, { groupe, clef, etat: 'trajectoire-point' })
    }

    // The LQ list of the Économie reading (FigureListeLQ — spans inside <li>).
    const listeLQ = elementClasse(section, 'figure', 'figure-liste-lq')
    if (listeLQ !== null) {
      const titre = listeLQ.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i)
      pusher('indicateur-label', titre ? texteInterne(titre[1], '') : null, { groupe, etat: 'lq-titre' })
      for (const rang of tousClasse(listeLQ, 'span', 'rang', true))
        pusher('figure-liste-lq', rang, { groupe, etat: 'lq-rang' })
      for (const activite of tousClasse(listeLQ, 'span', 'activite', true))
        pusher('figure-liste-lq', activite, { groupe, etat: 'lq-activite' })
      for (const lq of tousClasse(listeLQ, 'span', 'lq', true))
        pusher('figure-liste-lq', lq, { groupe, etat: 'lq-valeur' })
    }
  }

  pusher('estampille-snapshot', texteClasse(dom, 'estampille-snapshot'))
  return fragments
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function principal() {
  const opts = parseCli(process.argv.slice(2))
  const territoires = opts.territoires ?? TERRITOIRES_DEFAUT
  const themes = opts.themes ?? THEMES_DEFAUT

  if (!(await portEcoute(opts.base))) {
    console.error(`✗ aucun serveur sur ${opts.base} — lance d'abord : (cd app) npm run dev`)
    process.exit(1)
  }

  const inventaire = []
  const profil = join(tmpdir(), `lusk-audit-prose-${Date.now()}`)
  mkdirSync(profil, { recursive: true })
  try {
    for (const territoire of territoires) {
      const type = await typeDe(opts.base, territoire.id)
      for (const theme of themes) {
        const chemin =
          theme === 'apercu'
            ? `${opts.base}/territoire/${type}/${territoire.id}`
            : `${opts.base}/territoire/${type}/${territoire.id}?theme=${theme}`
        process.stdout.write(`→ ${territoire.id} · ${theme} … `)
        const dom = rendreChrome(chemin, opts.budget, profil)
        const fragments = analyserPage(dom, theme)
        inventaire.push({ territoire: territoire.id, theme, url: chemin, fragments })
        console.log(`${fragments.length} fragments`)
      }
    }
  } finally {
    rmSync(profil, { recursive: true, force: true })
  }

  mkdirSync(opts.out, { recursive: true })
  writeFileSync(join(opts.out, 'prose-inventory.json'), JSON.stringify(inventaire, null, 2))

  const md = [`${'#'} Inventaire de la prose rendue (audit #449)`, '', `_Généré par \`node scripts/audit-prose.mjs\` contre ${opts.base} — ${new Date().toISOString().slice(0, 10)}._`, '']
  for (const page of inventaire) {
    md.push(`## ${page.territoire} — onglet « ${page.theme} »`, '', `\`${page.url}\``, '')
    let courant = null
    for (const f of page.fragments) {
      const clef = f.groupe ?? f.etat ?? ''
      if (clef !== courant) {
        md.push(`### ${clef === '' ? '(page)' : clef}`)
        courant = clef
      }
      md.push(`- **[${f.role}]** ${f.texte}`)
    }
    md.push('')
  }
  writeFileSync(join(opts.out, 'prose-inventory.md'), md.join('\n'))
  console.log(`✓ ${inventaire.length} pages → ${join(opts.out, 'prose-inventory.{md,json}')}`)
}

/** Resolve the territoire's real type from the payload reference table. */
async function typeDe(base, id) {
  const rep = await fetch(`${base}/data/territoires.json`).then((r) => r.json())
  const t = rep.find((x) => x.territoire === id)
  if (!t) throw new Error(`territoire inconnu dans territoires.json : ${id}`)
  return t.type
}

principal().catch((e) => {
  console.error(e)
  process.exit(1)
})
