import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { chargerPayload } from '../payload/loader'
import {
  apercuPourTerritoire,
  formaterRang,
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
    'run-report.json',
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
  it('covers the real 1 269 territoires (1 202 communes, 62 EPCIs, 4 départements, région)', async () => {
    const payload = await chargerPayloadCommite()

    expect(payload.territoires).toHaveLength(1269)
    expect(payload.territoires.filter((t) => t.type === 'commune')).toHaveLength(1202)
    expect(payload.territoires.filter((t) => t.type === 'epci')).toHaveLength(62)
    expect(payload.territoires.filter((t) => t.type === 'departement')).toHaveLength(4)
    expect(payload.territoires.filter((t) => t.type === 'region')).toHaveLength(1)
  })

  it('carries the real names (LIBGEO/LIBEPCI — never the SIREN)', async () => {
    const payload = await chargerPayloadCommite()
    const nom = (id: string) => payload.territoires.find((t) => t.territoire === id)?.nom

    expect(nom('22001')).toBe('Allineuc')
    expect(nom('200067460')).toBe('Communauté de communes Loudéac Communauté - Bretagne Centre')
    expect(nom('53')).toBe('Bretagne')
    expect(payload.territoires.every((t) => t.epci === null || t.type === 'commune')).toBe(true)
  })

  it('publishes one indicateur row per (territoire × key × detail), across both themes', async () => {
    const payload = await chargerPayloadCommite()

    expect(payload.indicateurs.length).toBeGreaterThan(0)
    const themes = new Set(payload.indicateurs.map((i) => i.theme))
    expect(themes.has('demographie')).toBe(true)
    expect(themes.has('habitat')).toBe(true)
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

  it('drives the theme tab bar from the payload (both themes are built)', async () => {
    const payload = await chargerPayloadCommite()

    expect(themesPresent(payload)).toEqual(['demographie', 'habitat'])
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
})
