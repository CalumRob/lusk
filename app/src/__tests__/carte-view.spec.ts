import { flushPromises, mount } from '@vue/test-utils'

import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import { afterEach, describe, expect, it, vi } from 'vitest'

import CarteView from '../views/CarteView.vue'
import { COULEUR_CONTOUR, COULEUR_NEUTRE } from '../carte/couleurs'
import { echelleValeurs } from '../carte/seuils'
import { maplibreMock } from './setup'
import type { ChargerGeometrie } from '../geo/useGeometrie'
import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'
import type { Masques } from '../geo/types'
import {
  chargerAvec,
  histoiresDemographieFixture,
  histoiresHabitatFixture,
  histoiresMilieuxFixture,
  indicateursDemographieFixture,
  indicateursHabitatFixture,
  indicateursMilieuxFixture,
  membresProgrammesFixture,
  metadonneesThemesFixtures,
  subventionsProgrammesFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import { PAYLOAD_CHARGER_KEY, usePayload } from '../payload/usePayload'
import type { ChargerFichier } from '../payload/usePayload'
import type { Fichier } from '../payload/loader'
import { THEMES_CANONIQUES } from '../payload/types'
import type { Histoire, HistoireDemographie, HistoireMilieux, Indicateur, MembreProgramme, Payload, SubventionProgramme, Theme } from '../payload/types'
import { PayloadError } from '../payload/validate'
import { routes } from '../router'
import { THEME_METADATA_CHARGER_KEY } from '../payload/themeCatalogue'
import type { ChargerMetadonneesTheme } from '../payload/themeCatalogue'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { NATIVE_API_FIXTURE_NOTICE } from './fixtures/nativeApiScenarios'
import { nativeResources } from './helpers/semanticApiFixtures'

// These ids keep the browser proof bounded; every declaration fact comes from
// the producer-derived API discovery fixture below.
const resourceIds: Record<string, readonly string[]> = {
  demographie: ['densite', 'structure_age', 'evolution_1968', 'taille_menages', 'demographie_selected_reading'],
  habitat: ['habitat_selected_reading'],
  milieux: ['milieux_selected_reading'],
  programmes: ['couverture_programmes', 'subventions_annuelles', 'subventions_par_domaine'],
}
const mapMetadataPreload = new Map<string, Record<string, any>>()

/** Le miroir TS du builder R (construire_indicateurs_programmes) : les tables
 *  canoniques du fixture → les FAITS du thème servis par l'API (#893 : la
 *  carte ne lit plus aucun programmes.json, l'API sert les lignes
 *  indicateurs_programmes admises). */
function lignesCouverture(membres: MembreProgramme[]): Indicateur[] {
  return membres.map((m) => ({
    territoire: m.territoire,
    type: m.type,
    theme: 'programmes',
    key: 'couverture_programmes',
    detail: m.sigle,
    value: 1,
    unit: 'adhésion',
    rider: m.convention_valant_ort ? 'convention valant ORT' : null,
    rang_epci: null,
    rang_epci_n: null,
    rang_dep: null,
    rang_dep_n: null,
    rang_reg: null,
    rang_reg_n: null,
    vintage_source: m.vintage_source,
    vintage_version: m.vintage_version,
    vintage_date_reference: m.vintage_date_reference,
    vintage_date_publication: m.vintage_date_publication,
  }))
}

function lignesSubventions(subventions: SubventionProgramme[]): Indicateur[] {
  const territoires = [...new Set(subventions.map((s) => s.territoire))]
  const lignes: Indicateur[] = []
  for (const territoire of territoires) {
    const lignesTerritoire = subventions.filter((s) => s.territoire === territoire)
    const annee = Math.max(...lignesTerritoire.map((s) => s.annee))
    const anneeRef = lignesTerritoire.filter((s) => s.annee === annee)
    const type = lignesTerritoire[0]!.type
    lignes.push({
      territoire,
      type,
      theme: 'programmes',
      key: 'subventions_annuelles',
      detail: null,
      dimension: String(annee),
      value: anneeRef.reduce((somme, s) => somme + s.montant, 0),
      unit: '€',
      rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null,
      rang_reg: null, rang_reg_n: null,
      vintage_source: anneeRef[0]!.vintage_source,
      vintage_version: anneeRef[0]!.vintage_version,
      vintage_date_reference: anneeRef[0]!.vintage_date_reference,
      vintage_date_publication: anneeRef[0]!.vintage_date_publication,
    })
    if (type === 'commune') {
      for (const s of anneeRef) {
        lignes.push({
          territoire,
          type,
          theme: 'programmes',
          key: 'subventions_par_domaine',
          detail: s.programme_libl,
          dimension: String(annee),
          value: s.montant,
          unit: '€',
          rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null,
          rang_reg: null, rang_reg_n: null,
          vintage_source: s.vintage_source,
          vintage_version: s.vintage_version,
          vintage_date_reference: s.vintage_date_reference,
          vintage_date_publication: s.vintage_date_publication,
        })
      }
    }
  }
  return lignes
}

/** Mount boundary fixture: producer-shaped catalogue + cohort reads, never static app reads. */
async function fetchCarteApiFixture(p: Payload, usePublishedTerritoryReference = false): Promise<typeof fetch> {
  const producerMetadataByTheme = new Map<string, Record<string, any>>()
  const catalogueMetadataByTheme = new Map<string, Record<string, any>>()
  // Most fixtures use their matching compact reference. The shared-store
  // integration case opts into the warmed published reference explicitly.
  const referenceTerritories = usePublishedTerritoryReference
    ? JSON.parse(await readFile(join(process.cwd(), '..', 'public', 'data', 'territoires.json'), 'utf8')) as Payload['territoires']
    : p.territoires
  const loadProducerMetadata = async (theme: string) => {
    let metadata = producerMetadataByTheme.get(theme)
    if (!metadata) {
      metadata = JSON.parse(await readFile(join(process.cwd(), '..', 'pipeline', 'inst', 'extdata',
        'theme-metadata', `theme_${theme}.json`), 'utf8'))
      if (!metadata) throw new Error(`Missing producer metadata for ${theme}`)
      producerMetadataByTheme.set(theme, metadata)
    }
    return metadata!
  }
  const loadCatalogueMetadata = async (theme: string) => {
    let metadata = catalogueMetadataByTheme.get(theme)
    if (!metadata) {
      metadata = JSON.parse(await readFile(join(process.cwd(), '..', 'public', 'data', `theme_${theme}.json`), 'utf8'))
      if (!metadata) throw new Error(`Missing browser catalogue for ${theme}`)
      catalogueMetadataByTheme.set(theme, metadata)
      mapMetadataPreload.set(theme, metadata)
    }
    return metadata!
  }
  // Preload only the reduced browser projection; API fixture responses below
  // use canonical producer contracts/discovery separately.
  await Promise.all(['demographie', 'habitat', 'milieux', 'programmes'].flatMap((theme) =>
    [loadCatalogueMetadata(theme), loadProducerMetadata(theme)]))
  const declarations = async (theme: string) => {
    // #893 — un thème programmes sans faits (aucune ligne indicateurs_programmes)
    // n'a aucune ressource déclarée côté API
    if (theme === 'programmes' && !p.indicateurs.some((row) => row.theme === 'programmes')) return []
    const wanted = resourceIds[theme] ?? []
    const discovered = nativeResources(theme)
    return wanted.map((id) => {
      const declaration = discovered.find((resource) => resource.resource_id === id)
      if (!declaration) throw new Error(`Map fixture resource is not producer-declared: ${theme}/${id}`)
      return declaration
    })
  }
  const fixtureFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    if (url.startsWith('/data/theme_')) {
      return new Response(JSON.stringify(await loadCatalogueMetadata(url.slice('/data/theme_'.length, -5))))
    }
    if (url === '/api/resources') {
      try {
      const resources = [...await declarations('demographie'), ...await declarations('habitat'),
        ...await declarations('milieux'), ...await declarations('programmes')]
        return new Response(JSON.stringify({ contract: 'semantic-resource-catalogue-v1', resources }))
      } catch (error) { console.error('catalogue fixture failure', error); throw error }
    }
    if (url === '/api/resources/read-batch') {
      const body = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
      const results = []
      for (const item of body.items) {
        const theme = String(item.resource).startsWith('demographie_') || item.resource === 'densite' ||
          item.resource === 'evolution_1968' || item.resource === 'taille_menages' || item.resource === 'structure_age'
          ? 'demographie' : item.resource === 'habitat_selected_reading' ? 'habitat'
            : item.resource === 'milieux_selected_reading' ? 'milieux' : 'programmes'
        const resource = (await declarations(theme)).find((entry) => entry.resource_id === item.resource)!
        const metadata = await loadProducerMetadata(theme)
        const type = item.target.type as string
        if (item.target.kind === 'territory' && item.intent.kind !== 'facts') {
          const page = metadata.indicator_pages[item.resource]
          const selected = item.intent.kind === 'selected_comparison'
          const selectedMembers = selected ? item.intent.members : referenceTerritories
            .filter((territory) => territory.type === type)
            .map((territory) => ({ type: territory.type, id: territory.territoire }))
          const sourceId = resource.sources[0]
          const result = { indicator_id: item.resource, status: selectedMembers.length >= 2 ? 'available' : 'unavailable',
            unit: page.unit, direction: page.comparison?.direction ?? page.direction,
            source_facet: page.comparison?.indicator ?? item.resource, descriptor_version: 'map-fixture-v1',
            selected_member_count: selectedMembers.length, eligible_count: selectedMembers.length, missing_count: 0,
            rank: selectedMembers.length >= 2 ? 1 : null, rank_size: selectedMembers.length >= 2 ? selectedMembers.length : null,
            median: selectedMembers.length >= 2 ? 0 : null, rank_ties: selectedMembers.length >= 2 ? 1 : null,
            focal_in_selection: selectedMembers.some((member: any) => member.id === item.target.id),
            member_ranks: selectedMembers.map((member: any) => ({ territory_id: member.id,
              rank: selectedMembers.length >= 2 ? 1 : null, rank_size: selectedMembers.length >= 2 ? selectedMembers.length : null,
              rank_ties: selectedMembers.length >= 2 ? 1 : null })),
            comparison_sources: selectedMembers.length >= 2 ? [{ source_id: sourceId, name: resource.label,
              vintage_id: 'map-fixture-v1', version: 'map-fixture-v1', reference_date: null, publication_date: null }] : [] }
          results.push({ id: item.id, resource: item.resource, data: { resource: item.resource, target: item.target,
            contract: 'indicator-comparison-v1', indicator_id: item.resource, shape: 'scalar',
            content_version: `map-${item.resource}-v1`, reference_content_version: 'map-ref-v1',
            selection: selected ? selectedMembers.map((member: any) => ({ territory_type: member.type, territory_id: member.id })) : null,
            scope: { kind: selected ? 'explicit_selection' : type === 'commune' ? 'density_class' : 'same_level',
              territory_type: type, density_class_code: type === 'commune' ?
                referenceTerritories.find((territory) => territory.territoire === item.target.id)?.classe_densite_code : undefined,
              member_count: selectedMembers.length }, result } })
          continue
        }
        const members = referenceTerritories.filter((territory) => territory.type === type)
        const cohort = { territory_type: type, department_id: null, epci_id: null,
          member_count: members.length, members: members.map((territory) =>
            ({ id: territory.territoire, type: territory.type, name: territory.nom })), reference_content_version: 'map-ref-v1' }
        const identity = { resource: item.resource, target: item.target, shape: resource.shapes[0], cohort,
          content_version: `map-${item.resource}-v1`, reference_content_version: 'map-ref-v1' }
        const source = (row: any) => ({ source_id: resource.sources[0], name: row?.vintage_source ?? resource.label,
          vintage_id: row?.vintage_id ?? 'map-fixture-v1', version: row?.vintage_version ?? 'map-fixture-v1',
          reference_date: row?.vintage_date_reference ?? null, publication_date: row?.vintage_date_publication ?? null })
        let data: Record<string, any>
        if (resource.shapes[0] === 'scalar') {
          const page = metadata.indicator_pages[item.resource]
          const contract = metadata.scalar_contracts[item.resource]
          const rows = p.indicateurs.filter((row) => row.key === item.resource && row.type === type)
          data = { ...identity, descriptor: { indicator_id: item.resource, theme_id: theme, label: page.label,
            unit: page.unit, direction: resource.direction,
            comparison_facet: item.resource, allowed_levels: contract.allowed_levels,
            completeness: contract.completeness, descriptor_version: 'map-fixture-v1' },
            observations: members.map((territory) => { const row = rows.find((r) => r.territoire === territory.territoire)
              return { territory: { id: territory.territoire, type, name: territory.nom },
                status: row?.fact_status ?? (row ? 'measured' : 'not_available'), value: row?.value ?? null,
                sources: [source(row)] } }) }
        } else if (resource.shapes[0] === 'declared_profile') {
          const rows = p.indicateurs.filter((row) => row.key === item.resource && row.type === type)
          const axisValues = (name: string): string[] => {
            const values: unknown = resource.axis_values?.find((axis: any[]) => axis[0] === name)?.[1]
            return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : []
          }
          const details = axisValues('detail')
          const sexes = axisValues('sex')
          const axes = [
            ...details.map((key, order) => ({ name: 'detail' as const, key, label: key, order, unit: resource.unit })),
            ...sexes.map((key, order) => ({ name: 'sex' as const, key, label: key, order, unit: null })),
          ]
          data = { ...identity, descriptor: { indicator: item.resource, label: resource.label, unit: resource.unit,
            allowed_levels: resource.allowed_levels, completeness: 'sparse', descriptor_version: 'map-profile-v1',
            comparison_scalar: null, required_scalar_version: null, denominator_semantics: 'fixture',
            comparison_point: { detail: details[0], sex: sexes[0] ?? null, direction: resource.direction,
              unit: resource.unit }, axes },
            profiles: members.map((territory) => ({ territory: { id: territory.territoire, type, name: territory.nom },
              cells: rows.filter((row) => row.territoire === territory.territoire).map((row) => ({ detail: row.detail,
                sex: row.sex ?? null, unit: row.unit, denominator_semantics: 'fixture', status: row.fact_status ?? 'measured',
                value: row.value, sources: [source(row)] })) })) }
        } else if (resource.shapes[0] === 'typed_reading') {
          const readings = p.histoires.filter((row: any) => row.theme === theme && row.type === type)
          const story = metadata.subgroups.find((group: any) => group.reading)?.reading
          data = { ...identity, descriptor: resource.resource_id === 'demographie_selected_reading'
            ? { rate_unit: '‰/an' } : undefined, territories: members.map((territory) => ({ territory: { id: territory.territoire,
            type, name: territory.nom }, facts: readings.filter((row: any) => row.territoire === territory.territoire)
              .map((row: any) => ({ groupe: row.groupe ?? story?.story_key, story_key: story?.story_key,
                status: row.status ?? 'measured', ...Object.fromEntries((story?.params ?? []).filter((key: string) => typeof row[key] === 'number')
                  .map((key: string) => [key, row[key]])), source: source(row) })) })) }
        } else if (resource.shapes[0] === 'anchored_membership') {
          // #893 — les adhésions servies par l'API sont les lignes
          // couverture_programmes du thème (plus aucun programmes.json)
          const rows = p.indicateurs.filter((row) => row.theme === 'programmes' &&
            row.key === 'couverture_programmes' && row.type === type)
          data = { ...identity, descriptor: { kind: 'anchored_membership', unit: 'adhésion' }, territories: members.map((territory) => {
            const entries = rows.filter((row) => row.territoire === territory.territoire)
              .map((row) => ({ detail: row.detail, label: row.detail, rider: row.rider ?? null,
                sources: [source(row)] }))
            const summaries = [...new Set(entries.map((entry) => entry.detail))].map((detail) =>
              ({ detail, anchor_count: entries.filter((entry) => entry.detail === detail).length }))
            return { territory: { id: territory.territoire, type, name: territory.nom }, completeness: 'observed_sparse',
              availability: entries.length ? 'observed' : 'no_record', entries, relationships: [], summaries }
          }) }
        } else if (resource.shapes[0] === 'ordered_series') {
          const comparisonPoint = metadata.indicator_pages[item.resource]?.comparison?.dimension
          // #893 — les subventions servies par l'API sont les lignes
          // subventions_annuelles du thème (total poolé par année)
          const grants = p.indicateurs.filter((row) => row.theme === 'programmes' &&
            row.key === 'subventions_annuelles' && row.type === type)
          const axisValues = [...new Set(grants.map((row) => String(row.dimension)))].sort()
          const valuesByTerritoryAndYear = new Map<string, number>()
          for (const row of grants) if (row.value !== null) {
            valuesByTerritoryAndYear.set(`${row.territoire}:${row.dimension}`, row.value)
          }
          data = { ...identity, descriptor: { axis_kind: 'year', axis_values: axisValues,
            comparison_point: String(comparisonPoint), unit: resource.unit, completeness: 'sparse' },
            series: members.map((territory) => ({ territory: { id: territory.territoire, type, name: territory.nom },
              availability: valuesByTerritoryAndYear.has(`${territory.territoire}:${comparisonPoint}`) ? 'complete' : 'no_record',
              points: axisValues.filter((axis) => valuesByTerritoryAndYear.has(`${territory.territoire}:${axis}`)).map((axis) => ({ axis,
                observation_period: axis, status: 'measured', value: valuesByTerritoryAndYear.get(`${territory.territoire}:${axis}`),
                provenance: [{ source_id: resource.sources[0], source_name: resource.label, vintage_id: 'scdl-v1',
                  version: '2025', reference_date: null, publication_date: null }] })) })) }
        } else {
          // #893 — la ventilation par domaine servie par l'API : les lignes
          // subventions_par_domaine du thème
          const grants = p.indicateurs.filter((row) => row.theme === 'programmes' &&
            row.key === 'subventions_par_domaine' && row.type === type)
          data = { ...identity, descriptor: { kind: 'period_detail', unit: '€' }, territories: members.map((territory) => {
            const entries = grants.filter((row) => row.territoire === territory.territoire && row.detail)
              .map((row) => ({ detail: row.detail, label: row.detail, observation_period: String(row.dimension),
                status: 'measured', value: row.value, sources: [source(row)] }))
            return { territory: { id: territory.territoire, type, name: territory.nom }, completeness: 'observed_sparse',
              availability: entries.length ? 'observed' : 'no_record', entries }
          }) }
        }
        data.synthetic_fixture = NATIVE_API_FIXTURE_NOTICE
        results.push({ id: item.id, resource: item.resource, data })
      }
      return new Response(JSON.stringify({ contract: 'semantic-read-batch-v1', results }))
    }
    if (url === '/api/resources/read') return new Response('', { status: 404 })
    throw new Error(`Unexpected map API fixture request: ${url}`)
  }
  return fixtureFetch as typeof fetch
}

/**
 * La carte interactive (/carte — layouts.md §3): the ThemeTabs subheader
 * (reused, ?theme= in the URL), the full-bleed MapExplorer + MapSidebar, and
 * the shell's states — skeleton, typed error with Retry, and the honest
 * « Fonds de carte indisponible. » when no mask file is published. ADR-0019:
 * ?theme= selects the theme's DEFAULT (story) layer — coucheParDefaut — and
 * the sidebar's layer clicks switch the map + legend (in-memory state).
 */

function feature(territoire: string, nom: string) {
  return {
    type: 'Feature' as const,
    properties: { territoire, nom, type: 'commune' as const },
    geometry: { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [0, 0]]] },
  }
}

const masquesCommunes: Masques = {
  communes: { type: 'FeatureCollection', features: [feature('22001', 'Commune A1')] },
  epcis: null,
  departements: null,
}

const masquesAbsents: Masques = { communes: null, epcis: null, departements: null }

/** Les trois niveaux de masque — pour exercer le level-native des couches
 *  programmes (adhésion commune vs EPCI, aucune au département). */
const masquesTroisNiveaux: Masques = {
  communes: {
    type: 'FeatureCollection',
    features: [feature('22001', 'Commune A1'), feature('22002', 'Commune D')],
  },
  epcis: { type: 'FeatureCollection', features: [feature('200000001', 'EPCI X')] },
  departements: { type: 'FeatureCollection', features: [feature('22', 'Département 22')] },
}

/** Les trois niveaux COMPLETS — les 4 communes, les 2 EPCIs et les 2
 *  départements du fixture : la couche par défaut de la Démographie
 *  (taux_solde_naturel) porte assez de valeurs à chaque niveau pour que les
 *  échelles commune / EPCI / toutes-lignes DIFFÈRENT (le test #294). */
const masquesNiveauxComplets: Masques = {
  communes: {
    type: 'FeatureCollection',
    features: [
      feature('22001', 'Commune A1'),
      feature('22002', 'Commune D'),
      feature('29001', 'Commune B'),
      feature('29002', 'Commune C'),
    ],
  },
  epcis: {
    type: 'FeatureCollection',
    features: [feature('200000001', 'EPCI X'), feature('200000002', 'EPCI Y')],
  },
  departements: {
    type: 'FeatureCollection',
    features: [feature('22', 'Département 22'), feature('29', 'Département 29')],
  },
}

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  runReport: null,
  vintages: vintagesFixture,
  programmes: null,
}

/** Le payload avec l'onglet programmes — les FAITS du thème (#893 : plus
 *  aucun programmes.json ; l'API sert les lignes indicateurs_programmes,
 *  ici dérivées des tables canoniques du fixture) + une ligne de subvention
 *  communale supplémentaire (22002, 12 000 €) pour une légende lisible. */
const subventionsCarteFixture: SubventionProgramme[] = [
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
]
const payloadProgrammes: Payload = {
  ...payload,
  indicateurs: [
    ...indicateursDemographieFixture,
    ...lignesCouverture(membresProgrammesFixture),
    ...lignesSubventions(subventionsCarteFixture),
  ],
}

describe('CarteView — la discovery fixture conserve les capacités natives du producteur', () => {
  it('projette les déclarations API sélectionnées sans recopier éligibilité, axes ou capacités de comptage', async () => {
    const apiFixture = await fetchCarteApiFixture(payloadProgrammes)
    const response = await apiFixture('/api/resources')
    const catalogue = await response.json() as { resources: ReturnType<typeof nativeResources> }
    const expected = Object.entries(resourceIds).flatMap(([theme, ids]) =>
      ids.map((id) => nativeResources(theme).find((resource) => resource.resource_id === id)!))

    expect(catalogue.resources).toEqual(expected)
  })
})

function chargerPayloadAvec(p: Payload): ChargerFichier {
  return chargerAvec(p)
}

async function monter(overrides: {
  chargerPayload?: ChargerFichier
  chargerGeometrie?: ChargerGeometrie
  chargerMetadata?: ChargerMetadonneesTheme
  apiFetchImpl?: typeof fetch
  chemin?: string
  apiFetch?: boolean
  apiPayload?: Payload
} = {}) {
  let chargerPayload = overrides.chargerPayload ?? chargerPayloadAvec(payload)
  if (overrides.apiFetch !== false) {
    vi.stubGlobal('fetch', overrides.apiFetchImpl ?? await fetchCarteApiFixture(overrides.apiPayload ?? payload))
    const chargerPayloadOriginal = chargerPayload
    chargerPayload = async (file: Parameters<ChargerFichier>[0]) => {
      const theme = file.startsWith('theme_') ? file.slice('theme_'.length) : ''
      return theme && mapMetadataPreload.has(theme) ? mapMetadataPreload.get(theme) : chargerPayloadOriginal(file)
    }
  }
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(overrides.chemin ?? '/carte')
  await router.isReady()
  const wrapper = mount(CarteView, {
    global: {
      plugins: [router],
      provide: {
        [PAYLOAD_CHARGER_KEY]: chargerPayload,
        [GEOMETRIE_CHARGER_KEY]: overrides.chargerGeometrie ?? (async () => masquesCommunes),
        ...(overrides.chargerMetadata ? { [THEME_METADATA_CHARGER_KEY]: overrides.chargerMetadata } : {}),
      },
    },
  })
  await flushPromises()
  return { router, wrapper }
}

/** Monte la carte sur le payload programmes, sur les trois niveaux de masque
 *  (le level-native des couches d'adhésion s'exerce au changement de niveau). */
async function monterProgrammes(chemin: string) {
  vi.stubGlobal('fetch', await fetchCarteApiFixture(payloadProgrammes))
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(chemin)
  await router.isReady()
  const wrapper = mount(CarteView, {
    global: {
      plugins: [router],
      provide: {
        [PAYLOAD_CHARGER_KEY]: async (file: Parameters<ChargerFichier>[0]) => {
          const theme = file.startsWith('theme_') ? file.slice('theme_'.length) : ''
          return theme && mapMetadataPreload.has(theme) ? mapMetadataPreload.get(theme) : chargerPayloadAvec(payloadProgrammes)(file)
        },
        [GEOMETRIE_CHARGER_KEY]: async () => masquesTroisNiveaux,
      },
    },
  })
  await flushPromises()
  return { router, wrapper }
}

describe('CarteView — les états (chargement / erreur / fond indisponible)', () => {
  it('shows a skeleton while the payload loads (chargement-gated)', async () => {
    const enAttente = new Promise<unknown>(() => {})
    const { wrapper } = await monter({ chargerPayload: () => enAttente })

    expect(wrapper.find('[role="status"]').exists()).toBe(true)
    expect(wrapper.find('.squelette').exists()).toBe(true)
  })

  it('shows the typed error state with a Retry button for the payload', async () => {
    let appels = 0
    const charger: ChargerFichier = async (fichier) => {
      appels += 1
      if (appels === 1) throw new Error('Impossible de charger /data/territoires.json')
      return chargerAvec(payload)(fichier)
    }
    const { wrapper } = await monter({ chargerPayload: charger })

    expect(wrapper.find('.carte-etat--erreur').text()).toContain('Impossible de charger les données de la carte.')
    await wrapper.find('.carte-etat-bouton').trigger('click')
    await flushPromises()
    expect(wrapper.find('.carte-etat--erreur').exists()).toBe(false)
  })

  it('shows the typed error state with a Retry button for the geometry', async () => {
    let appels = 0
    const charger: ChargerGeometrie = async () => {
      appels += 1
      if (appels === 1) throw new Error('ECONNREFUSED')
      return masquesCommunes
    }
    const { wrapper } = await monter({ chargerGeometrie: charger })

    expect(wrapper.find('.carte-etat--erreur').text()).toContain('Impossible de charger le fond de carte.')
    await wrapper.find('.carte-etat-bouton').trigger('click')
    await flushPromises()
    expect(wrapper.find('.carte-etat--erreur').exists()).toBe(false)
  })

  it('shows the honest « Fonds de carte indisponible. » state when no mask is published', async () => {
    const { wrapper } = await monter({ chargerGeometrie: async () => masquesAbsents })

    expect(wrapper.text()).toContain('Fonds de carte indisponible.')
    expect(wrapper.find('.carte-etat-detail').text()).toContain('pas encore publiée')
  })
})

describe('CarteView — la carte avec fond publié', () => {
  it('masque le scalaire statique tant que le cohort est indisponible puis récupère via le retry', async () => {
    const metadata = JSON.parse(await (await import('node:fs/promises')).readFile('../public/data/theme_demographie.json', 'utf8'))
    const producer = JSON.parse(await readFile(join(process.cwd(), '..', 'pipeline', 'inst', 'extdata',
      'theme-metadata', 'theme_demographie.json'), 'utf8'))
    const scalar = producer.scalar_contracts.densite
    const resource = nativeResources('demographie').find((candidate) => candidate.resource_id === 'densite')
    if (!resource) throw new Error('Densité map fixture is not producer-declared')
    let apiCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/data/theme_demographie.json') return new Response(JSON.stringify(metadata))
      if (url === '/api/resources') return new Response(JSON.stringify({ contract: 'semantic-resource-catalogue-v1', resources: [resource] }))
      if (url === '/api/resources/read-batch') {
        apiCalls += 1
        if (apiCalls === 1) return new Response('', { status: 503 })
        const item = JSON.parse(init?.body as string).items[0]
        const members = territoiresFixture.filter((territory) => territory.type === 'commune')
        const fact = territoiresFixture.find((territory) => territory.territoire === '22001')!
        const data = { resource: 'densite', target: item.target, shape: 'scalar',
          cohort: { territory_type: 'commune', department_id: null, epci_id: null, member_count: members.length,
            members: members.map((territory) => ({ id: territory.territoire, type: territory.type, name: territory.nom })),
            reference_content_version: 'reference-v1' },
          content_version: 'scalar-v1', reference_content_version: 'reference-v1',
          descriptor: { indicator_id: 'densite', theme_id: 'demographie', label: resource.label, unit: resource.unit,
            direction: resource.direction, comparison_facet: scalar.comparison_facet,
            allowed_levels: resource.allowed_levels, denominator_semantics: scalar.denominator_semantics,
            completeness: scalar.completeness, descriptor_version: 'scalar-v1' },
          observations: [{ territory: { id: fact.territoire, type: fact.type, name: fact.nom }, status: 'measured', value: 9876,
            support_count: 41, denominator_count: 100,
            sources: [{ source_id: resource.sources[0], name: 'Source', vintage_id: 'v1', version: '2026',
              reference_date: null, publication_date: null }] }] }
        return new Response(JSON.stringify({ contract: 'semantic-read-batch-v1', results: [{ id: item.id, resource: 'densite', data }] }))
      }
      throw new Error(`Unexpected request: ${url}`)
    }))
    const { wrapper } = await monter({ chemin: '/carte?theme=demographie', apiFetch: false,
      chargerPayload: async (file) => file === 'theme_demographie' ? metadata : chargerPayloadAvec(payload)(file) })
    await wrapper.findAll('button').find((button) => button.text().includes('Densité'))?.trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('Impossible de charger les valeurs')
    expect(wrapper.find('[role="alert"]').text()).toContain('Réessayer')
    const carte = maplibreMock.instancesCarteMaple.at(-1)
    const joined = () => carte?.sourcesSetData['masques-communes']?.mock.calls.at(-1)?.[0] as { features: { properties: { territoire: string; valeur: number | null } }[] }
    expect(joined().features.find((f) => f.properties.territoire === '22001')?.properties.valeur).toBeNull()
    await wrapper.find('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(apiCalls).toBe(2)
    expect(joined().features.find((f) => f.properties.territoire === '22001')?.properties.valeur).toBe(9876)
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Densité de population')
    wrapper.unmount()
  })

  it('keeps native map facts and layers when selected label metadata is unavailable', async () => {
    const chargerMetadata = vi.fn(async () => { throw new Error('catalogue unavailable') })
    const { wrapper } = await monter({ chemin: '/carte?theme=demographie', chargerMetadata })

    expect(chargerMetadata).toHaveBeenCalledWith('demographie')
    expect(wrapper.find('.carte-etat--erreur').exists()).toBe(false)
    const layers = wrapper.findAll('.carte-sidebar-couche')
    expect(layers.length).toBeGreaterThan(0)
    expect(layers.map((layer) => layer.text())).toContain('Densité de population')
    expect(layers.map((layer) => layer.text())).toContain('Fait disponible')
    const map = maplibreMock.instancesCarteMaple.at(-1)
    const joined = map?.sourcesSetData['masques-communes']?.mock.calls.at(-1)?.[0] as
      { features: { properties: { territoire: string; valeur: number | null } }[] }
    expect(joined.features.find((item) => item.properties.territoire === '22001')?.properties.valeur).not.toBeNull()
    wrapper.unmount()
  })

  it('retries only selected-theme labels, recovers them without rereading facts, and keeps the active layer', async () => {
    const baseFetch = await fetchCarteApiFixture(payload)
    const requests: string[] = []
    const apiFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(String(input))
      return baseFetch(input, init)
    })
    let metadataAttempts = 0
    let rejectMetadataRetry!: (error: Error) => void
    const chargerMetadata = vi.fn((theme: Theme) => {
      metadataAttempts += 1
      if (metadataAttempts === 1) return Promise.reject(new Error('catalogue unavailable'))
      if (metadataAttempts === 2) return new Promise<typeof metadonneesThemesFixtures.demographie>((_resolve, reject) => {
        rejectMetadataRetry = reject
      })
      const metadata = structuredClone(metadonneesThemesFixtures[theme])
      if (theme === 'demographie') metadata.param_labels.taux_solde_naturel = 'Libellé récupéré du solde naturel'
      return Promise.resolve(metadata)
    })
    const { wrapper } = await monter({ chemin: '/carte?theme=demographie', chargerMetadata, apiFetchImpl: apiFetch })
    document.body.append(wrapper.element)

    expect(wrapper.find('[data-testid="map-metadata-error"]').text())
      .toContain('Les couches et leurs valeurs natives restent affichées.')
    expect(wrapper.findAll('.carte-sidebar-couche').map((layer) => layer.text())).toContain('Fait disponible')
    const densite = wrapper.findAll('.carte-sidebar-couche').find((layer) => layer.text().includes('Densité'))!
    await densite.trigger('click')
    const beforeRetryReads = requests.filter((url) => url === '/api/resources' || url === '/api/resources/read-batch')
    const notice = wrapper.find('[data-testid="map-metadata-notice"]').element
    const retry = wrapper.find('[data-testid="map-metadata-retry"]')
    const retryElement = retry.element as HTMLButtonElement
    retryElement.focus()

    await retry.trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="map-metadata-notice"]').element).toBe(notice)
    expect(wrapper.find('[data-testid="map-metadata-retry"]').element).toBe(retryElement)
    expect(document.activeElement).toBe(retryElement)
    expect(wrapper.find('[data-testid="map-metadata-pending"]').attributes('role')).toBe('status')
    expect(wrapper.find('[data-testid="map-metadata-pending"]').attributes('aria-live')).toBe('polite')
    expect(wrapper.find('[data-testid="map-metadata-notice"]').attributes('aria-busy')).toBe('true')
    expect(wrapper.find('[data-testid="map-metadata-pending"]').text()).toContain('Chargement des libellés')
    expect(retry.attributes('aria-disabled')).toBe('true')
    expect(chargerMetadata).toHaveBeenCalledTimes(2)
    await retry.trigger('click')
    expect(chargerMetadata).toHaveBeenCalledTimes(2)
    expect(document.activeElement).toBe(retryElement)
    expect(requests.filter((url) => url === '/api/resources' || url === '/api/resources/read-batch'))
      .toEqual(beforeRetryReads)

    rejectMetadataRetry(new Error('catalogue still unavailable'))
    await flushPromises()

    expect(wrapper.find('[data-testid="map-metadata-notice"]').element).toBe(notice)
    expect(wrapper.find('[data-testid="map-metadata-error"]').attributes('role')).toBe('alert')
    expect(wrapper.find('[data-testid="map-metadata-error"]').text())
      .toContain('Les couches et leurs valeurs natives restent affichées.')
    expect(wrapper.find('[data-testid="map-metadata-retry"]').element).toBe(retryElement)
    expect(document.activeElement).toBe(retryElement)

    await retry.trigger('click')
    await flushPromises()

    expect(chargerMetadata).toHaveBeenCalledTimes(3)
    expect(chargerMetadata).toHaveBeenLastCalledWith('demographie')
    expect(requests.filter((url) => url === '/api/resources' || url === '/api/resources/read-batch'))
      .toEqual(beforeRetryReads)
    expect(wrapper.find('[data-testid="map-metadata-error"]').exists()).toBe(false)
    expect(wrapper.findAll('.carte-sidebar-couche').map((layer) => layer.text()))
      .toContain('Libellé récupéré du solde naturel')
    expect(wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('Densité de population')
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Densité de population')
    wrapper.unmount()
  })

  it('does not let a late catalogue response for the former theme replace current labels', async () => {
    let resolveFormerTheme!: (metadata: typeof metadonneesThemesFixtures.demographie) => void
    const formerThemeMetadata = new Promise<typeof metadonneesThemesFixtures.demographie>((resolve) => {
      resolveFormerTheme = resolve
    })
    const habitatMetadata = structuredClone(metadonneesThemesFixtures.habitat)
    habitatMetadata.param_labels.part_passoires = 'Libellé actuel de la part de passoires'
    const chargerMetadata = vi.fn((theme: Theme) =>
      theme === 'demographie' ? formerThemeMetadata : Promise.resolve(habitatMetadata))
    const apiPayload: Payload = { ...payload,
      indicateurs: [...indicateursDemographieFixture, ...indicateursHabitatFixture],
      histoires: [...histoiresDemographieFixture, ...histoiresHabitatFixture],
    }
    const { wrapper } = await monter({ chemin: '/carte?theme=demographie', chargerMetadata, apiPayload })

    const habitat = wrapper.findAll('[role="tab"]').find((tab) => tab.text().includes('Habitat'))!
    await habitat.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.carte-sidebar-couche').map((layer) => layer.text()))
      .toContain('Libellé actuel de la part de passoires')

    resolveFormerTheme(metadonneesThemesFixtures.demographie)
    await flushPromises()

    expect(wrapper.findAll('.carte-sidebar-couche').map((layer) => layer.text()))
      .toContain('Libellé actuel de la part de passoires')
    expect(wrapper.findAll('.carte-sidebar-couche').map((layer) => layer.text()))
      .not.toContain('Fait disponible')
    wrapper.unmount()
  })

  it('keeps typed-reading map layers when every native reading is unavailable', async () => {
    const baseFetch = await fetchCarteApiFixture(payload)
    const apiFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await baseFetch(input, init)
      if (String(input) !== '/api/resources/read-batch') return response
      const body = await response.json() as { results: Array<{ resource: string; data: Record<string, any> }> }
      for (const result of body.results) {
        if (result.resource !== 'demographie_selected_reading') continue
        for (const territory of result.data.territories as Array<{ facts: Array<Record<string, any>> }>) {
          territory.facts = territory.facts.map((fact) => ({
            groupe: fact.groupe,
            story_key: 'identite-de-lecture-native',
            status: 'unavailable',
            source: fact.source,
          }))
        }
      }
      return new Response(JSON.stringify(body))
    })
    const { wrapper } = await monter({ chemin: '/carte?theme=demographie', apiFetchImpl: apiFetch })

    expect(wrapper.find('.carte-etat--erreur').exists()).toBe(false)
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Solde naturel (‰/an)')
    expect(wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('Solde naturel (‰/an)')
    const map = maplibreMock.instancesCarteMaple.at(-1)
    const joined = map?.sourcesSetData['masques-communes']?.mock.calls.at(-1)?.[0] as
      { features: { properties: { territoire: string; valeur: number | null } }[] }
    expect(joined.features.find((feature) => feature.properties.territoire === '22001')?.properties.valeur).toBeNull()
    expect(joined.features.every((feature) => feature.properties.valeur === null)).toBe(true)
    wrapper.unmount()
  })

  it('renders the populated native Milieux trajectory reading as a selectable map layer', async () => {
    const apiPayload: Payload = { ...payload,
      indicateurs: [...indicateursDemographieFixture, ...indicateursMilieuxFixture],
      histoires: [...histoiresDemographieFixture, ...histoiresMilieuxFixture],
    }
    const baseFetch = await fetchCarteApiFixture(apiPayload)
    const readingBatches: Array<Array<{ resource: string; fields: string[] }>> = []
    const apiFetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/resources/read-batch') {
        const body = JSON.parse(String(init?.body)) as { items: Array<{ resource: string; fields: string[] }> }
        readingBatches.push(body.items)
      }
      return baseFetch(input, init)
    })
    const { wrapper } = await monter({ chemin: '/carte?theme=milieux', apiPayload, apiFetchImpl })

    expect(wrapper.find('.carte-etat--erreur').exists()).toBe(false)
    const layer = wrapper.findAll('.carte-sidebar-couche')
      .find((button) => button.text().trim() === 'Trajectoire par habitant')
    expect(layer).toBeDefined()
    expect(readingBatches.flat().find((item) => item.resource === 'milieux_selected_reading')?.fields)
      .toContain('trajectoire_artif_par_habitant')

    await layer!.trigger('click')
    await flushPromises()

    expect(wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('Trajectoire par habitant')
    const map = maplibreMock.instancesCarteMaple.at(-1)
    const joined = map?.sourcesSetData['masques-communes']?.mock.calls.at(-1)?.[0] as
      { features: { properties: { territoire: string; valeur: number | null } }[] }
    const expected = histoiresMilieuxFixture.find((history): history is HistoireMilieux =>
      history.theme === 'milieux' && history.territoire === '22001')!
      .trajectoire_artif_par_habitant
    expect(joined.features.find((feature) => feature.properties.territoire === '22001')?.properties.valeur)
      .toBe(expected)
    wrapper.unmount()
  })

  it('does not let stale catalogue policy or labels override native layer admission', async () => {
    const stale = structuredClone(metadonneesThemesFixtures.demographie)
    stale.indicator_keys = ['taille_menages']
    stale.map_layers = { densite: false, structure_age: false }
    stale.indicator_labels.densite = 'Ancien label de densité'
    const chargerMetadata = vi.fn(async () => stale)
    const { wrapper } = await monter({ chemin: '/carte?theme=demographie', chargerMetadata })

    const layers = wrapper.findAll('.carte-sidebar-couche').map((layer) => layer.text())
    expect(layers).toContain('Densité de population')
    expect(layers).not.toContain('Ancien label de densité')
    expect(wrapper.find('.carte-etat--erreur').exists()).toBe(false)
    wrapper.unmount()
  })

  it('renders the map + sidebar and the registry-driven ThemeTabs — six supported themes (#901)', async () => {
    const { wrapper } = await monter()

    expect(wrapper.findComponent({ name: 'MapExplorer' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'MapSidebar' }).exists()).toBe(true)
    const onglets = wrapper.findAll('[role="tab"]').map((o) => o.text().trim())
    expect(onglets).toEqual([
      'Programmes et subventions',
      'Mobilité',
      'Démographie',
      'Habitat',
      'Économie/Emploi',
      'Milieux',
    ])
  })

  it('the Aperçu tab (default) runs on the brand ramp and shows the mask-level legend', async () => {
    const { wrapper } = await monter()

    expect(wrapper.find('.carte--theme-apercu').exists()).toBe(true)
    expect(wrapper.find('.carte-legendes-masques').text()).toContain('Communes')
  })

  it('selecting a theme writes ?theme= and drives the legend with its default (story) layer', async () => {
    const { router, wrapper } = await monter()

    const demographie = wrapper.findAll('[role="tab"]').find((o) => o.text().includes('Démographie'))
    await demographie?.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.theme).toBe('demographie')
    // la couche par défaut du thème — le premier scalaire de Story (ADR-0019 α)
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Solde naturel (‰/an)')
    expect(wrapper.find('.carte--theme-demographie').exists()).toBe(true)
  })

  it('an absent ?theme= in the URL selects the theme when it is in the payload', async () => {
    const { wrapper } = await monter({ chemin: '/carte?theme=demographie' })

    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Solde naturel (‰/an)')
  })

  it('the sidebar lists the theme’s layers — the default story layer active', async () => {
    const { wrapper } = await monter({ chemin: '/carte?theme=demographie' })

    const couches = wrapper.findAll('.carte-sidebar-couche').map((b) => b.text().trim())
    expect(couches[0]).toBe('Solde naturel (‰/an)')
    expect(couches).toContain('Densité de population')
    expect(couches).toContain('Moins de 15 ans')
    expect(wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('Solde naturel (‰/an)')
  })

  it('clicking a layer in the sidebar switches the map + legend (in-memory state)', async () => {
    const { wrapper } = await monter({ chemin: '/carte?theme=demographie' })

    const densite = wrapper
      .findAll('.carte-sidebar-couche')
      .find((b) => b.text().includes('Densité'))
    await densite?.trigger('click')
    await flushPromises()

    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Densité de population')
    expect(wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('Densité de population')
  })

  it('first load (no ?theme=) is the neutral state — no layer, masks only', async () => {
    const { wrapper } = await monter()

    expect(wrapper.findAll('.carte-sidebar-couche')).toHaveLength(0)
    expect(wrapper.find('.carte-legendes-masques').text()).toContain("sans couche d'indicateurs")
    expect(wrapper.findComponent({ name: 'MapLegend' }).props('couche')).toBeNull()
  })

  it('an unknown ?theme= falls back to Aperçu', async () => {
    const { wrapper } = await monter({ chemin: '/carte?theme=inconnu' })

    expect(wrapper.find('.carte--theme-apercu').exists()).toBe(true)
  })

  it('the layer controls only offer the published mask levels', async () => {
    const { wrapper } = await monter({ chargerGeometrie: async () => masquesCommunes })

    const boutons = wrapper.findAll('[role="radio"]').map((b) => b.text())
    expect(boutons).toEqual(['Communes'])
    expect(wrapper.find('.carte-sidebar-note').text()).toContain('sans géométrie sont indisponibles')
  })

  it('feeds the legend the map neutral rendering — map and legend share one source (issue #68)', async () => {
    const { wrapper } = await monter({ chemin: '/carte?theme=demographie' })

    const legende = wrapper.findComponent({ name: 'MapLegend' })
    expect(legende.props('couleurVide')).toBe(COULEUR_NEUTRE)
    expect(legende.props('couleurContour')).toBe(COULEUR_CONTOUR)
  })
})

describe('CarteView — l’onglet « Programmes et subventions » (ADR-0019 #282)', () => {
  it('le premier onglet de la carte lit « Programmes et subventions » (l’Aperçu de la fiche reste intact)', async () => {
    const { wrapper } = await monter()

    const onglets = wrapper.findAll('[role="tab"]').map((o) => o.text().trim())
    expect(onglets[0]).toBe('Programmes et subventions')
    expect(onglets).toContain('Démographie')
  })

  it('?onglet=programmes active la couche subventions par défaut — légende € et couches programmes dans la sidebar', async () => {
    const { wrapper } = await monterProgrammes('/carte?onglet=programmes')

    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Subventions totales')
    expect(wrapper.find('.carte-legendes-unite').text()).toContain('€')
    const couches = wrapper.findAll('.carte-sidebar-couche').map((b) => b.text().trim())
    expect(couches).toEqual(['ACV', 'PVD', 'ORT', 'Subventions totales'])
    expect(wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('Subventions totales')
  })

  it('?onglet=programmes&programme=ACV rend la légende catégorielle d’adhésion et marque ACV active', async () => {
    const { wrapper } = await monterProgrammes('/carte?onglet=programmes&programme=ACV')

    expect(wrapper.find('.carte-legendes-titre').text()).toBe('ACV')
    expect(wrapper.find('.carte-legendes-gamme').text()).toContain('Membre du programme')
    expect(wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('ACV')
  })

  it('cliquer le premier onglet écrit ?onglet=programmes (l’état de la carte, pas un Aperçu vide)', async () => {
    const { router, wrapper } = await monterProgrammes('/carte')

    await wrapper.findAll('[role="tab"]')[0].trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.onglet).toBe('programmes')
    expect(router.currentRoute.value.query.theme).toBeUndefined()
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Subventions totales')
  })

  it('sélectionner un thème efface ?onglet=programmes (l’exclusion mutuelle de l’ADR-0019)', async () => {
    const { router, wrapper } = await monterProgrammes('/carte?onglet=programmes')

    const demographie = wrapper.findAll('[role="tab"]').find((o) => o.text().includes('Démographie'))
    await demographie?.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.theme).toBe('demographie')
    expect(router.currentRoute.value.query.onglet).toBeUndefined()
  })

  it('?theme= ET ?onglet=programmes ensemble → l’onglet gagne, le thème est nettoyé', async () => {
    const { router, wrapper } = await monterProgrammes('/carte?theme=demographie&onglet=programmes')

    expect(router.currentRoute.value.query.onglet).toBe('programmes')
    expect(router.currentRoute.value.query.theme).toBeUndefined()
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Subventions totales')
  })

  it('?onglet=programmes&programme=INCONNU → la couche par défaut et le sigle inconnu nettoyé', async () => {
    const { router, wrapper } = await monterProgrammes('/carte?onglet=programmes&programme=INCONNU')

    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Subventions totales')
    expect(router.currentRoute.value.query.programme).toBeUndefined()
  })

  it('?onglet=inconnu → l’état neutre (aucune couche, la note des masques)', async () => {
    const { router, wrapper } = await monterProgrammes('/carte?onglet=inconnu')

    expect(router.currentRoute.value.query.onglet).toBeUndefined()
    expect(wrapper.find('.carte-legendes-masques').text()).toContain("sans couche d'indicateurs")
  })

  it('?programme=ACV sans ?onglet= → l’état neutre (un sigle hors onglet n’est pas un état)', async () => {
    const { router, wrapper } = await monterProgrammes('/carte?programme=ACV')

    expect(router.currentRoute.value.query.programme).toBeUndefined()
    expect(wrapper.findAll('.carte-sidebar-couche')).toHaveLength(0)
  })

  it('?onglet=programmes sans faits programmes côté API → l’état vide honnête, aucun repli statique (#893)', async () => {
    const { wrapper } = await monter({ chemin: '/carte?onglet=programmes' })

    expect(wrapper.findAll('.carte-sidebar-couche')).toHaveLength(0)
    expect(wrapper.find('.carte-legendes-masques').exists()).toBe(true)
  })

  it('au niveau EPCI, les couches d’adhésion EPCI (CRTE · Territoires d’industrie · ORT)', async () => {
    const { wrapper } = await monterProgrammes('/carte?onglet=programmes')

    const boutons = wrapper.findAll('[role="radio"]')
    await boutons[1].trigger('click')
    await flushPromises()

    const couches = wrapper.findAll('.carte-sidebar-couche').map((b) => b.text().trim())
    expect(couches).toEqual(['CRTE', "Territoires d'industrie", 'ORT', 'Subventions totales'])
  })

  it('au niveau département, AUCUNE couche d’adhésion — l’absence honnête, les subventions seules', async () => {
    const { wrapper } = await monterProgrammes('/carte?onglet=programmes')

    const boutons = wrapper.findAll('[role="radio"]')
    await boutons[2].trigger('click')
    await flushPromises()

    const couches = wrapper.findAll('.carte-sidebar-couche').map((b) => b.text().trim())
    expect(couches).toEqual(['Subventions totales'])
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Subventions totales')
  })

  it('la légende des subventions reste niveau-scopée au passage à l’EPCI (#294) — les valeurs EPCI seules', async () => {
    const { wrapper } = await monterProgrammes('/carte?onglet=programmes')

    const boutons = wrapper.findAll('[role="radio"]')
    await boutons[1].trigger('click')
    await flushPromises()

    const valeursEpci = subventionsProgrammesFixture
      .filter((s) => s.type === 'epci')
      .map((s) => s.montant)
    expect(wrapper.findComponent({ name: 'MapLegend' }).props('seuils')).toEqual(
      echelleValeurs(valeursEpci).seuils,
    )
  })

  it('ORT se re-joint au changement de niveau (ADR-0019) — ?programme=ORT reste actif de la commune à l’EPCI', async () => {
    const { wrapper } = await monterProgrammes('/carte?onglet=programmes&programme=ORT')

    expect(wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('ORT')

    const boutons = wrapper.findAll('[role="radio"]')
    await boutons[1].trigger('click')
    await flushPromises()

    expect(wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('ORT')
  })

  it('?programme=ACV au passage vers l’EPCI retombe sur les subventions (aucune ligne ACV EPCI — jamais inventée)', async () => {
    const { wrapper } = await monterProgrammes('/carte?onglet=programmes&programme=ACV')

    expect(wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('ACV')

    const boutons = wrapper.findAll('[role="radio"]')
    await boutons[1].trigger('click')
    await flushPromises()

    expect(wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('Subventions totales')
  })

  it('cliquer une couche d’adhésion dans la sidebar écrit ?onglet=programmes&programme=<sigle> (partageable)', async () => {
    const { router, wrapper } = await monterProgrammes('/carte?onglet=programmes')

    const pvd = wrapper.findAll('.carte-sidebar-couche').find((b) => b.text().trim() === 'PVD')
    await pvd?.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ onglet: 'programmes', programme: 'PVD' })
    expect(wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('PVD')
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('PVD')
  })

  it('?onglet=programmes&programme=ACV survit au rechargement (l’état est l’URL)', async () => {
    const premier = await monterProgrammes('/carte?onglet=programmes&programme=ACV')
    expect(premier.wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('ACV')
    premier.wrapper.unmount()

    const second = await monterProgrammes('/carte?onglet=programmes&programme=ACV')
    expect(second.wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('ACV')
    expect(second.wrapper.find('.carte-legendes-titre').text()).toBe('ACV')
  })
})

describe('CarteView — la légende suit l’échelle du niveau actif (ADR-0019, #294)', () => {
  it('au niveau EPCI, les seuils de la légende viennent des valeurs EPCI — pas de toutes les lignes mélangées', async () => {
    const { wrapper } = await monter({
      chemin: '/carte?theme=demographie',
      chargerGeometrie: async () => masquesNiveauxComplets,
    })

    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Solde naturel (‰/an)')

    const estDemographie = (h: Histoire): h is HistoireDemographie => h.theme === 'demographie'
    const valeursDuNiveau = (type: string) =>
      histoiresDemographieFixture
        .filter((h): h is HistoireDemographie => h.type === type && estDemographie(h))
        .map((h) => h.taux_solde_naturel)
    const toutesLignes = histoiresDemographieFixture.filter(estDemographie).map((h) => h.taux_solde_naturel)

    expect(wrapper.findComponent({ name: 'MapLegend' }).props('seuils')).toEqual(
      echelleValeurs(valeursDuNiveau('commune')).seuils,
    )

    const boutons = wrapper.findAll('[role="radio"]')
    await boutons[1].trigger('click')
    await flushPromises()

    const legende = wrapper.findComponent({ name: 'MapLegend' })
    expect(legende.props('seuils')).toEqual(echelleValeurs(valeursDuNiveau('epci')).seuils)
    expect(legende.props('seuils')).not.toEqual(echelleValeurs(toutesLignes).seuils)
  })
})

describe('CarteView — la recherche zoome sur l’entité (ADR-0019, #283)', () => {
  it('la recherche de la sidebar est sans navigation et son sélect remonte jusqu’à la carte', async () => {
    const { wrapper } = await monter({ chemin: '/carte?theme=demographie' })

    const sidebar = wrapper.findComponent({ name: 'MapSidebar' })
    const recherche = sidebar.findComponent({ name: 'GlobalSearchBar' })
    expect(recherche.props('sansNavigation')).toBe(true)

    const epciX = territoiresFixture.find((t) => t.territoire === '200000001')
    recherche.vm.$emit('select', epciX)
    await flushPromises()

    const explorateur = wrapper.findComponent({ name: 'MapExplorer' })
    expect(explorateur.props('territoireCible')).toEqual(epciX)
    expect(explorateur.props('requeteZoom')).toBe(1)
  })

  it('bascule le niveau sur celui de l’entité cherchée (un EPCI cherché depuis les communes)', async () => {
    const { wrapper } = await monter({
      chemin: '/carte?theme=demographie',
      chargerGeometrie: async () => masquesTroisNiveaux,
    })

    const sidebar = wrapper.findComponent({ name: 'MapSidebar' })
    expect(sidebar.props('niveau')).toBe('communes')

    const epciX = territoiresFixture.find((t) => t.territoire === '200000001')
    sidebar.findComponent({ name: 'GlobalSearchBar' }).vm.$emit('select', epciX)
    await flushPromises()

    expect(sidebar.props('niveau')).toBe('epcis')
    expect(wrapper.findComponent({ name: 'MapExplorer' }).props('territoireCible')).toEqual(epciX)
  })

  it('une entité au niveau affiché ne change pas de niveau et la carte ouvre son popup', async () => {
    const { wrapper } = await monter({
      chemin: '/carte?theme=demographie',
      chargerGeometrie: async () => masquesTroisNiveaux,
    })

    const sidebar = wrapper.findComponent({ name: 'MapSidebar' })
    const communeA1 = territoiresFixture.find((t) => t.territoire === '22001')
    sidebar.findComponent({ name: 'GlobalSearchBar' }).vm.$emit('select', communeA1)
    await flushPromises()

    expect(sidebar.props('niveau')).toBe('communes')
    const popup = maplibreMock.instancesPopups.at(-1)
    expect(popup?.contenu).toContain('Commune A1')
    expect(popup?.contenu).toContain('Voir la fiche')
  })
})

describe('CarteView — la carte neutre d’abord (T7, #303 — le wait-set de la carte)', () => {
  /** Le payload avec l’habitat en plus — la paire d’arrière-plan en échec
   *  devient observable (son onglet aurait rendu sinon). */
  const payloadDeuxThemes: Payload = {
    ...payload,
    indicateurs: [...indicateursDemographieFixture, ...indicateursHabitatFixture],
    histoires: [...histoiresDemographieFixture, ...histoiresHabitatFixture],
  }

  it('rend la carte neutre dès que territoires + run-report se règlent — les 6 onglets du registre sont là, les 12 fichiers numériques ne sont jamais demandés (#901)', async () => {
    const demandes: string[] = []
    const enAttente = new Promise<unknown>(() => {})
    const charger: ChargerFichier = async (fichier) => {
      demandes.push(fichier)
      // Les paires numériques « pendraient » si on les demandait — elles ne
      // le sont jamais (#901 : zéro téléchargement numérique statique).
      if (fichier.startsWith('indicateurs_') || fichier.startsWith('histoires_')) return enAttente
      return chargerAvec(payload)(fichier)
    }
    const { wrapper } = await monter({ chargerPayload: charger })

    // Le wait-set de la carte est réglé → pas de squelette, la carte vit.
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'MapExplorer' }).exists()).toBe(true)
    // Les 6 onglets du registre (la présence est produit, pas lignes de faits).
    const onglets = wrapper.findAll('[role="tab"]').map((o) => o.text().trim())
    expect(onglets).toEqual([
      'Programmes et subventions',
      'Mobilité',
      'Démographie',
      'Habitat',
      'Économie/Emploi',
      'Milieux',
    ])
    expect(demandes.filter((f) => f.startsWith('indicateurs_') || f.startsWith('histoires_'))).toEqual([])
    // L'état neutre honnête : masques seuls, aucune couche d'indicateurs.
    expect(wrapper.findAll('.carte-sidebar-couche')).toHaveLength(0)
    expect(wrapper.find('.carte-legendes-masques').text()).toContain("sans couche d'indicateurs")
  })

  it('le changement de niveau fonctionne dans l’état neutre (communes/epcis/departements)', async () => {
    const enAttente = new Promise<unknown>(() => {})
    const charger: ChargerFichier = async (fichier) => {
      if (fichier.startsWith('indicateurs_') || fichier.startsWith('histoires_')) return enAttente
      return chargerAvec(payload)(fichier)
    }
    const { wrapper } = await monter({
      chargerPayload: charger,
      chargerGeometrie: async () => masquesTroisNiveaux,
    })

    const boutons = wrapper.findAll('[role="radio"]')
    expect(boutons.map((b) => b.text())).toEqual(['Communes', 'EPCI', 'Départements'])
    await boutons[1].trigger('click')
    await flushPromises()

    expect(wrapper.findComponent({ name: 'MapSidebar' }).props('niveau')).toBe('epcis')
    expect(wrapper.findComponent({ name: 'MapExplorer' }).props('niveau')).toBe('epcis')
  })

  it('la popup de l’état neutre donne le nom et le lien « Voir la fiche »', async () => {
    const enAttente = new Promise<unknown>(() => {})
    const charger: ChargerFichier = async (fichier) => {
      if (fichier.startsWith('indicateurs_') || fichier.startsWith('histoires_')) return enAttente
      return chargerAvec(payload)(fichier)
    }
    await monter({ chargerPayload: charger })

    const carte = maplibreMock.instancesCarteMaple.at(-1)
    carte?.fire('load')
    const carteFake = carte as unknown as {
      queryRenderedFeatures: () => { properties: { territoire: string } }[]
    }
    carteFake.queryRenderedFeatures = () => [{ properties: { territoire: '22001' } }] as never
    carte?.fire('click', { point: { x: 10, y: 10 }, lngLat: { lng: -2, lat: 48 } })

    const popup = maplibreMock.instancesPopups.at(-1)
    expect(popup?.contenu).toContain('Commune A1')
    expect(popup?.contenu).toContain('Voir la fiche')
  })

  it('?theme= canonique est admis dès le wait-set (registre #901) — les couches viennent de l’API, les fichiers numériques du thème ne sont jamais demandés', async () => {
    const demandes: string[] = []
    const enAttente = new Promise<unknown>(() => {})
    const charger: ChargerFichier = async (fichier) => {
      demandes.push(fichier)
      // Les fichiers numériques du thème « pendraient » si on les demandait —
      // ils ne le sont jamais (#901).
      if (fichier === 'indicateurs_demographie' || fichier === 'histoires_demographie') return enAttente
      return chargerAvec(payload)(fichier)
    }
    const { router, wrapper } = await monter({
      chemin: '/carte?theme=demographie',
      chargerPayload: charger,
    })

    // Le thème canonique est admis immédiatement (la présence est produit,
    // pas lignes de faits) : l'URL est conservée et la couche par défaut du
    // thème (le premier scalaire de Story) est servie par l'API.
    expect(router.currentRoute.value.query.theme).toBe('demographie')
    expect(demandes).not.toContain('indicateurs_demographie')
    expect(demandes).not.toContain('histoires_demographie')
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Solde naturel (‰/an)')
    expect(wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('Solde naturel (‰/an)')
  })

  it('l’onglet programmes est piloté par l’acquisition API native — le magasin ne demande JAMAIS programmes.json (#893)', async () => {
    const demandes: string[] = []
    const charger: ChargerFichier = async (fichier) => {
      demandes.push(fichier)
      return chargerAvec(payloadProgrammes)(fichier)
    }
    const { wrapper } = await monter({
      chemin: '/carte?onglet=programmes',
      chargerPayload: charger,
      apiPayload: payloadProgrammes,
    })

    // Aucun fichier 'programmes' n'a été demandé au magasin : les couches
    // viennent exclusivement des lectures natives de l'API.
    expect(demandes).not.toContain('programmes')
    // #901 — idem pour les 12 fichiers numériques : zéro requête statique.
    expect(demandes.filter((f) => f.startsWith('indicateurs_') || f.startsWith('histoires_'))).toEqual([])
    expect(wrapper.findAll('.carte-sidebar-couche')).toHaveLength(4)
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Subventions totales')
    expect(wrapper.findComponent({ name: 'MapExplorer' }).exists()).toBe(true)
  })

  it('les fichiers numériques d’arrière-plan ne sont plus démarrés du tout (#901) : leur échec n’atteint jamais la carte, les 6 onglets du registre restent', async () => {
    const demandes: string[] = []
    const charger: ChargerFichier = async (fichier) => {
      demandes.push(fichier)
      if (fichier === 'indicateurs_habitat' || fichier === 'histoires_habitat') {
        throw new PayloadError('fetch', `${fichier}.json`, 'réseau')
      }
      return chargerAvec(payloadDeuxThemes)(fichier)
    }
    const { wrapper } = await monter({ chargerPayload: charger })

    // Aucune erreur de page — la carte vit, et les 6 onglets du registre
    // rendent (la présence est produit, pas lignes de faits).
    expect(wrapper.find('.carte-etat--erreur').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'MapExplorer' }).exists()).toBe(true)
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(6)
    // Les fichiers numériques en échec n'ont même pas été demandés.
    expect(demandes.filter((f) => f.startsWith('indicateurs_') || f.startsWith('histoires_'))).toEqual([])
  })

  it('garde l’URL ?theme= demandée quand le wait-set échoue — Retry la remet debout sans normalisation prématurée', async () => {
    let territoiresEchoue = true
    const charger: ChargerFichier = async (fichier) => {
      if (fichier === 'territoires' && territoiresEchoue) {
        territoiresEchoue = false
        throw new PayloadError('fetch', 'territoires.json', 'réseau')
      }
      return chargerAvec(payload)(fichier)
    }
    const { router, wrapper } = await monter({
      chemin: '/carte?theme=demographie',
      chargerPayload: charger,
    })

    // Le wait-set a échoué → l'erreur typée + Retry, l'URL demandée conservée
    // (un échec n'est pas une absence — Retry a son mot à dire).
    expect(wrapper.find('.carte-etat--erreur').text()).toContain(
      'Impossible de charger les données de la carte.',
    )
    expect(router.currentRoute.value.query.theme).toBe('demographie')

    await wrapper.find('.carte-etat-bouton').trigger('click')
    await flushPromises()

    // Retry ne refetch que l'échoué → la carte remonte, le thème demandé rend.
    expect(wrapper.find('.carte-etat--erreur').exists()).toBe(false)
    expect(router.currentRoute.value.query.theme).toBe('demographie')
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Solde naturel (‰/an)')
  })

  it('un thème non canonique demandé est nettoyé de l’URL (la normalisation d’avant, toujours en vie)', async () => {
    const { router, wrapper } = await monter({ chemin: '/carte?theme=bidule' })

    await flushPromises()
    expect(router.currentRoute.value.query.theme).toBeUndefined()
    expect(wrapper.find('.carte--theme-apercu').exists()).toBe(true)
  })
})

describe('CarteView — #901 : onglets + admission ?theme= depuis le REGISTRE THEMES_CANONIQUES (présence produit, pas lignes de faits)', () => {
  /** La barre d'onglets de la carte : le premier onglet « Programmes et
   *  subventions » (ADR-0019) couvre le thème `programmes`, puis les cinq
   *  autres thèmes dans l'ordre canonique du registre — six identités. */
  const ONGLETS_REGISTRE = [
    'Programmes et subventions',
    'Mobilité',
    'Démographie',
    'Habitat',
    'Économie/Emploi',
    'Milieux',
  ]
  const fichiersNumeriques = (demandes: string[]) =>
    demandes.filter((f) => f.startsWith('indicateurs_') || f.startsWith('histoires_'))

  it('cache frais : les 6 identités d’onglets du registre, et ZÉRO des 12 fichiers numériques demandés même si leurs réponses sont disponibles', async () => {
    const demandes: string[] = []
    // Le chargeur SERT les lignes statiques si on les demande (elles sont
    // « disponibles » côté fixture) — la carte ne doit JAMAIS les demander.
    const charger: ChargerFichier = async (fichier) => {
      demandes.push(fichier)
      return chargerAvec(payload)(fichier)
    }
    const { wrapper } = await monter({ chargerPayload: charger, apiFetch: false })

    expect(wrapper.findAll('[role="tab"]').map((o) => o.text().trim())).toEqual(ONGLETS_REGISTRE)
    expect(fichiersNumeriques(demandes)).toEqual([])
    // Bootstrap stays narrow: the wait-set only; a selected catalogue is not an eager payload read.
    expect(new Set(demandes)).toEqual(new Set([
      'territoires',
      'run-report',
    ]))
  })

  it('?theme= canonique admis dès le wait-set — même quand l’API ne déclare aucune ressource pour ce thème (état « sans couche » honnête, onglets stables)', async () => {
    const demandes: string[] = []
    const charger: ChargerFichier = async (fichier) => {
      demandes.push(fichier)
      return chargerAvec(payload)(fichier)
    }
    const { router, wrapper } = await monter({ chemin: '/carte?theme=mobilite', chargerPayload: charger })

    // mobilite n'a aucune ressource déclarée dans le fixture API : aucune
    // couche, aucune erreur — mais l'onglet existe et est sélectionné.
    expect(router.currentRoute.value.query.theme).toBe('mobilite')
    const onglets = wrapper.findAll('[role="tab"]')
    expect(onglets.map((o) => o.text().trim())).toEqual(ONGLETS_REGISTRE)
    expect(onglets[1]!.attributes('aria-selected')).toBe('true')
    expect(wrapper.findAll('.carte-sidebar-couche')).toHaveLength(0)
    expect(wrapper.find('.carte-etat--erreur').exists()).toBe(false)
    expect(fichiersNumeriques(demandes)).toEqual([])
  })

  it('échec API du thème sélectionné → « indisponible + Réessayer », PAS une absence : onglets stables, URL gardée, aucune valeur statique de repli, zéro requête numérique', async () => {
    const metadata = JSON.parse(await readFile(join(process.cwd(), '..', 'public', 'data', 'theme_demographie.json'), 'utf8'))
    const demandes: string[] = []
    const charger: ChargerFichier = async (fichier) => {
      demandes.push(fichier)
      return fichier === 'theme_demographie' ? metadata : chargerAvec(payload)(fichier)
    }
    const fixture = await fetchCarteApiFixture(payload)
    let premierAppel = true
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/resources' && premierAppel) {
        premierAppel = false
        return new Response('', { status: 503 })
      }
      return fixture(input, init)
    }))
    const { router, wrapper } = await monter({ chemin: '/carte?theme=demographie', chargerPayload: charger, apiFetch: false })
    await flushPromises()

    // L'échec API est un état indisponible + retry — jamais une absence d'onglet.
    expect(wrapper.find('[role="alert"]').text()).toContain('Impossible de charger les valeurs natives de la carte.')
    expect(router.currentRoute.value.query.theme).toBe('demographie')
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(6)
    // Aucune valeur statique de repli : les lignes du fixture (disponibles
    // côté chargeur) ne sont ni demandées ni rendues pendant l'échec.
    const carte = maplibreMock.instancesCarteMaple.at(-1)
    const joined = () => carte?.sourcesSetData['masques-communes']?.mock.calls.at(-1)?.[0] as { features: { properties: { territoire: string; valeur: number | null } }[] }
    expect(joined().features.find((f) => f.properties.territoire === '22001')?.properties.valeur ?? null).toBeNull()
    expect(fichiersNumeriques(demandes)).toEqual([])

    // Retry → l'API sert enfin → les valeurs natives rendent (toujours zéro
    // requête numérique statique).
    await wrapper.find('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Solde naturel (‰/an)')
    expect(joined().features.find((f) => f.properties.territoire === '22001')?.properties.valeur).not.toBeNull()
    expect(fichiersNumeriques(demandes)).toEqual([])
  })

  it('?theme=programmes (canonique) est normalisé vers l’URL unique du mode Programmes (?onglet=programmes) — couches adhésion/subventions rendues via l’API, pas seulement le highlight d’onglet (#901)', async () => {
    const demandes: string[] = []
    const charger: ChargerFichier = async (fichier) => {
      demandes.push(fichier)
      return chargerAvec(payloadProgrammes)(fichier)
    }
    const { router, wrapper } = await monter({
      chemin: '/carte?theme=programmes',
      chargerPayload: charger,
      apiPayload: payloadProgrammes,
    })

    // Une seule autorité d'URL pour le mode Programmes : ?onglet=programmes.
    expect(router.currentRoute.value.query).toEqual({ onglet: 'programmes' })
    // Le mode spécial rend SES couches, servies par l'acquisition API native
    // (membres + subventions) — pas un état vide de branche générique.
    const couches = wrapper.findAll('.carte-sidebar-couche').map((b) => b.text().trim())
    expect(couches).toEqual(['ACV', 'PVD', 'ORT', 'Subventions totales'])
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Subventions totales')
    expect(wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('Subventions totales')
    // 6 onglets du registre, zéro requête numérique statique.
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(6)
    expect(fichiersNumeriques(demandes)).toEqual([])
  })

  it('?theme=programmes&programme=ACV conserve le paramètre de couche à travers la normalisation (?onglet=programmes&programme=ACV)', async () => {
    const { router, wrapper } = await monter({
      chemin: '/carte?theme=programmes&programme=ACV',
      apiPayload: payloadProgrammes,
    })

    expect(router.currentRoute.value.query).toEqual({ onglet: 'programmes', programme: 'ACV' })
    expect(wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('ACV')
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('ACV')
  })

  it('passer de ?theme=demographie à l’onglet Programmes écrit l’URL canonique ?onglet=programmes (jamais ?theme=programmes)', async () => {
    const { router, wrapper } = await monterProgrammes('/carte?theme=demographie')

    expect(router.currentRoute.value.query).toEqual({ theme: 'demographie' })
    await wrapper.findAll('[role="tab"]')[0].trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ onglet: 'programmes' })
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Subventions totales')
  })

  it('?theme=programmes avec l’API en échec → normalisé vers ?onglet=programmes, état indisponible + Retry (pas une absence), onglets stables, zéro requête numérique', async () => {
    const metadataProgrammes = JSON.parse(await readFile(join(process.cwd(), '..', 'public', 'data', 'theme_programmes.json'), 'utf8'))
    const demandes: string[] = []
    const charger: ChargerFichier = async (fichier) => {
      demandes.push(fichier)
      return fichier === 'theme_programmes' ? metadataProgrammes : chargerAvec(payloadProgrammes)(fichier)
    }
    const fixture = await fetchCarteApiFixture(payloadProgrammes)
    let premierAppel = true
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/resources/read-batch' && premierAppel) {
        premierAppel = false
        return new Response('', { status: 503 })
      }
      return fixture(input, init)
    }))
    const { router, wrapper } = await monter({
      chemin: '/carte?theme=programmes',
      chargerPayload: charger,
      apiFetch: false,
    })
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ onglet: 'programmes' })
    expect(wrapper.find('[role="alert"]').text()).toContain('Impossible de charger les valeurs natives de la carte.')
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(6)
    expect(fichiersNumeriques(demandes)).toEqual([])

    await wrapper.find('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Subventions totales')
    expect(fichiersNumeriques(demandes)).toEqual([])
  })
})

describe('CarteView — #901 : magasin partagé CHAUD (aucun chargeur injecté — le seam public réel)', () => {
  it('store partagé préchauffé sur les seules références/métadonnées : la carte lit les observations synthétiques API et ne replie jamais', async () => {
    const payloadChaud: Payload = {
      ...payload,
      indicateurs: [],
      histoires: [],
    }
    // These deliberately synthetic API observations are distinct from any
    // published values; resource identity, unit, and source clock remain
    // producer-backed in the catalogue/metadata fixture.
    const densite = indicateursDemographieFixture.find((row) => row.key === 'densite')!
    const observationsApi = ['22001', '22002', '29001', '29002'].map((territoire, index) => ({
      ...densite, territoire, type: 'commune' as const, value: 73 + index,
      synthetic_fixture: NATIVE_API_FIXTURE_NOTICE,
    }))
    const payloadApi: Payload = {
      ...payloadChaud,
      // Retain synthetic profile cells so the fixture can publish exactly the
      // producer-declared axes for every cohort read, including background reads.
      indicateurs: [...indicateursDemographieFixture.filter((row) => row.key !== 'densite'), ...observationsApi],
    }
    const demandesData: string[] = []
    let apiEnEchec = false
    const fixtureApi = await fetchCarteApiFixture(payloadApi, true)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/data/')) {
        demandesData.push(url)
        const fichier = url.slice('/data/'.length, -'.json'.length) as Fichier
        // This test's shared store is intentionally bounded to retained
        // references and metadata. Retired numerical projections are not read.
        if (fichier.startsWith('indicateurs_') || fichier.startsWith('histoires_')) {
          return new Response('', { status: 404 })
        }
        try {
          return new Response(await readFile(join(process.cwd(), '..', 'public', 'data', `${fichier}.json`), 'utf8'))
        } catch {
          return new Response('', { status: 404 })
        }
      }
      // Panne ciblée sur les lectures de cohorts (la découverte réussit :
      // les couches existent, leurs valeurs échouent).
      if (apiEnEchec && url === '/api/resources/read-batch') return new Response('', { status: 503 })
      return fixtureApi(input, init)
    }))

    // Phase 0 — a prior route warms the shared production store through its
    // public seam, but only with retained reference/report/metadata files.
    const harness = mount(defineComponent({
      setup() {
        const metadata = THEMES_CANONIQUES.map((theme) => `theme_${theme}` as Fichier)
        const demarrer: Fichier[] = ['territoires', 'territoires-metadata', 'run-report', 'vintages', ...metadata]
        const etat = usePayload({ attendre: ['territoires', 'run-report'], demarrer })
        return { etat }
      },
      render: () => h('div'),
    }))
    await vi.waitFor(() => {
      expect(harness.vm.etat.chargement.value).toBe(false)
      expect(harness.vm.etat.erreur.value).toBeNull()
    })
    // The shared store is warm, while retired numeric sections stay honestly empty.
    expect(harness.vm.etat.payload.value.territoires.length).toBeGreaterThan(0)
    expect(harness.vm.etat.payload.value.indicateurs).toEqual([])
    expect(harness.vm.etat.payload.value.histoires).toEqual([])
    const numeriquesChauffes = demandesData.filter((u) => u.includes('indicateurs_') || u.includes('histoires_'))
    expect(numeriquesChauffes).toEqual([])
    const marqueur = demandesData.length

    const monterSurMagasinChaud = async () => {
      const router = createRouter({ history: createMemoryHistory(), routes })
      await router.push('/carte?theme=demographie')
      await router.isReady()
      const wrapper = mount(CarteView, {
        global: {
          plugins: [router],
          provide: { [GEOMETRIE_CHARGER_KEY]: async () => masquesCommunes },
        },
      })
      await flushPromises()
      return { router, wrapper }
    }
    const valeur22001 = () => {
      const carte = maplibreMock.instancesCarteMaple.at(-1)
      const joined = carte?.sourcesSetData['masques-communes']?.mock.calls.at(-1)?.[0] as
        { features: { properties: { territoire: string; valeur: number | null } }[] }
      return joined?.features.find((f) => f.properties.territoire === '22001')?.properties.valeur ?? null
    }

    // Phase 1 — the real card reuses the warmed shared metadata store.
    const { router, wrapper } = await monterSurMagasinChaud()
    // Only the selected catalogue is read for typed-field labels; no other theme is warmed here.
    expect(demandesData.slice(marqueur).filter((u) => u.startsWith('/data/')))
      .toEqual(['/data/theme_demographie.json'])
    // 6 onglets du registre, URL canonique conservée.
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(6)
    expect(router.currentRoute.value.query.theme).toBe('demographie')
    // The marked synthetic API response—not any static payload—drives the map.
    await wrapper.findAll('.carte-sidebar-couche').find((b) => b.text().includes('Densité'))!.trigger('click')
    await flushPromises()
    expect(valeur22001()).toBe(73)
    const marqueur2 = demandesData.length

    // Phase 2 — API failure: no numeric fallback, unavailable state + Retry,
    // with tabs/URL stable.
    apiEnEchec = true
    wrapper.unmount()
    const { router: router2, wrapper: wrapper2 } = await monterSurMagasinChaud()
    expect(wrapper2.find('[role="alert"]').text()).toContain('Impossible de charger les valeurs natives de la carte.')
    expect(router2.currentRoute.value.query.theme).toBe('demographie')
    expect(wrapper2.findAll('[role="tab"]')).toHaveLength(6)
    await wrapper2.findAll('.carte-sidebar-couche').find((b) => b.text().includes('Densité'))!.trigger('click')
    await flushPromises()
    expect(valeur22001()).toBeNull()
    expect(demandesData.slice(marqueur2).filter((u) => u.startsWith('/data/')))
      .toEqual(['/data/theme_demographie.json'])

    // Retry restores the same synthetic API value without reading numeric files.
    apiEnEchec = false
    await wrapper2.find('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper2.find('[role="alert"]').exists()).toBe(false)
    await wrapper2.findAll('.carte-sidebar-couche').find((b) => b.text().includes('Densité'))!.trigger('click')
    await flushPromises()
    expect(valeur22001()).toBe(73)
    expect(demandesData.slice(marqueur2).filter((u) => u.startsWith('/data/')))
      .toEqual(['/data/theme_demographie.json'])

    wrapper2.unmount()
    harness.unmount()
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  maplibreMock.instancesCarteMaple.length = 0
  maplibreMock.instancesPopups.length = 0
})
