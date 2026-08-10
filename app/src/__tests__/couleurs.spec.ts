import { describe, expect, it } from 'vitest'

import {
  ANCRAGES_THEMES,
  COULEUR_CORAL,
  COULEUR_NEUTRE,
  COULEUR_NEUTRE_ZERO,
  echelleChoroplethe,
  LARGEUR_CONTOUR,
  rampeDivergente,
  rolesRampesTheme,
} from '../carte/couleurs'

/**
 * The map's color system (DESIGN.md §2): the choropleth ramp derives from ONE
 * anchor hex per theme — the app-side mirror of tokens.css, since MapLibre
 * paints cannot read CSS custom properties. The anchors here must match
 * DESIGN.md §2's table (the tokens contract locks the same values). The ramp
 * roles (wash/soft/line/strong) mirror the tokens.css §2 recipes — the fiche
 * and the map now read the same ramp (audit #208 item 56).
 */

describe('ANCRAGES_THEMES — the DESIGN.md §2 anchors, mirrored for the map', () => {
  it('uses the four theme anchors locked by DESIGN.md §2', () => {
    expect(ANCRAGES_THEMES).toEqual({
      mobilite: '#6BA3B5', // teal
      demographie: '#8E85C4', // indigo
      habitat: '#C98F6E', // terracotta
      economie: '#D9A441', // amber — or/ambre, hors du vert-bleu de marque (#214)
      milieux: '#A99A5E', // olive/kaki — l'axe terre, l'ancrage provisoire du cinquième thème (ADR-0014)
    })
  })
})

describe('COULEUR_NEUTRE — the neutral mask fill (issue #68)', () => {
  const ANCIENNE_NEUTRE = '#BFD5D0' // avant #68 — trop présente sur le fond positron clair
  const luminance = (hex: string) => {
    const r = Number.parseInt(hex.slice(1, 3), 16)
    const g = Number.parseInt(hex.slice(3, 5), 16)
    const b = Number.parseInt(hex.slice(5, 7), 16)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }

  it('is lighter than the pre-polish value — the fill sits back against the basemap', () => {
    expect(luminance(COULEUR_NEUTRE)).toBeGreaterThan(luminance(ANCIENNE_NEUTRE))
  })

  it('stays in the mint/green-grey family (green dominant) — still reads at commune level', () => {
    const r = Number.parseInt(COULEUR_NEUTRE.slice(1, 3), 16)
    const g = Number.parseInt(COULEUR_NEUTRE.slice(3, 5), 16)
    const b = Number.parseInt(COULEUR_NEUTRE.slice(5, 7), 16)
    expect(COULEUR_NEUTRE).toMatch(/^#[A-Fa-f0-9]{6}$/)
    expect(g).toBeGreaterThanOrEqual(r)
    expect(g).toBeGreaterThanOrEqual(b)
  })
})

describe('LARGEUR_CONTOUR — the mask outline width (issue #68)', () => {
  it('is a hairline — tightened below the pre-polish 1.2px, still visible', () => {
    expect(LARGEUR_CONTOUR).toBeLessThan(1.2)
    expect(LARGEUR_CONTOUR).toBeGreaterThanOrEqual(0.5)
  })
})

describe('rolesRampesTheme — the theme ramp roles (tokens.css §2 recipe, audit #208 item 56)', () => {
  it('mirrors the tokens.css §2 color-mix recipes for the habitat anchor', () => {
    // color-mix(in oklab, #C98F6E 8%, #F8FBFB) / 16% over #FFFFFF / the anchor / 62% over #0C1B19
    expect(rolesRampesTheme('#C98F6E')).toEqual({
      wash: '#f5f2ef',
      soft: '#f7ede7',
      line: '#C98F6E',
      strong: '#7c604c',
    })
  })

  it('derives wash (lightest) → strong (darkest) for every theme anchor', () => {
    const luminance = (hex: string) => {
      const r = Number.parseInt(hex.slice(1, 3), 16)
      const g = Number.parseInt(hex.slice(3, 5), 16)
      const b = Number.parseInt(hex.slice(5, 7), 16)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    for (const ancrage of Object.values(ANCRAGES_THEMES)) {
      const roles = rolesRampesTheme(ancrage)
      expect(luminance(roles.wash)).toBeGreaterThan(luminance(roles.soft))
      expect(luminance(roles.soft)).toBeGreaterThan(luminance(roles.line))
      expect(luminance(roles.line)).toBeGreaterThan(luminance(roles.strong))
    }
  })

  it('throwing on an invalid hex — the drift guard', () => {
    expect(() => rolesRampesTheme('pas-une-couleur')).toThrow(RangeError)
  })
})

describe('echelleChoroplethe — the one-anchor ramp', () => {
  it('returns as many steps as requested, light to dark', () => {
    const rampe = echelleChoroplethe('#8E85C4', 5)

    expect(rampe).toHaveLength(5)
    // la clarté perçue décroît : première étape la plus claire (le wash de la rampe)
    expect(rampe[0]).toMatch(/^#[A-Fa-f0-9]{6}$/)
  })

  it('collapses to the theme poles: wash (light) → strong (dark), not a white/ink mix', () => {
    // 2 classes = the ramp's two extremes — the fiche's wash and strong roles,
    // NOT an anchor-mix with pure white / #0C1B19 (audit #208 item 56).
    const rampe = echelleChoroplethe('#C98F6E', 2)
    expect(rampe).toEqual(['#f5f2ef', '#7c604c'])
  })

  it('walks the role path: 4 classes = wash, soft, line, strong (the roles verbatim)', () => {
    // Un échantillonnage à 4 classes retombe exactement sur les 4 rôles.
    expect(echelleChoroplethe('#C98F6E', 4)).toEqual([
      '#f5f2ef', // wash
      '#f7ede7', // soft
      '#c98f6e', // line — the anchor itself
      '#7c604c', // strong
    ])
  })

  it('lightest step mixes the anchor toward the wash base, darkest toward strong', () => {
    const rampe = echelleChoroplethe('#8E85C4', 2)

    const premiere = rampe[0]
    const derniere = rampe[1]
    expect(premiere !== derniere).toBe(true)
    // wash : #8E85C4 (142,133,196) à 8 % sur #F8FBFB → chaque canal ≥ 200
    const r = Number.parseInt(premiere.slice(1, 3), 16)
    const g = Number.parseInt(premiere.slice(3, 5), 16)
    const b = Number.parseInt(premiere.slice(5, 7), 16)
    expect(r).toBeGreaterThanOrEqual(200)
    expect(g).toBeGreaterThanOrEqual(200)
    expect(b).toBeGreaterThanOrEqual(210)
    // strong : 62 % vers #0C1B19 (12,27,25) → chaque canal < celui de l'ancre
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

describe('COULEUR_CORAL — le contre-hue partagé de la rampe divergente (ADR-0019)', () => {
  it('mirror du jeton --mode-car (tokens.css §2) — le pôle négatif de toutes les rampes divergentes', () => {
    expect(COULEUR_CORAL).toBe('#A94562')
  })
})

describe('COULEUR_NEUTRE_ZERO — le neutre clair à zéro (ADR-0019)', () => {
  it('est distinct du neutre « non disponible » — un territoire à zéro ne lit pas comme une donnée absente', () => {
    expect(COULEUR_NEUTRE_ZERO).not.toBe(COULEUR_NEUTRE)
  })

  it('est plus clair que le neutre « non disponible » — le zéro s’efface, la donnée manquante se voit', () => {
    const luminance = (hex: string) => {
      const r = Number.parseInt(hex.slice(1, 3), 16)
      const g = Number.parseInt(hex.slice(3, 5), 16)
      const b = Number.parseInt(hex.slice(5, 7), 16)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    expect(luminance(COULEUR_NEUTRE_ZERO)).toBeGreaterThan(luminance(COULEUR_NEUTRE))
  })
})

describe('rampeDivergente — la rampe à deux pôles (ADR-0019)', () => {
  it('throwing quand les seuils n’enjambent pas zéro — une rampe divergente a deux pôles', () => {
    expect(() => rampeDivergente('#8E85C4', [10, 20, 30])).toThrow(RangeError)
    expect(() => rampeDivergente('#8E85C4', [-30, -20, -10])).toThrow(RangeError)
  })

  it('rend une couleur par bucket : pôle négatif coral + neutre à zéro + pôle positif thème', () => {
    const rampe = rampeDivergente('#8E85C4', [-20, -5, 5, 15])
    expect(rampe).toHaveLength(5) // 2 coral + 1 neutre + 2 thème
    expect(rampe[2]).toBe(COULEUR_NEUTRE_ZERO) // le neutre clair est AU zéro
  })

  it('ancre le pôle négatif sur le coral partagé — foncé à clair, du fort au wash', () => {
    const rampe = rampeDivergente('#8E85C4', [-20, -5, 5, 15])
    // le plus négatif = le fort du coral (62 % vers #0C1B19), le plus proche de zéro = son wash
    expect(rampe[0]).toBe('#6b3745') // coral strong
    expect(rampe[1]).toBe('#f3ecee') // coral wash
  })

  it('ancre le pôle positif sur l’ancrage du thème — clair à foncé, du wash au fort', () => {
    const rampe = rampeDivergente('#8E85C4', [-20, -5, 5, 15])
    expect(rampe[3]).toBe('#eff1f7') // indigo wash
    expect(rampe[4]).toBe('#595a7d') // indigo strong
  })

  it('suit le chemin des rôles par côté — les extrêmes de la rampe sont les rôles wash/strong', () => {
    const rampe = rampeDivergente('#C98F6E', [-20, -10, -5, 5, 15])
    expect(rampe).toHaveLength(6) // 3 coral + 1 neutre + 2 terracotta
    expect(rampe[0]).toBe('#6b3745') // coral strong
    expect(rampe[3]).toBe(COULEUR_NEUTRE_ZERO)
    expect(rampe[4]).toBe('#f5f2ef') // terracotta wash
    expect(rampe[5]).toBe('#7c604c') // terracotta strong
  })

  it('est monotone en clarté sur chaque côté : le négatif fonce vers le pôle, le positif s’éclaircit', () => {
    const luminance = (hex: string) => {
      const r = Number.parseInt(hex.slice(1, 3), 16)
      const g = Number.parseInt(hex.slice(3, 5), 16)
      const b = Number.parseInt(hex.slice(5, 7), 16)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const rampe = rampeDivergente('#8E85C4', [-20, -10, -5, 5, 15])
    expect(luminance(rampe[0])).toBeLessThan(luminance(rampe[1]))
    expect(luminance(rampe[1])).toBeLessThan(luminance(rampe[2]))
    expect(luminance(rampe[4])).toBeGreaterThan(luminance(rampe[5]))
  })

  it('throwing sur un ancrage invalide — le garde-fou de dérive', () => {
    expect(() => rampeDivergente('pas-une-couleur', [-20, 5])).toThrow(RangeError)
  })
})
