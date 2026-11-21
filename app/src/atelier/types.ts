/**
 * Input contracts of the Atelier model — synthetic fixtures and the discovery
 * projection are shaped here. No framework, no derived value, no direction.
 */

import type { AtelierLevel, CellRef } from './state'

/** The producer-declared Cellule addressing block carried by discovery (#1075/#1076). */
export interface CelluleCoordinateValue {
  value: string
  label: string
  unit: string | null
}
export interface CelluleCoordinate {
  name: string
  values: CelluleCoordinateValue[]
}
export interface CelluleDeclaration {
  coordinates: CelluleCoordinate[]
  valid_combinations?: Array<Record<string, string>>
  default_point?: Record<string, string>
}

/** Structural subset of a discovery resource the Atelier consumes. */
export interface DiscoveryResource {
  resource_id: string
  label: string
  unit: string
  sources: string[]
  shapes: string[]
  cellule?: CelluleDeclaration
}

/** One dataset actually used by an observation, keyed by producer identity. */
export interface CohortSource {
  sourceId: string
  name: string
  vintageId?: string
  version?: string
  referenceDate?: string
  publicationDate?: string
}

export interface CohortValue {
  /** Territory identity from the published cohort member. */
  territory: string
  type: string
  nom: string
  /** Absent, suppressed, non-finite or uncovered: null, never zero. */
  value: number | null
  sources: CohortSource[]
}

export type CohortAvailability =
  | { status: 'available' }
  | { status: 'publication_unavailable'; reason: string; family: string }
  | { status: 'unsupported_shape'; shape: string }

/**
 * One whole-level cohort admitted for one Cellule at one level. The key is
 * `${cellKey}|${level}`: a Cellule bound twice at the same level is one cohort;
 * the same Cellule at another level is a different whole-level read.
 */
export interface AdmittedCohort {
  key: string
  cell: CellRef
  level: AtelierLevel
  availability: CohortAvailability
  values: CohortValue[]
}

/** The exact semantic read the acquisition asks the shared client for. */
export interface CelluleDemand {
  key: string
  cell: CellRef
  level: AtelierLevel
  item: {
    resource: string
    target: { kind: 'territory_cohort'; type: AtelierLevel }
    coordinates: Record<string, string[]>
    intent: { kind: 'facts' }
  }
}
