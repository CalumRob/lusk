import { describe, expect, it } from 'vitest'

import type { Territoire } from '../payload/types'
import {
  TRI_PAR_DEFAUT,
  correspondAuNom,
  departementsPresent,
  epcisPourDepartement,
  filtrerParDepartement,
  filtrerParEpci,
  nomsEpci,
  territoiresDeType,
  trierTerritoires,
  valeurColonne,
} from '../listes/listes'
import { territoiresFixture } from '../payload/fixtures'

/**
 * The data-list domain (site-map.md §Data lists, layouts.md §4): pure
 * functions behind the /communes, /epcis and /departements link directories.
 * Each list is payload.territoires filtered to one type, narrowed by the
 * département/EPCI filters and the name search (accent-insensitive — the same
 * normaliserTexte the global search uses), then sorted. Nothing here touches
 * the DOM, the router or the fetch layer.
 */

/** A commune whose name needs accent-insensitive matching (fixtures are accent-free). */
const communeAccent: Territoire = {
  territoire: '22077',
  type: 'commune',
  nom: 'Plœuc-sur-Lié',
  departement: '22',
  epci: '200000001',
}

const communesFixture = territoiresFixture.filter((t) => t.type === 'commune')

describe('listes — filtrage par type', () => {
  it('keeps only the rows of the requested type', () => {
    expect(territoiresDeType(territoiresFixture, 'commune').map((t) => t.territoire)).toEqual([
      '22001',
      '22002',
      '29001',
      '29002',
    ])
    expect(territoiresDeType(territoiresFixture, 'epci').map((t) => t.territoire)).toEqual([
      '200000001',
      '200000002',
    ])
    expect(territoiresDeType(territoiresFixture, 'departement').map((t) => t.territoire)).toEqual([
      '22',
      '29',
    ])
  })
})

describe('listes — la recherche par nom', () => {
  it('matches case-insensitively', () => {
    expect(correspondAuNom(communesFixture[0], 'commune a1')).toBe(true)
    expect(correspondAuNom(communesFixture[0], 'COMMUNE')).toBe(true)
  })

  it('matches accent-insensitively ("ploeuc" finds "Plœuc-sur-Lié")', () => {
    expect(correspondAuNom(communeAccent, 'ploeuc')).toBe(true)
    expect(correspondAuNom(communeAccent, 'PLŒUC-SUR-LIE')).toBe(true)
  })

  it('treats an empty query as matching everything', () => {
    expect(correspondAuNom(communesFixture[0], '')).toBe(true)
    expect(correspondAuNom(communesFixture[0], '   ')).toBe(true)
  })

  it('rejects a name that does not contain the query', () => {
    expect(correspondAuNom(communesFixture[0], 'zzz')).toBe(false)
  })
})

describe('listes — les filtres département et EPCI', () => {
  it('null filters keep the whole list', () => {
    expect(filtrerParDepartement(communesFixture, null)).toHaveLength(4)
    expect(filtrerParEpci(communesFixture, null)).toHaveLength(4)
  })

  it('keeps only the rows of the selected département', () => {
    expect(filtrerParDepartement(communesFixture, '29').map((t) => t.territoire)).toEqual([
      '29001',
      '29002',
    ])
  })

  it('keeps only the rows of the selected EPCI', () => {
    expect(filtrerParEpci(communesFixture, '200000002').map((t) => t.territoire)).toEqual([
      '29001',
      '29002',
    ])
  })
})

describe('listes — les options EPCI du filtre', () => {
  it('lists the distinct EPCIs of the communes, all départements by default', () => {
    expect(epcisPourDepartement(communesFixture, null)).toEqual(['200000001', '200000002'])
  })

  it('restricts the EPCIs to the selected département', () => {
    expect(epcisPourDepartement(communesFixture, '22')).toEqual(['200000001'])
    expect(epcisPourDepartement(communesFixture, '29')).toEqual(['200000002'])
  })
})

describe('listes — les valeurs de colonne', () => {
  const noms = nomsEpci(territoiresFixture)

  it('resolves the EPCI column to the EPCI name, never the SIREN', () => {
    expect(valeurColonne(communesFixture[0], 'epci', noms)).toBe('EPCI X')
  })

  it('returns an empty string for a commune without EPCI (sorts last)', () => {
    const orpheline: Territoire = {
      territoire: '99999',
      type: 'commune',
      nom: 'Commune Orpheline',
      departement: '22',
      epci: null,
    }
    expect(valeurColonne(orpheline, 'epci', noms)).toBe('')
  })

  it('gives the raw code for the code and département columns', () => {
    expect(valeurColonne(communesFixture[0], 'code', noms)).toBe('22001')
    expect(valeurColonne(communesFixture[0], 'departement', noms)).toBe('22')
  })
})

describe('listes — le tri', () => {
  const noms = nomsEpci(territoiresFixture)

  it('defaults to name ascending', () => {
    expect(TRI_PAR_DEFAUT).toEqual({ cle: 'nom', sens: 'asc' })
  })

  it('sorts by name, ascending and descending', () => {
    const asc = trierTerritoires(communesFixture, TRI_PAR_DEFAUT, noms).map((t) => t.nom)
    expect(asc).toEqual(['Commune A1', 'Commune B', 'Commune C', 'Commune D'])

    const desc = trierTerritoires(communesFixture, { cle: 'nom', sens: 'desc' }, noms).map(
      (t) => t.nom,
    )
    expect(desc).toEqual(['Commune D', 'Commune C', 'Commune B', 'Commune A1'])
  })

  it('sorts by code', () => {
    const parCode = trierTerritoires(
      communesFixture,
      { cle: 'code', sens: 'asc' },
      noms,
    ).map((t) => t.territoire)
    expect(parCode).toEqual(['22001', '22002', '29001', '29002'])
  })

  it('sorts by the resolved EPCI name, ties broken by code', () => {
    const parEpci = trierTerritoires(
      communesFixture,
      { cle: 'epci', sens: 'asc' },
      noms,
    ).map((t) => t.territoire)
    // EPCI X (22001, 22002) sorts before EPCI Y (29001, 29002)
    expect(parEpci).toEqual(['22001', '22002', '29001', '29002'])
  })

  it('sorts by département', () => {
    const parDep = trierTerritoires(
      communesFixture,
      { cle: 'departement', sens: 'asc' },
      noms,
    ).map((t) => t.territoire)
    expect(parDep).toEqual(['22001', '22002', '29001', '29002'])
  })

  it('sorts by the EPCI name, descending', () => {
    const parEpciDesc = trierTerritoires(
      communesFixture,
      { cle: 'epci', sens: 'desc' },
      noms,
    ).map((t) => t.territoire)
    expect(parEpciDesc).toEqual(['29001', '29002', '22001', '22002'])
  })

  it('does not mutate its input', () => {
    const avant = communesFixture.map((t) => t.territoire)
    trierTerritoires(communesFixture, { cle: 'nom', sens: 'desc' }, noms)
    expect(communesFixture.map((t) => t.territoire)).toEqual(avant)
  })
})

describe('listes — les puces département', () => {
  it('derives the chips from the rows, sorted', () => {
    expect(departementsPresent(communesFixture)).toEqual(['22', '29'])
    expect(departementsPresent(territoiresFixture.filter((t) => t.type === 'epci'))).toEqual([
      '22',
      '29',
    ])
  })
})
