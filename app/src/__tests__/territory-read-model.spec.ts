import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  indicateursMobiliteFixture,
  histoiresMobiliteFixture,
  metadonneesThemesFixtures,
  territoiresFixture,
} from '@/payload/fixtures'
import {
  chargerModeleTerritoire,
  payloadDepuisModeleTerritoire,
  validerModeleTerritoire,
} from '@/payload/territoryReadModel'
import { territoryFactsFor } from '@/fiche/content/territoryFacts'

const target = territoiresFixture.find((territoire) => territoire.territoire === '22001')!
const modelePublie22001 = JSON.parse(readFileSync(
  resolve(process.cwd(), '../public/data/modeles-lecture/territoires/commune/22001.json'),
  'utf8',
))

describe('le modèle de lecture d’un territoire', () => {
  it('refuse au chargement un artefact de production qui ne porte pas les six thèmes', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        schema_version: '1',
        snapshot_id: '2026-09-15',
        territory: target,
        territoires: territoiresFixture,
        themes: {
          mobilite: {
            theme: 'mobilite',
            indicateurs: indicateursMobiliteFixture,
            histoires: histoiresMobiliteFixture,
            theme_metadata: metadonneesThemesFixtures.mobilite,
            profils_acces_bpe: null,
            distribution_acces_batiments: null,
            rampe_acces_batiments: null,
          },
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    try {
      await expect(chargerModeleTerritoire('commune', target.territoire))
        .rejects.toThrow(/six thèmes|thèmes manquants/)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('porte les faits Mobilité et ses preuves auxiliaires dans une unité atomique', () => {
    const modele = validerModeleTerritoire(
      {
        schema_version: '1',
        snapshot_id: '2026-09-15',
        territory: target,
        territoires: territoiresFixture,
        themes: {
          mobilite: {
            theme: 'mobilite',
            indicateurs: indicateursMobiliteFixture,
            histoires: histoiresMobiliteFixture,
            theme_metadata: metadonneesThemesFixtures.mobilite,
            profils_acces_bpe: [
              {
                territoire: '22001',
                type: 'commune',
                profil: 'velo-compense',
                profil_libelle: 'Le vélo compense',
                nombre_typequ: 3,
                exemplar_typequ: 'D267',
                exemplar_libelle: 'Spécialiste en dermatologie vénéréologie',
                exemplar_c: 0.1,
                exemplar_b: 0.4,
                exemplar_t: 0.1,
              },
            ],
            distribution_acces_batiments: null,
            rampe_acces_batiments: null,
          },
        },
      },
      'territoires/commune/22001.json',
    )

    expect(modele.schemaVersion).toBe('1')
    expect(modele.territory).toEqual(target)
    expect(modele.themes.mobilite?.indicators).toHaveLength(indicateursMobiliteFixture.length)
    expect(modele.themes.mobilite?.indicators[0]).toMatchObject(indicateursMobiliteFixture[0]!)
    expect(modele.themes.mobilite?.bpeAccess).toHaveLength(1)

    const payload = payloadDepuisModeleTerritoire(modele)
    const facts = territoryFactsFor(payload, target.territoire)

    expect(facts?.territory.name).toBe(target.nom)
    expect(facts?.mobility.bpeAccess.availability).toBe('complete')
    expect(facts?.mobility.bpeAccess.profiles[1]).toMatchObject({
      profile: 'velo-compense',
      count: 3,
    })
  })

  it('porte une comparaison pré-calculée sans publier les lignes des pairs', () => {
    const indicateursCible = indicateursMobiliteFixture.filter(
      (row) => row.territoire === target.territoire ||
        (row.territoire === '53' && row.key === 'nb_buildings'),
    )
    const ligneCible = indicateursCible.find((row) => row.territoire === target.territoire)!
    const modele = validerModeleTerritoire(
      {
        schema_version: '1',
        snapshot_id: '2026-09-15',
        territory: target,
        territoires: territoiresFixture.filter((territoire) =>
          [target.territoire, target.epci, target.departement, '53'].includes(territoire.territoire),
        ),
        themes: {
          mobilite: {
            theme: 'mobilite',
            indicateurs: indicateursCible,
            histoires: histoiresMobiliteFixture.filter(
              (row) => row.territoire === target.territoire,
            ),
            theme_metadata: metadonneesThemesFixtures.mobilite,
            profils_acces_bpe: null,
            distribution_acces_batiments: null,
            rampe_acces_batiments: null,
            directions_comparaison: { [ligneCible.key]: 'high' },
            comparaisons: {
              epci: {
                scope: { kind: 'communes-epci', label: 'communes de EPCI X' },
                faits: [{
                  key: ligneCible.key,
                  detail: ligneCible.detail,
                  sex: ligneCible.sex ?? null,
                  dimension: ligneCible.dimension ?? null,
                  origin: 'indicator',
                  direction: 'plus-est-mieux',
                  rank_position: 2,
                  rank_size: 7,
                  reference_kind: 'median',
                  reference_value: 42,
                }],
              },
            },
          },
        },
      },
      'territoires/commune/22001.json',
    )

    const payload = payloadDepuisModeleTerritoire(modele)
    const facts = territoryFactsFor(
      payload,
      target.territoire,
      modele.themes.mobilite?.comparisons.epci,
    )

    expect(payload.indicateurs.every((row) =>
      row.territoire === target.territoire || row.territoire === '53',
    )).toBe(true)
    expect(facts?.mobility.indicators.find((fact) => fact.key === ligneCible.key)?.comparison)
      .toEqual({
        direction: 'plus-est-mieux',
        scope: {
          mode: 'epci',
          kind: 'communes-epci',
          label: 'communes de EPCI X',
        },
        rank: { position: 2, size: 7 },
        reference: { kind: 'median', value: 42 },
      })
  })

  it('refuse un modèle dont le territoire déclaré ne figure pas dans le contexte', () => {
    expect(() =>
      validerModeleTerritoire(
        {
          schema_version: '1',
          snapshot_id: '2026-09-15',
          territory: { ...target, territoire: '99999' },
          territoires: territoiresFixture,
          themes: {},
        },
        'territoires/commune/99999.json',
      ),
    ).toThrow(/territoire déclaré/)
  })

  it('refuse un mode inconnu et deux comparaisons portant la même signature', () => {
    const themeBase = {
      theme: 'mobilite',
      indicateurs: indicateursMobiliteFixture,
      histoires: histoiresMobiliteFixture,
      theme_metadata: metadonneesThemesFixtures.mobilite,
      profils_acces_bpe: null,
      distribution_acces_batiments: null,
      rampe_acces_batiments: null,
      directions_comparaison: Object.fromEntries(
        indicateursMobiliteFixture.map((indicator) => [indicator.key, 'high']),
      ),
    }
    const envelope = (comparaisons: Record<string, unknown>) => ({
      schema_version: '1',
      snapshot_id: '2026-09-15',
      territory: target,
      territoires: territoiresFixture,
      themes: { mobilite: { ...themeBase, comparaisons } },
    })
    const targetFact = indicateursMobiliteFixture.find(
      (indicator) => indicator.territoire === target.territoire,
    )!
    const fact = {
      key: targetFact.key,
      detail: targetFact.detail,
      sex: targetFact.sex ?? null,
      dimension: targetFact.dimension ?? null,
      origin: 'indicator',
      direction: 'plus-est-mieux',
      rank_position: 1,
      rank_size: 2,
      reference_kind: 'median',
      reference_value: 100,
    }

    expect(() => validerModeleTerritoire(envelope({
      mystere: {
        scope: { kind: 'communes-epci', label: 'communes de EPCI X' },
        faits: [],
      },
    }), 'territoires/commune/22001.json')).toThrow(/mode de comparaison inconnu/)

    expect(() => validerModeleTerritoire(envelope({
      epci: {
        scope: { kind: 'communes-epci', label: 'communes de EPCI X' },
        faits: [fact, fact],
      },
    }), 'territoires/commune/22001.json')).toThrow(/dupliquée/)

    expect(() => validerModeleTerritoire(envelope({
      bretagne: {
        scope: { kind: 'departements-bretagne', label: 'départements bretons' },
        faits: [fact],
      },
    }), 'territoires/commune/22001.json')).toThrow(/scope.*incompatible/)

    expect(() => validerModeleTerritoire(envelope({
      epci: {
        scope: { kind: 'communes-epci', label: 'communes de EPCI X' },
        faits: [{ ...fact, key: 'fait-inventé' }],
      },
    }), 'territoires/commune/22001.json')).toThrow(/fait.*absent.*cible/)

    expect(() => validerModeleTerritoire(envelope({
      epci: {
        scope: { kind: 'communes-epci', label: 'communes de EPCI X' },
        faits: [{ ...fact, direction: 'moins-est-mieux' }],
      },
    }), 'territoires/commune/22001.json')).toThrow(/direction.*incohérente/)

    const densityModel = validerModeleTerritoire(envelope({
      densite: {
        scope: { kind: 'communes-densite', label: 'grands centres urbains bretons' },
        faits: [fact],
      },
    }), 'territoires/commune/22001.json')
    expect(densityModel.themes.mobilite?.comparisons.densite?.scope).toEqual({
      kind: 'communes-densite',
      label: 'grands centres urbains bretons',
    })
    const densityFacts = territoryFactsFor(
      payloadDepuisModeleTerritoire(densityModel),
      target.territoire,
      densityModel.themes.mobilite?.comparisons.densite,
    )
    expect(densityFacts?.mobility.indicators.find((candidate) => candidate.key === fact.key)?.comparison)
      .toMatchObject({
        scope: {
          mode: 'densite',
          kind: 'communes-densite',
          label: 'grands centres urbains bretons',
        },
      })
  })

  it('refuse une projection de distribution comparée incomplète', () => {
    const brut = structuredClone(modelePublie22001)
    const cellules = brut.themes.mobilite.comparaisons.epci.distribution_batiments.cells
    expect(cellules.length).toBeGreaterThan(1)
    cellules.pop()

    expect(() => validerModeleTerritoire(
      brut,
      'territoires/commune/22001.json',
    )).toThrow(/distribution comparée.*incomplète/)
  })

  it('refuse une distribution comparée qui ne recompose pas son total', () => {
    const brut = structuredClone(modelePublie22001)
    brut.themes.mobilite.comparaisons.epci.distribution_batiments.cells[0].building_count += 1

    expect(() => validerModeleTerritoire(
      brut,
      'territoires/commune/22001.json',
    )).toThrow(/distribution comparée.*incohérente/)
  })

  it('refuse une projection de rampe comparée incomplète', () => {
    const brut = structuredClone(modelePublie22001)
    const points = brut.themes.mobilite.comparaisons.epci.rampe_acces.points
    expect(points.length).toBeGreaterThan(1)
    points.pop()

    expect(() => validerModeleTerritoire(
      brut,
      'territoires/commune/22001.json',
    )).toThrow(/rampe comparée.*incomplète/)
  })
})
