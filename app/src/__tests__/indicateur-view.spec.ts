import { flushPromises, mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, beforeEach, vi } from 'vitest'
import IndicateurView from '../views/IndicateurView.vue'
import RepereFamilyOutlet from '../components/indicateurs/RepereFamilyOutlet.vue'
import { dispatchIndicatorFamily } from '../indicateurs/familySeam'
import { chargerAvec, indicateursDemographieFixture, indicateursHabitatFixture, indicateursMilieuxFixture, indicateursMobiliteFixture, indicateursProgrammesFixture, indicateursRaccordementFixture, metadonneesMobiliteRaccordementFixture, metadonneesThemesFixtures, territoiresFixture, histoiresDemographieFixture, apercuAvecNAFixture, runReportFraisFixture, vintagesFixture } from '../payload/fixtures'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'

import type { Payload, FamilleFigure, IndicatorPageMetadata } from '../payload/types'
import { routes } from '../router'
import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'
import type { Fichier } from '../payload/loader'
import { nativeBatchResponse, nativeReadFixture, nativeResources } from './helpers/semanticApiFixtures'

const payload: Payload = { territoires: [...territoiresFixture, { territoire: 'e', type: 'epci', nom: 'EPCI test', departement: null, epci: null }], indicateurs: indicateursDemographieFixture, histoires: histoiresDemographieFixture, apercu: apercuAvecNAFixture, runReport: runReportFraisFixture, vintages: vintagesFixture, programmes: null, themeMetadata: { demographie: metadonneesThemesFixtures.demographie } }
const networkRequests: string[] = []
const semanticReadItems: Array<Record<string, any>> = []
let collectionComparisonFailures = 0
let delayNextCollectionComparison = false
let pendingCollectionComparison: ((response: Response) => void) | null = null
let pendingCollectionComparisonItem: Record<string, any> | null = null
function pagePourFamille(family: FamilleFigure): IndicatorPageMetadata {
  const page = structuredClone(metadonneesThemesFixtures.demographie.indicator_pages!.densite) as any
  page.family = family
  page.comparison = { details: ['total'], detail: 'total', labels: { total: 'Total' }, unit: 'hab./km²', direction: 'high' }
  if (family === 'trajectory') page.trajectory = { endpoints: ['debut', 'fin'] }
  if (family === 'composition') page.composition = { parts: ['total'] }
  if (family === 'distribution') page.distribution = { signature: ['total'] }
  if (family === 'relationship') page.relationship = { roles: { x: { indicator: 'densite', detail: null, label: 'Axe X', unit: 'hab./km²' }, y: { indicator: 'densite', detail: null, label: 'Axe Y', unit: 'hab./km²' } } }
  if (family === 'list') page.list = { categories: ['total'] }
  if (family === 'pyramid') page.pyramid = { dimensions: ['total'] }
  if (family === 'comparison-bars') page.comparisonBars = { series: ['total'] }
  return page
}
async function monter(url: string, appels: string[] = [], metadataOverride = metadonneesThemesFixtures.demographie, factsOverride = payload.indicateurs, themeOverride: keyof typeof metadonneesThemesFixtures = 'demographie') {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(url)
  await router.isReady()
  const empty = { type: 'FeatureCollection' as const, features: [] }
  const routedPayload = { ...payload, indicateurs: factsOverride, themeMetadata: { [themeOverride]: metadataOverride } }
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    networkRequests.push(url)
    const hasPresentationOverride = metadataOverride !== metadonneesThemesFixtures[themeOverride]
    const themeMetadataPath = url.match(/^\/data\/theme_([a-z]+)\.json$/)
    if (themeMetadataPath) {
      const theme = themeMetadataPath[1] as keyof typeof metadonneesThemesFixtures
      const producer = JSON.parse(readFileSync(join(process.cwd(), '..', 'public', 'data', `theme_${theme}.json`), 'utf8'))
      const presentation = theme === themeOverride && hasPresentationOverride ? metadataOverride : producer
      return new Response(JSON.stringify(presentation === producer ? producer : { ...producer, ...presentation,
        scalar_contracts: producer.scalar_contracts,
        indicator_pages: { ...producer.indicator_pages, ...presentation.indicator_pages },
        source_records: { ...presentation.source_records, ...producer.source_records } }))
    }
    if (url === '/api/resources') {
      const routeTheme = String(router.currentRoute.value.params.theme) as keyof typeof metadonneesThemesFixtures
      const routeIndicator = String(router.currentRoute.value.params.indicator)
      const producer = JSON.parse(readFileSync(join(process.cwd(), '..', 'public', 'data', `theme_${routeTheme}.json`), 'utf8'))
      const presentation = routeTheme === themeOverride && hasPresentationOverride ? metadataOverride : producer
      const page = presentation.indicator_pages?.[routeIndicator]
      const companion = page?.comparison?.indicator && page.comparison.indicator !== routeIndicator
        ? page.comparison.indicator : null
      const resources = nativeResources(routeTheme).filter((resource) =>
        routeIndicator === 'raccordement_courbe'
          ? true
          : (resource.resource_id === routeIndicator || resource.resource_id === companion) &&
          (routeIndicator === 'subventions_par_domaine'
          ? resource.shapes.length === 1 && resource.shapes[0] === 'period_detail' &&
            resource.target_kinds.includes('territory_cohort') && resource.intents.includes('facts')
          : ['composition', 'list', 'distribution', 'pyramid'].includes(page?.family ?? '')
          ? (resource.shapes.includes('declared_profile') &&
            resource.target_kinds.includes('territory_cohort') && resource.intents.includes('facts')) ||
            (resource.shapes.includes('scalar') && resource.resource_id === companion)
          : (page?.family ?? '') === 'trajectory'
          ? resource.shapes.includes('ordered_series') &&
            resource.target_kinds.includes('territory_cohort') && resource.intents.includes('facts')
          : (page?.family ?? 'scalar') === 'scalar' && resource.shapes.length === 1 && resource.shapes[0] === 'scalar' &&
            !page?.comparison?.details?.length && !page?.comparison?.sexes?.length && !page?.comparison?.dimensions?.length &&
            resource.target_kinds.includes('territory_cohort') && resource.intents.includes('facts')))
      networkRequests.push(`catalogue:${routeTheme}/${routeIndicator}:${resources.length}`)
      return new Response(JSON.stringify({ contract: 'semantic-resource-catalogue-v1', resources }))
    }
    if (url === '/api/resources/read' && String(router.currentRoute.value.params.indicator) === 'subventions_par_domaine') {
      const item = JSON.parse(String(init?.body)) as Record<string, any>
      semanticReadItems.push(item)
      const marker = { resource: item.resource, content_version: 'collection-cv1', reference_content_version: 'collection-rv1' }
      if (item.target.kind === 'territory_cohort') {
        const members = routedPayload.territoires.filter((territory) => territory.type === 'commune' &&
          (!item.target.department_id || territory.departement === item.target.department_id) &&
          (!item.target.epci_id || territory.epci === item.target.epci_id))
        const territories = members.map((territory) => {
          const facts = factsOverride.filter((fact) => fact.key === item.resource && fact.territoire === territory.territoire)
          return { territory: { id: territory.territoire, type: territory.type, name: territory.nom },
            completeness: 'observed_sparse', availability: facts.length ? 'observed' : 'no_record',
            entries: facts.map((fact) => ({ detail: fact.detail, label: fact.detail, observation_period: fact.dimension,
              value: fact.value, status: 'measured', sources: [{ source_id: 'subventions_scdl', name: 'Région Bretagne',
                vintage_id: 'fixture-v1', version: '2025', reference_date: '2025-01-01', publication_date: '2025-02-01' }] })) }
        })
        return new Response(JSON.stringify({ ...marker, shape: 'period_detail',
          descriptor: { indicator_id: item.resource, kind: 'period_detail', unit: 'CAD', descriptor_version: 'collection-dv1' },
          territories }), { status: 200 })
      }
      if (delayNextCollectionComparison) {
        delayNextCollectionComparison = false
        pendingCollectionComparisonItem = item
        return await new Promise<Response>((resolve) => { pendingCollectionComparison = resolve })
      }
      if (collectionComparisonFailures > 0) {
        collectionComparisonFailures--
        return new Response('', { status: 503 })
      }
      const [detail] = item.coordinates.detail
      const [period] = item.coordinates.period
      const memberIds = item.intent.members.map((member: Record<string, string>) => member.id)
      // Contrat producteur FIDELE (api/observed_collections.py) : eligible =
      // membres MESURÉS à la coordonnée comparée (jamais memberIds.length — un
      // membre no_record compte en missing) ; status available ssi eligible >= 2,
      // sinon « unavailable » + reason fewer_than_two_comparable_values et
      // median/rank/rank_size null. Le rang du focal est le rang de concurrence
      // (direction high) sur les valeurs éligibles ; rank_size = eligible_count.
      const valeurDe = (id: string) => factsOverride.find((fact) =>
        fact.key === item.resource && fact.territoire === id && fact.detail === detail &&
        fact.dimension === period && fact.value !== null)?.value
      const values = memberIds.map(valeurDe).filter((v): v is number => v !== undefined)
      const focalId = item.target.id as string
      const focalValue = memberIds.includes(focalId) ? valeurDe(focalId) : undefined
      const eligible = values.length
      const enough = eligible >= 2
      const sorted = [...values].sort((a, b) => a - b)
      const mediane = enough
        ? (sorted.length % 2 ? sorted[Math.floor(sorted.length / 2)]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2)
        : null
      const rank = enough && focalValue !== undefined
        ? 1 + values.filter((v) => v > focalValue).length
        : null
      return new Response(JSON.stringify({ ...marker, target: item.target,
        selection: memberIds.map((territory_id: string) => ({ territory_type: 'commune', territory_id })),
        scope: { kind: 'explicit_selection', member_count: memberIds.length }, result: {
          descriptor_version: 'collection-dv1', source_facet: { detail, observation_period: period }, unit: 'CAD',
          direction: 'high', statistic: 'median',
          status: enough ? 'available' : 'unavailable',
          reason: enough ? null : 'fewer_than_two_comparable_values',
          selected_member_count: memberIds.length, eligible_count: eligible,
          missing_count: memberIds.length - eligible,
          median: mediane, rank, rank_size: rank === null ? null : eligible,
        } }), { status: 200 })
    }
    if (url === '/api/resources/read-batch') {
      const body = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
      return nativeBatchResponse(body.items, (item, resource) => nativeReadFixture(item, resource, {
        territories: routedPayload.territoires, facts: factsOverride,
        metadata: metadataOverride as unknown as Record<string, any>,
      }))
    }
    return new Response('', { status: 404 })
  })
  const wrapper = mount(IndicateurView, {
    global: {
      plugins: [router],
      provide: {
        [PAYLOAD_CHARGER_KEY]: async (fichier: Fichier) => { appels.push(fichier); return chargerAvec(routedPayload)(fichier) },
        [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
      },
      stubs: {
        MapExplorer: {
          props: ['payload', 'activeIds', 'niveau', 'territoireCible', 'couche'],
          template: '<div data-testid="map" :data-level="niveau" :data-selected="territoireCible?.territoire" :data-values="activeIds.join(\',\')" />',
        },
      },
    },
  })
  await flushPromises()
  return { wrapper, router }
}
beforeEach(() => { collectionComparisonFailures = 0; delayNextCollectionComparison = false; pendingCollectionComparison = null; pendingCollectionComparisonItem = null; semanticReadItems.length = 0; networkRequests.length = 0; localStorage.clear() })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('IndicateurView — routed URL seam', () => {
  it('acquires sparse facts once, changes category/period, retries comparison only, and joins native source clocks', async () => {
    const programmesMetadata = structuredClone(JSON.parse(readFileSync(join(process.cwd(), '..', 'public', 'data', 'theme_programmes.json'), 'utf8')))
    programmesMetadata.indicator_pages.subventions_par_domaine.unit = 'STATIC_UNIT'
    const categories = programmesMetadata.indicator_pages.subventions_par_domaine.comparison.details as string[]
    const programmesFacts = indicateursProgrammesFixture.flatMap((fact) => {
      if (fact.key !== 'subventions_par_domaine') return [fact]
      const detail = fact.detail === 'Agriculture' ? categories.find((category) => category.startsWith('Agriculture'))!
        : categories.find((category) => category.startsWith('Développement des secteurs clés'))!
      const mapped = { ...fact, detail, value: fact.detail === 'Agriculture' ? 0 : fact.value }
      // la facette (Développement…, 2024) doit porter DEUX mesures pour que la
      // comparaison soit « available » (eligible >= 2, contrat producteur) :
      // médiane 1 234 € sur deux communes mesurées
      return fact.detail === 'Agriculture'
        ? [mapped, { ...mapped, dimension: '2024', value: 1234 }]
        : [mapped, { ...mapped, dimension: '2024', value: 1234 },
           { ...mapped, territoire: '22002', dimension: '2024', value: 1234 }]
    })
    const category = categories.find((value) => value.startsWith('Agriculture'))!
    collectionComparisonFailures = 3
    const { wrapper, router } = await monter(
      `/indicateurs/programmes/subventions_par_domaine?territoire=22001&niveau=commune&detail=${encodeURIComponent(category)}&dimension=2025`,
      [], programmesMetadata, programmesFacts, 'programmes')
    await flushPromises()
    const state = (wrapper.findComponent({ name: 'IndicateurPage' }).vm as any).$.setupState
    expect(wrapper.find('[data-testid="sparse-collection-state"]').exists(), `${wrapper.text()} ${networkRequests.join(',')} bootstrap=${state.profileBootstrapError?.message} active=${state.sparseCollectionPageActive} factsError=${state.sparseCollectionFactsError} discovered=${state.profileDiscoveryComplete}`).toBe(true)
    expect(wrapper.find('[data-testid="sparse-collection-comparison-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sparse-collection-comparison-retry"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="profil-liste"]').text()).toContain('0 CAD')
    expect(wrapper.find('[data-testid="sparse-collection-period-control"]').exists()).toBe(true)
    expect((wrapper.get('select[aria-label="Période comparée"]').element as HTMLSelectElement).value).toBe('2025')
    const nextCategory = categories.find((value) => value.startsWith('Développement des secteurs clés'))!
    await wrapper.get('select[aria-label="Catégorie comparée"]').setValue(nextCategory)
    await flushPromises()
    expect(router.currentRoute.value.query.detail).toBe(nextCategory)
    expect(wrapper.text()).toContain(nextCategory)
    expect(wrapper.find('[data-testid="sparse-collection-comparison-error"]').exists()).toBe(true)
    await wrapper.get('select[aria-label="Période comparée"]').setValue('2024')
    await flushPromises()
    expect(router.currentRoute.value.query.dimension).toBe('2024')
    expect((wrapper.get('select[aria-label="Période comparée"]').element as HTMLSelectElement).value).toBe('2024')
    expect(wrapper.find('[data-testid="sparse-collection-comparison-error"]').exists()).toBe(true)
    await wrapper.get('[data-testid="sparse-collection-comparison-retry"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="sparse-collection-comparison-summary"]').text()).toContain('1 234')
    expect(wrapper.find('[data-testid="sparse-collection-comparison-summary"]').text()).toContain('CAD')
    expect(wrapper.find('[data-testid="sparse-collection-comparison-summary"]').text()).not.toContain('STATIC_UNIT')
    expect(semanticReadItems.filter((item) => item.target.kind === 'territory_cohort')).toHaveLength(1)
    expect(semanticReadItems.filter((item) => item.intent.kind === 'selected_comparison').at(-1)?.coordinates)
      .toEqual({ detail: [nextCategory], period: ['2024'] })
    await router.push({ query: { ...router.currentRoute.value.query, detail: category } })
    await flushPromises()
    await wrapper.findAll('.vues button')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="map"]').attributes('data-values')).toContain('22001')
    await wrapper.findAll('.vues button')[2]!.trigger('click')
    await flushPromises()
    const sourceCard = wrapper.find('.source-card')
    expect(sourceCard.text()).toContain('2025')
    expect(sourceCard.text()).toContain('fixture-v1')
    expect(sourceCard.text()).not.toContain('2026-08-05')
  })

  it('sparse comparison table: only the focal row shows the API rank — peers never show locally calculated ranks (#892)', async () => {
    const programmesMetadata = JSON.parse(readFileSync(join(process.cwd(), '..', 'public', 'data', 'theme_programmes.json'), 'utf8'))
    const categories = programmesMetadata.indicator_pages.subventions_par_domaine.comparison.details as string[]
    const category = categories.find((value) => value.startsWith('Agriculture'))!
    const base = indicateursProgrammesFixture.find((fact) => fact.key === 'subventions_par_domaine' && fact.detail === 'Agriculture')!
    // QUATRE communes portent la MÊME catégorie/période avec des montants différents :
    // 4 membres mesurés → eligible_count = 4 (contrat api/migrations/030) ; le focal
    // porte la valeur la plus haute (direction high) → rang API « 1er / 4 » —
    // un rang calculé localement existerait pour chaque pair si on le laissait passer
    const programmesFacts = [
      ...indicateursProgrammesFixture.filter((fact) => fact.key !== 'subventions_par_domaine'),
      { ...base, territoire: '22001', detail: category, dimension: '2025', value: 45000 },
      { ...base, territoire: '22002', detail: category, dimension: '2025', value: 30000 },
      { ...base, territoire: '29001', detail: category, dimension: '2025', value: 5000 },
      { ...base, territoire: '29002', detail: category, dimension: '2025', value: 22000 },
    ]
    const { wrapper } = await monter(
      `/indicateurs/programmes/subventions_par_domaine?territoire=22001&niveau=commune&detail=${encodeURIComponent(category)}&dimension=2025`,
      [], programmesMetadata, programmesFacts, 'programmes')
    await flushPromises()
    // la comparaison API a répondu (rang du focal uniquement — la requête ne porte que le focal)
    expect(wrapper.find('[data-testid="sparse-collection-comparison-summary"]').exists()).toBe(true)

    const rows = wrapper.findAll('.comparison-table-scroll tbody tr')
    expect(rows.length).toBe(4)
    const celluleRang = (row: ReturnType<typeof wrapper.findAll>[number]) => row.findAll('td')[2]!.text().trim()
    const estFocal = (row: ReturnType<typeof wrapper.findAll>[number]) => row.classes().includes('selection')
    const focal = rows.find(estFocal)!
    const pairs = rows.filter((row) => !estFocal(row))
    expect(pairs.length).toBe(3)
    // le focal affiche le rang API EXACT (1er / 4 = rank 1, rank_size = eligible_count 4)
    expect(celluleRang(focal)).toBe('1er / 4')
    // les pairs sans évidence de comparaison API par membre : AUCUN rang affiché
    // (pas de rang calculé localement, aucune taille de groupe fabriquée)
    for (const row of pairs) {
      expect(celluleRang(row)).toBe('')
    }
  })

  it('distinguishes whole-territory no-record from a missing selected category-period', async () => {
    const programmesMetadata = JSON.parse(readFileSync(join(process.cwd(), '..', 'public', 'data', 'theme_programmes.json'), 'utf8'))
    const categories = programmesMetadata.indicator_pages.subventions_par_domaine.comparison.details as string[]
    const programmesFacts = indicateursProgrammesFixture.map((fact) => fact.key !== 'subventions_par_domaine' ? fact : {
      ...fact, detail: fact.detail === 'Agriculture' ? categories.find((category) => category.startsWith('Agriculture'))!
        : categories.find((category) => category.startsWith('Développement des secteurs clés'))!,
    })
    const tourism = categories.find((category) => category === 'Tourisme')!
    const { wrapper, router } = await monter(
      `/indicateurs/programmes/subventions_par_domaine?territoire=22001&niveau=commune&detail=${encodeURIComponent(tourism)}&dimension=2025`,
      [], programmesMetadata, programmesFacts, 'programmes')
    await flushPromises()
    expect(wrapper.find('[data-testid="sparse-collection-facet-absent"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sparse-collection-no-record"]').exists()).toBe(false)
    // facette sans AUCUNE observation : la comparaison publiée est « unavailable »
    // (eligible < 2, api/observed_collections.py) — median/rang null, JAMAIS un
    // rang 1 / taille 0 inventé
    expect(wrapper.find('[data-testid="sparse-collection-comparison-unavailable"]').exists()).toBe(true)
    const etatCollection = wrapper.find('[data-testid="sparse-collection-state"]')
    expect(etatCollection.text()).not.toContain('Rang API')
    expect(etatCollection.text()).not.toMatch(/\d+(er|e)\//)
    await router.push({ query: { ...router.currentRoute.value.query, territoire: '22002' } })
    await flushPromises()
    expect(wrapper.find('[data-testid="sparse-collection-no-record"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sparse-collection-facet-absent"]').exists()).toBe(false)
  })

  it('rejects a delayed comparison response after the commune scope changes', async () => {
    const programmesMetadata = JSON.parse(readFileSync(join(process.cwd(), '..', 'public', 'data', 'theme_programmes.json'), 'utf8'))
    const categories = programmesMetadata.indicator_pages.subventions_par_domaine.comparison.details as string[]
    const agriculture = categories.find((category) => category.startsWith('Agriculture'))!
    const programmesFacts = indicateursProgrammesFixture.map((fact) => fact.key !== 'subventions_par_domaine' ? fact : {
      ...fact, detail: fact.detail === 'Agriculture' ? agriculture
        : categories.find((category) => category.startsWith('Développement des secteurs clés'))!,
    })
    // deux communes du département 29 mesurées à la même facette : la comparaison
    // re-scopée sur le 29 reste « available » (eligible = 2) avec médiane 15 000 €
    const baseAgri = programmesFacts.find((fact) => fact.key === 'subventions_par_domaine' && fact.detail === agriculture)!
    programmesFacts.push(
      { ...baseAgri, territoire: '29001', dimension: '2025', value: 15000 },
      { ...baseAgri, territoire: '29002', dimension: '2025', value: 15000 },
    )
    delayNextCollectionComparison = true
    const { wrapper, router } = await monter(
      `/indicateurs/programmes/subventions_par_domaine?territoire=22001&niveau=commune&detail=${encodeURIComponent(agriculture)}&dimension=2025`,
      [], programmesMetadata, programmesFacts, 'programmes')
    expect(wrapper.find('[data-testid="sparse-collection-comparison-pending"]').exists()).toBe(true)
    expect(pendingCollectionComparison).not.toBeNull()
    const oldRequest = pendingCollectionComparisonItem!
    await router.push({ query: { ...router.currentRoute.value.query, departement: '29' } })
    await flushPromises()
    expect(wrapper.find('[data-testid="sparse-collection-comparison-summary"]').text()).toContain('15 000')
    const scopedRequest = semanticReadItems.filter((item) => item.target.kind === 'territory_cohort').at(-1)
    expect(scopedRequest?.target.department_id).toBe('29')
    expect(scopedRequest?.target.department_id).not.toBe(oldRequest.target.department_id)
    const staleMembers = oldRequest.intent.members.map((member: Record<string, string>) => ({
      territory_type: member.type, territory_id: member.id,
    }))
    pendingCollectionComparison!(new Response(JSON.stringify({ resource: oldRequest.resource, target: oldRequest.target,
      content_version: 'collection-cv1', reference_content_version: 'collection-rv1', selection: staleMembers,
      scope: { kind: 'explicit_selection', member_count: staleMembers.length }, result: {
        descriptor_version: 'collection-dv1', source_facet: { detail: agriculture, observation_period: '2025' },
        unit: 'CAD', selected_member_count: staleMembers.length, status: 'available', median: 7777,
        rank: 1, rank_size: staleMembers.length,
      } }), { status: 200 }))
    await flushPromises()
    expect(wrapper.find('[data-testid="sparse-collection-comparison-summary"]').text()).toContain('15 000')
    expect(wrapper.find('[data-testid="sparse-collection-comparison-summary"]').text()).not.toContain('7 777')
  })

  it('defaults to Repères and switches real URL-backed views; invalid vue is cleared by selecting Repères', async () => { const { wrapper, router } = await monter('/indicateurs/demographie/densite?vue=wat'); expect(wrapper.find('main').exists()).toBe(true); await wrapper.findAll('.vues button')[0].trigger('click'); await flushPromises(); expect(router.currentRoute.value.query.vue).toBeUndefined(); await router.push({ query: { vue: 'carte' } }); await flushPromises(); expect(router.currentRoute.value.query.vue).toBe('carte'); await router.push({ query: { vue: 'indicateur' } }); await flushPromises(); expect(router.currentRoute.value.query.vue).toBe('indicateur') })
  it('renders unknown indicator honestly', async () => { const { wrapper } = await monter('/indicateurs/demographie/not-published'); expect(wrapper.text()).toContain('Indicateur introuvable') })
  it('renders an unknown theme as a finite honest error state', async () => { const { wrapper } = await monter('/indicateurs/inconnu/densite'); expect(wrapper.text()).toContain('Indicateur introuvable'); expect(wrapper.text()).not.toContain('Chargement de l’indicateur') })
  it('reacts when the router reuses the view for a new indicator parameter', async () => { const { wrapper, router } = await monter('/indicateurs/demographie/densite'); expect(wrapper.text()).toContain('Densité de population'); await router.push('/indicateurs/demographie/not-published'); await flushPromises(); expect(wrapper.text()).toContain('Indicateur introuvable'); expect(wrapper.text()).not.toContain('Densité de population') })
  it('keeps ordinary scalar page facts API-only while changing the routed theme', async () => { const appels: string[] = []; const { wrapper, router } = await monter('/indicateurs/demographie/densite', appels); expect(appels).toEqual(['territoires']); await router.push('/indicateurs/habitat/not-published'); await flushPromises(); expect(wrapper.text()).toContain('Indicateur introuvable'); expect(wrapper.text()).not.toContain('Densité de population') })
  it('renders a retired legacy accessibility slug as the unknown indicator without reading its static rows', async () => {
    // #627 — the served projection still declares the legacy accessibility
    // page, but the producer catalogue excludes it: no reader may resolve it.
    // A retired slug behaves exactly like any undeclared indicator.
    const legacyMetadata = structuredClone(metadonneesThemesFixtures.mobilite) as typeof metadonneesThemesFixtures.mobilite & { indicator_pages?: Record<string, unknown> }
    legacyMetadata.indicator_pages = {
      ...legacyMetadata.indicator_pages,
      iso_alimentation: {
        indicator: 'iso_alimentation',
        label: 'Part des bâtiments sans accès à l’alimentation (à pied ou en transports en commun)',
        definition: 'La part des bâtiments résidentiels sans accès à l’alimentation.',
        unit: '%', calculation: 'Analyse d’accessibilité', direction: 'low', caveats: '',
        levels: ['commune', 'epci', 'departement'], sources: ['mobilite_snapshot'], family: 'scalar',
      },
    }
    const appels: string[] = []
    const { wrapper } = await monter('/indicateurs/mobilite/iso_alimentation', appels, legacyMetadata, indicateursMobiliteFixture, 'mobilite')
    expect(wrapper.text()).toContain('Indicateur introuvable')
    expect(appels).toEqual(['territoires'])
  })
  it('writes fallback level, lets explicit URL win, filters, preserves fiche theme and scopes', async () => { localStorage.setItem('lusk:niveau-indicateur', 'commune'); const { wrapper, router } = await monter('/indicateurs/demographie/densite'); expect(router.currentRoute.value.query.niveau).toBe('commune'); await wrapper.find('input').setValue('Commune A'); expect(wrapper.text()).toContain('Commune A'); expect(wrapper.find('a[href*="theme=demographie"]').exists()).toBe(true); await wrapper.find('select').setValue('epci'); await flushPromises(); expect(router.currentRoute.value.query.departement).toBeUndefined(); expect(router.currentRoute.value.query.epci).toBeUndefined() })
  it('renders the native unit and acquired source/vintage clocks', async () => { const { wrapper, router } = await monter('/indicateurs/demographie/densite?vue=indicateur'); expect(wrapper.text()).toContain('hab/km²'); expect(wrapper.text()).toContain('2026-06-30'); expect(wrapper.text()).not.toContain('Publication annuelle'); expect(router.currentRoute.value.query.vue).toBe('indicateur') })
   it('mounts map integration with the exact active facet facts', async () => { const { wrapper, router } = await monter('/indicateurs/demographie/densite?vue=carte&territoire=29002'); const expected = payload.indicateurs.filter((fact) => fact.key === 'densite' && fact.type === 'commune').map((fact) => fact.territoire); expect(wrapper.find('[data-testid="map"]').exists()).toBe(true); expect(wrapper.find('[data-testid="map"]').attributes('data-level')).toBe('communes'); expect(wrapper.find('[data-testid="map"]').attributes('data-selected')).toBe('29002'); expect(wrapper.find('[data-testid="map"]').attributes('data-values')).toBe(expected.join(',')); expect(router.currentRoute.value.query.vue).toBe('carte') })
  it('persists a level selected through the routed control', async () => { const { wrapper } = await monter('/indicateurs/demographie/densite'); await wrapper.find('select').setValue('epci'); await flushPromises(); expect(localStorage.getItem('lusk:niveau-indicateur')).toBe('epci') })
  it('renders real EPCI rows after switching the routed level', async () => { const { wrapper } = await monter('/indicateurs/demographie/densite'); await wrapper.find('select').setValue('epci'); await flushPromises(); expect(wrapper.find('tbody').text()).toContain('EPCI X'); expect(wrapper.find('tbody').text()).toContain('EPCI Y') })
  it('normalizes explicit non-commune scopes and invalid scope identifiers on first load', async () => { const { router } = await monter('/indicateurs/demographie/densite?niveau=epci&departement=22&epci=missing'); expect(router.currentRoute.value.query.departement).toBeUndefined(); expect(router.currentRoute.value.query.epci).toBeUndefined(); const second = await monter('/indicateurs/demographie/densite?niveau=commune&departement=missing&epci=missing'); expect(second.router.currentRoute.value.query.departement).toBeUndefined(); expect(second.router.currentRoute.value.query.epci).toBeUndefined() })
  it('sorts by explicit URL-backed name, value and direction-aware rank controls', async () => { const { wrapper, router } = await monter('/indicateurs/demographie/densite?tri=nom&ordre=asc'); expect(wrapper.findAll('tbody tr')[0].text()).toContain('Commune A1'); await wrapper.findAll('thead button')[1].trigger('click'); await flushPromises(); expect(router.currentRoute.value.query.tri).toBe('valeur'); expect(router.currentRoute.value.query.ordre).toBe('asc'); expect(wrapper.findAll('tbody tr')[0].text()).toContain('Commune D') })
  it('clicking a table row persists the selected territory and uses a non-fixed density marker', async () => { const { wrapper, router } = await monter('/indicateurs/demographie/densite'); await wrapper.findAll('tbody button')[0].trigger('click'); await flushPromises(); expect(router.currentRoute.value.query.territoire).toBe('22001'); const marker = wrapper.find('.point-highlight'); expect(marker.exists()).toBe(true); expect(marker.attributes('cx')).not.toBe('300') })
  it('gives the selected density marker an accessible formatted description', async () => { const { wrapper } = await monter('/indicateurs/demographie/densite?territoire=22001'); expect(wrapper.find('svg desc').text()).toContain('Commune A1'); expect(wrapper.find('svg desc').text()).toContain('200'); expect(wrapper.find('svg desc').text()).toContain('positionné sur l’axe') })
    // The committed producer metadata (with its page descriptors and
    // contracts) drives the real classification; the fixture metadata
    // deliberately publishes no indicator_pages for these themes.
    const producerMetadata = (theme: string) => JSON.parse(readFileSync(join(process.cwd(), '..', 'public', 'data', `theme_${theme}.json`), 'utf8'))
    it.each([
      ['scalar', '/indicateurs/demographie/densite', indicateursDemographieFixture, 'demographie'],
      ['composition', '/indicateurs/habitat/mix_logements', indicateursHabitatFixture, 'habitat'],
      ['list', '/indicateurs/mobilite/reseaux', indicateursMobiliteFixture, 'mobilite'],
      ['distribution', '/indicateurs/habitat/distribution_dpe', indicateursHabitatFixture, 'habitat'],
      ['pyramid', '/indicateurs/demographie/structure_age', indicateursDemographieFixture, 'demographie'],
      ['trajectory', '/indicateurs/milieux/artif_par_habitant', indicateursMilieuxFixture, 'milieux'],
    ] as const)('routed family %s mounts through its real producer classification', async (family, url, facts, theme) => {
      // #627 - the retired static route vehicle no longer serves arbitrary
      // page families: every production family classifies through the
      // producer catalogue (profiles and series included).
      const { wrapper, router } = await monter(url, [], producerMetadata(theme), facts as unknown as typeof payload.indicateurs, theme)
      expect(router.currentRoute.value.name).toBe('indicateur')
      expect(wrapper.find('.repere-family-outlet').exists()).toBe(true)
      expect(wrapper.find(`[data-renderer="${family}"]`).exists()).toBe(true)
    })
    it('dispatches every family - including those no production page declares - through the real outlet', () => {
      // The dispatch/outlet seam owns renderer capability for every family:
      // relationship has no production route and comparison-bars is a fiche
      // figure family, so their renderer mounting is proven at the seam.
      for (const family of ['scalar', 'composition', 'trajectory', 'distribution', 'relationship', 'list', 'pyramid', 'comparison-bars'] as const) {
        const metadata = structuredClone(metadonneesThemesFixtures.demographie)
        metadata.indicator_pages!.densite = pagePourFamille(family)
        const dispatch = dispatchIndicatorFamily(metadata.indicator_pages!.densite, { theme: 'demographie', facts: payload.indicateurs, territories: payload.territoires })
        const wrapper = mount(RepereFamilyOutlet, { props: { dispatch } })
        expect(wrapper.find(`[data-renderer="${family}"]`).exists(), family).toBe(true)
        wrapper.unmount()
      }
    })
    it('keeps the outlet honesty states for unavailable, incomplete, and invalid dispatches', () => {
      const metadata = structuredClone(metadonneesThemesFixtures.demographie)
      metadata.indicator_pages!.densite = pagePourFamille('composition')
      const base = { theme: 'demographie' as const, territories: payload.territoires, selected: '22001' }
      const unavailable = dispatchIndicatorFamily(metadata.indicator_pages!.densite,
        { ...base, facts: payload.indicateurs.filter((fact) => fact.key !== 'densite') })
      const unavailableWrapper = mount(RepereFamilyOutlet, { props: { dispatch: unavailable } })
      expect(unavailableWrapper.find('[role="status"]').text()).toContain('pas disponible')
      const incompleteFacts = payload.indicateurs.map((fact) => fact.key === 'densite' ? { ...fact, detail: 'total', value: null } : fact)
      const incomplete = dispatchIndicatorFamily(metadata.indicator_pages!.densite, { ...base, facts: incompleteFacts })
      const incompleteWrapper = mount(RepereFamilyOutlet, { props: { dispatch: incomplete } })
      expect(incompleteWrapper.find('[role="status"]').text()).toContain('partiels')
      expect(incompleteWrapper.find('[data-renderer="composition"]').exists()).toBe(true)
      const invalidMetadata = structuredClone(metadata)
      delete (invalidMetadata.indicator_pages!.densite as { composition?: unknown }).composition
      const invalid = dispatchIndicatorFamily(invalidMetadata.indicator_pages!.densite, { ...base, facts: incompleteFacts })
      const invalidWrapper = mount(RepereFamilyOutlet, { props: { dispatch: invalid } })
      expect(invalidWrapper.text()).toContain('La facette de cette famille de Repères est invalide.')
    })
    // The malformed-facet URL canonicalization is owned by the pure seam
    // (etat-url.spec.ts - fusionnerFacette replaces stale detail/sex/dimension
    // in place and appends missing keys); the retired static route vehicle no
    // longer duplicates it at the route level.
  it('renders unique extremes as named fiche links', async () => { const { wrapper } = await monter('/indicateurs/demographie/densite'); expect(wrapper.find('a[href*="territoire/commune/22001"]').exists()).toBe(true); })
  it('renders tied extremes as counts without pretending one territory wins', async () => { const tiedPayload = structuredClone(payload); tiedPayload.indicateurs = tiedPayload.indicateurs.map((fact) => fact.key === 'densite' && fact.type === 'commune' ? { ...fact, value: 10 } : fact); const original = payload.indicateurs; payload.indicateurs = tiedPayload.indicateurs; const { wrapper } = await monter('/indicateurs/demographie/densite'); expect(wrapper.text()).toContain('4 territoires à égalité'); expect(wrapper.find('.extremes a').exists()).toBe(false); payload.indicateurs = original })
})

// La grammaire Repères des trajectoires (#438) — la page routée rend le chemin
// complet à côté du détail (actif) qui pilote carte/extrêmes/tableau ; les
// bornes déclarées sans valeur restent sur l'axe ; le copié-collé produit est
// exclusivement français (« détail (actif) », jamais « endpoint »).
describe('IndicateurView — trajectoires (#438)', () => {
  // #627 - the retired static route vehicle no longer mounts synthetic family
  // pages: the artif route-level trajectory behavior (detail URL state, axis
  // states, real-value scale) is owned by annual-series-api-page.spec.ts
  // (the production series route) and exploration-model.spec.ts (the pure
  // trajectory model). The retained raccordement_courbe owner path keeps its
  // routed test below.
  it('trace la référence médiane déclarée et distingue le service planifié de l’acquisition', async () => {
    const { wrapper, router } = await monter(
      '/indicateurs/mobilite/raccordement_courbe?territoire=22001',
      [],
      metadonneesMobiliteRaccordementFixture,
      indicateursRaccordementFixture,
      'mobilite',
    )
    expect(wrapper.find('[data-renderer="trajectory"] .trajectoire-reference').exists()).toBe(true)
    expect(wrapper.find('[data-renderer="trajectory"] .trajectoire-mediane').exists()).toBe(false)
    const marqueur = wrapper.find('[data-renderer="trajectory"] .trajectoire-marqueur')
    expect(marqueur.attributes('aria-label')).toBe('Seuil de 90 minutes')
    expect(marqueur.find('title').text()).toBe('Seuil de 90 minutes')
    expect(wrapper.find('[data-renderer="trajectory"] svg').attributes('viewBox')).toBe('0 0 600 160')
    expect(wrapper.findAll('[data-renderer="trajectory"] .trajectoire-tick').map((tick) => tick.classes('trajectoire-tick--wide'))).toEqual([false, true, true, false, true, false, true, false, true, true, false])

    await router.push({ query: { ...router.currentRoute.value.query, vue: 'indicateur' } })
    await flushPromises()
    // #627 — the raccordement owner path is API-active: L'indicateur renders
    // the acquired measure metadata, and the static metadata clock paragraph
    // never does.
    expect(wrapper.find('[data-testid="raccordement-dates"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('points déclarés')
  }, 20000)

})

// #627 - the retired static route vehicle no longer mounts synthetic family
// pages, so the former route-level duplicates of the family grammars live at
// their owning seams: the pure family models and honesty states are covered
// by exploration-model.spec.ts (profil complet dans l'ordre declare, profil
// incomplet, absent a ce niveau, signature complete, relation nuage/etats,
// echelles reelles), the production profile routes (mix_logements, reseaux,
// distribution_dpe, structure_age) are mounted through their real API
// classification by profile-page-api.spec.ts (presentations, sorting, ranks,
// states) and the census above, the series routes by
// annual-series-api-page.spec.ts, and the malformed-facet URL canonicalization
// by etat-url.spec.ts.
