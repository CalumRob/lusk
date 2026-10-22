import type { TerritoryIdentity } from '@/fiche/content/territoryFacts'

/** Published car sidecar shape; fixture values come from the CDN contract. */
export function carInlineLegend(territory: Pick<TerritoryIdentity, 'type' | 'code' | 'name'> = {
  type: 'commune', code: '22003', name: 'Aucaleuc',
}) {
  return {
    schema: 'lusk.aedar.inline-legend.v1',
    territory: { kind: territory.type, code: territory.code, name: territory.name },
    mode: 'car',
    measure: 'diversity',
    horizon_minutes: 15,
    label: 'Types d’équipements accessibles en 15 minutes',
    helper: null as string | null,
    image: {
      key: `maps/aedar/v1/${territory.code}-car-inline.webp`,
      sha256: 'a'.repeat(64),
      bytes: 57706,
    },
    scale: {
      type: 'equal-width',
      semantics: 'car-only-typequ',
      scope: 'absolute',
      minimum: 0,
      maximum: 218,
      boundaries: [0, 43.6, 87.2, 130.8, 174.4, 218],
      colours: ['#716ca2', '#8f85b1', '#ad9ebf', '#b186a3', '#ac5b78'],
      display_ticks: ['0', '44', '87', '131', '174', '218'],
      regional_reference: 120.76035790364342,
      regional_reference_label: 'Moy. Bretagne',
    },
  }
}
