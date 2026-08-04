import { describe, expect, it } from 'vitest'

import { ANCRAGES_THEMES, echelleChoroplethe } from '../carte/couleurs'

/**
 * The map's color system (DESIGN.md §2): the choropleth ramp derives from ONE
 * anchor hex per theme — the app-side mirror of tokens.css, since MapLibre
 * paints cannot read CSS custom properties. The anchors here must match
 * DESIGN.md §2's table (the tokens contract locks the same values).
 */

describe('ANCRAGES_THEMES — the DESIGN.md §2 anchors, mirrored for the map', () => {
  it('uses the four theme anchors locked by DESIGN.md §2', () => {
    expect(ANCRAGES_THEMES).toEqual({
      mobilite: '#6BA3B5', // teal
      demographie: '#8E85C4', // indigo
      habitat: '#C98F6E', // terracotta
      economie: '#7FA875', // green
    })
  })
})

describe('echelleChoroplethe — the one-anchor ramp', () => {
  it('returns as many steps as requested, light to dark', () => {
    const rampe = echelleChoroplethe('#8E85C4', 5)

    expect(rampe).toHaveLength(5)
    // la clarté perçue décroît : première étape la plus claire (mix blanc)
    expect(rampe[0]).toMatch(/^#[A-Fa-f0-9]{6}$/)
  })

  it('lightest step mixes the anchor toward white, darkest toward #0C1B19', () => {
    const rampe = echelleChoroplethe('#8E85C4', 2)

    const premiere = rampe[0]
    const derniere = rampe[1]
    expect(premiere !== derniere).toBe(true)
    // #8E85C4 (142,133,196) mixé à 88 % vers le blanc → chaque canal ≥ 200
    const r = Number.parseInt(premiere.slice(1, 3), 16)
    const g = Number.parseInt(premiere.slice(3, 5), 16)
    const b = Number.parseInt(premiere.slice(5, 7), 16)
    expect(r).toBeGreaterThanOrEqual(200)
    expect(g).toBeGreaterThanOrEqual(200)
    expect(b).toBeGreaterThanOrEqual(210)
    // dernière : mixé vers #0C1B19 (12,27,25) → chaque canal < celui de l'ancre
    const rd = Number.parseInt(derniere.slice(1, 3), 16)
    const gd = Number.parseInt(derniere.slice(3, 5), 16)
    const bd = Number.parseInt(derniere.slice(5, 7), 16)
    expect(rd).toBeLessThan(142)
    expect(gd).toBeLessThan(133)
    expect(bd).toBeLessThan(196)
  })

  it('is monotone: each step is strictly between its neighbours (light → dark)', () => {
    const rampe = echelleChoroplethe('#C98F6E', 6)
    const luminance = (hex: string) => {
      const r = Number.parseInt(hex.slice(1, 3), 16)
      const g = Number.parseInt(hex.slice(3, 5), 16)
      const b = Number.parseInt(hex.slice(5, 7), 16)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    for (let i = 1; i < rampe.length; i++) {
      expect(luminance(rampe[i])).toBeLessThan(luminance(rampe[i - 1]))
    }
  })

  it('throws on an invalid hex — the drift guard', () => {
    expect(() => echelleChoroplethe('pas-une-couleur', 3)).toThrow(RangeError)
    expect(() => echelleChoroplethe('#8E85C4', 1)).toThrow(RangeError)
  })
})
