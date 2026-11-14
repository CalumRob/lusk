import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { describe, expect, it } from 'vitest'

import CahierMobiliteSection from '@/fiche/prototype/CahierMobiliteSection.vue'
import { CONTROLE_COMPARAISON_KEY } from '@/fiche/comparisonContext'
import type { ControleComparaison, SelectionComparaison } from '@/fiche/comparisonContext'
import { buildMobiliteShareSection } from '@/fiche/content/mobiliteSections'
import type { FactProvenance, NumericFact, TerritoryFacts } from '@/fiche/content/territoryFacts'
import type { ThemeMetadata } from '@/payload/types'

/**
 * #1006 — the explicit « Aucune comparaison » identity is read from the
 * header control the Cahier already injects: the compared row disappears,
 * while a requested comparison keeps its honest loading/error/retry state.
 */

const provenance: FactProvenance = {
  sourceId: 'korrigo', source: 'Bretagne Mobilité', version: '2026-02',
  referenceDate: '2026-02-28', publicationDate: '2026-08-06',
}

function shareFact(value: number): NumericFact {
  return {
    key: 'offre_tc',
    detail: null,
    value,
    unit: '%',
    availability: 'complete',
    provenance,
    comparison: {
      direction: 'plus-est-mieux',
      scope: { kind: 'communes-densite', label: 'communes de la classe de densité' },
      rank: { position: 21, size: 43 },
      reference: { kind: 'median', value: 0.34 },
    },
    comparisonBasis: 'territory-median',
    reason: null,
  }
}

const facts: TerritoryFacts = {
  territory: {
    code: '35238', type: 'commune', name: 'Rennes', department: '35',
    epci: '243500139', epciName: 'Rennes Métropole',
  },
  theme: 'mobilite',
  mobility: { namedTrajectoryReferences: [], indicators: [shareFact(0.9957355031616097)] },
}

const metadata = {
  theme: 'mobilite', label: 'Mobilité', subgroups: [], indicator_keys: [], sources: {},
  indicator_labels: { offre_tc: 'Part des bâtiments près d’un arrêt (à 500 m)' },
  detail_labels: {},
  source_records: {
    korrigo: {
      dataset: 'Korrigo', publisher: 'Bretagne Mobilité', url: 'https://korrigo.example',
      licence: 'ODbL', vintage: '2026-02', freshness: '28 février 2026',
    },
  },
} as unknown as ThemeMetadata

function section() {
  return buildMobiliteShareSection(facts, metadata)
}

function control(selection: SelectionComparaison): ControleComparaison {
  return {
    focal: { type: 'commune', territoire: '35238', nom: 'Rennes', departement: '35', epci: null },
    territoires: [],
    selection,
    libelleActif: null,
    presetDefaut: null,
    presets: [],
    choisir: () => undefined,
  }
}

function mountWith(selection: SelectionComparaison, comparison: {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  error?: string
  retry?: () => void
}) {
  return mount(CahierMobiliteSection, {
    props: { section: section(), unit: { key: 'offre-transports-commun', label: 'L’offre de transports en commun' }, comparison },
    global: {
      provide: {
        [CONTROLE_COMPARAISON_KEY as symbol]: ref(control(selection)),
      },
    },
  })
}

describe('CahierMobiliteSection — explicit none vs requested comparison (#1006)', () => {
  it('removes the whole compared row for the explicit empty selection', () => {
    const wrapper = mountWith({ etat: 'vide' }, { status: 'ready' })
    expect(wrapper.find('[data-row="territory"]').exists()).toBe(true)
    expect(wrapper.find('[data-row="comparison"]').exists()).toBe(false)
    expect(wrapper.find('.cahier-rank').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Groupe comparé')
    expect(wrapper.text()).not.toContain('Groupe comparé indisponible')
    wrapper.unmount()
  })

  it('keeps the compared row for the default, a resolved preset and tapped members', () => {
    for (const selection of [
      { etat: 'defaut' } as const,
      { etat: 'preset', preset: 'densite' } as const,
      { etat: 'membres', membres: [
        { territory_type: 'commune', territory_id: '35238' },
        { territory_type: 'commune', territory_id: '35240' },
      ] } as const,
    ] satisfies readonly SelectionComparaison[]) {
      const wrapper = mountWith(selection, { status: 'ready' })
      expect(wrapper.find('[data-row="comparison"]').exists()).toBe(true)
      expect(wrapper.get('[data-row="comparison"] .cahier-rank--comparison').text()).toBe('21e/43')
      wrapper.unmount()
    }
  })

  it('keeps a requested comparison loading, failed and retryable', async () => {
    const loading = mountWith({ etat: 'defaut' }, { status: 'loading' })
    expect(loading.find('[data-row="comparison"]').exists()).toBe(true)
    expect(loading.text()).toContain('Chargement du groupe comparé')
    loading.unmount()

    let retried = 0
    const error = mountWith({ etat: 'defaut' }, {
      status: 'error', error: 'lecture refusée', retry: () => { retried += 1 },
    })
    expect(error.text()).toContain('lecture refusée')
    await error.get('.mobilite-share-track__retry').trigger('click')
    expect(retried).toBe(1)
    error.unmount()
  })

  it('keeps the served precision and the source stamp in the production delegate', () => {
    const wrapper = mountWith({ etat: 'defaut' }, { status: 'ready' })
    expect(wrapper.get('[data-row="territory"] .mobilite-share-track__value').text()).toBe('99,6 %')
    expect(wrapper.get('[data-row="comparison"] .mobilite-share-track__value').text()).toBe('34,0 %')
    expect(wrapper.get('.cahier-evidence-source').text()).toContain('Bretagne Mobilité 2026-02')
    wrapper.unmount()
  })
})
