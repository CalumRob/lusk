import { describe, expect, it } from 'vitest'

import {
  chargerMasques,
  validerCollectionMasque,
} from '../geo/chargerMasques'
import type { CollectionMasque } from '../geo/types'
import { PayloadError } from '../payload/validate'

/**
 * The geometry seam (ADR-0008) — the map's half of the pipeline's geometry
 * publish: fetch the three /data/*.geojson files, validate the FeatureCollection
 * contract loudly, and treat a 404 as an absent level (the honest state),
 * never a crash.
 */

const commune = {
  type: 'Feature',
  properties: { territoire: '22001', nom: 'Allineuc', type: 'commune' },
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
}

const collectionValide: CollectionMasque = {
  type: 'FeatureCollection',
  features: [commune],
}

interface ReponseBrute {
  ok: boolean
  status: number
  corps?: unknown
}

function fetchFixe(reponses: Record<string, ReponseBrute>) {
  return async (url: string) => {
    const nom = url.split('/').pop() ?? ''
    const r = reponses[nom]
    if (!r) return { ok: false, status: 404, json: async () => ({}) }
    return {
      ok: r.ok,
      status: r.status,
      json: async () => r.corps ?? {},
    }
  }
}

describe('validerCollectionMasque — the ADR-0008 contract', () => {
  it('accepts a valid FeatureCollection and preserves the territoire codes', () => {
    const validee = validerCollectionMasque(collectionValide, 'communes.geojson')

    expect(validee.type).toBe('FeatureCollection')
    expect(validee.features[0].properties.territoire).toBe('22001')
    expect(validee.features[0].properties.nom).toBe('Allineuc')
  })

  it('falls back to the code when nom is missing', () => {
    const validee = validerCollectionMasque(
      {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: { territoire: '22001', type: 'commune' }, geometry: commune.geometry },
        ],
      },
      'communes.geojson',
    )

    expect(validee.features[0].properties.nom).toBe('22001')
  })

  it('rejects a non-FeatureCollection with a typed validation error', () => {
    expect(() => validerCollectionMasque({ features: [] }, 'communes.geojson')).toThrow(PayloadError)
    expect(() => validerCollectionMasque({ features: [] }, 'communes.geojson')).toThrow(/FeatureCollection/)
  })

  it('rejects a feature without a territoire code', () => {
    expect(() =>
      validerCollectionMasque(
        {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: { nom: 'X' }, geometry: commune.geometry }],
        },
        'communes.geojson',
      ),
    ).toThrow(/sans code territoire/)
  })

  it('rejects a feature without a polygonal geometry', () => {
    expect(() =>
      validerCollectionMasque(
        {
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', properties: { territoire: '22001' }, geometry: { type: 'Point', coordinates: [0, 0] } },
          ],
        },
        'communes.geojson',
      ),
    ).toThrow(/géométrie polygonale/)
  })
})

describe('chargerMasques — the fetch seam', () => {
  it('loads the three mask files in parallel', async () => {
    const vus: string[] = []
    const fetchImpl = async (url: string) => {
      vus.push(url.split('/').pop() ?? '')
      return {
        ok: true,
        status: 200,
        json: async () => collectionValide,
      }
    }

    const masques = await chargerMasques({ baseUrl: '/data/', fetchImpl })

    expect(vus.sort()).toEqual(['communes.geojson', 'departements.geojson', 'epcis.geojson'])
    expect(masques.communes?.features).toHaveLength(1)
    expect(masques.epcis?.features).toHaveLength(1)
    expect(masques.departements?.features).toHaveLength(1)
  })

  it('treats a 404 as an absent level — honest, not an error', async () => {
    const masques = await chargerMasques({
      fetchImpl: fetchFixe({
        'communes.geojson': { ok: true, status: 200, corps: collectionValide },
      }),
    })

    expect(masques.communes).not.toBeNull()
    expect(masques.epcis).toBeNull()
    expect(masques.departements).toBeNull()
  })

  it('raises a typed fetch error on a non-404 HTTP failure', async () => {
    await expect(
      chargerMasques({
        fetchImpl: fetchFixe({
          'communes.geojson': { ok: false, status: 500 },
        }),
      }),
    ).rejects.toThrow(PayloadError)
  })

  it('raises a typed fetch error when the network fails', async () => {
    await expect(
      chargerMasques({
        fetchImpl: async () => {
          throw new Error('ECONNREFUSED')
        },
      }),
    ).rejects.toThrow(PayloadError)
  })

  it('raises a validation error when a file breaks the contract', async () => {
    await expect(
      chargerMasques({
        fetchImpl: fetchFixe({
          'communes.geojson': { ok: true, status: 200, corps: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { nom: 'X' }, geometry: commune.geometry }] } },
        }),
      }),
    ).rejects.toThrow(/sans code territoire/)
  })
})
