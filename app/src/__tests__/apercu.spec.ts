import { describe, expect, it } from 'vitest'

import {
  LIEN_SUBVENTIONS,
  formaterValeurApercu,
  libelleApercu,
  libelleProgramme,
} from '../fiche/apercu'
import type { ApercuRow, Programme } from '../fiche/apercu'
import { apercuFixture } from '../payload/fixtures'

/**
 * The Aperçu tab's display vocabulary (app/src/fiche/apercu.ts) — the French
 * labels and the number formatting that turns the pipeline's apercu rows into
 * the figures the tab renders (CONTEXT.md §Aperçu). The pipeline stores
 * percentages as fractions in [0,1] (unit « % », value 0.15 = 15 %) — the
 * formatter's job is to say 15, never 0,15. Labels match the pipeline's own
 * declared libellés (theme_demographie.R §APERCU_DEMOGRAPHIE).
 */

const ligne = (key: string, value: number, unit: string): ApercuRow => ({
  territoire: '22001',
  type: 'commune',
  key,
  value,
  unit,
})

describe('formaterValeurApercu — the basic-stat figures', () => {
  it('formats a population with the French thousand separator', () => {
    expect(formaterValeurApercu(ligne('population', 2000, 'hab.'))).toBe('2\u202F000 hab.')
  })

  it('keeps the unit on the figure', () => {
    expect(formaterValeurApercu(ligne('densite', 200, 'hab/km²'))).toBe('200 hab/km²')
  })

  it('reads percentages as fractions: 0.15 → « 15 % »', () => {
    expect(formaterValeurApercu(ligne('part_65_plus', 0.15, '%'))).toBe('15 %')
  })

  it('rounds non-integer figures to a readable whole number', () => {
    expect(formaterValeurApercu(ligne('densite', 133.33333333333334, 'hab/km²'))).toBe(
      '133 hab/km²',
    )
  })

  it('renders an empty string for a null value — never a phantom figure', () => {
    expect(formaterValeurApercu({ ...ligne('part_65_plus', 0.15, '%'), value: null })).toBe('')
  })

  it('rounds a fractional percentage to the nearest whole per cent', () => {
    expect(formaterValeurApercu(ligne('part_65_plus', 0.19285714285714287, '%'))).toBe('19 %')
  })

  it('formats the fixture rows the R contract locked (population 22001 = 2000)', () => {
    const population = apercuFixture.find(
      (r) => r.territoire === '22001' && r.key === 'population',
    )
    expect(population).toBeDefined()
    expect(formaterValeurApercu(population!)).toBe('2\u202F000 hab.')
  })
})

describe('libelleApercu — the French label registry', () => {
  it('labels the pipeline keys with the pipeline’s own declared labels', () => {
    expect(libelleApercu('population')).toBe('Population')
    expect(libelleApercu('densite')).toBe('Densité de population')
    expect(libelleApercu('part_65_plus')).toBe('Part des 65 ans et plus')
  })

  it('falls back to the raw key for an undeclared key — never a blank label', () => {
    expect(libelleApercu('cle_inconnue')).toBe('cle_inconnue')
  })
})

describe('Programme — the programmes & financements element (CONTEXT.md)', () => {
  it('expands a programme to « sigle — nom » for its accessible name', () => {
    const acv: Programme = { sigle: 'ACV', nom: 'Action Cœur de Ville' }
    expect(libelleProgramme(acv)).toBe('ACV — Action Cœur de Ville')
  })

  it('keeps a programme without a distinct sigle as itself', () => {
    const programme: Programme = { sigle: "Territoires d'industrie", nom: "Territoires d'industrie" }
    expect(libelleProgramme(programme)).toBe("Territoires d'industrie")
  })

  it('points the Région subventions link at the Région Bretagne aides portal', () => {
    expect(LIEN_SUBVENTIONS.href).toBe('https://www.bretagne.bzh/aides/')
    expect(LIEN_SUBVENTIONS.libelle).toBe('Subventions de la Région Bretagne')
  })
})
