import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { chargerPayload } from '../payload/loader'
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
 */

const dataDir = join(process.cwd(), '..', 'public', 'data')

function lireJson(nom: string): unknown {
  return JSON.parse(readFileSync(join(dataDir, nom), 'utf-8'))
}

/** Serve the committed payload through the seam, from disk — no network. */
async function chargerPayloadCommite() {
  const fichiers: Record<string, unknown> = {}
  for (const nom of [
    'territoires.json',
    'apercu.json',
    'indicateurs_demographie.json',
    'histoires_demographie.json',
    'indicateurs_habitat.json',
    'histoires_habitat.json',
    'indicateurs_economie.json',
    'histoires_economie.json',
    'run-report.json',
    'vintages.json',
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

describe('payload contract — the committed payload parses and renders', () => {
  it('covers the real 1 268 territoires (1 202 communes, 61 EPCIs, 4 départements, région)', async () => {
    // 1268, pas 1269 : la référence n'a plus l'EPCI fantôme « Sans objet »
    // (fix #131) — 1202 communes + 61 EPCIs réels + 4 départements + 1 région
    const payload = await chargerPayloadCommite()

    expect(payload.territoires).toHaveLength(1268)
    expect(payload.territoires.filter((t) => t.type === 'commune')).toHaveLength(1202)
    expect(payload.territoires.filter((t) => t.type === 'epci')).toHaveLength(61)
    expect(payload.territoires.filter((t) => t.type === 'departement')).toHaveLength(4)
    expect(payload.territoires.filter((t) => t.type === 'region')).toHaveLength(1)
  })

  it('accepts the three islands without an EPCI (22016, 29083, 29155 — « Sans objet », issue #131)', async () => {
    const payload = await chargerPayloadCommite()

    for (const ile of ['22016', '29083', '29155']) {
      const commune = payload.territoires.find((t) => t.territoire === ile)
      expect(commune).toMatchObject({ type: 'commune', epci: null })
    }
  })

  it('carries the real names (LIBGEO/LIBEPCI — never the SIREN)', async () => {
    const payload = await chargerPayloadCommite()
    const nom = (id: string) => payload.territoires.find((t) => t.territoire === id)?.nom

    expect(nom('22001')).toBe('Allineuc')
    expect(nom('200067460')).toBe('Communauté de communes Loudéac Communauté - Bretagne Centre')
    expect(nom('53')).toBe('Bretagne')
    expect(payload.territoires.every((t) => t.epci === null || t.type === 'commune')).toBe(true)
  })

  it('publishes one indicateur row per (territoire × key × detail), across all three themes', async () => {
    const payload = await chargerPayloadCommite()

    expect(payload.indicateurs.length).toBeGreaterThan(0)
    const themes = new Set(payload.indicateurs.map((i) => i.theme))
    expect(themes.has('demographie')).toBe(true)
    expect(themes.has('habitat')).toBe(true)
    expect(themes.has('economie')).toBe(true)
    const cles = new Set(payload.indicateurs.map((i) => `${i.territoire}|${i.key}|${i.detail ?? ''}`))
    expect(cles.size).toBe(payload.indicateurs.length)
  })

  it('keeps every rank in [0,1] or null', async () => {
    const payload = await chargerPayloadCommite()

    for (const i of payload.indicateurs) {
      for (const rang of [i.rang_epci, i.rang_dep, i.rang_reg]) {
        if (rang !== null) expect(rang).toBeGreaterThanOrEqual(0)
        if (rang !== null) expect(rang).toBeLessThanOrEqual(1)
      }
    }
  })

  it('stamps each indicator with its two vintage dates (reference + publication)', async () => {
    const payload = await chargerPayloadCommite()

    for (const i of payload.indicateurs) {
      // la référence est null pour la base DPE roulante (ADR-0009) — jamais
      // pour la publication (toujours publiée)
      if (i.vintage_date_reference !== null) {
        expect(i.vintage_date_reference).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      }
      expect(i.vintage_date_publication).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('renders the Aperçu from the apercu table (never derives it)', async () => {
    const payload = await chargerPayloadCommite()

    const lignes = apercuPourTerritoire(payload, '22001')
    expect(lignes.map((l) => l.key)).toContain('population')
    expect(lignes.find((l) => l.key === 'population')).toMatchObject({
      value: 589,
      unit: 'hab.',
    })
  })

  it('drives the theme tab bar from the payload (all three themes are built)', async () => {
    const payload = await chargerPayloadCommite()

    expect(themesPresent(payload)).toEqual(['demographie', 'habitat', 'economie'])
  })

  it('formats the committed ranks as French chips', async () => {
    const payload = await chargerPayloadCommite()

    const densite29001 = payload.indicateurs.find(
      (i) => i.territoire === '29001' && i.key === 'densite',
    )
    expect(formaterRang(densite29001?.rang_epci ?? null, 'rang_epci')).toBe("P20 de l'EPCI")
  })

  it('renders the freshness line from the committed run-report', async () => {
    const payload = await chargerPayloadCommite()

    expect(ligneFraicheur(payload)).toContain('2026')
  })

  it('loads the committed vintages table — the freshness facts of the Méthodes sources', async () => {
    const payload = await chargerPayloadCommite()

    // L'union commise (issues #124/#133) : une ligne par source des trois
    // thèmes construits — démographie + habitat + economie (les 5 du manifeste
    // Économie : sirene_snapshot, flores_a38, flores_a88, rp_emploi, rp_chomage)
    expect(payload.vintages).toHaveLength(34)
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

  it('publishes the Économie Stories multi-lignes — top-5 per (territoire × story_key), les deux story_keys', async () => {
    const payload = await chargerPayloadCommite()

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
    const payload = await chargerPayloadCommite()

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
})
