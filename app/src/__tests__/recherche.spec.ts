import { describe, expect, it } from 'vitest'

import { territoiresFixture } from '../payload/fixtures'
import type { Territoire } from '../payload/types'
import {
  libelleType,
  normaliserTexte,
  rechercherIndicateurs,
  rechercherTerritoires,
} from '../search/recherche'
import type { EntreeRechercheIndicateur } from '../search/recherche'

/**
 * The search scoring/matching logic — pure functions, locked in isolation
 * before the component is built. Raw Territoire rows in, ranked matches out.
 * French names from LIBGEO/LIBEPCI carry diacritics, so accent-insensitive
 * matching is the contract: "rennes" must find "Rennes".
 */

/** Real Breton names — the accent/liaison shapes the fixture cannot show. */
const territoiresBretons: Territoire[] = [
  { territoire: '35238', type: 'commune', nom: 'Rennes', departement: '35', epci: '200043990' },
  { territoire: '35288', type: 'commune', nom: 'Saint-Malo', departement: '35', epci: '200066140' },
  { territoire: '35051', type: 'commune', nom: 'Bruz', departement: '35', epci: '200043990' },
  { territoire: '22113', type: 'commune', nom: 'Lannion', departement: '22', epci: '200065928' },
  { territoire: '29019', type: 'commune', nom: 'Brest', departement: '29', epci: '200026120' },
  { territoire: '29103', type: 'commune', nom: 'Quimper', departement: '29', epci: '200068120' },
  { territoire: '56121', type: 'commune', nom: 'Vannes', departement: '56', epci: '200067916' },
  { territoire: '56098', type: 'commune', nom: 'Lorient', departement: '56', epci: '200042174' },
  { territoire: '200043990', type: 'epci', nom: 'Rennes Métropole', departement: '35', epci: null },
  { territoire: '200066140', type: 'epci', nom: 'Saint-Malo Agglomération', departement: '35', epci: null },
  { territoire: '35', type: 'departement', nom: 'Ille-et-Vilaine', departement: '35', epci: null },
  { territoire: '53', type: 'region', nom: 'Bretagne', departement: null, epci: null },
]

describe('normaliserTexte — accent-insensitive, separator-tolerant normalization', () => {
  it('strips diacritics — "rennes" normalizes to the same form as "Rennes"', () => {
    expect(normaliserTexte('Rennes')).toBe('rennes')
    expect(normaliserTexte('Département')).toBe('departement')
    expect(normaliserTexte('Agglomération')).toBe('agglomeration')
  })

  it('lowercases and trims surrounding whitespace', () => {
    expect(normaliserTexte('  SAINT-MALO  ')).toBe('saint malo')
  })

  it('treats spaces, hyphens and apostrophes as equivalent separators', () => {
    expect(normaliserTexte('Saint-Malo')).toBe('saint malo')
    expect(normaliserTexte("L'Hermitage-Lorge")).toBe('l hermitage lorge')
    expect(normaliserTexte('L’Hermitage')).toBe('l hermitage')
  })

  it('expands French ligatures (œ, æ)', () => {
    expect(normaliserTexte('Rœux')).toBe('roeux')
    expect(normaliserTexte('Cæsar')).toBe('caesar')
  })

  it('expands uppercase ligatures too — lowercased before expansion', () => {
    expect(normaliserTexte('PLŒUC-SUR-LIÉ')).toBe('ploeuc sur lie')
    expect(normaliserTexte('ŒUVRES')).toBe('oeuvres')
  })
})

describe('rechercherTerritoires — search over the territoires reference table', () => {
  it('returns no results for an empty or whitespace-only query', () => {
    expect(rechercherTerritoires(territoiresBretons, '')).toEqual([])
    expect(rechercherTerritoires(territoiresBretons, '   ')).toEqual([])
  })

  it('returns no results when nothing matches', () => {
    expect(rechercherTerritoires(territoiresBretons, 'zzzz')).toEqual([])
  })

  it('finds every match on the reference table, sorted by score', () => {
    const resultats = rechercherTerritoires(territoiresBretons, 'rennes')

    // "Rennes" (exact) ranks above "Rennes Métropole" (prefix)
    expect(resultats.map((t) => t.territoire)).toEqual(['35238', '200043990'])
  })

  it('matches accent-insensitively — "departement" finds the Département rows', () => {
    const resultats = rechercherTerritoires(territoiresFixture, 'departement')

    expect(resultats.map((t) => t.territoire)).toEqual(['22', '29'])
    expect(resultats.map((t) => t.nom)).toEqual(['Département 22', 'Département 29'])
  })

  it('ranks a prefix match above a plain substring', () => {
    // "lo" is a prefix of "Lorient" but only a substring of "Saint-Malo"
    const resultats = rechercherTerritoires(territoiresBretons, 'lo')

    expect(resultats.map((t) => t.territoire)).toEqual([
      '56098', // Lorient — prefix, first
      '35288', // Saint-Malo — substring
      '200066140', // Saint-Malo Agglomération — substring
    ])
  })

  it('ranks a word-start match above a plain substring', () => {
    // "mal" starts a word in "Saint-Malo" but is only a substring elsewhere
    const resultats = rechercherTerritoires(territoiresBretons, 'mal')

    expect(resultats.map((t) => t.territoire)).toEqual(['35288', '200066140'])
  })

  it('breaks score ties by shortest name first, then alphabetically', () => {
    // "Saint-Malo" and "Saint-Malo Agglomération" are equal-score prefixes:
    // the shorter name ranks first
    const resultats = rechercherTerritoires(territoiresBretons, 'saint')

    expect(resultats.map((t) => t.territoire)).toEqual(['35288', '200066140'])
  })

  it('breaks an equal-length tie alphabetically (stable order)', () => {
    const resultats = rechercherTerritoires(territoiresFixture, 'epci')

    expect(resultats.map((t) => t.territoire)).toEqual(['200000001', '200000002'])
  })

  it('caps the results at 8 by default', () => {
    // "e" matches 9 of the 12 test territories — the default cap must hold at 8
    const resultats = rechercherTerritoires(territoiresBretons, 'e')

    expect(resultats.length).toBe(8)
  })

  it('honours a caller-provided limit', () => {
    const resultats = rechercherTerritoires(territoiresBretons, 'e', 3)

    expect(resultats.length).toBe(3)
  })
})

describe('libelleType — the French type chip label', () => {
  it('maps each territoire type to its French label', () => {
    expect(libelleType('commune')).toBe('Commune')
    expect(libelleType('epci')).toBe('EPCI')
    expect(libelleType('departement')).toBe('Département')
    expect(libelleType('region')).toBe('Région')
  })
})

/**
 * La recherche groupée (#409) : les entrées Indicateurs du catalogue partagent
 * la même mécanique d'appariement que les territoires — insensible aux
 * accents, préfixe avant sous-chaîne, borne de résultat.
 */
describe('rechercherIndicateurs — la moitié Indicateurs de la recherche groupée', () => {
  const entrees: EntreeRechercheIndicateur[] = [
    {
      theme: 'demographie',
      themeLabel: 'Démographie',
      label: 'Densité de population',
      href: '/indicateurs/demographie/densite',
    },
    {
      theme: 'habitat',
      themeLabel: 'Habitat',
      label: 'Distribution des étiquettes DPE (A à G)',
      href: '/indicateurs/habitat/distribution_dpe',
    },
    {
      theme: 'mobilite',
      themeLabel: 'Mobilité',
      label: "L'offre cyclable",
      href: '/indicateurs/mobilite/offre_cyclable',
    },
    {
      theme: 'programmes',
      themeLabel: 'Programmes et subventions',
      label: 'Subventions régionales attribuées',
      href: '/indicateurs/programmes/subventions_annuelles',
    },
  ]

  it('trouve par libellé, insensible aux accents et à la casse', () => {
    const resultats = rechercherIndicateurs(entrees, 'densite')
    expect(resultats.map((entree) => entree.href)).toEqual(['/indicateurs/demographie/densite'])
  })

  it('apparie un fragment au milieu du libellé (« cycl » → L’offre cyclable)', () => {
    const resultats = rechercherIndicateurs(entrees, 'cycl')
    expect(resultats.map((entree) => entree.label)).toEqual(["L'offre cyclable"])
  })

  it('classe les correspondances par qualité et borne le résultat demandé', () => {
    const resultats = rechercherIndicateurs(entrees, 'd')
    expect(resultats.length).toBeLessThanOrEqual(4)
    expect(resultats[0]!.label).toBe('Densité de population')
  })

  it('ne retourne rien pour une requête vide ou sans correspondance', () => {
    expect(rechercherIndicateurs(entrees, '')).toEqual([])
    expect(rechercherIndicateurs(entrees, '   ')).toEqual([])
    expect(rechercherIndicateurs(entrees, 'zzzz')).toEqual([])
  })

  it('aucune entrée (territoire ni indicateur) ne cible une surface retirée — /carte épargnée sans lien, /methodologie retirée (#410)', () => {
    // Les hrefs des indicateurs viennent du catalogue (contract-driven) ; les
    // territoires mènent aux fiches. Le verrou : aucune entrée de recherche
    // ne peut jamais mener à la carte standalone ni à Méthodes.
    const toutes = [
      ...entrees,
      ...rechercherTerritoires(territoiresFixture, 'a').map((t) => ({
        href: `/territoire/${t.type}/${t.territoire}`,
      })),
    ]
    for (const entree of toutes) {
      expect(entree.href.startsWith('/carte'), entree.href).toBe(false)
      expect(entree.href.startsWith('/methodologie'), entree.href).toBe(false)
    }
  })
})
