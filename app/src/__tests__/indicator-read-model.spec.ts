import { describe, expect, it, vi } from 'vitest'

import { indicateursDemographieFixture, metadonneesThemesFixtures, territoiresFixture } from '../payload/fixtures'
import {
  chargerManifesteModelesLecture,
  chargerModeleIndicateur,
  payloadDepuisModeleIndicateur,
  validerManifesteModelesLecture,
  validerModeleIndicateur,
} from '../payload/indicatorReadModel'

describe("le modèle de lecture d'une Page d'indicateur", () => {
  it('valide le manifeste des routes de lecture', () => {
    const manifeste = validerManifesteModelesLecture(
      {
        schema_version: '1',
        routes: { demographie: ['densite'] },
      },
      'modeles-lecture/manifest.json',
    )

    expect(manifeste.schemaVersion).toBe('1')
    expect(manifeste.routes.demographie).toEqual(['densite'])
  })

  it.each([
    { schema_version: '2', routes: {} },
    { schema_version: '1', routes: { inconnu: ['densite'] } },
    { schema_version: '1', routes: { demographie: ['densite', 'densite'] } },
    { schema_version: '1', routes: { demographie: ['densite invalide'] } },
  ])('rejette un manifeste de routes invalide', (raw) => {
    expect(() => validerManifesteModelesLecture(raw, 'manifest.json')).toThrow()
  })

  it("demande le manifeste sous l'adresse publiée", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ schema_version: '1', routes: { demographie: ['densite'] } }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    try {
      await chargerManifesteModelesLecture()
      expect(fetchMock).toHaveBeenCalledWith('/data/modeles-lecture/manifest.json')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('valide une projection densité autonome à partir de son contrat public', () => {
    const densite = indicateursDemographieFixture.filter(
      (fact) => fact.key === 'densite' && fact.type !== 'region',
    )
    const modele = validerModeleIndicateur(
      {
        schema_version: '1',
        snapshot_id: '2026-09-15',
        theme: 'demographie',
        indicator: 'densite',
        theme_label: 'Démographie',
        page: {
          indicator: 'densite',
          label: 'Densité de population',
          definition: "Nombre d'habitants par kilomètre carré.",
          unit: 'hab./km²',
          calculation: 'Population divisée par la superficie.',
          direction: 'high',
          caveats: 'La superficie est celle du territoire.',
          levels: ['commune', 'epci', 'departement'],
          sources: ['serie_historique'],
        },
        detail_labels: {},
        source_records: metadonneesThemesFixtures.demographie.source_records,
        facts: densite,
      },
      'densite.json',
      territoiresFixture,
    )

    expect(modele.theme).toBe('demographie')
    expect(modele.indicator).toBe('densite')
    expect(modele.facts).toHaveLength(densite.length)
    expect(modele.facts.map(({ territoire, value }) => ({ territoire, value }))).toEqual(
      densite.map(({ territoire, value }) => ({ territoire, value })),
    )
    expect(modele.page.levels).toEqual(['commune', 'epci', 'departement'])
    expect(modele.sourceRecords.serie_historique?.dataset).toBeTruthy()
    const payload = payloadDepuisModeleIndicateur(modele, territoiresFixture)
    expect(payload.themeMetadata?.demographie?.source_records).toEqual(modele.sourceRecords)
  })

  it("demande l'artefact sous l'adresse publiée", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        schema_version: '1',
        snapshot_id: '2025-01-01',
        theme: 'demographie',
        indicator: 'densite',
        theme_label: 'Démographie',
        page: metadonneesThemesFixtures.demographie.indicator_pages!.densite,
        detail_labels: {},
        source_records: metadonneesThemesFixtures.demographie.source_records,
        facts: indicateursDemographieFixture.filter(
          (fact) => fact.key === 'densite' && fact.type !== 'region',
        ),
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    try {
      await chargerModeleIndicateur('demographie', 'densite', territoiresFixture)
      expect(fetchMock).toHaveBeenCalledWith(
        '/data/modeles-lecture/indicateurs/demographie/densite.json',
      )
      await expect(chargerModeleIndicateur('demographie', 'evolution_1968', territoiresFixture)).rejects.toThrow(
        'route',
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
