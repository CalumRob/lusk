import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { isReactive } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import * as territoryFacts from '@/fiche/content/territoryFacts'
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
import { routes } from '@/router'

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

describe('Variant D — shell performance seam', () => {
  it('resolves content from the raw payload after the Mobilité wait-set settles', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/territoire/commune/22001?theme=mobilite&variant=D')
    await router.isReady()

    const factsSpy = vi.spyOn(territoryFacts, 'territoryFactsFor')
    mount(TerritoireView, {
      global: {
        plugins: [router],
        provide: { [PAYLOAD_CHARGER_KEY]: chargerAvec(payload) },
      },
    })

    await flushPromises()

    expect(factsSpy).toHaveBeenCalledTimes(1)
    expect(isReactive(factsSpy.mock.calls[0]?.[0])).toBe(false)
    factsSpy.mockRestore()
  })
})
