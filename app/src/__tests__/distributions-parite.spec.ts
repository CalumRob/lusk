import { describe, expect, it } from 'vitest'

import { PayloadError, verifierPariteDistributions } from '../payload/validate'
import type { Payload } from '../payload/types'

/**
 * La garde de parité distributions ↔ faits publiés (#440) — le miroir TS de
 * verifier_parite_distributions (theme_metadata.R), appelée au chargement :
 * la signature déclarée couvre EXACTEMENT les détails publiés de sa clé.
 * Le cas miroir le plus important : un détail de signature déclaré jamais
 * publié échoue FORT — jamais une barre morte dans les Repères.
 */
describe('verifierPariteDistributions — la garde distributions ↔ payload (#440)', () => {
  it('rejette un détail de signature déclaré jamais publié — le même verdict que R', () => {
    const faits = ['A', 'B', 'C'].map((detail) => ({ territoire: '22001', type: 'commune' as const, theme: 'habitat' as const, key: 'distribution_dpe', detail, value: 0.1, unit: '%', sex: null, dimension: null }))
    const valide: Payload = { territoires: [], indicateurs: faits, histoires: [], apercu: null, runReport: null, vintages: null, programmes: null, themeMetadata: { habitat: { indicator_pages: { distribution_dpe: { family: 'distribution', distribution: { signature: ['A', 'B', 'C'] } } } } } as Payload['themeMetadata'][keyof Payload['themeMetadata']] }
    expect(() => verifierPariteDistributions(valide)).not.toThrow()

    const mort = { ...valide, themeMetadata: { habitat: { indicator_pages: { distribution_dpe: { family: 'distribution', distribution: { signature: ['A', 'B', 'C', 'Z'] } } } } } as Payload['themeMetadata'][keyof Payload['themeMetadata']] }
    expect(() => verifierPariteDistributions(mort)).toThrow(PayloadError)
    try {
      verifierPariteDistributions(mort)
    } catch (e) {
      expect((e as PayloadError).message).toMatch(/détail « Z » de « distribution_dpe » déclaré jamais publié/)
    }
  })
})
