import { describe, expect, it } from 'vitest'

import { couchesDuTheme } from '../carte/coucheModel'
import { valeurHistoireParTerritoire } from '../carte/fusion'
import { groupesCouchesCarte } from '../fiche/content/ficheGrammar'
import type { Couche, EntreeCouches } from '../carte/coucheModel'
import { histoiresDemographieFixture, histoiresEconomieFixture, histoiresHabitatFixture, histoiresMilieuxFixture,
  histoiresMobiliteFixture, indicateursDemographieFixture, indicateursEconomieFixture, indicateursHabitatFixture,
  indicateursMilieuxFixture, indicateursMobiliteFixture, metadonneesThemesFixtures,
  territoiresFixture, vintagesFixture } from '../payload/fixtures'
import type { Indicateur, Payload, Theme, ThemeMetadata } from '../payload/types'
import type { SemanticResourceDeclaration } from '../payload/semanticResourceClient'
import { nativeResources } from './helpers/semanticApiFixtures'

function resource(id: string, shape: string, overrides: Partial<SemanticResourceDeclaration> = {}): SemanticResourceDeclaration {
  return {
    resource_id: id, indicator_id: id, theme_id: 'demographie', label: `API ${id}`, unit: 'API-unit',
    direction: 'high', allowed_levels: ['commune'], sources: ['source-a'], shapes: [shape],
    target_kinds: ['territory_cohort'], fields: ['value'], intents: ['facts'],
    map_eligible: true, ...overrides,
  }
}

function payloadAvec(indicateurs: Indicateur[], histoires: Payload['histoires'], metadata?: ThemeMetadata,
  theme: Theme = 'demographie'): Payload {
  return { territoires: territoiresFixture, indicateurs, histoires, runReport: null, vintages: vintagesFixture,
    programmes: null, themeMetadata: metadata ? { [theme]: metadata } : {} }
}

function keyOf(entry: EntreeCouches): string[] {
  if (entry.type === 'couche') {
    if ('clef' in entry.couche) return [entry.couche.clef]
    return [entry.couche.source === 'membre' ? entry.couche.sigle : entry.couche.libelle]
  }
  return entry.groupe.couches.map((layer) => layer.detail ?? layer.clef)
}

describe('couchesDuTheme — ownership app grammar × native map contract (#827)', () => {
  const stories = histoiresDemographieFixture.map((row) => ({ ...row, mapApiFact: true }))

  it('keeps declared typed-reading layers and their default when the cohort has no observation rows', () => {
    const payload = payloadAvec([], [])
    const model = couchesDuTheme(payload, 'demographie', {
      declarations: [resource('demographie_selected_reading', 'typed_reading', {
        map_eligible: null,
        fields: ['groupe', 'story_key', 'periode', 'classification', 'taux_solde_naturel', 'not_a_map_field'],
        axis_values: [['groupe', ['trajectoire-demographique']]],
      })],
    })

    expect(model.entrees.flatMap(keyOf)).toEqual(['taux_solde_naturel'])
    expect(model.coucheParDefaut).toMatchObject({
      source: 'histoire', clef: 'taux_solde_naturel', sousGroupe: 'trajectoire-demographique', storyKey: null,
    })
    expect(payload.histoires).toEqual([])
  })

  it('keeps all-unavailable native reading layers, their producer story identity, and null values', () => {
    const unavailable = {
      territoire: '22001', type: 'commune', theme: 'demographie',
      groupe: 'trajectoire-demographique', story_key: 'lecture-native-independante', status: 'unavailable',
    } as unknown as Payload['histoires'][number]
    const payload = payloadAvec([], [unavailable])
    const model = couchesDuTheme(payload, 'demographie', {
      declarations: [resource('demographie_selected_reading', 'typed_reading', {
        map_eligible: null,
        fields: ['groupe', 'story_key', 'periode', 'classification', 'taux_solde_naturel',
          'taux_solde_migratoire', 'not_a_map_field'],
        axis_values: [['groupe', ['trajectoire-demographique']]],
      })],
    })

    expect(model.entrees.flatMap(keyOf)).toEqual(['taux_solde_naturel', 'taux_solde_migratoire'])
    expect(model.coucheParDefaut).toMatchObject({
      clef: 'taux_solde_naturel', sousGroupe: 'trajectoire-demographique', storyKey: 'lecture-native-independante',
    })
    expect(valeurHistoireParTerritoire(payload, 'demographie', 'taux_solde_naturel').get('22001'))
      .toEqual({ value: null, unit: '' })
    expect(payload.histoires).toEqual([unavailable])
  })

  it('orders app candidates and reading fields, intersected with native identities and eligibility', () => {
    const stale = structuredClone(metadonneesThemesFixtures.demographie)
    stale.indicator_keys = ['taille_menages', 'densite']
    stale.map_layers = { densite: false, evolution_1968: false }
    stale.subgroups = []
    const model = couchesDuTheme(payloadAvec(indicateursDemographieFixture, stories, stale), 'demographie', {
      declarations: [
        resource('demographie_selected_reading', 'typed_reading', {
          map_eligible: null,
          fields: ['groupe', 'story_key', 'taux_solde_naturel', 'taux_solde_migratoire'],
          axes: ['groupe'], axis_values: [['groupe', ['trajectoire-demographique']]],
        }),
        resource('densite', 'scalar'),
        resource('evolution_1968', 'scalar'),
        resource('structure_age', 'declared_profile', { map_eligible: false,
          axis_values: [['detail', ['<15', '15-24']]] }),
        resource('taille_menages', 'scalar', { map_eligible: false }),
      ],
      axes: {},
      nativeContracts: {},
      metadata: stale,
    })

    expect(model.coucheParDefaut).toMatchObject({
      source: 'histoire', clef: 'taux_solde_naturel', libelle: 'Solde naturel (‰/an)',
      sousGroupe: 'trajectoire-demographique',
    })
    expect(model.entrees.map(keyOf)).toEqual([
      ['taux_solde_naturel'], ['taux_solde_migratoire'], ['densite'], ['evolution_1968'],
    ])
    expect(model.entrees[1]).toMatchObject({
      type: 'groupe', groupe: { libelle: 'Trajectoire démographique' },
    })
    expect(model.entrees.flatMap(keyOf)).not.toContain('taille_menages')
    expect(model.entrees.flatMap(keyOf)).not.toContain('structure_age')
    expect(model.entrees.flatMap(keyOf)).not.toContain('classification')
  })

  it('keeps native map candidates ordered by shared grammar across supported themes', () => {
    const cases: { theme: Theme; indicators: Indicateur[]; histories: Payload['histoires']; defaultLayer: string | null }[] = [
      { theme: 'demographie', indicators: indicateursDemographieFixture,
        histories: histoiresDemographieFixture, defaultLayer: 'taux_solde_naturel' },
      { theme: 'mobilite', indicators: indicateursMobiliteFixture,
        histories: histoiresMobiliteFixture, defaultLayer: null },
      { theme: 'habitat', indicators: indicateursHabitatFixture,
        histories: histoiresHabitatFixture, defaultLayer: 'part_passoires' },
      { theme: 'milieux', indicators: indicateursMilieuxFixture,
        histories: histoiresMilieuxFixture, defaultLayer: 'delta_population' },
      { theme: 'economie', indicators: indicateursEconomieFixture,
        histories: histoiresEconomieFixture, defaultLayer: null },
    ]

    for (const { theme, indicators, histories, defaultLayer } of cases) {
      const grammar = groupesCouchesCarte(theme)
      const declarations = nativeResources(theme) as unknown as SemanticResourceDeclaration[]
      const payload = payloadAvec(indicators, histories, undefined, theme)
      const model = couchesDuTheme(payload, theme, { declarations, axes: {}, nativeContracts: {} })
      const layers = model.entrees.flatMap((entry) => entry.type === 'couche' ? [entry.couche] : entry.groupe.couches)
      const activeStoryFields = new Set(grammar.flatMap((group) => group.storyFields.filter((field) => {
        const binding = declarations.some((declaration) => declaration.shapes.includes('typed_reading') &&
          declaration.fields.includes(field) && declaration.axis_values?.some(([axis, values]) =>
            axis === 'groupe' && values.includes(group.key)))
        return binding && histories.some((row) => {
          const story = row as unknown as Record<string, unknown>
          return story.groupe === group.key && typeof story[field] === 'number'
        })
      })))
      const eligibleResourceKeys = grammar.flatMap((group) => group.resourceKeys.filter((key) => {
        const declaration = declarations.find((candidate) => candidate.resource_id === key && candidate.indicator_id === key)
        const hasScalar = declaration?.shapes.includes('scalar')
        const hasDetails = declaration?.axis_values?.some(([axis, values]) => axis === 'detail' && values.length > 0)
        return declaration?.map_eligible === true && (hasScalar || hasDetails)
      }))
      const indicatorLayers = layers.filter((layer): layer is Couche => 'clef' in layer && layer.source === 'indicateur')
      const actualResourceKeys = [...new Set(indicatorLayers
        .map((layer) => layer.clef))]
      const actualNonStoryKeys = actualResourceKeys.filter((key) => !activeStoryFields.has(key))
      const expectedNonStoryKeys = eligibleResourceKeys.filter((key) => !activeStoryFields.has(key))

      expect(model.coucheParDefaut?.clef ?? null, theme).toBe(defaultLayer)
      expect(new Set(actualResourceKeys), theme).toEqual(new Set(eligibleResourceKeys))
      expect(actualNonStoryKeys, theme).toEqual(expectedNonStoryKeys)
      for (const entry of model.entrees.filter((candidate) => candidate.type === 'groupe' &&
        candidate.groupe.couches.length > 0 && candidate.groupe.couches.every((layer) => layer.source === 'indicateur'))) {
        if (entry.type !== 'groupe') continue
        const key = entry.groupe.couches[0]!.clef
        const nativeDetails = declarations.find((declaration) => declaration.resource_id === key)
          ?.axis_values?.find(([axis]) => axis === 'detail')?.[1]
        if (nativeDetails?.length) expect(entry.groupe.couches.map((layer) => layer.detail), `${theme}/${key}`).toEqual(nativeDetails)
      }
    }
  })

  it('keeps both app-declared Milieux reading fields for populated, empty, and unavailable native cohorts', () => {
    const declarations = nativeResources('milieux') as unknown as SemanticResourceDeclaration[]
    const populated = couchesDuTheme(payloadAvec(indicateursMilieuxFixture, histoiresMilieuxFixture, undefined, 'milieux'),
      'milieux', { declarations })
    const readingKeys = (model: ReturnType<typeof couchesDuTheme>) => model.entrees
      .flatMap((entry) => entry.type === 'couche' ? [entry.couche] : entry.groupe.couches)
      .filter((layer): layer is Couche => 'clef' in layer && layer.source === 'histoire')
      .map((layer) => layer.clef)

    expect(readingKeys(populated)).toEqual(['delta_population', 'trajectoire_artif_par_habitant'])
    expect(populated.coucheParDefaut).toMatchObject({
      clef: 'delta_population', storyKey: 'se-densifier-setaler-ou-sen-aller',
    })

    const emptyPayload = payloadAvec([], [], undefined, 'milieux')
    const empty = couchesDuTheme(emptyPayload, 'milieux', { declarations })
    expect(readingKeys(empty)).toEqual(['delta_population', 'trajectoire_artif_par_habitant'])
    expect(empty.coucheParDefaut).toMatchObject({ clef: 'delta_population', storyKey: null })
    expect(emptyPayload.histoires).toEqual([])

    const unavailable = {
      territoire: '22001', type: 'commune', theme: 'milieux',
      groupe: 'artificialisation', story_key: 'se-densifier-setaler-ou-sen-aller', status: 'unavailable',
    } as unknown as Payload['histoires'][number]
    const unavailablePayload = payloadAvec([], [unavailable], undefined, 'milieux')
    const unavailableModel = couchesDuTheme(unavailablePayload, 'milieux', { declarations })
    expect(readingKeys(unavailableModel)).toEqual(['delta_population', 'trajectoire_artif_par_habitant'])
    expect(unavailableModel.coucheParDefaut).toMatchObject({
      clef: 'delta_population', storyKey: 'se-densifier-setaler-ou-sen-aller',
    })
    expect(valeurHistoireParTerritoire(unavailablePayload, 'milieux', 'trajectoire_artif_par_habitant').get('22001'))
      .toEqual({ value: null, unit: '' })
    expect(unavailablePayload.histoires).toEqual([unavailable])
  })

  it('keeps raccordement map admission on producer eligibility, not its native curve/reference axes', () => {
    const declarations = nativeResources('mobilite') as unknown as SemanticResourceDeclaration[]
    const model = couchesDuTheme(payloadAvec([], [], undefined, 'mobilite'), 'mobilite', {
      declarations, axes: {}, nativeContracts: {},
    })
    const layers = model.entrees.flatMap((entry) => entry.type === 'couche' ? [entry.couche] : entry.groupe.couches)
      .filter((layer): layer is Couche => 'clef' in layer && layer.source === 'indicateur')
      .map((layer) => layer.clef)

    expect(layers).toContain('offre_tc')
    expect(layers).toContain('raccordement_tc')
    expect(layers).not.toContain('raccordement_courbe')
    expect(layers).not.toContain('raccordement_reference')
  })

  it('uses native resource labels and axes before stale producer presentation metadata', () => {
    const facts = indicateursDemographieFixture.map((row) => row.key === 'structure_age'
      ? { ...row, nativeContract: {
        label: 'Structure par âge — contrat API', shapes: ['declared_profile'],
        axisValues: ['15-24', '<15'],
        axes: [
          { name: 'detail', key: '15-24', label: '15 à 24 ans — API', order: 0 },
          { name: 'detail', key: '<15', label: 'Moins de 15 ans — API', order: 1 },
        ],
      } }
      : row)
    const stale = structuredClone(metadonneesThemesFixtures.demographie)
    stale.indicator_labels.structure_age = 'Ancien label'
    stale.detail_labels.structure_age = { '15-24': 'Ancienne tranche', '<15': 'Ancienne tranche' }
    const model = couchesDuTheme(payloadAvec(facts, [], stale), 'demographie', {
      declarations: [resource('structure_age', 'declared_profile', {
        label: 'Structure par âge — catalogue API',
        axis_values: [['detail', ['15-24', '<15']]],
      })],
      axes: { structure_age: ['15-24', '<15'] },
      nativeContracts: { structure_age: facts.find((row) => row.key === 'structure_age')!.nativeContract! },
    })

    expect(model.entrees).toHaveLength(1)
    expect(model.entrees[0]).toMatchObject({ type: 'groupe', groupe: { libelle: 'Structure par âge — contrat API' } })
    expect(keyOf(model.entrees[0]!)).toEqual(['15-24', '<15'])
    if (model.entrees[0]?.type === 'groupe') {
      expect(model.entrees[0].groupe.couches.map((layer) => layer.libelle))
        .toEqual(['15 à 24 ans — API', 'Moins de 15 ans — API'])
    }
  })

  it('keeps fact-free app wording first and prefers fresh native factual labels over stale browser labels', () => {
    const stale = structuredClone(metadonneesThemesFixtures.demographie)
    stale.indicator_labels.densite = 'Ancien libellé de densité'
    stale.indicator_labels.evolution_1968 = 'Ancien libellé de trajectoire'
    const model = couchesDuTheme(payloadAvec([], [], stale), 'demographie', {
      declarations: [
        resource('densite', 'scalar', { label: 'Libellé natif récent pour densite' }),
        resource('evolution_1968', 'scalar', { label: 'Libellé de déclaration récent' }),
      ],
      nativeContracts: { evolution_1968: { label: 'Libellé factuel natif récent' } },
    })

    const layers = model.entrees.flatMap((entry) => entry.type === 'couche' ? [entry.couche] : entry.groupe.couches)
      .filter((layer): layer is Couche => 'clef' in layer)
    expect(layers.find((layer) => layer.clef === 'densite')?.libelle).toBe('Densité de population')
    expect(layers.find((layer) => layer.clef === 'evolution_1968')?.libelle).toBe('Libellé factuel natif récent')
    expect(layers.map((layer) => layer.libelle)).not.toContain('Ancien libellé de trajectoire')
  })

  it('keeps a sparse native scalar descriptor as a candidate without fabricating observations', () => {
    const model = couchesDuTheme(payloadAvec([], [], undefined), 'demographie', {
      declarations: [resource('densite', 'scalar')], axes: {}, nativeContracts: {},
    })

    expect(model.entrees).toEqual([{ type: 'couche', couche: expect.objectContaining({
      source: 'indicateur', clef: 'densite', libelle: 'Densité de population',
    }) }])
    expect(model.coucheParDefaut).toBeNull()
  })

  it('does not let a producer-excluded layer become eligible through app grammar', () => {
    const model = couchesDuTheme(payloadAvec([], [], undefined), 'demographie', {
      declarations: [resource('densite', 'scalar', { map_eligible: false })], axes: {}, nativeContracts: {},
    })
    expect(model.entrees).toEqual([])
  })
})
