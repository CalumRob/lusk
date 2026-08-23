import { describe, expect, it } from 'vitest'
import { metadonneesThemesFixtures } from '../payload/fixtures'
import { PayloadError, validerThemeMetadata } from '../payload/validate'

describe('contrat des pages d’indicateur', () => {
  it('keeps the public label separate from the typed direction', () => {
    const metadata = structuredClone(metadonneesThemesFixtures.demographie)
    expect(metadata.indicator_pages!.densite.label).toBe('Densité de population')
    expect(metadata.indicator_pages!.densite.direction).toBe('high')
  })

  it.each([
    ['direction typée', (meta: any) => { meta.indicator_pages.densite.direction = 'Descriptif' }],    ['niveau dupliqué', (meta: any) => { meta.indicator_pages.densite.levels = ['commune', 'commune'] }],
    ['source inconnue', (meta: any) => { meta.indicator_pages.densite.sources = ['missing'] }],
    ['détail invalide', (meta: any) => { meta.indicator_pages.densite.detail = 42 }],
    ['clé/indicateur incohérents', (meta: any) => { meta.indicator_pages.densite.indicator = 'autre' }],
    ['source de référence absente de la page', (meta: any) => { meta.indicator_pages.densite.sources = ['age_detail'] }],
    ['vintage dupliqué', (meta: any) => { meta.indicator_pages.densite.vintage = 'ancienne valeur' }],
    ['famille inconnue', (meta: any) => { meta.indicator_pages.densite.family = 'unknown' }],
    ['facette indicateur inconnue', (meta: any) => { meta.indicator_pages.densite.comparison = { indicator: 'unknown' } }],
    ['facette sexe invalide', (meta: any) => { meta.indicator_pages.densite.comparison = { sexes: ['X'] } }],
    ['facette dimension invalide', (meta: any) => { meta.indicator_pages.densite.comparison = { dimensions: [42] } }],
    ['facette direction invalide', (meta: any) => { meta.indicator_pages.densite.comparison = { direction: 'sideways' } }],
    ['facette libellé invalide', (meta: any) => { meta.indicator_pages.densite.comparison = { labels: { total: 42 } } }],
  ])('rejette %s', (_name, mutate) => {
    const metadata = structuredClone(metadonneesThemesFixtures.demographie)
    mutate(metadata)
    expect(() => validerThemeMetadata(metadata, 'theme_demographie.json')).toThrow()
  })

  it.each(['scalar', 'trajectory', 'composition', 'distribution', 'relationship', 'list', 'pyramid', 'comparison-bars'] as const)('accepte la famille %s', (family) => {
    const metadata = structuredClone(metadonneesThemesFixtures.demographie)
    metadata.indicator_pages!.densite.family = family
    const extensions: Record<string, unknown> = { trajectory: { endpoints: ['debut', 'fin'] }, composition: { parts: ['a'] }, distribution: { signature: 'x', summary: 'y' }, relationship: { roles: { x: 'a', y: 'b' }, measure: 'r' }, list: { categories: ['a'] }, pyramid: { dimensions: ['detail', 'sex'] }, 'comparison-bars': { series: ['a'] } }
    if (family !== 'scalar') (metadata.indicator_pages!.densite as any)[family === 'comparison-bars' ? 'comparison-bars' : family] = extensions[family]
    // #431 : le contrat composition/pyramid est complet dans les DEUX miroirs
    // (R + app) — chaque part porte son libellé canonical, la pyramide déclare
    // detail/sex et ses sexes, sans condition sur la présence de detail_labels
    if (family === 'composition') {
      ;(metadata.detail_labels as any).densite = { a: 'Part A' }
      ;(metadata.indicator_pages!.densite as any).comparison = { details: ['a'], detail: 'a', unit: '%', labels: { a: 'Part A' } }
    }
    if (family === 'pyramid') (metadata.indicator_pages!.densite as any).comparison = { sexes: ['F', 'M'], sex: 'F', unit: '%' }
    expect(() => validerThemeMetadata(metadata, 'theme_demographie.json')).not.toThrow()
  })

  it.each([
    ['trajectory', { endpoints: ['', 'fin'] }], ['composition', { parts: [] }],
    ['distribution', { signature: 'x', summary: '' }], ['list', { categories: [''] }],
    ['pyramid', { dimensions: [''] }], ['comparison-bars', { series: [''] }],
  ] as const)('rejette les extensions %s vides', (family, extension) => {
    const metadata = structuredClone(metadonneesThemesFixtures.demographie)
    metadata.indicator_pages!.densite.family = family
    ;(metadata.indicator_pages!.densite as any)[family === 'comparison-bars' ? 'comparison-bars' : family] = extension
    expect(() => validerThemeMetadata(metadata, 'theme_demographie.json')).toThrow()
  })

  // L'union discriminée par famille est NORMALISÉE par le validateur (#437) :
  // une page scalaire sans `family` (la forme héritée #401) sort avec
  // `family: 'scalar'` — plus jamais un alias optionnel qui ne fait rien.
  it('normalise la page scalaire héritée avec sa famille « scalar »', () => {
    const metadata = structuredClone(metadonneesThemesFixtures.demographie)
    const { family: _familleHeritee, ...pageSansFamille } = metadata.indicator_pages!.densite
    ;(metadata.indicator_pages as any).densite = pageSansFamille
    const validee = validerThemeMetadata(metadata, 'theme_demographie.json')
    expect(validee.indicator_pages!.densite.family).toBe('scalar')
  })
})

// La parité négative stricte R/app des descripteurs composition/pyramid
// (issue #431) : libellés de détail, parts, dimensions detail/sex et sexes
// sont requis SANS CONDITION — le miroir exact de valider_theme_metadata
// (pipeline/R/theme_metadata.R), jamais un verdict qui dépend de la présence
// d'une carte detail_labels pour la clé.
describe('contrat des pages composition/pyramid — le miroir strict de R (#431)', () => {
  function pageEvolution(extra: Record<string, unknown>): any {
    return {
      indicator: 'evolution_1968', detail: null,
      label: 'Évolution depuis 1968', definition: 'La population de la commune depuis 1968.',
      unit: '%', calculation: 'Variation annuelle moyenne.', direction: 'low',
      caveats: 'Les séries antérieures sont rétropolées.',
      levels: ['commune', 'epci', 'departement'],
      sources: ['serie_historique'],
      ...extra,
    }
  }

  function verdictErreur(metadata: unknown): PayloadError {
    let erreur: unknown
    try { validerThemeMetadata(metadata, 'theme_demographie.json') } catch (e) { erreur = e }
    expect(erreur).toBeInstanceOf(PayloadError)
    return erreur as PayloadError
  }

  it.each([
    ['une part sans libellé canonical — aucune carte de détail pour la clé', (meta: any) => {
      meta.indicator_pages.evolution_1968 = pageEvolution({ family: 'composition', composition: { parts: ['avant', 'apres'] } })
    }, /libellé/],
    ['une pyramide dont les dimensions n\u2019incluent pas sex', (meta: any) => {
      meta.indicator_pages.evolution_1968 = pageEvolution({ family: 'pyramid', pyramid: { dimensions: ['detail'] }, comparison: { sexes: ['F', 'M'], sex: 'F', unit: '%' } })
    }, /detail et sex/],
    ['une pyramide sans comparison.sexes', (meta: any) => {
      meta.indicator_pages.evolution_1968 = pageEvolution({ family: 'pyramid', pyramid: { dimensions: ['detail', 'sex'] } })
    }, /requis pour une pyramide/],
    ['des parts absentes de l\u2019extension — le miroir de composition = list()', (meta: any) => {
      meta.indicator_pages.evolution_1968 = pageEvolution({ family: 'composition', composition: {} })
    }, /incomplet/],
  ])('rejette %s — le même verdict que R (#431)', (_nom, muter, motif) => {
    const metadata = structuredClone(metadonneesThemesFixtures.demographie)
    muter(metadata)
    expect(verdictErreur(metadata).message).toMatch(motif)
  })

  it('rejette une part dont le libellé manque dans une carte de détail existante', () => {
    const metadata = structuredClone(metadonneesThemesFixtures.demographie)
    ;(metadata.indicator_pages!.densite as any).family = 'composition'
    ;(metadata.indicator_pages!.densite as any).composition = { parts: ['<15', 'fantome'] }
    ;(metadata.detail_labels as any).densite = { '<15': 'Moins de 15 ans' }
    ;(metadata.indicator_pages!.densite as any).comparison = { details: ['<15'], detail: '<15', unit: '%', labels: { '<15': 'Moins de 15 ans' } }
    expect(verdictErreur(metadata).message).toMatch(/libellé/)
  })
})
