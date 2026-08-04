import { mount } from '@vue/test-utils'

import { createMemoryHistory, createRouter } from 'vue-router'

import { afterEach, describe, expect, it } from 'vitest'

import AppHeader from '../components/AppHeader.vue'
import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  runReportFraisFixture,
  territoiresFixture,
} from '../payload/fixtures'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import type { ChargerPayload } from '../payload/usePayload'
import type { Payload } from '../payload/types'
import { routes } from '../router'

/**
 * AppHeader (DESIGN.md §5 + site-map.md §Navigation): sticky 60px chrome,
 * Lusk wordmark (serif → /) — the sole home affordance (#61) — centered nav
 * Carte · Données · Méthodes with a 2px underline on the active route,
 * Contact → calumrobertson.fr, and (F3, #53 + #61) the search collapsed into
 * a « Rechercher » button that expands an overlay below the header. Mobile
 * (<768px): full-screen drawer (transform-only, scroll-lock, focus trap,
 * Escape closes); a select inside the search closes the drawer. Données is a
 * small disclosure dropdown to the three lists.
 */

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
}

const charger: ChargerPayload = async () => payload

let montee: ReturnType<typeof mount> | null = null

async function montage(chemin = '/', options: Record<string, unknown> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(chemin)
  await router.isReady()
  const wrapper = mount(AppHeader, {
    attachTo: document.body,
    global: {
      plugins: [router],
      provide: { [PAYLOAD_CHARGER_KEY]: charger },
      ...options,
    },
  })
  montee = wrapper
  return { router, wrapper }
}

afterEach(() => {
  montee?.unmount()
  montee = null
  document.body.classList.remove('tiroir-verrouille')
  document.body.innerHTML = ''
})

const LIENS_NAV = ['Carte', 'Données', 'Méthodes']

describe('AppHeader — le mot-clé et la navigation', () => {
  it('renders the locked brand lockup — ermine + italic "lusk" — linking to /', async () => {
    const { wrapper } = await montage()

    const marque = wrapper.find('.en-tete-marque')
    expect(marque.text()).toBe('lusk')
    expect(marque.find('.lusk-marque__ermine').exists()).toBe(true)
    expect(marque.attributes('aria-label')).toBe('lusk — Accueil')
    expect(marque.attributes('href')).toBe('/')
  })

  it('renders the centered nav items in order — no Accueil, the wordmark is the home affordance', async () => {
    const { wrapper } = await montage()

    const libelles = wrapper
      .find('.nav-bureau')
      .findAll('.nav-lien')
      .map((l) => l.text().trim())
    expect(libelles).toEqual(LIENS_NAV)
  })

  it('underlines the active nav item for the current route', async () => {
    const { router, wrapper } = await montage('/carte')

    const carte = wrapper.findAll('.nav-lien')[0]
    expect(carte.classes()).toContain('nav-lien--actif')

    await router.push('/communes')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.nav-lien')[0].classes()).not.toContain('nav-lien--actif')
    expect(wrapper.findAll('.nav-lien')[1].classes()).toContain('nav-lien--actif')
  })

  it('keeps Données active on the three list routes and the fiche', async () => {
    const { router, wrapper } = await montage('/communes')
    expect(wrapper.findAll('.nav-lien')[1].classes()).toContain('nav-lien--actif')

    await router.push('/territoire/commune/29002')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.nav-lien')[1].classes()).toContain('nav-lien--actif')
  })

  it('has no Accueil link in the desktop nav or the mobile drawer', async () => {
    const { wrapper } = await montage()

    expect(wrapper.find('.nav-bureau').text()).not.toContain('Accueil')

    await wrapper.find('.bouton-menu').trigger('click')
    expect(wrapper.find('.tiroir').text()).not.toContain('Accueil')
  })

  it('renders Contact as the external calumrobertson.fr link', async () => {
    const { wrapper } = await montage()

    const contact = wrapper.find('a.bouton-contact')
    expect(contact.text()).toContain('Contact')
    expect(contact.attributes('href')).toBe('https://calumrobertson.fr')
    expect(contact.attributes('target')).toBe('_blank')
  })

  it('has no locale toggle (French-only v1)', async () => {
    const { wrapper } = await montage()

    expect(wrapper.text()).not.toMatch(/FR|EN/)
  })
})

describe('AppHeader — les cibles de navigation résolvent', () => {
  it('points Méthodes at the registered /methodologie route', async () => {
    const { wrapper } = await montage()

    const methodes = wrapper.find('.nav-bureau a[href="/methodologie"]')
    expect(methodes.exists()).toBe(true)
    expect(methodes.text()).toBe('Méthodes')
    expect(routes.some((r) => r.path === '/methodologie')).toBe(true)
  })

  it('resolves every internal nav target against the route table', async () => {
    const { wrapper } = await montage()

    const cheminsRoutes = new Set<string>(routes.map((r) => r.path))
    const cibles = wrapper
      .findAll('.nav-bureau a, .tiroir a')
      .map((l) => l.attributes('href'))
      .filter((href): href is string => !!href && href.startsWith('/'))

    expect(cibles.length).toBeGreaterThan(0)
    for (const cible of cibles) {
      expect(cheminsRoutes.has(cible)).toBe(true)
    }
  })
})

describe('AppHeader — le menu Données', () => {
  it('opens the three data-list links on click', async () => {
    const { wrapper } = await montage()

    const donnees = wrapper.findAll('.nav-lien')[1]
    expect(donnees.attributes('aria-expanded')).toBe('false')

    await donnees.trigger('click')
    expect(donnees.attributes('aria-expanded')).toBe('true')
    const sous = wrapper.findAll('.sous-nav-lien')
    expect(sous.map((l) => l.text())).toEqual(['Les communes', 'Les EPCI', 'Les départements'])
    expect(sous[0].attributes('href')).toBe('/communes')
    expect(sous[1].attributes('href')).toBe('/epcis')
    expect(sous[2].attributes('href')).toBe('/departements')
  })

  it('closes the menu when a list link is chosen', async () => {
    const { wrapper } = await montage()

    await wrapper.findAll('.nav-lien')[1].trigger('click')
    await wrapper.findAll('.sous-nav-lien')[0].trigger('click')

    expect(wrapper.findAll('.nav-lien')[1].attributes('aria-expanded')).toBe('false')
  })
})

describe('AppHeader — le tiroir mobile', () => {
  it('starts closed, opens on the menu button and locks the page scroll', async () => {
    const { wrapper } = await montage()

    const bouton = wrapper.find('.bouton-menu')
    expect(bouton.attributes('aria-expanded')).toBe('false')

    await bouton.trigger('click')
    expect(bouton.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('.tiroir').classes()).toContain('tiroir--ouvert')
    expect(document.body.classList.contains('tiroir-verrouille')).toBe(true)
  })

  it('moves focus into the drawer when it opens', async () => {
    const { wrapper } = await montage()

    await wrapper.find('.bouton-menu').trigger('click')

    const tiroir = wrapper.find('.tiroir').element as HTMLElement
    expect(tiroir.contains(document.activeElement)).toBe(true)
  })

  it('closes on Escape, restores the scroll and returns focus to the toggle', async () => {
    const { wrapper } = await montage()
    const bouton = wrapper.find('.bouton-menu').element as HTMLButtonElement

    await wrapper.find('.bouton-menu').trigger('click')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.bouton-menu').attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.tiroir').classes()).not.toContain('tiroir--ouvert')
    expect(document.body.classList.contains('tiroir-verrouille')).toBe(false)
    expect(document.activeElement).toBe(bouton)
  })

  it('contains the same links at display size, Contact included', async () => {
    const { wrapper } = await montage()

    await wrapper.find('.bouton-menu').trigger('click')
    const texteTiroir = wrapper.find('.tiroir').text()

    for (const libelle of [...LIENS_NAV, 'Les communes', 'Les EPCI', 'Les départements', 'Contact']) {
      expect(texteTiroir).toContain(libelle)
    }
  })

  it('closes when a drawer link is chosen', async () => {
    const { wrapper } = await montage()

    await wrapper.find('.bouton-menu').trigger('click')
    await wrapper.find('.tiroir a[href="/carte"]').trigger('click')

    expect(wrapper.find('.bouton-menu').attributes('aria-expanded')).toBe('false')
  })
})

describe('AppHeader — la recherche globale (F3, #53 + #61)', () => {
  it('shows a « Rechercher » button instead of an always-open search in the header', async () => {
    const { wrapper } = await montage('/carte')

    const bouton = wrapper.find('.bouton-recherche')
    expect(bouton.exists()).toBe(true)
    expect(bouton.text()).toContain('Rechercher')
    expect(bouton.attributes('aria-expanded')).toBe('false')
    expect(bouton.attributes('aria-controls')).toBe('recherche-superposee')
    expect(wrapper.find('.en-tete-recherche input[role="combobox"]').exists()).toBe(false)
  })

  it('sits right-aligned before Contact in the header (F3/#53 layout)', async () => {
    const { wrapper } = await montage()

    const enfants = wrapper.find('.en-tete-interieur').element.children
    const ordre = Array.from(enfants).map((el) => el.className)
    const positionRecherche = ordre.findIndex((c) => c.includes('en-tete-recherche'))
    const positionContact = ordre.findIndex((c) => c.includes('bouton-contact'))

    expect(positionRecherche).toBeGreaterThan(-1)
    expect(positionContact).toBeGreaterThan(positionRecherche)
  })

  it('expands the search below the header on click and moves focus into the input', async () => {
    const { wrapper } = await montage()
    const bouton = wrapper.find('.bouton-recherche')

    await bouton.trigger('click')
    await wrapper.vm.$nextTick()

    const panneau = wrapper.find('.recherche-superposee')
    expect(panneau.exists()).toBe(true)
    expect(bouton.attributes('aria-expanded')).toBe('true')

    const input = panneau.find('input[role="combobox"]')
    expect(input.exists()).toBe(true)
    expect(input.attributes('aria-label')).toBe('Rechercher un territoire par son nom')
    expect(panneau.element.contains(document.activeElement)).toBe(true)
  })

  it('closes on Escape and returns focus to the button', async () => {
    const { wrapper } = await montage()
    const bouton = wrapper.find('.bouton-recherche').element as HTMLButtonElement

    await wrapper.find('.bouton-recherche').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.recherche-superposee').exists()).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.recherche-superposee').exists()).toBe(false)
    expect(wrapper.find('.bouton-recherche').attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(bouton)
  })

  it('closes on an outside click', async () => {
    const { wrapper } = await montage()

    await wrapper.find('.bouton-recherche').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.recherche-superposee').exists()).toBe(true)

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.recherche-superposee').exists()).toBe(false)
    expect(wrapper.find('.bouton-recherche').attributes('aria-expanded')).toBe('false')
  })

  it('searches the payload territoires once expanded', async () => {
    const { wrapper } = await montage()
    await wrapper.find('.bouton-recherche').trigger('click')

    const input = wrapper.find('.recherche-superposee input[role="combobox"]')
    await input.trigger('focus')
    await input.setValue('epci')
    await new Promise((r) => setTimeout(r, 300))

    const options = wrapper.findAll('[role="option"]')
    expect(options.length).toBeGreaterThan(0)
    expect(options[0].text()).toContain('EPCI')
  })

  it('closes the mobile drawer when a search result is chosen', async () => {
    const { wrapper } = await montage()

    await wrapper.find('.bouton-menu').trigger('click')
    expect(wrapper.find('.tiroir').classes()).toContain('tiroir--ouvert')

    const tiroir = wrapper.find('.tiroir')
    const input = tiroir.find('input[role="combobox"]')
    await input.trigger('focus')
    await input.setValue('epci')
    await new Promise((r) => setTimeout(r, 300))

    await tiroir.findAll('[role="option"]')[0].trigger('click')
    await new Promise((r) => setTimeout(r, 50))

    expect(wrapper.find('.tiroir').classes()).not.toContain('tiroir--ouvert')
    expect(wrapper.find('.bouton-menu').attributes('aria-expanded')).toBe('false')
  })
})
