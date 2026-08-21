import { flushPromises, mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

import SourcesView from '../views/SourcesView.vue'
import { chargerAvec, histoiresHabitatFixture, indicateursHabitatFixture } from '../payload/fixtures'
import type { ChargerFichier } from '../payload/usePayload'
import type { Payload } from '../payload/types'
import { apercuAvecNAFixture, histoiresDemographieFixture, indicateursDemographieFixture, territoiresFixture, vintagesFixture } from '../payload/fixtures'
import { routes } from '../router'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'

const payload: Payload = { territoires: territoiresFixture, indicateurs: indicateursDemographieFixture, histoires: histoiresDemographieFixture, apercu: apercuAvecNAFixture, runReport: null, vintages: vintagesFixture, programmes: null }

async function monter(charger: ChargerFichier) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/sources')
  await router.isReady()
  const wrapper = mount(SourcesView, { global: { plugins: [router], provide: { [PAYLOAD_CHARGER_KEY]: charger } } })
  await flushPromises()
  return wrapper
}

describe('SourcesView — route dataset-centric', () => {
  it('rend une fiche accessible, ses millésimes et les consommateurs canoniques', async () => {
    const wrapper = await monter(chargerAvec(payload))
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
      themeMetadata: { habitat: habitatMetadata },
    }
    const wrapper = await monter(chargerAvec(habitatPayload))
    const dvf = wrapper.find('#source-dvf')
    expect(dvf.exists()).toBe(true)
    expect(dvf.findAll('.source-record__vintages li')).toHaveLength(0)
    expect(dvf.text()).toContain('2021–2025')
  })
})
