import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { indicateursDemographieFixture, metadonneesThemesFixtures, territoiresFixture } from '../payload/fixtures'
import { validerManifesteModelesLecture, validerModeleIndicateur } from '../payload/indicatorReadModel'
import type { Theme } from '../payload/types'

// Les artefacts publiés (manifeste + modèles par indicateur) restent des
// actifs producteur de publication/recovery (#871) : le navigateur ne les
// charge plus, mais leur contrat de schéma reste gardé ici, contre les
// fichiers réellement commités.
const publishedData = (...segments: string[]) => join(process.cwd(), '..', 'public', 'data', ...segments)
const readPublished = (...segments: string[]) => JSON.parse(readFileSync(publishedData(...segments), 'utf8'))
const territoiresPublies = readPublished('territoires.json') as Parameters<typeof validerModeleIndicateur>[2]

describe("le contrat de schéma des modèles de lecture d'une Page d'indicateur (#871)", () => {
  it('valide le manifeste des routes tel que publié', () => {
    const manifeste = validerManifesteModelesLecture(readPublished('modeles-lecture', 'manifest.json'),
      'modeles-lecture/manifest.json')

    expect(manifeste.schemaVersion).toBe('1')
    expect(Object.entries(manifeste.routes).filter(([, indicators]) => indicators.length > 0)
      .map(([theme, indicators]) => `${theme}:${indicators.join(',')}`))
      .toEqual(['demographie:densite', 'mobilite:bornes_ev_par_station_service'])
  })

  it('valide chaque modèle d’indicateur publié sous l’adresse de sa route', () => {
    const manifeste = validerManifesteModelesLecture(readPublished('modeles-lecture', 'manifest.json'),
      'modeles-lecture/manifest.json')
    for (const [theme, indicators] of Object.entries(manifeste.routes)) {
      for (const indicator of indicators ?? []) {
        const raw = readPublished('modeles-lecture', 'indicateurs', theme, `${indicator}.json`)
        const modele = validerModeleIndicateur(raw, `modeles-lecture/indicateurs/${theme}/${indicator}.json`,
          territoiresPublies, { theme: theme as Theme, indicator })
        expect(modele.indicator, `${theme}/${indicator}`).toBe(indicator)
        expect(modele.theme, `${theme}/${indicator}`).toBe(theme)
        expect(modele.page.indicator, `${theme}/${indicator}`).toBe(indicator)
      }
    }
  })

  it.each([
    { schema_version: '2', routes: {} },
    { schema_version: '1', routes: { inconnu: ['densite'] } },
    { schema_version: '1', routes: { demographie: ['densite', 'densite'] } },
    { schema_version: '1', routes: { demographie: ['densite invalide'] } },
  ])('rejette un manifeste de routes invalide', (raw) => {
    expect(() => validerManifesteModelesLecture(raw, 'manifest.json')).toThrow()
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
  })

  it.each([
    ['une route qui ne correspond pas au modèle', (raw: Record<string, unknown>) => { raw.indicator = 'autre' }],
    ['un marqueur read_model non booléen', (raw: Record<string, unknown>) => { (raw.page as Record<string, unknown>).read_model = 'oui' }],
    ['une direction inconnue', (raw: Record<string, unknown>) => { (raw.page as Record<string, unknown>).direction = 'descriptif' }],
    ['un fait hors de la page déclarée', (raw: Record<string, unknown>) => {
      const facts = raw.facts as Array<Record<string, unknown>>
      if (facts.length) facts[0]!.key = 'hors_page'
    }],
  ])('rejette un modèle d’indicateur invalide : %s', (_nom, muter) => {
    const densite = indicateursDemographieFixture.filter(
      (fact) => fact.key === 'densite' && fact.type !== 'region',
    )
    const raw = {
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
    }
    muter(raw as unknown as Record<string, unknown>)
    expect(() => validerModeleIndicateur(raw, 'densite.json', territoiresFixture,
      { theme: 'demographie', indicator: 'densite' })).toThrow()
  })

  it('rejette un modèle dont la ressource source référencée est absente', () => {
    const densite = indicateursDemographieFixture.filter(
      (fact) => fact.key === 'densite' && fact.type !== 'region',
    )
    const raw = {
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
        sources: ['source_absente'],
      },
      detail_labels: {},
      source_records: metadonneesThemesFixtures.demographie.source_records,
      facts: densite,
    }
    expect(() => validerModeleIndicateur(raw, 'densite.json', territoiresFixture)).toThrow()
  })
})
