import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import AccueilView from '../views/AccueilView.vue'
import {
  chargerAvec, histoiresDemographieFixture, indicateursDemographieFixture,
  runReportFraisFixture, territoiresFixture, vintagesFixture,
} from '../payload/fixtures'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import type { ChargerFichier } from '../payload/usePayload'
import type { Payload } from '../payload/types'
import { routes } from '../router'

// #1027: public homepage seam; real search and router, injected file transport.
const payload: Payload = {
  territoires: territoiresFixture, indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture, runReport: runReportFraisFixture,
  vintages: vintagesFixture, programmes: null,
}

async function monter(charger: ChargerFichier = chargerAvec(payload), attacher = false) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  await router.isReady()
  const wrapper = mount(AccueilView, {
    attachTo: attacher ? document.body : undefined,
    global: { plugins: [router], provide: { [PAYLOAD_CHARGER_KEY]: charger } },
  })
  await flushPromises()
  return { router, wrapper }
}

describe('Accueil — direction approuvée #1027', () => {
  it('déplace le focus et la sélection des onglets au clavier sans perdre la saisie', async () => {
    const { wrapper } = await monter(chargerAvec(payload), true)
    try {
      const tabs = wrapper.findAll('[role="tab"]')
      await wrapper.get('input[role="combobox"]').setValue('Rennes')
      ;(tabs[0].element as HTMLButtonElement).focus()
      await tabs[0].trigger('keydown', { key: 'ArrowRight' })
      expect(tabs[1].attributes('aria-selected')).toBe('true')
      expect(document.activeElement).toBe(tabs[1].element)
      await tabs[1].trigger('keydown', { key: 'ArrowRight' })
      expect(document.activeElement).toBe(tabs[0].element)
      await tabs[0].trigger('keydown', { key: 'End' })
      expect(document.activeElement).toBe(tabs[1].element)
      await tabs[1].trigger('keydown', { key: 'Home' })
      expect(document.activeElement).toBe(tabs[0].element)
      await tabs[0].trigger('keydown', { key: 'ArrowLeft' })
      expect(document.activeElement).toBe(tabs[1].element)
      await tabs[1].trigger('keydown', { key: 'ArrowLeft' })
      expect(document.activeElement).toBe(tabs[0].element)
      expect((wrapper.get('input[role="combobox"]').element as HTMLInputElement).value).toBe('Rennes')
    } finally { wrapper.unmount() }
  })

  it('propose deux onglets reliés à leurs panneaux, recherche par défaut et listes navigables', async () => {
    const { wrapper, router } = await monter()
    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs.map((tab) => tab.text())).toEqual(['Rechercher', 'Parcourir'])
    expect(wrapper.get('[role="tablist"]').attributes('aria-label')).toBe('Accéder aux territoires')
    expect(tabs[0].attributes('aria-selected')).toBe('true')
    expect(tabs[0].attributes('tabindex')).toBe('0')
    expect(tabs[1].attributes('tabindex')).toBe('-1')
    for (const tab of tabs) {
      const panel = wrapper.get(`#${tab.attributes('aria-controls')}`)
      expect(panel.attributes('role')).toBe('tabpanel')
      expect(panel.attributes('aria-labelledby')).toBe(tab.attributes('id'))
    }
    await tabs[1].trigger('click')
    expect(tabs[1].attributes('aria-selected')).toBe('true')
    expect(wrapper.get('#accueil-panneau-rechercher').attributes('hidden')).toBeDefined()
    const panel = wrapper.get(`#${tabs[1].attributes('aria-controls')}`)
    expect(panel.findAll('a').map((a) => a.attributes('href'))).toEqual(['/communes', '/epcis', '/departements'])
    expect(panel.findAll('a').map((a) => a.text())).toEqual(['Communes', 'EPCI', 'Départements'])
    for (const lien of panel.findAll('a')) {
      expect(lien.get('svg').attributes('aria-hidden')).toBe('true')
      expect(lien.findAll('button, [role="button"]')).toHaveLength(0)
    }
    expect(panel.find('a[href="/indicateurs"]').exists()).toBe(false)
    expect(wrapper.get('a[href="/indicateurs"]').isVisible()).toBe(true)
    await panel.get('a[href="/communes"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/communes')
  })

  it('conserve la signature, l’hermine et la légende', async () => {
    const { wrapper } = await monter()
    expect(wrapper.find('.accueil-hero .lusk-marque__ermine').exists()).toBe(true)
    expect(wrapper.find('.lusk-marque__mot').text()).toBe('lusk')
    expect(wrapper.find('.accueil-marque-caption').text()).toBe("/'lysk/ · breton · élan, mouvement")
    expect(wrapper.find('.accueil-accroche').text()).toBe('Intelligence territoriale en Bretagne')
  })

  it('présente l’introduction approuvée', async () => {
    const { wrapper } = await monter()
    expect(wrapper.find('.accueil-sous-titre').text()).toBe('Accès aux équipements, migrations, occupation des sols, habitat… Lusk propose des données ouvertes et des analyses originales pour comprendre les dynamiques et les tensions des territoires bretons.')
  })

  it('montre trois emplacements provisoires sans fausse interaction ni promotion', async () => {
    const { wrapper } = await monter()
    const emplacements = wrapper.findAll('.accueil-editorial > li')
    expect(emplacements).toHaveLength(3)
    for (const emplacement of emplacements) {
      expect(emplacement.get('.accueil-a-venir').text()).toBe('À venir')
      expect(emplacement.get('.accueil-image-provisoire').text()).toBe('Figure à venir')
      expect(emplacement.findAll('a, button, [tabindex], img, svg, time')).toHaveLength(0)
    }
    expect(wrapper.find('.accueil-editorial h2').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/Données actualisées|Derrière chaque fiche|derniers articles/i)
    expect(wrapper.findAll('.carrousel-carte')).toHaveLength(0)
  })

  it('offre directement la recherche et un simple lien vers le catalogue, sans cartes explicatives', async () => {
    const { wrapper, router } = await monter()
    expect(wrapper.find('input[role="combobox"]').attributes('aria-label')).toBe('Rechercher un territoire par son nom ou son code administratif')
    expect(wrapper.findAll('.porte')).toHaveLength(0)
    const lien = wrapper.find('a[href="/indicateurs"]')
    expect(lien.text()).toBe('Explorer les indicateurs')
    await lien.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/indicateurs')
    expect(wrapper.find('a[href="/carte"]').exists()).toBe(false)
  })

  it('garde la recherche territoire et sa navigation clavier', async () => {
    const { wrapper, router } = await monter()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const input = wrapper.get('input[role="combobox"]')
      await input.trigger('focus')
      await input.setValue('epci')
      await vi.advanceTimersByTimeAsync(300)
      expect(wrapper.findAll('[role="option"]')).toHaveLength(2)
      await input.trigger('keydown', { key: 'ArrowDown' })
      expect(input.attributes('aria-activedescendant')).toBe('gsb-option-0')
      await input.trigger('keydown', { key: 'Enter' })
      vi.useRealTimers()
      await flushPromises()
      expect(router.currentRoute.value.path).toBe('/territoire/epci/200000001')
    } finally { vi.useRealTimers() }
  })
})

describe('Accueil — récupération préservée', () => {
  it('rend l’introduction et le catalogue pendant le chargement', async () => {
    const { wrapper } = await monter(() => new Promise(() => {}))
    expect(wrapper.get('.accueil').attributes('aria-busy')).toBe('true')
    expect(wrapper.find('.global-search__spinner').exists()).toBe(true)
    expect(wrapper.find('a[href="/indicateurs"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Données actualisées')
  })

  it('montre l’erreur et réessaie sans perdre les entrées', async () => {
    let premier = true
    const charger: ChargerFichier = async (fichier) => {
      if (fichier === 'territoires' && premier) {
        premier = false
        throw new Error('panne territoires')
      }
      return chargerAvec(payload)(fichier)
    }
    const { wrapper } = await monter(charger)
    expect(wrapper.text()).toContain('Impossible de charger les données.')
    expect(wrapper.find('input[role="combobox"]').exists()).toBe(true)
    await wrapper.get('.bouton-reessayer').trigger('click')
    await flushPromises()
    expect(wrapper.find('.accueil-erreur').exists()).toBe(false)
    expect(wrapper.get('.accueil').attributes('aria-busy')).toBe('false')
    expect(wrapper.text()).not.toContain('Données actualisées')
  })

  it('ne bloque pas la recherche sur les fichiers de fond', async () => {
    const { wrapper } = await monter((fichier) =>
      fichier === 'territoires' || fichier === 'run-report'
        ? chargerAvec(payload)(fichier) : new Promise(() => {}))
    expect(wrapper.get('.accueil').attributes('aria-busy')).toBe('false')
    expect(wrapper.find('.global-search__spinner').exists()).toBe(false)
  })
})
