/**
 * The geometry contract (ADR-0008): static GeoJSON under /data/, produced by
 * the pipeline from IGN Admin Express (Licence Ouverte), filtered to Bretagne
 * and simplified. The app loads them as plain MapLibre vector sources — no
 * PMTiles protocol, no tile generation.
 *
 * Files: communes.geojson, epcis.geojson, departements.geojson. Each feature
 * carries the `territoire` code (INSEE code / SIREN) in its properties so the
 * map can join the fiche payload's KPIs for popups (name + 2–3 indicateurs +
 * « Voir la fiche »).
 */

/** The mask levels — the territory geometries the map can display. */
export const NIVEAUX_MASQUE = ['communes', 'epcis', 'departements'] as const
export type NiveauMasque = (typeof NIVEAUX_MASQUE)[number]

/** A GeoJSON geometry the map can render (Polygon or MultiPolygon, WGS84). */
export type GeometrieMasque =
  | { type: 'Polygon'; coordinates: unknown }
  | { type: 'MultiPolygon'; coordinates: unknown }

/** One feature of a mask file — the ADR-0008 contract. */
export interface FeatureTerritoire {
  type: 'Feature'
  properties: {
    territoire: string
    nom: string
    type: string
  }
  geometry: GeometrieMasque
}

/** The FeatureCollection shape of a /data/<niveau>.geojson file. */
export interface CollectionMasque {
  type: 'FeatureCollection'
  features: FeatureTerritoire[]
}

/** One loaded level — the collection, or null when the file is absent (404). */
export type Masque = CollectionMasque | null

/** The geometry state — the seam's output (a 404 per level is honest, not an error). */
export interface Masques {
  communes: Masque
  epcis: Masque
  departements: Masque
}

/** The French label of each mask level — the sidebar's layer controls. */
export const NOMS_NIVEAUX: Record<NiveauMasque, string> = {
  communes: 'Communes',
  epcis: 'EPCI',
  departements: 'Départements',
}
