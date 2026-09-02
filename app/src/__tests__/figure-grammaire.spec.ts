import { describe, expect, it } from 'vitest'

import {
  accentPositionRang,
  directionIndicateur,
  glypheDirection,
  puceRangDirection,
} from '../fiche/figureGrammaire'
import {
  CAHIER_FIGURE_AXIS,
  CAHIER_FIGURE_GEOMETRY,
  CAHIER_FIGURE_GRID,
} from '../fiche/cahierFigureGrammaire'

/**
 * La grammaire des puces de rang (issue #371, parent #367) — le seam partagé
 * consommé par IndicatorFigure et FigureOffreCyclable. Tests du comportement
 * observable (glyphe + phrase accessible + accent), jamais des internes : le
 * sens vient du registre Méthodes (THEMES_METHODES), jamais d'une table
 * app-side dupliquée.
 */

describe('figureGrammaire — le glyphe et la phrase de direction', () => {
  it('dérive ▲ pour plus-est-mieux et ▼ pour moins-est-mieux', () => {
    expect(glypheDirection('plus-est-mieux')).toBe('▲')
    expect(glypheDirection('moins-est-mieux')).toBe('▼')
  })

  it('construit la puce avec le glyphe visible et la phrase accessible complète', () => {
    const puce = puceRangDirection('3e/41 de l’EPCI', 'plus-est-mieux')
    expect(puce.glyphe).toBe('▲')
    expect(puce.rang).toBe('3e/41 de l’EPCI')
    // la phrase complète porte dans title + aria-label — jamais le glyphe seul
    expect(puce.phrase).toBe('3e/41 de l’EPCI — plus = mieux')
  })

  it('donne la phrase « moins = mieux » pour un indicateur inversé', () => {
    const puce = puceRangDirection('27e/38 de l’EPCI', 'moins-est-mieux')
    expect(puce.glyphe).toBe('▼')
    expect(puce.phrase).toBe('27e/38 de l’EPCI — moins = mieux')
  })
})

describe('figureGrammaire — le socle géométrique du Cahier', () => {
  it('expose la géométrie 820×340 commune à la distribution et aux profils', () => {
    expect(CAHIER_FIGURE_GEOMETRY).toEqual({
      width: 820,
      height: 340,
      margin: { top: 38, right: 26, bottom: 58, left: 88 },
    })
  })

  it('dérive la grille ECharts des mêmes marges que le SVG', () => {
    expect(CAHIER_FIGURE_GRID).toEqual({
      left: '10.73%',
      right: '3.17%',
      top: '11.18%',
      bottom: '17.06%',
    })
  })

  it('garde les axes et les graduations sur la même mesure', () => {
    expect(CAHIER_FIGURE_AXIS).toEqual({ width: 1, tickLength: 7, xLabelOffset: 22, yLabelOffset: 12, yLabelBaseline: 4 })
  })
})

describe('figureGrammaire — la dérivation depuis le registre Méthodes', () => {
  it('lit le sens du classement dans THEMES_METHODES (jamais une table app-side)', () => {
    expect(directionIndicateur('demographie', 'densite')).toBe('plus-est-mieux')
    expect(directionIndicateur('habitat', 'prix_m2')).toBe('moins-est-mieux')
  })

  it('renvoie null pour un thème/clé hors registre — glyphe honnête absent', () => {
    expect(directionIndicateur('demographie', 'clef_inexistante')).toBeNull()
  })
})

describe('figureGrammaire — l’accent discret de position (tiers)', () => {
  it('renforce le tiers supérieur', () => {
    expect(accentPositionRang(1, 3)).toBe('fort')
    expect(accentPositionRang(1, 2)).toBe('fort')
  })

  it('atténue le tiers médian', () => {
    expect(accentPositionRang(2, 3)).toBe('faible')
    expect(accentPositionRang(5, 12)).toBe('faible')
  })

  it('laisse muet le tiers inférieur et les cas sans groupe', () => {
    expect(accentPositionRang(3, 3)).toBeNull()
    expect(accentPositionRang(2, 2)).toBeNull()
    expect(accentPositionRang(null, 3)).toBeNull()
    expect(accentPositionRang(1, null)).toBeNull()
  })
})
