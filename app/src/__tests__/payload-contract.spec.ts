import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import { chargerPayload } from '../payload/loader'
import type { Payload } from '../payload/types'
import {
  apercuPourTerritoire,
  formaterRang,
  histoiresEconomiePourTerritoire,
  ligneFraicheur,
  themesPresent,
} from '../payload/selectors'

/**
 * The payload contract, app side — the mirror of the R-side contract test
 * (pipeline/tests/testthat/test-contract-payload.R). The pipeline publishes
 * the fiche payload as static JSON under public/data/ (repo root — the
 * nginx /data/ alias, app/README.md); this test reads those committed files
 * and proves the seam accepts them, field for field. If the pipeline drifts
 * from the contract, this test goes red — loud, like its R mirror.
 *
 * Shared-load (issue #185 smell, le flake 5000ms) : le payload committé fait
 * ~25 Mo — il est LU, validé et parsé UNE SEULE FOIS par fichier de test
 * (la promesse mémoïsée de chargerPayloadCommite), jamais une fois par test.
 * Les 15 tests partagent la même instance : un run parallèle ne re-parse
 * plus le payload 15 fois.
 */

const dataDir = join(process.cwd(), '..', 'public', 'data')

function lireJson(nom: string): unknown {
  return JSON.parse(readFileSync(join(dataDir, nom), 'utf-8'))
}

/** Serve the committed payload through the seam, from disk — no network. */
function chargerPayloadCommite(): Promise<Payload> {
  const fichiers: Record<string, unknown> = {}
  for (const nom of [
    'territoires.json',
    'apercu.json',
    'indicateurs_mobilite.json',
    'histoires_mobilite.json',
    'indicateurs_demographie.json',
    'histoires_demographie.json',
    'indicateurs_habitat.json',
    'histoires_habitat.json',
    'indicateurs_economie.json',
    'histoires_economie.json',
    'indicateurs_milieux.json',
    'histoires_milieux.json',
    'run-report.json',
    'vintages.json',
    'programmes.json',
  ]) {
    fichiers[nom] = lireJson(nom)
  }

  return chargerPayload({
    baseUrl: 'data/',
    fetchImpl: async (url: string) => {
      const nom = url.split('/').pop() ?? url
      if (nom in fichiers) {
        return { ok: true, status: 200, json: async () => fichiers[nom] }
      }
      return { ok: false, status: 404, json: async () => { throw new Error('404') } }
    },
  })
}

/** Le payload committé, chargé UNE fois par fichier (partagé entre les tests). */
let payloadCommite: Payload | null = null
let promesseCharge: Promise<Payload> | null = null

beforeAll(async () => {
  promesseCharge ??= chargerPayloadCommite()
  payloadCommite = await promesseCharge
})

function obtenirPayload(): Payload {
  if (payloadCommite === null) throw new Error('payload non chargé (beforeAll)')
  return payloadCommite
}

describe('payload contract — the committed payload parses and renders', () => {
  it('covers the real 1 268 territoires (1 202 communes, 61 EPCIs, 4 départements, région)', async () => {
    // 1268, pas 1269 : la référence n'a plus l'EPCI fantôme « Sans objet »
    // (fix #131) — 1202 communes + 61 EPCIs réels + 4 départements + 1 région
    const payload = obtenirPayload()

    expect(payload.territoires).toHaveLength(1268)
    expect(payload.territoires.filter((t) => t.type === 'commune')).toHaveLength(1202)
    expect(payload.territoires.filter((t) => t.type === 'epci')).toHaveLength(61)
    expect(payload.territoires.filter((t) => t.type === 'departement')).toHaveLength(4)
    expect(payload.territoires.filter((t) => t.type === 'region')).toHaveLength(1)
  })

  it('accepts the three islands without an EPCI (22016, 29083, 29155 — « Sans objet », issue #131)', async () => {
    const payload = obtenirPayload()

    for (const ile of ['22016', '29083', '29155']) {
      const commune = payload.territoires.find((t) => t.territoire === ile)
      expect(commune).toMatchObject({ type: 'commune', epci: null })
    }
  })

  it('carries the real names (LIBGEO/LIBEPCI — never the SIREN)', async () => {
    const payload = obtenirPayload()
    const nom = (id: string) => payload.territoires.find((t) => t.territoire === id)?.nom

    expect(nom('22001')).toBe('Allineuc')
    expect(nom('200067460')).toBe('Communauté de communes Loudéac Communauté - Bretagne Centre')
    expect(nom('53')).toBe('Bretagne')
    expect(payload.territoires.every((t) => t.epci === null || t.type === 'commune')).toBe(true)
  })

  it('publishes one indicateur row per (territoire × key × detail), across all four themes', async () => {
    const payload = obtenirPayload()

    expect(payload.indicateurs.length).toBeGreaterThan(0)
    const themes = new Set(payload.indicateurs.map((i) => i.theme))
    expect(themes.has('mobilite')).toBe(true)
    expect(themes.has('demographie')).toBe(true)
    expect(themes.has('habitat')).toBe(true)
    expect(themes.has('economie')).toBe(true)
    const cles = new Set(payload.indicateurs.map((i) => `${i.territoire}|${i.key}|${i.detail ?? ''}`))
    expect(cles.size).toBe(payload.indicateurs.length)
  })

  it('keeps every rank in [0,1] or null', async () => {
    const payload = obtenirPayload()

    // Un seul expect agrégé plutôt que ~100k expects par ligne : le payload
    // fait ~25 Mo (21k indicateurs × 3 rangs) — une assertion par valeur
    // dépassait le timeout 5000ms du test sous charge parallèle (le flake
    // #185), et le message d'échec liste les violations au lieu de s'arrêter
    // à la première.
    const horsBornes = payload.indicateurs
      .flatMap((i) =>
        [i.rang_epci, i.rang_dep, i.rang_reg].map((rang) => ({ i, rang })),
      )
      .filter(({ rang }) => rang !== null && (rang < 0 || rang > 1))
      .map(({ i, rang }) => `${i.territoire}/${i.key}/${i.detail ?? ''}: ${rang}`)
    expect(horsBornes).toEqual([])
  })

  it('stamps each indicator with its two vintage dates (reference + publication)', async () => {
    const payload = obtenirPayload()

    const malEstampilles = payload.indicateurs
      .filter((i) => {
        // la référence est null pour la base DPE roulante (ADR-0009) — jamais
        // pour la publication (toujours publiée)
        const referenceOk = i.vintage_date_reference === null ||
          /^\d{4}-\d{2}-\d{2}$/.test(i.vintage_date_reference)
        const publicationOk = /^\d{4}-\d{2}-\d{2}$/.test(i.vintage_date_publication)
        return !referenceOk || !publicationOk
      })
      .map((i) => `${i.territoire}/${i.key}: réf ${i.vintage_date_reference} · publ ${i.vintage_date_publication}`)
    expect(malEstampilles).toEqual([])
  })

  it('renders the Aperçu from the apercu table (never derives it)', async () => {
    const payload = obtenirPayload()

    const lignes = apercuPourTerritoire(payload, '22001')
    expect(lignes.map((l) => l.key)).toContain('population')
    expect(lignes.find((l) => l.key === 'population')).toMatchObject({
      value: 589,
      unit: 'hab.',
    })
  })

  it('drives the theme tab bar from the payload (all five themes are built)', async () => {
    const payload = obtenirPayload()

    expect(themesPresent(payload)).toEqual([
      'mobilite',
      'demographie',
      'habitat',
      'economie',
      'milieux',
    ])
  })

  it('parses the regenerated Milieux histoires — the pivot schema field-by-field (spec #225 → #243)', async () => {
    const payload = obtenirPayload()

    // Le payload régénéré (spec #225 → #243) porte le nouveau schéma — la
    // Story Milieux est de nouveau une exigence STRICTE du contrat. Les lignes
    // se lisent champ par champ, l'invariant d'ADR-0017 est prouvé sur le
    // payload committé.
    const milieux = payload.histoires.filter((h) => h.theme === 'milieux')
    expect(milieux.length).toBeGreaterThan(1200)

    const allineuc = milieux.find((h) => h.territoire === '22001')
    expect(allineuc).toMatchObject({
      type: 'commune',
      story_key: 'se-densifier-setaler-ou-sen-aller',
      periode_pop: '2017-2023',
      periode_artif: '2021-2025',
      classification: 'sen-aller-et-consommer-quand-meme',
    })
    expect(allineuc?.artif_m2 ?? 0).toBeGreaterThan(0)
    expect(allineuc?.artif_m3 ?? 0).toBeGreaterThan(0)
    expect(allineuc?.artif_m2_par_habitant ?? 0).toBeGreaterThan(0)
    expect(allineuc?.artif_m3_par_habitant ?? 0).toBeGreaterThan(0)
    expect(allineuc?.trajectoire_artif_par_habitant ?? 0).toBeGreaterThan(0)

    // l'invariant ADR-0017 sur tout le payload committé : sign(ratio − 1) =
    // sign(delta) — la classification et le graphe ne peuvent jamais diverger.
    // Les lignes SANS trajectoire (M2 = 0 ou états absents — la découverte
    // #243) sont null de part et d'autre : l'invariant ne s'y applique pas,
    // la lecture est honnêtement absente (jamais une lecture inventée).
    for (const h of milieux) {
      const ratio = h.trajectoire_artif_par_habitant
      if (ratio === null) {
        expect(h.classification).toBeNull()
        continue
      }
      const delta = (h.artif_m3_par_habitant ?? 0) - (h.artif_m2_par_habitant ?? 0)
      expect(Math.sign(ratio - 1)).toBe(Math.sign(delta))
    }

    // la découverte #243 corrigée : le payload régénéré lit l'ÉTAT du produit
    // millésimé (le DIFF est sorti) — plus AUCUNE commune à M2 = 0 (le bug
    // flux-et-état : les 102 communes « sans renaturation » publiaient un
    // zéro d'état inventé). La garde du pipeline « toute commune a un état
    // > 0 » (amendement #243) verrouille la propriété côté compute.
    const m2zero = milieux.filter((h) => h.artif_m2_par_habitant === 0)
    expect(m2zero.length).toBe(0)
  })

  it('formats the committed ranks as French chips', async () => {
    const payload = obtenirPayload()

    const densite29001 = payload.indicateurs.find(
      (i) => i.territoire === '29001' && i.key === 'densite',
    )
    expect(formaterRang(densite29001?.rang_epci ?? null, 'rang_epci')).toBe("P20 de l'EPCI")
  })

  it('renders the freshness line from the committed run-report', async () => {
    const payload = obtenirPayload()

    expect(ligneFraicheur(payload)).toContain('2026')
  })

  it('loads the committed vintages table — the freshness facts of the Méthodes sources', async () => {
    const payload = obtenirPayload()

    // L'union commise (issues #124/#133/#177) : une ligne par source des
    // CINQ thèmes construits — démographie + habitat + economie (les 5 du
    // manifeste Économie : sirene_snapshot, flores_a38, flores_a88, rp_emploi,
    // rp_chomage) + les 8 sources mobilité de la course 2026-08-06
    // (#139/#140/#141) + le jeu Geovelo des aménagements cyclables (#228,
    // #233 — la source du mode `b` et de la figure « L'offre cyclable ») + la
    // table de passage COG du run 2026-08-09 (#227/#273 — la projection des
    // codes COG 2022 du jeu vers le COG 2025 du squelette) + les 6 sources
    // programmes du run 2026-08-07 (#175/#176/#178 : acv, pvd, crte,
    // territoires_industrie, ort, subventions_scdl) + la source consoenaf du
    // run milieux 2026-08-07 (#177) + les HUIT sources OCS-GE du run milieux
    // 2026-08-09 (l'amendement #243, ADR-0017 : le produit millésimé
    // « surfaces artificialisées », 2 millésimes × 4 départements — le DIFF
    // est sorti du manifeste) + les TROIS patchs correctifs M2 du run
    // 2026-08-10 (ocsge_patch_correctif_{22,29,56} — la décision de
    // l'amendement, appliquée dans #243)
    expect(payload.vintages).toHaveLength(62)
    const consoenaf = payload.vintages?.find((v) => v.id === 'consoenaf')
    expect(consoenaf).toMatchObject({
      source:
        "Cerema — Consommation d'espaces naturels, agricoles et forestiers (CONSOENAF) 2011-2025 : indicateurs communaux (Fichiers Fonciers)",
      version: '2025',
      licence: 'lov2',
      date_reference: '2025-01-01',
      date_publication: '2026-07-24',
    })
    const ocsge22 = payload.vintages?.find((v) => v.id === 'ocsge_artificialisation_22_2025')
    expect(ocsge22).toMatchObject({
      version: '2025',
      licence: 'lov2',
      date_reference: '2025-01-01',
      date_publication: '2026-07-03',
    })
    // le vintage du produit millésimé — jamais le différentiel (le bug #243)
    expect(ocsge22?.source).toContain('surfaces artificialisées')
    expect(ocsge22?.source).not.toContain('différentiel')
    const serieHistorique = payload.vintages?.find((v) => v.id === 'serie_historique')
    expect(serieHistorique).toMatchObject({
      source: 'INSEE — Série historique du recensement',
      version: '2023',
      licence: 'lov2',
      date_reference: '2023-01-01',
    })
    // La base des EPCI est un millésime fixe — publiée mais sans base roulante
    expect(payload.vintages?.find((v) => v.id === 'epci')?.date_publication).toBeNull()
  })

  it('loads the committed programmes payload — membership + subventions, the shared file (issue #178/#179)', async () => {
    const payload = obtenirPayload()

    // Le fichier PARTAGÉ est présent (le run programmes 2026-08-07 l'a publié)
    // — jamais l'état vide du 404 : l'élément Aperçu doit rendre des données
    expect(payload.programmes).not.toBeNull()
    const programmes = payload.programmes!

    // les deux tables du contrat : les lignes d'adhésion (253 — les comptes
    // verrouillés du run réel) et les agrégats de subventions (1 908 lignes,
    // hors communes hors-Bretagne — la discipline « attribué à un territoire
    // breton », fix des lignes communales)
    expect(programmes.membres).toHaveLength(253)
    expect(programmes.subventions.length).toBeGreaterThan(0)

    // chaque ligne d'adhésion est ancrée commune ou EPCI (jamais département/
    // région — l'échelle est dérivée dans l'app, ADR-0013)
    for (const membre of programmes.membres) {
      expect(['commune', 'epci']).toContain(membre.type)
      expect(membre.vintage_date_reference).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }

    // chaque ligne de subvention porte le vintage hebdomadaire SCDL
    for (const subvention of programmes.subventions) {
      expect(subvention.vintage_version).toBe('2026-08-05')
      expect(subvention.montant).toBeGreaterThan(0)
    }
  })

  it('publishes the Économie Stories multi-lignes — top-5 per (territoire × story_key), les deux story_keys', async () => {
    const payload = obtenirPayload()

    const histoiresEconomie = payload.histoires.filter((h) => h.theme === 'economie')
    // 1202 communes + 61 EPCIs + 4 départements = 1267 × 5 + les 5 de la région
    expect(histoiresEconomie).toHaveLength(6340)
    const storyKeys = new Set(histoiresEconomie.map((h) => h.story_key))
    expect(storyKeys).toEqual(new Set(['ce-que-la-commune-abrite', 'ce-que-la-bretagne-abrite']))

    // la région porte la lecture de structure, le reste la spécialisation
    expect(
      histoiresEconomie.filter((h) => h.story_key === 'ce-que-la-bretagne-abrite'),
    ).toHaveLength(5)
    expect(histoiresEconomie.filter((h) => h.story_key === 'ce-que-la-bretagne-abrite').every(
      (h) => h.territoire === '53',
    )).toBe(true)

    // le sélecteur Story lit le top-5 réel d'une commune, trié par rang
    const allineuc = histoiresEconomiePourTerritoire(payload, '22001')
    expect(allineuc?.map((l) => l.rang)).toEqual([1, 2, 3, 4, 5])
    expect(allineuc?.[0]?.activity_label).toBe('Élevage de volailles')
  })

  it('exposes the Économie Story vintage on every line (issue #74 — the story cites its source)', async () => {
    const payload = obtenirPayload()

    const histoire = payload.histoires.find(
      (h) => h.theme === 'economie' && h.territoire === '22001',
    )
    expect(histoire).toMatchObject({
      vintage_source: 'data.bretagne.bzh — Base SIRENE - Région Bretagne (sirene-v3-consolidee)',
      vintage_version: '2026-04',
      vintage_date_reference: '2026-03-31',
      vintage_date_publication: '2026-05-01',
    })
  })

  it('parses the committed Mobilité Stories — 1 405 rows, les deux story_keys (issue #142)', async () => {
    const payload = obtenirPayload()

    const histoiresMobilite = payload.histoires.filter((h) => h.theme === 'mobilite')
    // 1 266 territoires portent le défaut + les 139 saillants portent aussi le vélo
    expect(histoiresMobilite).toHaveLength(1405)
    const storyKeys = new Set(histoiresMobilite.map((h) => h.story_key))
    expect(storyKeys).toEqual(
      new Set(['vingt-minutes-sans-voiture', 'ce-que-le-velo-preserve']),
    )
    // chaque territoire porte le défaut, une ligne ; les saillants en portent deux
    const defauts = histoiresMobilite.filter((h) => h.story_key === 'vingt-minutes-sans-voiture')
    expect(defauts).toHaveLength(1266)
    expect(new Set(defauts.map((h) => h.territoire)).size).toBe(1266)
    const velo = histoiresMobilite.filter((h) => h.story_key === 'ce-que-le-velo-preserve')
    expect(velo).toHaveLength(139)
    expect(velo.every((h) => h.classification_saillance === 'saillant')).toBe(true)
  })

  it('carries the real Mobilité Story matter — div_loss_t, la signature et l’estampille snapshot', async () => {
    const payload = obtenirPayload()

    // 22001 (Allineuc) : le défaut non-saillant, sa distribution réelle
    const allineuc = payload.histoires.find(
      (h) => h.theme === 'mobilite' && h.territoire === '22001',
    )
    expect(allineuc).toMatchObject({
      theme: 'mobilite',
      story_key: 'vingt-minutes-sans-voiture',
      div_loss_t: 38,
      div_loss_b: 38,
      delta: 0,
      pct_iso_full_t: 0.48,
      classification_saillance: 'non-saillant',
      dens_min: 28,
      dens_max: 47,
    })
    if (allineuc?.theme === 'mobilite' && allineuc.story_key === 'vingt-minutes-sans-voiture') {
      expect(allineuc.dens_1).toBeCloseTo(0.005915, 6)
      expect(allineuc.dec_1).toBeCloseTo(33.7, 6)
    }
    // l'estampille SNAPSHOT — la Story cite SA source (issue #74, ADR-0012)
    expect(allineuc).toMatchObject({
      vintage_source: "Lusk — analyse d'accessibilité « Vingt minutes sans voiture » (analyse portée, BPE 2024 · OSM 02-2026 · BDNB 2025-07)",
      vintage_version: '2026-02',
      vintage_date_reference: '2026-02-28',
      vintage_date_publication: '2026-08-06',
    })
  })
})
