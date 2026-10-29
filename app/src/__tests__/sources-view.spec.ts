import { flushPromises, mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

import SourcesView from '../views/SourcesView.vue'
import { chargerAvec, histoiresHabitatFixture, histoiresMobiliteFixture, indicateursHabitatFixture, indicateursMobiliteFixture, metadonneesThemesFixtures } from '../payload/fixtures'
import type { ChargerFichier } from '../payload/usePayload'
import type { Payload } from '../payload/types'
import { apercuAvecNAFixture, histoiresDemographieFixture, indicateursDemographieFixture, territoiresFixture, vintagesFixture } from '../payload/fixtures'
import { routes } from '../router'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'

const payload: Payload = { territoires: territoiresFixture, indicateurs: indicateursDemographieFixture, histoires: histoiresDemographieFixture, apercu: apercuAvecNAFixture, runReport: null, vintages: vintagesFixture, programmes: null }

function payloadAvecFichesSources(): Payload {
  const demographie = structuredClone(metadonneesThemesFixtures.demographie)
  demographie.source_records = {
    serie_historique: {
      dataset: 'Série historique', publisher: 'INSEE', url: null as unknown as string,
      licence: 'Licence ouverte', vintage: 'RP 2023', freshness: 'Publication annuelle',
      vintages: [{ id: 'serie_historique', label: 'Recensement', version: null, licence: null, dateReference: null, datePublication: null }],
      clocks: [{ name: 'Recensement', frequency: 'quinquennale', reference: 'INSEE' }],
    },
  }
  return { ...payload, themeMetadata: { ...metadonneesThemesFixtures, demographie } }
}

async function monter(charger: ChargerFichier) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/sources')
  await router.isReady()
  const wrapper = mount(SourcesView, { global: { plugins: [router], provide: { [PAYLOAD_CHARGER_KEY]: charger } } })
  await flushPromises()
  return wrapper
}

describe('SourcesView — route dataset-centric', () => {
  it('charge seulement les références, les vintages et les fiches source, jamais les tables numériques', async () => {
    const requested: string[] = []
    const wrapper = await monter(async (fichier) => {
      requested.push(fichier)
      return chargerAvec(payloadAvecFichesSources())(fichier)
    })

    expect(wrapper.find('article.source-record').exists()).toBe(true)
    expect(wrapper.find('a[href="/indicateurs/demographie/densite"]').exists()).toBe(true)
    expect(requested).toContain('vintages')
    expect(requested).toContain('territoires-metadata')
    expect(requested).toContain('theme_demographie')
    expect(requested).not.toContain('territoires')
    expect(requested.some((fichier) => fichier.startsWith('indicateurs_'))).toBe(false)
    expect(requested.some((fichier) => fichier.startsWith('histoires_'))).toBe(false)
    expect(requested).not.toContain('apercu')
    expect(requested).not.toContain('programmes')
  })

  it('rend une fiche accessible, ses millésimes et les consommateurs canoniques', async () => {
    const wrapper = await monter(chargerAvec(payloadAvecFichesSources()))
    expect(wrapper.find('h1#sources-title').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Horloges de mise à jour"]').exists()).toBe(true)
    expect(wrapper.findAll('article.source-record').length).toBeGreaterThan(0)
    expect(wrapper.find('a[href^="https://"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/indicateurs/demographie/densite"]').exists()).toBe(true)
  })

  it('garde un état de chargement honnête', async () => {
    const wrapper = await monter(() => new Promise<Payload>(() => {}))
    expect(wrapper.find('[role="status"]').text()).toContain('Chargement')
  })

  it('applique le repli ADR-0022 aux jeux à fraîcheur partagée, mais garde les lignes OCS-GE', async () => {
    const habitatMetadata = JSON.parse(readFileSync(join(process.cwd(), '..', 'pipeline', 'inst', 'extdata', 'theme-metadata', 'theme_habitat.json'), 'utf8'))
    const habitatPayload: Payload = {
      ...payload,
      indicateurs: [...payload.indicateurs, ...indicateursHabitatFixture],
      histoires: [...payload.histoires, ...histoiresHabitatFixture],
      themeMetadata: { ...metadonneesThemesFixtures, habitat: habitatMetadata },
    }
    const wrapper = await monter(chargerAvec(habitatPayload))
    const dvf = wrapper.find('#source-dvf')
    expect(dvf.exists()).toBe(true)
    expect(dvf.findAll('.source-record__vintages li')).toHaveLength(0)
    expect(dvf.text()).toContain('2021–2025')
  })

  it('rend la méthodologie portée par la fiche source', async () => {
    const mobiliteMetadata = structuredClone(metadonneesThemesFixtures.mobilite)
    mobiliteMetadata.source_records = {
      ...(mobiliteMetadata.source_records ?? {}),
      osm_reseaux: {
        dataset: 'OpenStreetMap',
        publisher: 'OpenStreetMap',
        url: 'https://www.openstreetmap.org',
        licence: 'ODbL',
        vintage: '2026-08',
        freshness: 'snapshot',
        methodology: {
          title: 'Estimation des places',
          summary: 'Une méthode portée par la source.',
          factors: [{ key: 'surface', label: 'Parking de surface', value: 26.70208, unit: 'm²/place' }],
          notes: ['Les places sont estimées.'],
        },
      },
    }
    const wrapper = await monter(chargerAvec({
      ...payload,
      indicateurs: [...payload.indicateurs, ...indicateursMobiliteFixture],
      histoires: [...payload.histoires, ...histoiresMobiliteFixture],
      themeMetadata: { ...metadonneesThemesFixtures, mobilite: mobiliteMetadata },
    }))

    const method = wrapper.find('.source-record__methodology')
    expect(method.exists()).toBe(true)
    expect(method.text()).toContain('Estimation des places')
    expect(method.text()).toContain('26,70208 m²/place')
  })
})
