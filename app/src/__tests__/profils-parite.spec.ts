import { describe, expect, it } from 'vitest'

import { indicateursMobiliteFixture, metadonneesThemesFixtures } from '../payload/fixtures'
import { PayloadError, verifierPariteListes } from '../payload/validate'
import type { ListPageMetadata, Payload } from '../payload/types'

/**
 * La garde de parité listes ↔ faits publiés (#439) — le miroir TS de
 * verifier_parite_listes (theme_metadata.R), appelée au chargement : les
 * catégories déclarées d'une page « list » couvrent EXACTEMENT les détails
 * publiés de sa clé. Le cas miroir le plus important : une catégorie
 * déclarée jamais publiée échoue FORT — jamais une ligne morte dans le
 * profil ; et un détail publié absent des catégories n'est jamais effacé
 * du profil en silence.
 */

// La page de liste minimale du contrat — la même forme que le descripteur
// épinglé de Mobilité (types complets, jamais un littéral partiel).
const CATEGORIES = ['t_longueur', 't_densite', 'b_longueur', 'b_densite', 'c_longueur', 'c_densite']
const pageListe: ListPageMetadata = {
  indicator: 'reseaux',
  detail: null,
  label: 'Réseaux à pied / vélo / voiture',
  definition: 'Les longueurs et densités de réseau par mode de déplacement.',
  unit: 'km',
  calculation: 'Longueurs et densités publiées par le pipeline.',
  direction: 'high',
  caveats: 'La couverture du réseau dépend de la source publiée.',
  levels: ['commune', 'epci', 'departement'],
  sources: ['amenagements_cyclables'],
  family: 'list',
  list: { categories: [...CATEGORIES] },
}

// Les faits publiés viennent du fixture Mobilité typé : ses lignes reseaux
// portent exactement les six catégories déclarées.
function payloadAvec(categories: string[]): Payload {
  return {
    territoires: [],
    indicateurs: indicateursMobiliteFixture,
    histoires: [],
    apercu: null,
    runReport: null,
    vintages: null,
    programmes: null,
    themeMetadata: { mobilite: { ...metadonneesThemesFixtures.mobilite, indicator_pages: { reseaux: { ...pageListe, list: { categories } } } } },
  }
}

describe('verifierPariteListes — la garde listes ↔ payload (#439)', () => {
  it('rejette une catégorie déclarée jamais publiée — le même verdict que R', () => {
    expect(() => verifierPariteListes(payloadAvec(CATEGORIES))).not.toThrow()

    const morte = payloadAvec([...CATEGORIES, 'Z'])
    expect(() => verifierPariteListes(morte)).toThrow(PayloadError)
    try {
      verifierPariteListes(morte)
    } catch (e) {
      expect((e as PayloadError).message).toMatch(/catégorie « Z » de « reseaux » déclaré jamais publié/)
    }
  })

  it('rejette un détail publié absent des catégories déclarées — jamais un profil amputé en silence', () => {
    const amputee = payloadAvec(CATEGORIES.filter((detail) => detail !== 'c_densite'))
    expect(() => verifierPariteListes(amputee)).toThrow(PayloadError)
    try {
      verifierPariteListes(amputee)
    } catch (e) {
      expect((e as PayloadError).message).toMatch(/détail « c_densite » de « reseaux » publié absent des catégories déclarées/)
    }
  })
})
