import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import AedarDiversityLossMapsCahier from '@/fiche/prototype/AedarDiversityLossMapsCahier.vue'

import {
  aedarDiversityLossSection,
  fetchAedarDiversityLossMapLegend,
  parseAedarInlineLegend,
} from '@/fiche/content/aedarDiversityLossMaps'
import type { TerritoryIdentity } from '@/fiche/content/territoryFacts'

const modes = ['walk', 'transit', 'bike_lts2', 'bike_lts4'] as const

const territory: TerritoryIdentity = {
  code: 'test-commune',
  type: 'commune',
  name: 'Test commune',
  department: null,
  epci: null,
}

function inlineLegend(mode: typeof modes[number], overrides: Record<string, unknown> = {}) {
  return {
    schema: 'lusk.aedar.inline-legend.v1',
    territory: { kind: territory.type, code: territory.code, name: territory.name },
    mode,
    measure: 'equipment_loss',
    horizon_minutes: 15,
    image: {
      key: `maps/aedar/v1/${territory.code}-${mode}-inline.webp`,
      sha256: 'a'.repeat(64),
      bytes: 36412,
    },
    scale: {
      type: 'equal-width',
      semantics: 'car-only-typequ',
      scope: 'territory-local-pooled-loss',
      minimum: 12,
      maximum: 92,
      boundaries: [12, 28, 44, 60, 76, 92],
      colours: ['#716ca2', '#8f85b1', '#ad9ebf', '#b186a3', '#ac5b78'],
      display_ticks: ['12', '28', '44,0', '60', '76', '92'],
      regional_reference: null,
      regional_reference_label: null,
    },
    ...overrides,
  }
}

describe('AEDAR diversity-loss map section', () => {
  it('uses the image-bound production sidecar tick labels verbatim', () => {
    expect(parseAedarInlineLegend(inlineLegend('walk'), territory, 'walk')).toEqual({
      colors: ['#716ca2', '#8f85b1', '#ad9ebf', '#b186a3', '#ac5b78'],
      tickLabels: ['12', '28', '44,0', '60', '76', '92'],
    })
  })

  it('rejects a sidecar for another image instead of borrowing its scale labels', () => {
    expect(() => parseAedarInlineLegend(inlineLegend('transit'), territory, 'walk'))
      .toThrow(/AEDAR/i)
  })

  it('rejects malformed production tick labels', () => {
    expect(() => parseAedarInlineLegend(inlineLegend('walk', {
      scale: { ...inlineLegend('walk').scale, display_ticks: ['12', '28'] },
    }), territory, 'walk')).toThrow(/AEDAR/i)
  })

  it('fetches and verifies the image-bound sidecar for every production loss map', async () => {
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const mode = modes.find((candidate) => String(input).endsWith(`/${territory.code}-${candidate}-inline.json`))!
      return { ok: true, json: async () => inlineLegend(mode) } as Response
    })

    await expect(fetchAedarDiversityLossMapLegend(territory, request as typeof fetch)).resolves.toEqual({
      colors: ['#716ca2', '#8f85b1', '#ad9ebf', '#b186a3', '#ac5b78'],
      tickLabels: ['12', '28', '44,0', '60', '76', '92'],
    })
    expect(request.mock.calls.map(([url]) => String(url))).toEqual(modes.map((mode) =>
      `https://images.calumrobertson.fr/maps/aedar/v1/${territory.code}-${mode}-inline.json`))
  })

  it('rejects inconsistent scale labels across the four production sidecars', async () => {
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const mode = modes.find((candidate) => String(input).endsWith(`-${candidate}-inline.json`))!
      const sidecar = inlineLegend(mode)
      if (mode === 'walk') {
        sidecar.scale.display_ticks = ['0', '28', '44,0', '60', '76', '92']
      }
      return { ok: true, json: async () => sidecar } as Response
    })

    await expect(fetchAedarDiversityLossMapLegend(territory, request as typeof fetch)).rejects.toThrow(/échelles/i)
  })

  it('builds the opt-in production-map section with metadata-provided labels and colors', () => {
    const legend = parseAedarInlineLegend(inlineLegend('walk'), territory, 'walk')
    const section = aedarDiversityLossSection({ status: 'ready', legend }, territory)

    expect(section).toMatchObject({
      key: 'aedar-diversity-loss',
      availability: 'complete',
      evidence: {
        kind: 'aedar-diversity-loss',
        territory: { code: 'test-commune', name: 'Test commune' },
        horizonMinutes: 15,
        mapModes: modes,
        metadataState: 'ready',
        legend: {
          colors: ['#716ca2', '#8f85b1', '#ad9ebf', '#b186a3', '#ac5b78'],
          tickLabels: ['12', '28', '44,0', '60', '76', '92'],
          note: 'Échelle locale',
        },
      },
    })
    expect(section.evidence?.kind).toBe('aedar-diversity-loss')
    if (section.evidence?.kind !== 'aedar-diversity-loss') return
    expect(section.evidence.maps.map(({ mode, label }) => [mode, label])).toEqual([
      ['walk', 'À pied'], ['transit', 'Transports'], ['bike_lts2', 'Vélo LTS2'], ['bike_lts4', 'Vélo LTS4'],
    ])
    expect(section.evidence.maps.every((map) => map.inlineAvailable && map.inspectionAvailable)).toBe(true)
  })

  it('never opens the inspection gallery from a pending page-1 loss map, and opens it once active', async () => {
    const legend = parseAedarInlineLegend(inlineLegend('walk'), territory, 'walk')
    const section = aedarDiversityLossSection({ status: 'ready', legend }, territory)
    if (section.evidence?.kind !== 'aedar-diversity-loss') throw new Error('Expected diversity-loss evidence')
    document.querySelectorAll('.lusk-map-gallery').forEach((element) => element.remove())

    const inactive = mount(AedarDiversityLossMapsCahier, { props: { evidence: section.evidence, active: false } })
    try {
      await flushPromises()
      // The viewports stay (geometry preserved) but a click downloads nothing.
      expect(inactive.findAll('.aedar-diversity-loss-map .map-viewport')).toHaveLength(modes.length)
      await inactive.find('.aedar-diversity-loss-map--walk .map-viewport').trigger('click')
      await flushPromises()
      expect(inactive.findAll('.map-gallery-source img[src]')).toHaveLength(0)
      expect(document.querySelector('.lusk-map-gallery')).toBeNull()
    } finally {
      inactive.unmount()
    }

    const active = mount(AedarDiversityLossMapsCahier, { props: { evidence: section.evidence, active: true } })
    try {
      await flushPromises()
      await active.find('.aedar-diversity-loss-map--walk .map-viewport').trigger('click')
      await flushPromises()
      const opened = active.findAll('.map-gallery-source img')
        .map((image) => image.attributes('src') ?? '')
      expect(opened).toHaveLength(modes.length)
      expect(opened).toContain('https://images.calumrobertson.fr/maps/aedar/v1/test-commune-walk-inspection.webp')
      expect(opened.every((src) => src.includes('/test-commune-') && src.includes('-inspection.webp'))).toBe(true)
    } finally {
      active.unmount()
    }
  })

  it('keeps production maps available while legend metadata is loading or unavailable', () => {
    for (const status of ['loading', 'unavailable'] as const) {
      const section = aedarDiversityLossSection({ status, legend: null }, territory)
      expect(section.availability).toBe('incomplete')
      expect(section.evidence?.kind).toBe('aedar-diversity-loss')
      if (section.evidence?.kind !== 'aedar-diversity-loss') continue
      expect(section.evidence.maps.every((map) => map.inlineAvailable && map.inspectionAvailable)).toBe(true)
      expect(section.evidence.legend).toBeNull()
      expect(section.evidence.metadataState).toBe(status)
    }
  })
})
