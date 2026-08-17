import { describe, expect, it } from 'vitest'

import {
  COULEURS_DPE,
  ORDRE_DPE,
  couleurDpe,
  couleurTexteDpe,
} from '../fiche/couleursDpe'

/**
 * Les couleurs officielles DPE (nouvelle échelle 2021) — la source unique de
 * vérité de la figure de composition distribution_dpe (#371). Jamais la
 * palette du thème.
 */
describe('couleursDpe — la référence officielle A→G', () => {
  it('déclare les sept étiquettes A→G dans l’ordre canonique', () => {
    expect(ORDRE_DPE).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G'])
  })

  it('mappe chaque étiquette à sa couleur officielle (référence ADEME 2021)', () => {
    expect(COULEURS_DPE.A).toBe('#008659')
    expect(COULEURS_DPE.B).toBe('#2BAE6E')
    expect(COULEURS_DPE.C).toBe('#C7E600')
    expect(COULEURS_DPE.D).toBe('#FFB400')
    expect(COULEURS_DPE.E).toBe('#F06D00')
    expect(COULEURS_DPE.F).toBe('#E3000F')
    expect(COULEURS_DPE.G).toBe('#9B134C')
  })

  it('couleurDpe renvoie null pour une étiquette hors contrat — aucune couleur inventée', () => {
    expect(couleurDpe('H')).toBeNull()
    expect(couleurDpe('')).toBeNull()
    expect(couleurDpe('A')).toBe('#008659')
  })
})

describe('couleursDpe — le contraste de texte clé sur la LETTRE (A–G)', () => {
  it('donne un texte sombre aux étiquettes claires (C jaune, D orange), blanc aux autres', () => {
    expect(couleurTexteDpe('C')).toBe('#1a1a1a')
    expect(couleurTexteDpe('D')).toBe('#1a1a1a')
    expect(couleurTexteDpe('A')).toBe('#ffffff')
    expect(couleurTexteDpe('B')).toBe('#ffffff')
    expect(couleurTexteDpe('E')).toBe('#ffffff')
    expect(couleurTexteDpe('F')).toBe('#ffffff')
    expect(couleurTexteDpe('G')).toBe('#ffffff')
  })
})
