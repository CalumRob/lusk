import { describe, expect, it } from 'vitest'

import { couchesDuTheme } from '../carte/coucheModel'
import { groupesCouchesCarte } from '../fiche/content/ficheGrammar'
import type { Couche, EntreeCouches } from '../carte/coucheModel'
import { indicateursDemographieFixture, indicateursEconomieFixture, indicateursHabitatFixture,
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
  it('keeps native map candidates ordered by shared grammar across supported themes', () => {
    const cases: Array<{ theme: Theme; indicators: Indicateur[] }> = [
      { theme: 'demographie', indicators: indicateursDemographieFixture },
      { theme: 'mobilite', indicators: indicateursMobiliteFixture },
      { theme: 'habitat', indicators: indicateursHabitatFixture },
      { theme: 'milieux', indicators: indicateursMilieuxFixture },
      { theme: 'economie', indicators: indicateursEconomieFixture },
    ]

    for (const { theme, indicators } of cases) {
      const grammar = groupesCouchesCarte(theme)
      const declarations = nativeResources(theme) as unknown as SemanticResourceDeclaration[]
      const payload = payloadAvec(indicators, [], undefined, theme)
      const model = couchesDuTheme(payload, theme, { declarations, axes: {}, nativeContracts: {} })
      const layers = model.entrees.flatMap((entry) => entry.type === 'couche' ? [entry.couche] : entry.groupe.couches)
      const eligibleResourceKeys = grammar.flatMap((group) => group.resourceKeys.filter((key) => {
        const declaration = declarations.find((candidate) => candidate.resource_id === key && candidate.indicator_id === key)
        const hasScalar = declaration?.shapes.includes('scalar')
        const hasDetails = declaration?.axis_values?.some(([axis, values]) => axis === 'detail' && values.length > 0)
        return declaration?.map_eligible === true && (hasScalar || hasDetails)
      }))
      const indicatorLayers = layers.filter((layer): layer is Couche => 'clef' in layer && layer.source === 'indicateur')
      const actualResourceKeys = [...new Set(indicatorLayers.map((layer) => layer.clef))]

      expect(model.coucheParDefaut, theme).toBeNull()
      expect(actualResourceKeys, theme).toEqual(eligibleResourceKeys)
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
