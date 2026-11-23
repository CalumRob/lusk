/**
 * Audit #478 — table de vérité des associations jeu ← indicateur, dérivée de
 * façon déterministe de l'autorité publiée (public/data/theme_*.json) selon
 * la MÊME sémantique que le jointeur du sélecteur (sourceRecords,
 * app/src/payload/selectors.ts) : consommateur = clé des cartes `sources` du
 * thème (primaire) ∪ `indicator_pages[key].sources` (secondaires), résolue au
 * jeu via datasetDeSource (la clé `dataset` du registre éditorial). Le script
 * liste AUSSI les enregistrements d'autorité sans consommateur (filtrés hors
 * de la page par `consumers.length > 0`) — les lignes « implausiblement
 * vides ».
 *
 * Sortie : evidence/expected-associations.json
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const RACINE = path.resolve(process.argv[2] ?? '.', 'public/data')
const SORTIE = path.resolve(process.argv[3] ?? 'docs/audits/478-sources-table-audit/evidence/expected-associations.json')

/** Les clés `dataset` du registre éditorial (app/src/methodes/sources.ts) — la résolution id → jeu. */
const DATASETS_PAR_ID = (() => {
  const familles = { dvf: [], dpe: [] }
  const map = {
    serie_historique: 'serie_historique', menages: 'menages', age_detail: 'age_detail', epci: 'epci',
    logements: 'logements', sirene_snapshot: 'sirene_snapshot', flores_a38: 'flores_a38',
    flores_a88: 'flores_a88', rp_emploi: 'rp_emploi', rp_chomage: 'rp_chomage',
    mobilite_snapshot: 'mobilite_snapshot', rp_logement_princ: 'rp_logement_princ',
    osm_reseaux: 'osm_reseaux', amenagements_cyclables: 'amenagements_cyclables',
    cog_passage: 'cog_passage', communes_limites: 'communes_limites', korrigo: 'korrigo',
    batiments_residentiels: 'batiments_residentiels', 'bornes-recharges': 'bornes-recharges',
    'stationnement-velo': 'stationnement-velo', bpe_b316: 'bpe_b316',
    consoenaf: 'consoenaf',
  }
  for (const annee of [2021, 2022, 2023, 2024, 2025]) for (const dep of ['22', '29', '35', '56']) map[`dvf_${annee}_dep${dep}`] = 'dvf'
  for (const dep of ['22', '29', '35', '56']) map[`dpe_${dep}`] = 'dpe'
  const millesimes = { '22': [2021, 2025], '29': [2021, 2024], '35': [2020, 2023], '56': [2022, 2024] }
  for (const dep of ['22', '29', '35', '56']) for (const m of millesimes[dep]) map[`ocsge_artificialisation_${dep}_${m}`] = 'ocsge_artificialisation'
  for (const dep of ['22', '29', '56']) map[`ocsge_patch_correctif_${dep}`] = 'ocsge_artificialisation'
  return { ...familles, ...map }
})()

const jeuDe = (id) => DATASETS_PAR_ID[id] ?? id

const THEMES = ['mobilite', 'demographie', 'habitat', 'economie', 'milieux', 'programmes']

/** Le nom public du jeu — dataset du premier source_records qui le porte. */
async function main() {
  const jeux = new Map() // jeu → { themes:Set, consommateurs:[{theme,key,voie}] , recordsAutorite:Set(theme) }
  const autoriteSansConsommateur = []
  const nomsJeux = new Map()

  for (const theme of THEMES) {
    let meta
    try {
      meta = JSON.parse(await readFile(path.join(RACINE, `theme_${theme}.json`), 'utf8'))
    } catch { continue /* thème absent du payload */ }

    for (const [id, record] of Object.entries(meta.source_records ?? {})) {
      const jeu = jeuDe(id)
      if (!jeux.has(jeu)) jeux.set(jeu, { themes: new Set(), consommateurs: [], recordsAutorite: new Set() })
      jeux.get(jeu).recordsAutorite.add(theme)
      if (!nomsJeux.has(jeu)) nomsJeux.set(jeu, record.dataset ?? jeu)
    }

    for (const [key, primaire] of Object.entries(meta.sources ?? {})) {
      const secondaires = meta.indicator_pages?.[key]?.sources ?? []
      for (const id of new Set([primaire, ...secondaires].filter(Boolean))) {
        const jeu = jeuDe(id)
        if (!jeux.has(jeu)) jeux.set(jeu, { themes: new Set(), consommateurs: [], recordsAutorite: new Set() })
        const entree = jeux.get(jeu)
        entree.themes.add(theme)
        if (!entree.consommateurs.some((c) => c.theme === theme && c.key === key)) {
          entree.consommateurs.push({ theme, key, voie: id === primaire ? 'sources (primaire)' : 'indicator_pages.sources (secondaire)' })
        }
      }
    }
  }

  for (const [jeu, entree] of jeux) {
    if (entree.consommateurs.length === 0) {
      autoriteSansConsommateur.push({ jeu, nom: nomsJeux.get(jeu) ?? jeu, themesAutorite: [...entree.recordsAutorite] })
    }
  }

  const sortie = {
    note: 'Associations attendues = jointure publiée theme_*.json (mêmes règles que sourceRecords). Les jeux sans consommateur sont filtrés HORS de /sources par SourcesView.',
    jeux: Object.fromEntries([...jeux.entries()].map(([jeu, e]) => [jeu, {
      nom: nomsJeux.get(jeu) ?? jeu,
      themesConsommateurs: [...e.themes],
      themesAvecRecordAutorite: [...e.recordsAutorite],
      consommateurs: e.consommateurs.map((c) => `${c.theme}/${c.key} (${c.voie})`),
    }])),
    autoriteSansConsommateur_filtresHorsPage: autoriteSansConsommateur.sort((a, b) => a.jeu.localeCompare(b.jeu)),
  }
  await mkdir(path.dirname(SORTIE), { recursive: true })
  await writeFile(SORTIE, JSON.stringify(sortie, null, 2))
  console.log(`Table de vérité écrite : ${SORTIE}`)
  console.log(`Jeux avec consommateurs : ${Object.keys(sortie.jeux).length} ; jeux d'autorité sans consommateur (hors page) : ${autoriteSansConsommateur.length}`)
  for (const j of autoriteSansConsommateur) console.log(`  - ${j.jeu} (thèmes porteurs : ${j.themesAutorite.join(', ') || '—'})`)
}

main().catch((err) => { console.error(err); process.exit(1) })
