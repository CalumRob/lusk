import { describe, expect, it } from 'vitest'

import { indicateursHabitatFixture, metadonneesThemesFixtures } from '../payload/fixtures'
import { PayloadError, verifierPariteDistributions } from '../payload/validate'
import type { DistributionPageMetadata, Payload } from '../payload/types'

/**
 * La garde de parité distributions ↔ faits publiés (#440) — le miroir TS de
 * verifier_parite_distributions (theme_metadata.R), appelée au chargement :
 * la signature déclarée couvre EXACTEMENT les détails publiés de sa clé.
 * Le cas miroir le plus important : un détail de signature déclaré jamais
 * publié échoue FORT — jamais une barre morte dans les Repères.
 */

// La page de distribution minimale du contrat — la même forme que le
// descripteur épinglé de Habitat (types complets, jamais un littéral partiel).
const pageDistribution: DistributionPageMetadata = {
  indicator: 'distribution_dpe',
  detail: null,
  label: 'Distribution des étiquettes DPE (A à G)',
  definition: 'Répartition des diagnostics de performance énergétique par étiquette.',
  unit: '%',
  calculation: 'Part de chaque étiquette parmi les diagnostics disponibles.',
  direction: 'low',
  caveats: 'La comparaison porte sur la part de passoires thermiques (F/G).',
  levels: ['commune', 'epci', 'departement'],
  sources: ['dpe_22'],
  family: 'distribution',
  distribution: { signature: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] },
}

// Les faits publiés viennent du fixture Habitat typé : ses sept lignes
// distribution_dpe portent exactement les détails A→G de 22001.
function payloadAvec(signature: string[]): Payload {
  return {
    territoires: [],
    indicateurs: indicateursHabitatFixture,
    histoires: [],
    apercu: null,
    runReport: null,
    vintages: null,
    programmes: null,
    themeMetadata: { habitat: { ...metadonneesThemesFixtures.habitat, indicator_pages: { distribution_dpe: { ...pageDistribution, distribution: { signature } } } } },
  }
}

describe('verifierPariteDistributions — la garde distributions ↔ payload (#440)', () => {
  it('rejette un détail de signature déclaré jamais publié — le même verdict que R', () => {
    expect(() => verifierPariteDistributions(payloadAvec(['A', 'B', 'C', 'D', 'E', 'F', 'G']))).not.toThrow()

    const mort = payloadAvec(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'Z'])
    expect(() => verifierPariteDistributions(mort)).toThrow(PayloadError)
    try {
      verifierPariteDistributions(mort)
    } catch (e) {
      expect((e as PayloadError).message).toMatch(/détail « Z » de « distribution_dpe » déclaré jamais publié/)
    }
  })
})
