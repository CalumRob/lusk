import { flushPromises, mount } from '@vue/test-utils'

import { createMemoryHistory, createRouter } from 'vue-router'

import { describe, expect, it } from 'vitest'

import TerritoireView from '../views/TerritoireView.vue'
import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  histoiresHabitatFixture,
  indicateursDemographieFixture,
  indicateursHabitatFixture,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import type { ChargerPayload } from '../payload/usePayload'
import type { Payload } from '../payload/types'
import { routes } from '../router'

/**
 * La fiche d'identité — the shell (site-map.md §Fiche): breadcrumb, H1 with
 * the territory's real name (trouverTerritoire), type chip, context
 * switcher, then the payload-driven ThemeTabs with Aperçu as default and the
 * ?theme= URL state, the page bg wearing the selected theme's -wash.
 * Loading → skeleton; PayloadError → icon + message + Retry; unknown
 * territory → honest empty state. C2/C3 slot their content into the Aperçu
 * and theme placeholders.
 */

const payloadDemographie: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture,
}

const payloadAvecHabitat: Payload = {
  ...payloadDemographie,
  indicateurs: [...indicateursDemographieFixture, ...indicateursHabitatFixture],
  histoires: [...histoiresDemographieFixture, ...histoiresHabitatFixture],
}

function chargerAvec(payload: Payload): ChargerPayload {
  return async () => payload
}

async function monter(chemin: string, charger: ChargerPayload) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(chemin)
  await router.isReady()
  const wrapper = mount(TerritoireView, {
    global: {
      plugins: [router],
      provide: { [PAYLOAD_CHARGER_KEY]: charger },
    },
  })
  await flushPromises()
  return { router, wrapper }
}

describe('TerritoireView — chargement, erreur, introuvable', () => {
  it('shows a skeleton while the payload loads', async () => {
    const enAttente = new Promise<Payload>(() => {})
    const { wrapper } = await monter('/territoire/commune/29002', () => enAttente)

    expect(wrapper.find('[role="status"]').exists()).toBe(true)
    expect(wrapper.find('.squelette').exists()).toBe(true)
  })

  it('shows the typed error state with a Retry button, never the raw error string', async () => {
    let appels = 0
    const charger: ChargerPayload = async () => {
      appels += 1
      if (appels === 1) throw new Error('Impossible de charger /data/territoires.json')
      return payloadDemographie
    }
    const { wrapper } = await monter('/territoire/commune/29002', charger)

    expect(wrapper.find('.etat-erreur').exists()).toBe(true)
    expect(wrapper.text()).toContain('Impossible de charger les données')
    expect(wrapper.text()).not.toContain('/data/territoires.json')
    expect(wrapper.text()).not.toContain('Payload invalide')

    await wrapper.find('.bouton-reessayer').trigger('click')
    await flushPromises()

    expect(wrapper.find('.etat-erreur').exists()).toBe(false)
    expect(wrapper.find('h1').text()).toBe('Commune C')
    expect(appels).toBe(2)
  })

  it('shows the honest empty state for an unknown territory, not a crash', async () => {
    const { wrapper } = await monter('/territoire/commune/99999', chargerAvec(payloadDemographie))

    expect(wrapper.find('.etat-vide').exists()).toBe(true)
    expect(wrapper.text()).toContain('Territoire introuvable.')
    expect(wrapper.find('.etat-vide a[href="/communes"]').exists()).toBe(true)
    expect(wrapper.find('h1').exists()).toBe(false)
  })

  it('treats a route type that does not match the payload as not found', async () => {
    const { wrapper } = await monter('/territoire/epci/22001', chargerAvec(payloadDemographie))

    expect(wrapper.find('.etat-vide').exists()).toBe(true)
  })
})

describe('TerritoireView — l’en-tête de la fiche', () => {
  it('renders the territory’s real name, type chip and breadcrumb', async () => {
    const { wrapper } = await monter('/territoire/commune/29002', chargerAvec(payloadDemographie))

    const h1 = wrapper.find('.fiche-titre h1')
    expect(h1.text()).toBe('Commune C')
    expect(wrapper.find('.puce-type').text()).toBe('Commune')

    const fil = wrapper.find('.fil-ariane')
    expect(fil.text()).toContain('Accueil')
    expect(fil.text()).toContain('Données')
    expect(fil.text()).toContain('Les communes')
    expect(fil.find('a[href="/"]').exists()).toBe(true)
    expect(fil.find('a[href="/communes"]').exists()).toBe(true)
  })

  it('renders the context switcher (commune → EPCI → département → région)', async () => {
    const { wrapper } = await monter('/territoire/commune/29002', chargerAvec(payloadDemographie))

    const switcher = wrapper.find('.contexte-switcher')
    const liens = switcher.findAll('a').map((l) => l.text())
    expect(liens).toEqual(['EPCI Y', 'Département 29', 'Bretagne'])
    expect(switcher.find('[aria-current="page"]').text()).toBe('Commune C')
  })

  it('groups the type chip and the context switcher into a centered actions row under the title', async () => {
    const { wrapper } = await monter('/territoire/commune/29002', chargerAvec(payloadDemographie))

    const identite = wrapper.find('.fiche-identite')
    expect(identite.exists()).toBe(true)
    expect(identite.find('.fiche-titre h1').text()).toBe('Commune C')

    const actions = identite.find('.fiche-actions')
    expect(actions.exists()).toBe(true)
    expect(actions.find('.puce-type').text()).toBe('Commune')
    expect(actions.find('.contexte-switcher').exists()).toBe(true)
  })
})

describe('TerritoireView — les onglets (ADR-0007)', () => {
  it('renders only the themes present in the payload, Aperçu first', async () => {
    const { wrapper } = await monter('/territoire/commune/29002', chargerAvec(payloadDemographie))

    const onglets = wrapper.findAll('[role="tab"]').map((o) => o.text().trim())
    expect(onglets).toEqual(['Aperçu', 'Démographie'])
  })

  it('renders every payload theme in canonical order when several exist', async () => {
    const { wrapper } = await monter('/territoire/commune/29002', chargerAvec(payloadAvecHabitat))

    const onglets = wrapper.findAll('[role="tab"]').map((o) => o.text().trim())
    expect(onglets).toEqual(['Aperçu', 'Démographie', 'Habitat'])
  })

  it('opens on Aperçu by default (absent ?theme=) and renders its content', async () => {
    const { wrapper } = await monter('/territoire/commune/29002', chargerAvec(payloadDemographie))

    const apercu = wrapper.findAll('[role="tab"]')[0]
    expect(apercu.attributes('aria-selected')).toBe('true')
    expect(wrapper.find('[role="tabpanel"]').attributes('id')).toBe('panneau-apercu')
    // the Aperçu tab's real content: basic stats + Programmes & financements
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Population')
    expect(wrapper.find('[role="tabpanel"]').text()).toContain('Programmes & financements')
  })

  it('selects the theme from ?theme= and renders its block', async () => {
    const { wrapper } = await monter(
      '/territoire/commune/29002?theme=demographie',
      chargerAvec(payloadDemographie),
    )

    const demographie = wrapper.findAll('[role="tab"]')[1]
    expect(demographie.attributes('aria-selected')).toBe('true')
    expect(wrapper.find('[role="tabpanel"]').attributes('id')).toBe('panneau-demographie')
    const panneau = wrapper.find('[role="tabpanel"]')
    expect(panneau.text()).toContain('Démographie')
    expect(panneau.text()).toContain('Densité de population')
    expect(panneau.text()).toContain('La population diminue sur ses deux composantes.')
  })

  it('writes ?theme= into the URL when a theme tab is chosen', async () => {
    const { router, wrapper } = await monter(
      '/territoire/commune/29002',
      chargerAvec(payloadDemographie),
    )

    await wrapper.findAll('[role="tab"]')[1].trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.theme).toBe('demographie')
  })

  it('clears ?theme= from the URL when Aperçu is chosen', async () => {
    const { router, wrapper } = await monter(
      '/territoire/commune/29002?theme=demographie',
      chargerAvec(payloadDemographie),
    )

    await wrapper.findAll('[role="tab"]')[0].trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.theme).toBeUndefined()
    expect(wrapper.findAll('[role="tab"]')[0].attributes('aria-selected')).toBe('true')
  })

  it('falls back to Aperçu and cleans the URL for a theme absent from the payload', async () => {
    const { router, wrapper } = await monter(
      '/territoire/commune/29002?theme=habitat',
      chargerAvec(payloadDemographie),
    )

    await flushPromises()
    expect(wrapper.findAll('[role="tab"]')[0].attributes('aria-selected')).toBe('true')
    expect(router.currentRoute.value.query.theme).toBeUndefined()
  })
})

describe('TerritoireView — la coloration de la page (le -wash du thème)', () => {
  it('wears the selected theme’s wash; Aperçu stays on the brand ramp', async () => {
    const { wrapper } = await monter(
      '/territoire/commune/29002?theme=demographie',
      chargerAvec(payloadDemographie),
    )

    expect(wrapper.find('.fiche').classes()).toContain('fiche--theme-demographie')
  })

  it('uses the general (brand) state on Aperçu', async () => {
    const { wrapper } = await monter('/territoire/commune/29002', chargerAvec(payloadDemographie))

    expect(wrapper.find('.fiche').classes()).toContain('fiche--theme-apercu')
  })
})

describe('TerritoireView — le filigrane de la fiche', () => {
  it('renders the watermark behind the Aperçu tab, accents on the brand anchor', async () => {
    const { wrapper } = await monter('/territoire/commune/29002', chargerAvec(payloadDemographie))

    const filigrane = wrapper.find('.filigrane-fiche')
    expect(filigrane.exists()).toBe(true)
    expect(filigrane.attributes('aria-hidden')).toBe('true')
    expect(filigrane.attributes('style')).toContain('--filigrane-accent: var(--brand-500)')
  })

  it('wears the theme’s anchor on a theme tab', async () => {
    const { wrapper } = await monter(
      '/territoire/commune/29002?theme=demographie',
      chargerAvec(payloadDemographie),
    )

    const filigrane = wrapper.find('.filigrane-fiche')
    expect(filigrane.attributes('style')).toContain(
      '--filigrane-accent: var(--theme-demographie-line)',
    )
  })

  it('is not rendered when the fiche is missing (empty state)', async () => {
    const { wrapper } = await monter('/territoire/commune/99999', chargerAvec(payloadDemographie))

    expect(wrapper.find('.filigrane-fiche').exists()).toBe(false)
  })
})
