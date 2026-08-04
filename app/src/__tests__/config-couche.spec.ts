import { describe, expect, it } from 'vitest'

import { configCoucheTheme } from '../carte/configCouche'

/** The theme → indicator-layer mapping (layouts.md §3): one choropleth per theme. */

describe('configCoucheTheme — the theme → layer mapping', () => {
  it('maps Démographie to the densité layer', () => {
    expect(configCoucheTheme('demographie')).toEqual({
      theme: 'demographie',
      indicateur: 'densite',
      libelle: 'Densité de population',
    })
  })

  it('maps Habitat to the passoires thermiques layer', () => {
    expect(configCoucheTheme('habitat')).toEqual({
      theme: 'habitat',
      indicateur: 'part_passoires',
      libelle: 'Part de passoires thermiques',
    })
  })

  it('maps Mobilité to null — no choropleth contract yet (masks only)', () => {
    expect(configCoucheTheme('mobilite')).toBeNull()
  })

  it('maps Économie to null — no choropleth contract yet (masks only)', () => {
    expect(configCoucheTheme('economie')).toBeNull()
  })
})
