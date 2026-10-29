import { flushPromises, mount } from '@vue/test-utils'

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
  apercuFixture,
  chargerAvec,
  histoiresDemographieFixture,
  histoiresHabitatFixture,
  indicateursDemographieFixture,
  indicateursHabitatFixture,
  membresProgrammesFixture,
  programmesLadderFixture,
  subventionsProgrammesFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import type { ChargerFichier } from '../payload/usePayload'
import type { Histoire, HistoireDemographie, Payload } from '../payload/types'
import { PayloadError } from '../payload/validate'
import { routes } from '../router'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const resourceShapes: Record<string, Record<string, { shape: string; source: string; levels?: string[] }>> = {
  demographie: {
    densite: { shape: 'scalar', source: 'serie_historique' },
    structure_age: { shape: 'declared_profile', source: 'age_detail' },
    evolution_1968: { shape: 'scalar', source: 'serie_historique' },
    taille_menages: { shape: 'scalar', source: 'menages' },
    demographie_selected_reading: { shape: 'typed_reading', source: 'serie_historique', levels: ['commune', 'epci', 'departement', 'region'] },
  },
  programmes: {
    couverture_programmes: { shape: 'anchored_membership', source: 'acv' },
    subventions_annuelles: { shape: 'ordered_series', source: 'subventions_scdl' },
    subventions_par_domaine: { shape: 'period_detail', source: 'subventions_scdl', levels: ['commune'] },
  },
}
const mapMetadataPreload = new Map<string, Record<string, any>>()

/** Mount boundary fixture: producer-shaped catalogue + cohort reads, never static app reads. */
async function fetchCarteApiFixture(p: Payload): Promise<typeof fetch> {
  const metadataByTheme = new Map<string, Record<string, any>>()
  const loadMetadata = async (theme: string) => {
    let metadata = metadataByTheme.get(theme)
    if (!metadata) {
      metadata = JSON.parse(await readFile(join(process.cwd(), '..', 'public', 'data', `theme_${theme}.json`), 'utf8'))
      mapMetadataPreload.set(theme, metadata!)
      if (!metadata) throw new Error(`Missing producer metadata for ${theme}`)
      metadataByTheme.set(theme, metadata)
    }
    return metadata!
  }
  // Preload canonical metadata before mount so fetch() never performs filesystem
  // I/O while Vue is flushing its watchers.
  await Promise.all(['demographie', 'programmes'].map(loadMetadata))
  const declarations = async (theme: string) => {
    if (theme === 'programmes' && !p.programmes) return []
    const metadata = await loadMetadata(theme)
    const shapes = resourceShapes[theme] ?? {}
    return Object.entries(shapes).map(([id, spec]) => {
      const page = metadata.indicator_pages?.[id]
      const allowed = spec.levels ?? page?.levels ?? ['commune', 'epci', 'departement']
      const facts = p.indicateurs.filter((row) => row.key === id && row.theme === theme)
      const details = [...new Set(facts.map((row) => row.detail).filter((value): value is string => Boolean(value)))]
      const sexes = [...new Set(facts.map((row) => row.sex).filter(Boolean))] as string[]
      const axes = spec.shape === 'declared_profile' ? ['detail', ...(sexes.length ? ['sex'] : [])] :
        spec.shape === 'ordered_series' ? ['year'] : spec.shape === 'anchored_membership' ? ['membership'] :
          spec.shape === 'typed_reading' ? ['groupe'] : []
      const axisValues = spec.shape === 'declared_profile'
        ? [['detail', details], ...(sexes.length ? [['sex', sexes]] : [])]
        : spec.shape === 'anchored_membership' ? [['detail', ['ACV', 'PVD', 'CRTE', "Territoires d'industrie", 'ORT']]]
          : spec.shape === 'typed_reading' ? [['groupe', metadata.subgroups.filter((g: any) => g.reading).map((g: any) => g.reading.story_key)]] : []
      const source = page?.sources?.[0] ?? spec.source
      return { resource_id: id, theme_id: theme, indicator_id: id, label: metadata.indicator_labels?.[id] ?? id,
        unit: page?.unit ?? (spec.shape === 'anchored_membership' ? 'adhésion' : ''),
        direction: page?.comparison?.direction ?? page?.direction ?? 'high', allowed_levels: allowed, sources: [source],
        shapes: [spec.shape], axes, axis_values: axisValues, target_kinds: ['territory', 'territory_cohort'],
        fields: spec.shape === 'anchored_membership' ? ['detail', 'label', 'rider', 'anchor_count', 'availability']
          : spec.shape === 'typed_reading' ? metadata.semantic_resources?.find((r: any) => r.resource_id === id)?.fields ?? []
            : spec.shape === 'scalar' ? ['value'] : spec.shape === 'declared_profile' ? ['value'] : ['value'],
        intents: ['facts', ...(spec.shape === 'scalar' ? ['fixed_comparison', 'selected_comparison'] : [])] }
    })
  }
  const fixtureFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    if (url.startsWith('/data/theme_')) {
      return new Response(JSON.stringify(await loadMetadata(url.slice('/data/theme_'.length, -5))))
    }
    if (url === '/api/resources') {
      try {
      const resources = [...await declarations('demographie'), ...await declarations('programmes')]
        return new Response(JSON.stringify({ contract: 'semantic-resource-catalogue-v1', resources }))
      } catch (error) { console.error('catalogue fixture failure', error); throw error }
    }
    if (url === '/api/resources/read-batch') {
      const body = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
      const results = []
      for (const item of body.items) {
        const theme = String(item.resource).startsWith('demographie_') || item.resource === 'densite' ||
          item.resource === 'evolution_1968' || item.resource === 'taille_menages' || item.resource === 'structure_age'
          ? 'demographie' : 'programmes'
        const resource = (await declarations(theme)).find((entry) => entry.resource_id === item.resource)!
        const metadata = await loadMetadata(theme)
        const type = item.target.type as string
        if (item.target.kind === 'territory' && item.intent.kind !== 'facts') {
          const page = metadata.indicator_pages[item.resource]
          const selected = item.intent.kind === 'selected_comparison'
          const selectedMembers = selected ? item.intent.members : p.territoires
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
                p.territoires.find((territory) => territory.territoire === item.target.id)?.classe_densite_code : undefined,
              member_count: selectedMembers.length }, result } })
          continue
        }
        const members = p.territoires.filter((territory) => territory.type === type)
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
          const details = resource.axis_values.find((axis: any[]) => axis[0] === 'detail')?.[1] ?? []
          const sexes = resource.axis_values.find((axis: any[]) => axis[0] === 'sex')?.[1] ?? [null]
          data = { ...identity, descriptor: { indicator: item.resource, label: resource.label, unit: resource.unit,
            allowed_levels: resource.allowed_levels, completeness: 'sparse', descriptor_version: 'map-profile-v1',
            comparison_scalar: null, required_scalar_version: null, denominator_semantics: 'fixture',
            comparison_point: { detail: details[0], sex: sexes[0] ?? null, direction: resource.direction,
              unit: resource.unit }, axes: details.map((key: string, order: number) => ({ name: 'detail', key, label: key, order, unit: resource.unit }))
              .concat(sexes.filter(Boolean).map((key: string, order: number) => ({ name: 'sex', key, label: key, order, unit: null }))) },
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
          const rows = p.programmes?.membres ?? []
          data = { ...identity, descriptor: { kind: 'anchored_membership', unit: 'adhésion' }, territories: members.map((territory) => {
            const entries = rows.filter((row) => row.territoire === territory.territoire && row.type === type)
              .map((row) => ({ detail: row.sigle, label: row.sigle, rider: row.convention_valant_ort ? 'convention valant ORT' : null,
                sources: [source(row)] }))
            const summaries = [...new Set(entries.map((entry) => entry.detail))].map((detail) =>
              ({ detail, anchor_count: entries.filter((entry) => entry.detail === detail).length }))
            return { territory: { id: territory.territoire, type, name: territory.nom }, completeness: 'observed_sparse',
              availability: entries.length ? 'observed' : 'no_record', entries, relationships: [], summaries }
          }) }
        } else if (resource.shapes[0] === 'ordered_series') {
          const comparisonPoint = metadata.indicator_pages[item.resource]?.comparison?.dimension
          const grants = p.programmes?.subventions ?? []
          const axisValues = [...new Set(grants.filter((row) => row.type === type).map((row) => String(row.annee)))].sort()
          const valuesByTerritoryAndYear = new Map<string, number>()
          for (const row of grants) if (row.type === type) {
            const key = `${row.territoire}:${row.annee}`
            valuesByTerritoryAndYear.set(key, (valuesByTerritoryAndYear.get(key) ?? 0) + row.montant)
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
          const grants = p.programmes?.subventions ?? []
          data = { ...identity, descriptor: { kind: 'period_detail', unit: '€' }, territories: members.map((territory) => {
            const entries = grants.filter((row) => row.territoire === territory.territoire && row.type === type && row.programme_libl)
              .map((row) => ({ detail: row.programme_libl, label: row.programme_libl, observation_period: String(row.annee),
                status: 'measured', value: row.montant, sources: [source(row)] }))
            return { territory: { id: territory.territoire, type, name: territory.nom }, completeness: 'observed_sparse',
              availability: entries.length ? 'observed' : 'no_record', entries }
          }) }
        }
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
  apercu: apercuFixture,
  runReport: null,
  vintages: vintagesFixture,
  programmes: null,
}

/** Le payload avec l'onglet programmes — les lignes partagées + une ligne de
 *  subvention communale supplémentaire (22002) pour une légende lisible. */
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

function chargerPayloadAvec(p: Payload): ChargerFichier {
  return chargerAvec(p)
}

async function monter(overrides: {
  chargerPayload?: ChargerFichier
  chargerGeometrie?: ChargerGeometrie
  chemin?: string
  apiFetch?: boolean
  apiPayload?: Payload
} = {}) {
  let chargerPayload = overrides.chargerPayload ?? chargerPayloadAvec(payload)
  if (overrides.apiFetch !== false) {
    vi.stubGlobal('fetch', await fetchCarteApiFixture(overrides.apiPayload ?? payload))
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
    vi.stubEnv('VITE_SCALAR_COHORT_API', '1')
    const metadata = JSON.parse(await (await import('node:fs/promises')).readFile('../public/data/theme_demographie.json', 'utf8'))
    const page = metadata.indicator_pages.densite
    const resource = { resource_id: 'densite', theme_id: 'demographie', indicator_id: 'densite', label: 'Densité',
      unit: page.unit, direction: page.direction, allowed_levels: metadata.scalar_contracts.densite.allowed_levels,
      sources: page.sources, shapes: ['scalar'], target_kinds: ['territory', 'territory_cohort'],
      fields: ['value', 'support_count', 'denominator_count'], intents: ['facts', 'fixed_comparison', 'selected_comparison'] }
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
          descriptor: { indicator_id: 'densite', theme_id: 'demographie', label: 'Densité de population', unit: page.unit,
            direction: page.direction, comparison_facet: 'densite', allowed_levels: resource.allowed_levels,
            denominator_semantics: 'Population totale publiée', completeness: 'sparse', descriptor_version: 'scalar-v1' },
          observations: [{ territory: { id: fact.territoire, type: fact.type, name: fact.nom }, status: 'measured', value: 9876,
            support_count: 41, denominator_count: 100,
            sources: [{ source_id: page.sources[0], name: 'Source', vintage_id: 'v1', version: '2026',
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

  it('renders the map + sidebar and the payload-driven ThemeTabs', async () => {
    const { wrapper } = await monter()

    expect(wrapper.findComponent({ name: 'MapExplorer' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'MapSidebar' }).exists()).toBe(true)
    const onglets = wrapper.findAll('[role="tab"]').map((o) => o.text().trim())
    expect(onglets[0]).toBe('Programmes et subventions')
    expect(onglets).toContain('Démographie')
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

  it('?onglet=programmes sans payload programmes (404 = élément absent) → l’état vide honnête', async () => {
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

  it('rend la carte neutre dès que territoires + run-report se règlent, toutes les paires de thèmes encore pendantes', async () => {
    const enAttente = new Promise<unknown>(() => {})
    const charger: ChargerFichier = async (fichier) => {
      if (fichier.startsWith('indicateurs_') || fichier.startsWith('histoires_')) return enAttente
      return chargerAvec(payload)(fichier)
    }
    const { wrapper } = await monter({ chargerPayload: charger })

    // Le wait-set de la carte est réglé → pas de squelette, la carte vit.
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'MapExplorer' }).exists()).toBe(true)
    // Aucun onglet de thème (les paires pendent) — le premier onglet seul.
    const onglets = wrapper.findAll('[role="tab"]').map((o) => o.text().trim())
    expect(onglets).toEqual(['Programmes et subventions'])
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

  it('la liste de couches se remplit progressivement — une couche n’est rendue que quand SA paire atterrit, l’URL ?theme= conservée', async () => {
    let resoudreIndicateurs: (v: unknown) => void = () => {}
    let resoudreHistoires: (v: unknown) => void = () => {}
    const indicateursEnAttente = new Promise<unknown>((resoudre) => {
      resoudreIndicateurs = resoudre
    })
    const histoiresEnAttente = new Promise<unknown>((resoudre) => {
      resoudreHistoires = resoudre
    })
    const charger: ChargerFichier = async (fichier) => {
      if (fichier === 'indicateurs_demographie') return indicateursEnAttente
      if (fichier === 'histoires_demographie') return histoiresEnAttente
      return chargerAvec(payload)(fichier)
    }
    const { router, wrapper } = await monter({
      chemin: '/carte?theme=demographie',
      chargerPayload: charger,
    })

    // Le thème demandé pend encore → l'état neutre honnête, l'URL CONSERVÉE
    // (la normalisation ne réécrit pas un thème valide en vol).
    expect(wrapper.findAll('.carte-sidebar-couche')).toHaveLength(0)
    expect(wrapper.find('.carte-legendes-masques').text()).toContain("sans couche d'indicateurs")
    expect(router.currentRoute.value.query.theme).toBe('demographie')

    // La paire atterrit → la couche par défaut du thème (le premier scalaire
    // de Story) rend, sans rechargement de la page.
    resoudreIndicateurs(indicateursDemographieFixture)
    resoudreHistoires(histoiresDemographieFixture)
    await flushPromises()

    expect(router.currentRoute.value.query.theme).toBe('demographie')
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Solde naturel (‰/an)')
    expect(wrapper.find('.carte-sidebar-couche.est-actif').text()).toBe('Solde naturel (‰/an)')
  })

  it('le groupe de couches « Programmes et subventions » apparaît quand programmes atterrit (arrière-plan)', async () => {
    let resoudreProgrammes: (v: unknown) => void = () => {}
    const programmesEnAttente = new Promise<unknown>((resoudre) => {
      resoudreProgrammes = resoudre
    })
    const charger: ChargerFichier = async (fichier) => {
      if (fichier === 'programmes') return programmesEnAttente
      return chargerAvec(payload)(fichier)
    }
    const { wrapper } = await monter({
      chemin: '/carte?onglet=programmes',
      chargerPayload: charger,
      apiPayload: payloadProgrammes,
    })

    // L'acquisition native de la carte est indépendante du payload historique
    // programmes encore en attente.
    expect(wrapper.findAll('.carte-sidebar-couche')).toHaveLength(4)
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Subventions totales')
    expect(wrapper.findComponent({ name: 'MapExplorer' }).exists()).toBe(true)

    resoudreProgrammes(programmesLadderFixture)
    await flushPromises()

    // Le règlement du payload historique ne remplace pas les faits natifs.
    expect(wrapper.find('.carte-legendes-titre').text()).toBe('Subventions totales')
    expect(wrapper.findAll('.carte-sidebar-couche')).toHaveLength(4)
  })

  it('une paire de thème d’arrière-plan en échec → ses couches absentes, la carte vivante, aucune erreur de page', async () => {
    const charger: ChargerFichier = async (fichier) => {
      if (fichier === 'indicateurs_habitat' || fichier === 'histoires_habitat') {
        throw new PayloadError('fetch', `${fichier}.json`, 'réseau')
      }
      return chargerAvec(payloadDeuxThemes)(fichier)
    }
    const { wrapper } = await monter({ chargerPayload: charger })

    // Aucune erreur de page — la carte vit, l'onglet habitat simplement absent
    // (l'absence honnête, jamais une erreur).
    expect(wrapper.find('.carte-etat--erreur').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'MapExplorer' }).exists()).toBe(true)
    const onglets = wrapper.findAll('[role="tab"]').map((o) => o.text().trim())
    expect(onglets).toEqual(['Programmes et subventions', 'Démographie'])
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

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  maplibreMock.instancesCarteMaple.length = 0
  maplibreMock.instancesPopups.length = 0
})
