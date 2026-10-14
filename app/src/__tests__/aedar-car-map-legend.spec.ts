import { describe, expect, it, vi } from 'vitest'

import { fetchAedarCarMapLegend, parseAedarCarMapLegend } from '@/fiche/content/aedarCarMapLegend'
import { carInlineLegend } from './fixtures/aedar-car-inline-legend'

const territory = { type: 'departement' as const, code: '35', name: 'Ille-et-Vilaine' }

describe('AEDAR car-map legend metadata', () => {
  it('uses the image-bound production label, colors, limits and display ticks without a Bretagne mean tick', () => {
    expect(parseAedarCarMapLegend(carInlineLegend(territory), territory)).toEqual({
      title: 'Types d’équipements accessibles en 15 minutes*',
      minimum: 0,
      maximum: 218,
      colors: ['#716ca2', '#8f85b1', '#ad9ebf', '#b186a3', '#ac5b78'],
      tickLabels: ['0', '44', '87', '131', '174', '218'],
      note: '* Sur 235 catégories d’équipements BPE',
    })
  })

  it('fetches the car image sidecar and preserves producer display strings instead of rounding them again', async () => {
    const raw = carInlineLegend(territory)
    raw.scale.minimum = 10
    raw.scale.maximum = 100
    raw.scale.boundaries = [10, 28, 46, 64, 82, 100]
    raw.scale.display_ticks = ['10', '28,0', '46', '64,0', '82', '100']
    raw.label = 'Libellé publié'
    raw.helper = 'Précision publiée.'
    const request = vi.fn(async () => ({ ok: true, json: async () => raw }) as Response)

    const legend = await fetchAedarCarMapLegend(territory, request as typeof fetch)
    expect(request).toHaveBeenCalledWith('https://images.calumrobertson.fr/maps/aedar/v1/35-car-inline.json')
    expect(legend).toMatchObject({
      title: 'Libellé publié*', minimum: 10, maximum: 100,
      tickLabels: ['10', '28,0', '46', '64,0', '82', '100'],
      note: 'Précision publiée. * Sur 235 catégories d’équipements BPE',
    })
  })

  it.each<[string, (raw: ReturnType<typeof carInlineLegend>) => void]>([
    ['territory code', (raw) => { raw.territory.code = '56' }],
    ['territory kind', (raw) => { raw.territory.kind = 'epci' }],
    ['mode', (raw) => { raw.mode = 'walk' }],
    ['measure', (raw) => { raw.measure = 'equipment_loss' }],
    ['horizon', (raw) => { raw.horizon_minutes = 20 }],
    ['image key', (raw) => { raw.image.key = 'maps/aedar/v1/35-car-inspection.webp' }],
    ['image hash', (raw) => { raw.image.sha256 = 'invalid' }],
    ['image size', (raw) => { raw.image.bytes = 0 }],
    ['scale scope', (raw) => { raw.scale.scope = 'territory-local-pooled-loss' }],
    ['palette', (raw) => { raw.scale.colours = ['not a color'] }],
    ['tick count', (raw) => { raw.scale.display_ticks = ['0', '218'] }],
    ['empty tick', (raw) => { raw.scale.display_ticks[1] = '' }],
    ['scale limits', (raw) => { raw.scale.maximum = -1 }],
    ['boundaries', (raw) => { raw.scale.boundaries[2] = 0 }],
  ])('rejects mismatched or invalid %s instead of inventing a legend', (_, invalidate) => {
    const raw = carInlineLegend(territory)
    invalidate(raw)
    expect(() => parseAedarCarMapLegend(raw, territory)).toThrow(/AEDAR/i)
  })

  it('rejects missing or unreadable metadata instead of returning the old hardcoded palette', async () => {
    const missing = vi.fn(async () => ({ ok: false, status: 404 }) as Response)
    await expect(fetchAedarCarMapLegend(territory, missing as typeof fetch)).rejects.toThrow(/indisponibles/i)
    const malformed = vi.fn(async () => new Response('invalid json', { status: 200 }))
    await expect(fetchAedarCarMapLegend(territory, malformed as typeof fetch)).rejects.toThrow(/JSON/)
  })

  it('rejects an unsafe territory code before issuing a request', async () => {
    const request = vi.fn()
    await expect(fetchAedarCarMapLegend({ ...territory, code: '../private' }, request)).rejects.toThrow(/territoire/i)
    expect(request).not.toHaveBeenCalled()
  })
})
