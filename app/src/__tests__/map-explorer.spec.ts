import { flushPromises, mount } from '@vue/test-utils'

import { createMemoryHistory, createRouter } from 'vue-router'

import { afterEach, describe, expect, it } from 'vitest'

import MapExplorer from '../components/carte/MapExplorer.vue'
import { indicateursDemographieFixture, territoiresFixture } from '../payload/fixtures'
import type { Payload } from '../payload/types'
import { routes } from '../router'
import { maplibreMock } from './setup'
import type { Masques } from '../geo/types'

/**
 * MapExplorer (ADR-0008 + layouts.md §3) — the ported shell, PMTiles swapped
 * for plain GeoJSON sources: CARTO Voyager raster basemap with the OSM
 * attribution, one GeoJSON source + fill/line layers per present mask level,
 * the theme's choropleth driving the active fill (Aperçu = neutral masks),
 * and click popups (name + KPIs + « Voir la fiche »). The specs assert the
 * map contract against the structural maplibre fake (setup.ts).
 */

function feature(territoire: string, nom: string) {
  return {
    type: 'Feature' as const,
    properties: { territoire, nom, type: 'commune' as const },
    geometry: { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [0, 0]]] },
  }
}

const masquesCommunes: Masques = {
  communes: {
    type: 'FeatureCollection',
    features: [feature('22001', 'Commune A1'), feature('22002', 'Commune D')],
  },
  epcis: null,
  departements: null,
}

const masquesDeuxNiveaux: Masques = {
  ...masquesCommunes,
  epcis: { type: 'FeatureCollection', features: [feature('200000001', 'EPCI X')] },
}

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: [],
  apercu: [],
  runReport: null,
}

async function monter(overrides: Record<string, unknown> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/carte')
  await router.isReady()
  const wrapper = mount(MapExplorer, {
    props: {
      masques: masquesCommunes,
      payload,
      theme: null,
      niveau: 'communes',
      ...overrides,
    },
    global: { plugins: [router] },
  })
  await flushPromises()
  const carte = maplibreMock.instancesCarteMaple.at(-1)
  carte?.fire('load')
  await flushPromises()
  return { wrapper, carte }
}

afterEach(() => {
  maplibreMock.instancesCarteMaple.length = 0
  maplibreMock.instancesPopups.length = 0
})

describe('MapExplorer — the basemap (ADR-0008)', () => {
  it('initializes with the CARTO Voyager raster tiles (a/b/c/d) and the OSM attribution', async () => {
    const { carte } = await monter()
    const style = carte?.options.style as {
      sources: Record<string, { type: string; tiles?: string[]; attribution?: string }>
      layers: { id: string; type: string }[]
    }

    const voyager = style.sources['fond-cartographique']
    expect(voyager.type).toBe('raster')
    expect(voyager.tiles).toHaveLength(4)
    expect(voyager.tiles?.[0]).toContain('a.basemaps.cartocdn.com')
    expect(voyager.tiles?.[3]).toContain('d.basemaps.cartocdn.com')
    expect(voyager.tiles?.[0]).toContain('voyager_nolabels')
    expect(voyager.attribution).toContain('OpenStreetMap contributors')
    expect(style.layers.some((l) => l.id === 'fond-carte' && l.type === 'raster')).toBe(true)
  })

  it('adds a NavigationControl (keyboard-reachable map controls)', async () => {
    const { carte } = await monter()
    expect(carte?.controlesAjoutes).toHaveLength(1)
  })
})

describe('MapExplorer — the GeoJSON mask layers', () => {
  it('registers one geojson source + fill/line layers per present mask level', async () => {
    const { carte } = await monter()

    const source = carte?.sources['masques-communes'] as { type: string }
    expect(source?.type).toBe('geojson')
    const remplissage = carte?.couches['masques-communes-remplissage'] as { type?: string } | undefined
    const contour = carte?.couches['masques-communes-contour'] as { type?: string } | undefined
    expect(remplissage?.type).toBe('fill')
    expect(contour?.type).toBe('line')
    // les niveaux absents (404) ne créent ni source ni couche
    expect(carte?.sources['masques-epcis']).toBeUndefined()
    expect(carte?.couches['masques-epcis-remplissage']).toBeUndefined()
  })

  it('shows the active level and hides the others', async () => {
    const { carte } = await monter({ masques: masquesDeuxNiveaux })

    expect(carte?.misesEnPage['masques-communes-remplissage'].visibility).toBe('visible')
    expect(carte?.misesEnPage['masques-communes-contour'].visibility).toBe('visible')
    expect(carte?.misesEnPage['masques-epcis-remplissage'].visibility).toBe('none')
  })

  it('switches the visible level when the niveau prop changes', async () => {
    const { wrapper, carte } = await monter({ masques: masquesDeuxNiveaux })

    await wrapper.setProps({ niveau: 'epcis' })

    expect(carte?.misesEnPage['masques-epcis-remplissage'].visibility).toBe('visible')
    expect(carte?.misesEnPage['masques-communes-remplissage'].visibility).toBe('none')
  })
})

describe('MapExplorer — the theme-driven indicator layer', () => {
  it('paints the neutral mask fill in Aperçu (no theme)', async () => {
    const { carte } = await monter()

    expect(carte?.peintures['masques-communes-remplissage']['fill-color']).toBe('#BFD5D0')
  })

  it('paints the theme choropleth and joins the indicator onto the source data', async () => {
    const { wrapper, carte } = await monter()

    await wrapper.setProps({ theme: 'demographie' })

    const peinture = carte?.peintures['masques-communes-remplissage']['fill-color'] as unknown[]
    expect(peinture[0]).toBe('case')
    const step = peinture[2] as unknown[]
    expect(step[0]).toBe('step')
    // la source active est rechargée avec les valeurs jointes
    const donnees = carte?.sourcesSetData['masques-communes']?.mock.calls.at(-1)?.[0] as {
      features: { properties: { territoire: string; valeur: number | null } }[]
    }
    const a1 = donnees.features.find((f) => f.properties.territoire === '22001')
    expect(a1?.properties.valeur).toBe(200)
    const d = donnees.features.find((f) => f.properties.territoire === '22002')
    expect(d?.properties.valeur).toBe(50)
  })

  it('keeps neutral masks for a theme without a choropleth contract', async () => {
    const { wrapper, carte } = await monter()

    await wrapper.setProps({ theme: 'mobilite' })

    expect(carte?.peintures['masques-communes-remplissage']['fill-color']).toBe('#BFD5D0')
  })
})

describe('MapExplorer — the popup (name + KPIs + « Voir la fiche »)', () => {
  it('opens a popup with the territory name, its KPIs and the fiche link', async () => {
    const { carte } = await monter({ theme: 'demographie' })
    const carteFake = carte as unknown as {
      queryRenderedFeatures: () => { properties: { territoire: string } }[]
    }
    carteFake.queryRenderedFeatures = () => [
      { properties: { territoire: '22001' } },
    ] as never

    carte?.fire('click', { point: { x: 10, y: 10 }, lngLat: { lng: -2, lat: 48 } })

    const popup = maplibreMock.instancesPopups.at(-1)
    expect(popup?.contenu).toContain('Commune A1')
    expect(popup?.contenu).toContain('Voir la fiche')
    // l'indicateur du thème sélectionné, formaté en français
    expect(popup?.contenu).toContain('Densité de population')
    expect(popup?.contenu).toContain('200')
    expect(popup?.options.focusAfterOpen).toBe(true)
  })

  it('keeps the popup honest when the territory has no payload rows', async () => {
    const { carte } = await monter()
    const carteFake = carte as unknown as {
      queryRenderedFeatures: () => { properties: { territoire: string } }[]
    }
    carteFake.queryRenderedFeatures = () => [
      { properties: { territoire: '99999' } },
    ] as never

    carte?.fire('click', { point: { x: 10, y: 10 }, lngLat: { lng: -2, lat: 48 } })

    const popup = maplibreMock.instancesPopups.at(-1)
    expect(popup?.contenu).toContain('99999')
    expect(popup?.contenu).not.toContain('Voir la fiche')
  })
})
