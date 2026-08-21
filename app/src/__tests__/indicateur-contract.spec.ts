import { describe, expect, it } from 'vitest'
import { metadonneesThemesFixtures } from '../payload/fixtures'
import { validerThemeMetadata } from '../payload/validate'

describe('contrat des pages d’indicateur', () => {
  it('keeps the public label separate from the typed direction', () => {
    const metadata = structuredClone(metadonneesThemesFixtures.demographie)
    expect(metadata.indicator_pages!.densite.label).toBe('Densité de population')
    expect(metadata.indicator_pages!.densite.direction).toBe('high')
  })

  it.each([
    ['direction typée', (meta: any) => { meta.indicator_pages.densite.direction = 'Descriptif' }],
    ['niveau dupliqué', (meta: any) => { meta.indicator_pages.densite.levels = ['commune', 'commune'] }],
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

  it.each(['scalar', 'trajectory', 'composition', 'distribution', 'profile', 'relationship', 'pyramid', 'comparison-bars'] as const)('accepte la famille %s', (family) => {
    const metadata = structuredClone(metadonneesThemesFixtures.demographie)
    metadata.indicator_pages!.densite.family = family
    expect(() => validerThemeMetadata(metadata, 'theme_demographie.json')).not.toThrow()
  })
})
