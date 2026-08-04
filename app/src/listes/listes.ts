/**
 * The data-list domain — the pure functions behind the /communes, /epcis and
 * /departements link directories (site-map.md §Data lists, layouts.md §4,
 * ui-elements.md §Table). Decision 2026-08-03: these pages are FILTERABLE
 * LINK DIRECTORIES serving the fiches — a search alternative. No KPI columns,
 * no computation.
 *
 * Each list is payload.territoires filtered to one type, then narrowed by the
 * département/EPCI filters and the name search (accent-insensitive — the same
 * normaliserTexte the global search uses, so "ploeuc" finds "Plœuc-sur-Lié"),
 * then sorted. Everything here is a pure function: no DOM, no router, no
 * fetch. The component (ListeTerritoires) wires these to the URL query state
 * and the template.
 */

import { normaliserTexte } from '../search/recherche'
import type { Territoire, TerritoireType } from '../payload/types'

/** A sortable column of a data list. */
export type CleColonne = 'nom' | 'code' | 'epci' | 'departement'

export type SensTri = 'asc' | 'desc'

/** The active sort — which column, which direction. */
export interface TriListe {
  cle: CleColonne
  sens: SensTri
}

/** One column of the list table. The actions column is implicit, always last. */
export interface ColonneListe {
  cle: CleColonne
  libelle: string
  triable: boolean
}

/**
 * The per-page configuration — what one data-list page renders. The three
 * views each define theirs (communes: nom | code | EPCI; EPCIs: nom | code |
 * département; départements: nom | code), the shared component renders it.
 */
export interface ConfigListe {
  type: 'commune' | 'epci' | 'departement'
  titre: string
  placeholderRecherche: string
  colonnes: ColonneListe[]
  libelleVide: string
  filtreDepartement: boolean
  filtreEpci: boolean
}

/** The initial sort: by name, ascending (the contract of the list pages). */
export const TRI_PAR_DEFAUT: TriListe = { cle: 'nom', sens: 'asc' }

/** The rows of one type — the list page is payload.territoires narrowed once. */
export function territoiresDeType(
  territoires: Territoire[],
  type: TerritoireType,
): Territoire[] {
  return territoires.filter((t) => t.type === type)
}

/** The département chips of a list, derived from the rows (22 · 29 · 35 · 56). */
export function departementsPresent(territoires: Territoire[]): string[] {
  const codes = new Set<string>()
  for (const t of territoires) if (t.departement) codes.add(t.departement)
  return [...codes].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))
}

/**
 * The name search: accent-insensitive "contains" (normaliserTexte strips
 * diacritics, so "ploeuc" matches "Plœuc-sur-Lié"). An empty query matches
 * everything — the caller short-circuits before this anyway.
 */
export function correspondAuNom(territoire: Territoire, requete: string): boolean {
  const requeteNormalisee = normaliserTexte(requete)
  if (requeteNormalisee === '') return true
  return normaliserTexte(territoire.nom).includes(requeteNormalisee)
}

/** The département filter — null means no filter. */
export function filtrerParDepartement(
  liste: Territoire[],
  departement: string | null,
): Territoire[] {
  if (departement === null) return liste
  return liste.filter((t) => t.departement === departement)
}

/** The EPCI filter (the commune list's epci column) — null means no filter. */
export function filtrerParEpci(liste: Territoire[], epci: string | null): Territoire[] {
  if (epci === null) return liste
  return liste.filter((t) => t.epci === epci)
}

/**
 * The EPCI filter's options: the distinct EPCIs of the communes, restricted to
 * the selected département (an EPCI from another département would produce an
 * empty list — a dead-end filter, so it is never offered). Returns the SIRENs.
 */
export function epcisPourDepartement(
  communes: Territoire[],
  departement: string | null,
): string[] {
  const codes = new Set<string>()
  for (const commune of filtrerParDepartement(communes, departement)) {
    if (commune.epci) codes.add(commune.epci)
  }
  return [...codes]
}

/** The SIREN → EPCI-name lookup (the table shows names, never SIRENs). */
export function nomsEpci(territoires: Territoire[]): Map<string, string> {
  const noms = new Map<string, string>()
  for (const t of territoires) if (t.type === 'epci') noms.set(t.territoire, t.nom)
  return noms
}

/**
 * The display value of a column for a row. The EPCI column resolves the SIREN
 * to the EPCI's name; empty strings stand for "no value" (sorted last).
 */
export function valeurColonne(
  territoire: Territoire,
  cle: CleColonne,
  noms: Map<string, string>,
): string {
  switch (cle) {
    case 'nom':
      return territoire.nom
    case 'code':
      return territoire.territoire
    case 'epci':
      return territoire.epci ? (noms.get(territoire.epci) ?? territoire.epci) : ''
    case 'departement':
      return territoire.departement ?? ''
  }
}

/** Ascending comparator — empty values always sort last, whatever the column. */
function comparer(va: string, vb: string): number {
  const videA = va === ''
  const videB = vb === ''
  if (videA && videB) return 0
  if (videA) return 1
  if (videB) return -1
  return va.localeCompare(vb, 'fr', { sensitivity: 'base', numeric: true })
}

/**
 * The sorted copy of a list — accent-insensitive locale-aware comparison,
 * ties broken by code (deterministic order). The input array is never mutated.
 */
export function trierTerritoires(
  liste: Territoire[],
  tri: TriListe,
  noms: Map<string, string>,
): Territoire[] {
  const direction = tri.sens === 'asc' ? 1 : -1
  return [...liste].sort((a, b) => {
    const cmp = comparer(valeurColonne(a, tri.cle, noms), valeurColonne(b, tri.cle, noms))
    if (cmp !== 0) return cmp * direction
    return a.territoire.localeCompare(b.territoire, 'fr', { numeric: true })
  })
}
