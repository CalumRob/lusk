import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'

import { createMemoryHistory, createRouter } from 'vue-router'

import { afterEach, describe, expect, it } from 'vitest'

import MapExplorer from '../components/carte/MapExplorer.vue'
import { COULEUR_NEUTRE, LARGEUR_CONTOUR } from '../carte/couleurs'
import type { Couche } from '../carte/coucheModel'
import {
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  indicateursHabitatFixture,
  membresProgrammesFixture,
  subventionsProgrammesFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import type { Payload } from '../payload/types'
import { routes } from '../router'
import { maplibreMock } from './setup'
import type { Masques } from '../geo/types'

/**
 * MapExplorer (ADR-0008 + layouts.md §3) — the ported shell, PMTiles swapped
 * for plain GeoJSON sources: Etalab positron vector basemap (ADR-0018, local
 * vendored style without labels, OSM attribution from the TileJSON), one
 * GeoJSON source + fill/line layers per present mask level, the ACTIVE LAYER
 * (the couche the view passes down — ADR-0019) driving the active fill
 * (Aperçu = neutral masks), and click popups (name + KPIs + « Voir la
 * fiche »). The specs assert the map contract against the structural maplibre
 * fake (setup.ts).
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

/** Deux EPCIs — les deux lignes densite du fixture (133,33 et 150) : le
 *  re-join au niveau EPCI recale ses seuils sur ces valeurs. */
const masquesDeuxEpcis: Masques = {
  ...masquesCommunes,
  epcis: {
    type: 'FeatureCollection',
    features: [feature('200000001', 'EPCI X'), feature('200000002', 'EPCI Y')],
  },
}

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: [],
  runReport: null,
  vintages: vintagesFixture,
  programmes: null,
}

/** Le payload avec l'onglet programmes — les lignes partagées + une ligne de
 *  subvention communale supplémentaire (22002) pour que la choroplèthe ait
 *  des valeurs à joindre. */
const payloadProgrammes: Payload = {
  ...payload,
  programmes: {
    membres: membresProgrammesFixture,
    subventions: [
      ...subventionsProgrammesFixture,
      {
        territoire: '22002',
        type: 'commune',
        annee: 2025,
        programme_libl: null,
        montant: 12000,
        vintage_source: 'Région Bretagne — subventions attribuées (SCDL)',
        vintage_version: '2026-08-05',
        vintage_date_reference: '2026-08-05',
        vintage_date_publication: '2026-08-05',
      },
    ],
  },
}

/** The Démographie densité layer — the previous config's equivalent, as a Couche. */
const coucheDensite: Couche = {
  source: 'indicateur',
  clef: 'densite',
  detail: null,
  libelle: 'Densité de population',
  parDefaut: false,
}

/** The Démographie default layer — the first story scalar (ADR-0019 α rule). */
const coucheTauxSoldeNaturel: Couche = {
  source: 'histoire',
  clef: 'taux_solde_naturel',
  detail: null,
  libelle: 'taux_solde_naturel',
  parDefaut: true,
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
      couche: null,
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

describe('MapExplorer — the basemap (ADR-0018)', () => {
  it('initializes with the vendored Etalab positron style (local, no remote CARTO)', async () => {
    const { carte } = await monter()

    // Le style est servi localement (app/public/positron-nolabels.json) — la
    // carte ne parle jamais au CDN CARTO ; les tuiles vecteur viennent d'Etalab.
    expect(carte?.options.style).toBe('/positron-nolabels.json')
  })

  it('vendored positron style: vector source from Etalab, zero symbol layers (labels dropped)', () => {
    const style = JSON.parse(
      readFileSync(join(process.cwd(), 'public', 'positron-nolabels.json'), 'utf-8'),
    ) as {
      version: number
      sources: Record<string, { type: string; url?: string }>
      layers: { type: string }[]
    }

    expect(style.version).toBe(8)
    // La source vecteur pointe sur les tuiles OpenMapTiles d'Etalab.
    const source = style.sources['openmaptiles']
    expect(source.type).toBe('vector')
    expect(source.url).toContain('openmaptiles.data.gouv.fr')
    // Les labels ont été retirés (look voyager_nolabels conservé) : aucune
    // couche symbol — MapLibre ne charge alors ni glyphs ni sprites.
    expect(style.layers.some((l) => l.type === 'symbol')).toBe(false)
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

  it('paints the mask contour as a hairline — the shared LARGEUR_CONTOUR (issue #68)', async () => {
    const { carte } = await monter()

    const contour = carte?.couches['masques-communes-contour'] as
      | { paint?: Record<string, unknown> }
      | undefined
    expect(contour?.paint?.['line-width']).toBe(LARGEUR_CONTOUR)
  })

  it('switches the visible level when the niveau prop changes', async () => {
    const { wrapper, carte } = await monter({ masques: masquesDeuxNiveaux })

    await wrapper.setProps({ niveau: 'epcis' })

    expect(carte?.misesEnPage['masques-epcis-remplissage'].visibility).toBe('visible')
    expect(carte?.misesEnPage['masques-communes-remplissage'].visibility).toBe('none')
  })
})

describe('MapExplorer — the active layer choropleth (ADR-0019)', () => {
  it('paints the neutral mask fill in Aperçu (no theme, no layer)', async () => {
    const { carte } = await monter()

    expect(carte?.peintures['masques-communes-remplissage']['fill-color']).toBe(COULEUR_NEUTRE)
  })

  it('paints the layer choropleth and joins the indicator onto the source data', async () => {
    const { wrapper, carte } = await monter()

    await wrapper.setProps({ theme: 'demographie', couche: coucheDensite })

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

  it('joins a story-scalar layer (source histoire) onto the source data', async () => {
    const { wrapper, carte } = await monter()

    await wrapper.setProps({ theme: 'demographie', couche: coucheTauxSoldeNaturel })

    const peinture = carte?.peintures['masques-communes-remplissage']['fill-color'] as unknown[]
    expect(peinture[0]).toBe('case')
    const donnees = carte?.sourcesSetData['masques-communes']?.mock.calls.at(-1)?.[0] as {
      features: { properties: { territoire: string; valeur: number | null } }[]
    }
    const a1 = donnees.features.find((f) => f.properties.territoire === '22001')
    expect(a1?.properties.valeur).toBe(5.982905982905983)
    const d = donnees.features.find((f) => f.properties.territoire === '22002')
    expect(d?.properties.valeur).toBe(-8.080808080808081)
  })

  it('keeps neutral masks when no layer is active (a theme without a default — Économie)', async () => {
    const { wrapper, carte } = await monter()

    await wrapper.setProps({ theme: 'economie', couche: null })

    expect(carte?.peintures['masques-communes-remplissage']['fill-color']).toBe(COULEUR_NEUTRE)
  })
})

describe('MapExplorer — les couches de l’onglet « Programmes & financements » (#282)', () => {
  it('peint le highlight catégoriel d’une couche d’adhésion (in/out — jamais une rampe)', async () => {
    const { wrapper, carte } = await monter()

    await wrapper.setProps({
      payload: payloadProgrammes,
      couche: { source: 'membre', sigle: 'ACV', libelle: 'ACV', niveau: 'communes' },
    })

    const peinture = carte?.peintures['masques-communes-remplissage']['fill-color'] as unknown[]
    expect(peinture[0]).toBe('case')
    expect(peinture[1]).toEqual(['==', ['get', 'membre'], true])
    // les données jointes portent le booléen membre — pas un nombre, pas une rampe
    const donnees = carte?.sourcesSetData['masques-communes']?.mock.calls.at(-1)?.[0] as {
      features: { properties: { territoire: string; membre: boolean } }[]
    }
    const a1 = donnees.features.find((f) => f.properties.territoire === '22001')
    const d = donnees.features.find((f) => f.properties.territoire === '22002')
    expect(a1?.properties.membre).toBe(true) // lauréate ACV
    expect(d?.properties.membre).toBe(false) // PVD, pas ACV
  })

  it('choroplèthe la couche subventions — le total € par territoire joint sur la source', async () => {
    const { wrapper, carte } = await monter()

    await wrapper.setProps({
      payload: payloadProgrammes,
      couche: { source: 'subvention', libelle: 'Subventions totales' },
    })

    const peinture = carte?.peintures['masques-communes-remplissage']['fill-color'] as unknown[]
    expect(peinture[0]).toBe('case')
    const step = peinture[2] as unknown[]
    expect(step[0]).toBe('step')
    const donnees = carte?.sourcesSetData['masques-communes']?.mock.calls.at(-1)?.[0] as {
      features: { properties: { territoire: string; valeur: number | null } }[]
    }
    const a1 = donnees.features.find((f) => f.properties.territoire === '22001')
    const d = donnees.features.find((f) => f.properties.territoire === '22002')
    expect(a1?.properties.valeur).toBe(45000) // la somme des deux domaines
    expect(d?.properties.valeur).toBe(12000)
  })

  it('garde le neutre en secours quand la couche subventions ne joint aucune ligne (payload absent)', async () => {
    const { wrapper, carte } = await monter()

    await wrapper.setProps({ couche: { source: 'subvention', libelle: 'Subventions totales' } })

    const peinture = carte?.peintures['masques-communes-remplissage']['fill-color'] as unknown[]
    expect(peinture[0]).toBe('case')
    expect(JSON.stringify(peinture)).toContain(COULEUR_NEUTRE)
  })

  it('garde les masques neutres quand la couche programme est inactive (aucune couche)', async () => {
    const { carte } = await monter()

    expect(carte?.peintures['masques-communes-remplissage']['fill-color']).toBe(COULEUR_NEUTRE)
  })

  it('ouvre le popup sans planter sur une couche programmes — le popup rejoint le thème seulement (#281)', async () => {
    const { wrapper, carte } = await monter({ payload: payloadProgrammes })

    await wrapper.setProps({
      couche: { source: 'membre', sigle: 'ACV', libelle: 'ACV', niveau: 'communes' },
    })
    const carteFake = carte as unknown as {
      queryRenderedFeatures: () => { properties: { territoire: string } }[]
    }
    carteFake.queryRenderedFeatures = () => [{ properties: { territoire: '22001' } }] as never

    carte?.fire('click', { point: { x: 10, y: 10 }, lngLat: { lng: -2, lat: 48 } })

    const popup = maplibreMock.instancesPopups.at(-1)
    expect(popup?.contenu).toContain('Commune A1')
    expect(popup?.contenu).toContain('Voir la fiche')
  })
})

describe('MapExplorer — la popup par couche (ADR-0019, #281)', () => {
  it('ouvre une popup qui mène par la valeur de la couche active + son rang, puis « Voir la fiche »', async () => {
    const { carte } = await monter({ theme: 'demographie', couche: coucheDensite })
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
    // la valeur de la couche active, formatée en français, avec son rang-en-contexte
    expect(popup?.contenu).toContain('Densité de population')
    expect(popup?.contenu).toContain('200')
    expect(popup?.contenu).toContain("P50 de l'EPCI")
    expect(popup?.contenu).toContain('popup-carte-rang')
    // la popup répond « comment ce territoire se situe sur CETTE variable » —
    // pas le mur de KPI du thème (plus de ligne Population)
    expect(popup?.contenu).not.toContain('>Population<')
    expect(popup?.options.focusAfterOpen).toBe(true)
  })

  it('une couche story (source histoire) ouvre une popup valeur seule — aucun rang inventé', async () => {
    const { carte } = await monter({ theme: 'demographie', couche: coucheTauxSoldeNaturel })
    const carteFake = carte as unknown as {
      queryRenderedFeatures: () => { properties: { territoire: string } }[]
    }
    carteFake.queryRenderedFeatures = () => [
      { properties: { territoire: '22001' } },
    ] as never

    carte?.fire('click', { point: { x: 10, y: 10 }, lngLat: { lng: -2, lat: 48 } })

    const popup = maplibreMock.instancesPopups.at(-1)
    expect(popup?.contenu).toContain('5,98')
    expect(popup?.contenu).toContain('Voir la fiche')
    expect(popup?.contenu).not.toContain('popup-carte-rang')
  })

  it('la popup reflète la ligne du niveau affiché — un EPCI cliqué montre la valeur ET le rang de l’EPCI', async () => {
    const { wrapper, carte } = await monter({
      masques: masquesDeuxNiveaux,
      theme: 'demographie',
      couche: coucheDensite,
    })
    await wrapper.setProps({ niveau: 'epcis' })

    const carteFake = carte as unknown as {
      queryRenderedFeatures: () => { properties: { territoire: string } }[]
    }
    carteFake.queryRenderedFeatures = () => [
      { properties: { territoire: '200000001' } },
    ] as never
    carte?.fire('click', { point: { x: 10, y: 10 }, lngLat: { lng: -2, lat: 48 } })

    const popup = maplibreMock.instancesPopups.at(-1)
    expect(popup?.contenu).toContain('133,33')
    expect(popup?.contenu).toContain('P0 du département')
    expect(popup?.contenu).toContain('Voir la fiche')
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

describe('MapExplorer — le re-join au changement de niveau (ADR-0019, #281)', () => {
  it('garde la couche active et la re-joint aux lignes du nouveau niveau — couleurs recalculées', async () => {
    const { wrapper, carte } = await monter({
      masques: masquesDeuxEpcis,
      theme: 'demographie',
      couche: coucheDensite,
    })

    // au niveau communes, les seuils viennent des valeurs communales [200, 50]
    const peintureCommunes = carte?.peintures['masques-communes-remplissage']['fill-color'] as unknown[]
    const stepCommunes = peintureCommunes[2] as unknown[]
    expect(stepCommunes.slice(3)).toEqual([200, expect.any(String)])

    await wrapper.setProps({ niveau: 'epcis' })

    // même couche, re-jointe aux lignes EPCI : la source porte les valeurs EPCI
    const donnees = carte?.sourcesSetData['masques-epcis']?.mock.calls.at(-1)?.[0] as {
      features: { properties: { territoire: string; valeur: number | null } }[]
    }
    const epci = donnees.features.find((f) => f.properties.territoire === '200000001')
    expect(epci?.properties.valeur).toBe(133.33333333333334)
    // et les seuils/couleurs se recalculent des valeurs du niveau (150 EPCI ≠ 200 communes)
    const peintureEpcis = carte?.peintures['masques-epcis-remplissage']['fill-color'] as unknown[]
    const stepEpcis = peintureEpcis[2] as unknown[]
    expect(stepEpcis.slice(3)).toEqual([150, expect.any(String)])
    expect(peintureEpcis).not.toEqual(peintureCommunes)
  })

  it('une couche sans lignes au niveau affiché rend le remplissage neutre — jamais des valeurs inventées', async () => {
    const coucheHabitat: Couche = {
      source: 'indicateur',
      clef: 'part_residences_secondaires',
      detail: null,
      libelle: 'Part de résidences secondaires',
      parDefaut: false,
    }
    const payloadHabitat: Payload = {
      ...payload,
      indicateurs: indicateursHabitatFixture,
    }
    const { wrapper, carte } = await monter({
      masques: masquesDeuxNiveaux,
      payload: payloadHabitat,
      theme: 'habitat',
      couche: coucheHabitat,
    })

    await wrapper.setProps({ niveau: 'epcis' })

    // la couche n'a aucune ligne EPCI (le fixture habitat ne porte que 22001 + 53) :
    // la jointure laisse la valeur à null — l'honnête, jamais un chiffre inventé
    const donnees = carte?.sourcesSetData['masques-epcis']?.mock.calls.at(-1)?.[0] as {
      features: { properties: { territoire: string; valeur: number | null; valeur_formatee: string | null } }[]
    }
    const epci = donnees.features.find((f) => f.properties.territoire === '200000001')
    expect(epci?.properties.valeur).toBeNull()
    expect(epci?.properties.valeur_formatee).toBeNull()
    // l'échelle s'effondre (aucune valeur) et le garde-fou neutre couvre tout le niveau
    const peinture = carte?.peintures['masques-epcis-remplissage']['fill-color'] as unknown[]
    expect(peinture[0]).toBe('case')
    const step = peinture[2] as unknown[]
    expect(step[0]).toBe('step')
    expect(step.length).toBe(3)
    expect(peinture).toContain(COULEUR_NEUTRE)
  })
})

describe('MapExplorer — the hover tooltip (audit #208 item 57)', () => {
  it('shows a lightweight tooltip with the territory name and its value on mousemove', async () => {
    const { carte } = await monter({ theme: 'demographie', couche: coucheDensite })
    const carteFake = carte as unknown as {
      queryRenderedFeatures: () => { properties: { territoire: string } }[]
    }
    carteFake.queryRenderedFeatures = () => [
      { properties: { territoire: '22001' } },
    ] as never

    carte?.fire('mousemove', { point: { x: 10, y: 10 }, lngLat: { lng: -2, lat: 48 } })

    const tooltip = maplibreMock.instancesPopups.at(-1)
    expect(tooltip?.contenu).toContain('Commune A1')
    expect(tooltip?.contenu).toContain('200')
    // survol ≠ clic : pas de lien fiche, pas de focus (léger, non bloquant)
    expect(tooltip?.contenu).not.toContain('Voir la fiche')
    expect(tooltip?.options.focusAfterOpen).toBeFalsy()
  })

  it('follows the cursor: the tooltip moves with the mousemove', async () => {
    const { carte } = await monter({ theme: 'demographie', couche: coucheDensite })
    const carteFake = carte as unknown as {
      queryRenderedFeatures: () => { properties: { territoire: string } }[]
    }
    carteFake.queryRenderedFeatures = () => [
      { properties: { territoire: '22001' } },
    ] as never

    carte?.fire('mousemove', { point: { x: 10, y: 10 }, lngLat: { lng: -2, lat: 48 } })
    carte?.fire('mousemove', { point: { x: 20, y: 20 }, lngLat: { lng: -3, lat: 49 } })

    const tooltip = maplibreMock.instancesPopups.at(-1)
    expect(tooltip?.position).toEqual({ lng: -3, lat: 49 })
  })

  it('removes the tooltip when the cursor leaves a territory', async () => {
    const { carte } = await monter({ theme: 'demographie', couche: coucheDensite })
    const carteFake = carte as unknown as {
      queryRenderedFeatures: () => { properties: { territoire: string } }[]
    }
    carteFake.queryRenderedFeatures = () => [
      { properties: { territoire: '22001' } },
    ] as never
    carte?.fire('mousemove', { point: { x: 10, y: 10 }, lngLat: { lng: -2, lat: 48 } })
    expect(maplibreMock.instancesPopups.at(-1)?.enlevee).toBe(false)

    carteFake.queryRenderedFeatures = () => [] as never
    carte?.fire('mousemove', { point: { x: 99, y: 99 }, lngLat: { lng: -9, lat: 44 } })

    expect(maplibreMock.instancesPopups.at(-1)?.enlevee).toBe(true)
  })
})

describe('MapExplorer — le tooltip se pose SOUS le popup ouvert (ADR-0019, #279)', () => {
  it('ancre le tooltip au popup ouvert au lieu de suivre le curseur dans son empreinte', async () => {
    const { carte } = await monter({ theme: 'demographie', couche: coucheDensite })
    const carteFake = carte as unknown as {
      queryRenderedFeatures: () => { properties: { territoire: string } }[]
    }
    carteFake.queryRenderedFeatures = () => [
      { properties: { territoire: '22001' } },
    ] as never

    // ouvre un popup au clic…
    carte?.fire('click', { point: { x: 10, y: 10 }, lngLat: { lng: -2, lat: 48 } })
    const popup = maplibreMock.instancesPopups.at(-1)

    // …puis survole un territoire (le curseur peut passer au-dessus du popup)
    carte?.fire('mousemove', { point: { x: 50, y: 60 }, lngLat: { lng: -4, lat: 47 } })

    const tooltip = maplibreMock.instancesPopups.at(-1)
    expect(tooltip).not.toBe(popup)
    // le tooltip reste ancré au point du popup — pas sous le curseur
    expect(tooltip?.position).toEqual(popup?.position)
    // le survol renseigne toujours le territoire sous le curseur
    expect(tooltip?.contenu).toContain('Commune A1')
    // et il s'étend vers le bas : ancre en haut + décalage positif en pixels
    expect(tooltip?.options.anchor).toBe('top')
    const decalage = tooltip?.options.offset as [number, number]
    expect(decalage[0]).toBe(0)
    expect(decalage[1]).toBeGreaterThan(0)
  })

  it('sans popup ouvert, le tooltip suit le curseur sans ancre ni décalage imposés', async () => {
    const { carte } = await monter({ theme: 'demographie', couche: coucheDensite })
    const carteFake = carte as unknown as {
      queryRenderedFeatures: () => { properties: { territoire: string } }[]
    }
    carteFake.queryRenderedFeatures = () => [
      { properties: { territoire: '22001' } },
    ] as never

    carte?.fire('mousemove', { point: { x: 10, y: 10 }, lngLat: { lng: -2, lat: 48 } })

    const tooltip = maplibreMock.instancesPopups.at(-1)
    expect(tooltip?.options.anchor).toBeUndefined()
    expect(tooltip?.options.offset).toBeUndefined()
  })

  it('revient sous le curseur quand le popup se ferme au clic sur le vide', async () => {
    const { carte } = await monter({ theme: 'demographie', couche: coucheDensite })
    const carteFake = carte as unknown as {
      queryRenderedFeatures: () => { properties: { territoire: string } }[]
    }
    carteFake.queryRenderedFeatures = () => [
      { properties: { territoire: '22001' } },
    ] as never

    carte?.fire('click', { point: { x: 10, y: 10 }, lngLat: { lng: -2, lat: 48 } })
    carte?.fire('mousemove', { point: { x: 50, y: 60 }, lngLat: { lng: -4, lat: 47 } })
    const tooltipSousPopup = maplibreMock.instancesPopups.at(-1)

    // le popup se ferme (clic sur le vide)…
    carteFake.queryRenderedFeatures = () => [] as never
    carte?.fire('click', { point: { x: 99, y: 99 }, lngLat: { lng: -9, lat: 44 } })
    expect(maplibreMock.instancesPopups.at(-2)?.enlevee).toBe(true)

    // …le prochain survol retrouve un tooltip suiveur de curseur (recréé)
    carteFake.queryRenderedFeatures = () => [
      { properties: { territoire: '22001' } },
    ] as never
    carte?.fire('mousemove', { point: { x: 20, y: 20 }, lngLat: { lng: -3, lat: 49 } })

    const tooltip = maplibreMock.instancesPopups.at(-1)
    expect(tooltip).not.toBe(tooltipSousPopup)
    expect(tooltip?.position).toEqual({ lng: -3, lat: 49 })
    expect(tooltip?.options.anchor).toBeUndefined()
  })

  it('revient sous le curseur quand le popup se ferme par l’événement close (bouton × / closeOnClick)', async () => {
    const { carte } = await monter({ theme: 'demographie', couche: coucheDensite })
    const carteFake = carte as unknown as {
      queryRenderedFeatures: () => { properties: { territoire: string } }[]
    }
    carteFake.queryRenderedFeatures = () => [
      { properties: { territoire: '22001' } },
    ] as never

    carte?.fire('click', { point: { x: 10, y: 10 }, lngLat: { lng: -2, lat: 48 } })
    carte?.fire('mousemove', { point: { x: 50, y: 60 }, lngLat: { lng: -4, lat: 47 } })

    const popup = maplibreMock.instancesPopups[0]
    ;(popup as unknown as { fire: (e: string) => void }).fire('close')

    carte?.fire('mousemove', { point: { x: 20, y: 20 }, lngLat: { lng: -3, lat: 49 } })

    const tooltip = maplibreMock.instancesPopups.at(-1)
    expect(tooltip?.position).toEqual({ lng: -3, lat: 49 })
    expect(tooltip?.options.anchor).toBeUndefined()
  })
})

describe('MapExplorer — les noms EPCI passent à la ligne dans le tooltip (ADR-0019, #279)', () => {
  const source = readFileSync(
    join(process.cwd(), 'src', 'components', 'carte', 'MapExplorer.vue'),
    'utf-8',
  )

  function regle(selecteur: string): string {
    const reg = new RegExp(`${selecteur}\\s*\\{([\\s\\S]*?)\\}`)
    const match = source.match(reg)
    if (!match) throw new Error(`règle introuvable : ${selecteur}`)
    return match[1]
  }

  it('laisse le nom du territoire passer à la ligne (white-space: normal) au lieu de déborder', () => {
    expect(regle('\\.tooltip-carte-nom')).toContain('white-space: normal')
  })

  it('permet la coupure des très longs mots dans la boîte (overflow-wrap: anywhere)', () => {
    expect(regle('\\.tooltip-carte-nom')).toContain('overflow-wrap: anywhere')
  })

  it('garde la valeur sur une seule ligne — seul le nom long se replie', () => {
    expect(regle('\\.tooltip-carte-valeur')).toContain('white-space: nowrap')
  })

  it('ne force plus le nowrap sur le conteneur du tooltip', () => {
    expect(regle('\\.tooltip-carte')).not.toContain('white-space: nowrap')
  })
})
