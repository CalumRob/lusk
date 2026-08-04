/**
 * THE GEOMETRY SEAM — the only module that touches the raw GeoJSON under
 * /data/ (ADR-0008). Mirror of the payload loader (payload/loader.ts): fetch
 * injectable, typed errors (PayloadError — the UI's error state), contract
 * drift is loud, and a 404 on a mask level means the level is absent (honest
 * state — the layer control disables it), never a crash.
 *
 * The real geometry is published by the pipeline (a pipeline ticket); until
 * then the demo files live in public/data/. The app does not care which
 * produced them — the contract is the FeatureCollection shape in geo/types.ts.
 */

import { PayloadError } from '../payload/validate'
import type { CollectionMasque, Masques } from './types'

/** The minimal Response surface the loader needs (fetch() satisfies it). */
export interface ReponseFetch {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export type FetchImpl = (url: string) => Promise<ReponseFetch>

export interface ChargerMasquesOptions {
  /** Base of the /data/ hosting — defaults to '/data/' (nginx alias). */
  baseUrl?: string
  /** Injected for tests; defaults to the real fetch. */
  fetchImpl?: FetchImpl
}

export const FICHIERS_MASQUES = ['communes', 'epcis', 'departements'] as const
export type NomFichierMasque = (typeof FICHIERS_MASQUES)[number]

function estObjet(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

/**
 * The app's half of the geometry contract: a FeatureCollection whose features
 * carry `properties.territoire` (string) and a Polygon/MultiPolygon geometry.
 * Anything else is contract drift — loud, never a silent wrong map.
 */
export function validerCollectionMasque(brut: unknown, fichier: string): CollectionMasque {
  if (!estObjet(brut) || brut.type !== 'FeatureCollection' || !Array.isArray(brut.features)) {
    throw new PayloadError(
      'validation',
      fichier,
      `${fichier} n'est pas une FeatureCollection (ADR-0008)`,
    )
  }
  const features = (brut.features as unknown[]).map((feature, index) => {
    if (!estObjet(feature) || feature.type !== 'Feature' || !estObjet(feature.properties)) {
      throw new PayloadError(
        'validation',
        fichier,
        `Feature ${index} de ${fichier} invalide (ADR-0008)`,
      )
    }
    const { territoire, nom, type } = feature.properties as Record<string, unknown>
    if (typeof territoire !== 'string' || territoire === '') {
      throw new PayloadError(
        'validation',
        fichier,
        `Feature ${index} de ${fichier} sans code territoire`,
      )
    }
    const geom = feature.geometry
    if (
      !estObjet(geom) ||
      (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') ||
      !Array.isArray(geom.coordinates)
    ) {
      throw new PayloadError(
        'validation',
        fichier,
        `Feature ${index} de ${fichier} sans géométrie polygonale`,
      )
    }
    return {
      type: 'Feature' as const,
      properties: {
        territoire,
        nom: typeof nom === 'string' ? nom : territoire,
        type: typeof type === 'string' ? type : '',
      },
      geometry:
        geom.type === 'Polygon'
          ? { type: 'Polygon' as const, coordinates: geom.coordinates }
          : { type: 'MultiPolygon' as const, coordinates: geom.coordinates },
    }
  })
  return { type: 'FeatureCollection', features }
}

/**
 * Fetch and validate the three mask files in parallel. A 404 on a level means
 * the level is absent (the honest state), any other failure is a typed
 * PayloadError (kind 'fetch' — the UI's Retry path).
 */
export async function chargerMasques(options: ChargerMasquesOptions = {}): Promise<Masques> {
  const baseUrl = options.baseUrl ?? '/data/'
  const fetchImpl = options.fetchImpl ?? ((url: string) => fetch(url))

  async function obtenir(niveau: NomFichierMasque): Promise<CollectionMasque | null> {
    const fichier = `${niveau}.geojson`
    const url = `${baseUrl}${fichier}`
    let reponse: ReponseFetch
    try {
      reponse = await fetchImpl(url)
    } catch (cause) {
      throw new PayloadError(
        'fetch',
        fichier,
        `Impossible de charger ${url} : ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }
    if (!reponse.ok) {
      if (reponse.status === 404) return null
      throw new PayloadError('fetch', fichier, `Réponse HTTP ${reponse.status} pour ${url}`)
    }
    let brut: unknown
    try {
      brut = await reponse.json()
    } catch {
      throw new PayloadError('fetch', fichier, `JSON illisible dans ${url}`)
    }
    return validerCollectionMasque(brut, fichier)
  }

  const [communes, epcis, departements] = await Promise.all([
    obtenir('communes'),
    obtenir('epcis'),
    obtenir('departements'),
  ])
  return { communes, epcis, departements }
}
