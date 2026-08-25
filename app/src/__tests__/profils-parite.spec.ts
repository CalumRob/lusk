import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { indicateursMobiliteFixture, metadonneesThemesFixtures } from '../payload/fixtures'
import { PayloadError, verifierPariteListes } from '../payload/validate'
import type { Indicateur, ListPageMetadata, Payload, ThemeMetadata } from '../payload/types'

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

// La garde sur le payload COMMITTÉ (#439) — le miroir du bloc R
// « verifier_parite_listes : le payload COMMITTÉ est en parité… »
// (test-theme-metadata.R) : les artefacts que l'app fetch réellement, lus
// depuis public/data et le canon épinglé par le motif établi
// (theme-metadata-parity.spec.ts). L'énumération y est le devoir : reseaux
// (Mobilité) puis subventions_par_domaine (#462) sont LES DEUX pages de
// famille « list » publiées à travers les six thèmes — jamais une famille
// orpheline, jamais une liste non déclarée.
describe('verifierPariteListes — le payload committé (#439)', () => {
  const themes = ['demographie', 'habitat', 'economie', 'mobilite', 'milieux', 'programmes'] as const
  const canonicalDir = join(process.cwd(), '..', 'pipeline', 'inst', 'extdata', 'theme-metadata')
  const publicDir = join(process.cwd(), '..', 'public', 'data')

  it('est en parité et les DEUX listes publiées sont déclarées à travers les six thèmes (#462)', () => {
    const pagesListes: string[] = []
    for (const theme of themes) {
      const metadata = JSON.parse(readFileSync(join(canonicalDir, `theme_${theme}.json`), 'utf8')) as ThemeMetadata
      const cles = Object.entries(metadata.indicator_pages ?? {}).filter(([, page]) => page.family === 'list').map(([cle]) => cle)
      if (!cles.length) continue
      const faits = JSON.parse(readFileSync(join(publicDir, `indicateurs_${theme}.json`), 'utf8')) as unknown as Indicateur[]
      verifierPariteListes({ territoires: [], indicateurs: faits, histoires: [], apercu: null, runReport: null, vintages: null, programmes: null, themeMetadata: { [theme]: metadata } })
      pagesListes.push(`${theme}:${cles.join(',')}`)
    }
    expect(pagesListes).toEqual(['mobilite:reseaux', 'programmes:subventions_par_domaine'])
  })
})
