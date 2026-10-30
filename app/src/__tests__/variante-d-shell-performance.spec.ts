import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { isReactive } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import App from '@/App.vue'
import * as mobilityThemeApiFacts from '@/fiche/content/mobilityThemeApiFacts'
import TerritoireView from '@/views/TerritoireView.vue'
import {
  chargerAvec,
  histoiresMobiliteFixture,
  indicateursMobiliteFixture,
  metadonneesThemesFixtures,
  territoiresFixture,
} from '@/payload/fixtures'
import type { Payload } from '@/payload/types'
import { PAYLOAD_CHARGER_KEY } from '@/payload/usePayload'
import { TERRITORY_REFERENCE_CHARGER_KEY } from '@/payload/territoryReference'
import { routes } from '@/router'
import { createNativeSemanticApiTransport } from './helpers/nativeSemanticApiTransport'

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursMobiliteFixture,
  histoires: histoiresMobiliteFixture,
  apercu: null,
  runReport: null,
  vintages: null,
  programmes: null,
  themeMetadata: { mobilite: structuredClone(metadonneesThemesFixtures.mobilite) },
}

describe('Production Mobilité — shell performance seam (#868: bootstrap référence)', () => {
  it('resolves cahier content from the reference + native API on the normal route', async () => {
    vi.stubGlobal('fetch', createNativeSemanticApiTransport())
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/territoire/commune/22001?theme=mobilite')
    await router.isReady()

    const factsSpy = vi.spyOn(mobilityThemeApiFacts, 'mobilityFactsFromThemeApi')
    const wrapper = mount(TerritoireView, {
      global: {
        plugins: [router],
        provide: {
          [PAYLOAD_CHARGER_KEY]: chargerAvec(payload),
          [TERRITORY_REFERENCE_CHARGER_KEY]: async () => territoiresFixture,
        },
      },
    })

    await flushPromises()

    // The initial incomplete shell and the completed API facts each materialize
    // the display model once; neither may receive a reactive payload.
    expect(factsSpy).toHaveBeenCalled()
    expect(factsSpy.mock.calls.every(([facts]) => !isReactive(facts))).toBe(true)
    expect(wrapper.find('.fiche-en-tete-surface').exists()).toBe(true)
    expect(wrapper.find('.fiche--theme-mobilite').exists()).toBe(true)
    expect(wrapper.find('.fiche-contenu').exists()).toBe(true)
    expect(wrapper.find('.cahier-cover').exists()).toBe(false)
    factsSpy.mockRestore()
  })

  it('keeps the global header and footer around the cahier body', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/territoire/commune/22001?theme=mobilite')
    await router.isReady()

    const wrapper = mount(App, {
      global: {
        plugins: [router],
        provide: {
          [PAYLOAD_CHARGER_KEY]: chargerAvec(payload),
          [TERRITORY_REFERENCE_CHARGER_KEY]: async () => territoiresFixture,
        },
      },
    })

    await flushPromises()

    expect(wrapper.find('header.en-tete').exists()).toBe(true)
    expect(wrapper.find('footer.pied').exists()).toBe(true)
  })
})
