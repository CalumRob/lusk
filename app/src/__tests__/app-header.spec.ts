import { mount } from '@vue/test-utils'

import { createMemoryHistory, createRouter } from 'vue-router'

import { afterEach, describe, expect, it } from 'vitest'

import AppHeader from '../components/AppHeader.vue'
import { routes } from '../router'

/**
 * AppHeader (DESIGN.md §5 + site-map.md §Navigation): sticky 60px chrome,
 * Lusk wordmark (serif → /), centered nav Accueil · Carte · Données ·
 * Méthodes with a 2px underline on the active route, Contact →
 * calumrobertson.fr. Mobile (<768px): full-screen drawer (transform-only,
 * scroll-lock, focus trap, Escape closes). Données is a small disclosure
 * dropdown to the three lists. No locale toggle (French-only v1).
 */

let montee: ReturnType<typeof mount> | null = null

async function montage(chemin = '/') {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(chemin)
  await router.isReady()
  const wrapper = mount(AppHeader, {
    attachTo: document.body,
    global: { plugins: [router] },
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

const LIENS_NAV = ['Accueil', 'Carte', 'Données', 'Méthodes']

describe('AppHeader — le mot-clé et la navigation', () => {
  it('renders the serif Lusk wordmark linking to /', async () => {
    const { wrapper } = await montage()

    const marque = wrapper.find('.en-tete-marque')
    expect(marque.text()).toBe('Lusk')
    expect(marque.attributes('href')).toBe('/')
  })

  it('renders the four centered nav items in order', async () => {
    const { wrapper } = await montage()

    const libelles = wrapper
      .find('.nav-bureau')
      .findAll('.nav-lien')
      .map((l) => l.text().trim())
    expect(libelles).toEqual(LIENS_NAV)
  })

  it('underlines the active nav item for the current route', async () => {
    const { router, wrapper } = await montage('/')

    const accueil = wrapper.findAll('.nav-lien')[0]
    expect(accueil.classes()).toContain('nav-lien--actif')

    await router.push('/carte')
    await wrapper.vm.$nextTick()
    const carte = wrapper.findAll('.nav-lien')[1]
    expect(carte.classes()).toContain('nav-lien--actif')
    expect(wrapper.findAll('.nav-lien')[0].classes()).not.toContain('nav-lien--actif')
  })

  it('keeps Données active on the three list routes and the fiche', async () => {
    const { router, wrapper } = await montage('/communes')
    expect(wrapper.findAll('.nav-lien')[2].classes()).toContain('nav-lien--actif')

    await router.push('/territoire/commune/29002')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.nav-lien')[2].classes()).toContain('nav-lien--actif')
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

describe('AppHeader — le menu Données', () => {
  it('opens the three data-list links on click', async () => {
    const { wrapper } = await montage()

    const donnees = wrapper.findAll('.nav-lien')[2]
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

    await wrapper.findAll('.nav-lien')[2].trigger('click')
    await wrapper.findAll('.sous-nav-lien')[0].trigger('click')

    expect(wrapper.findAll('.nav-lien')[2].attributes('aria-expanded')).toBe('false')
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
    await wrapper.find('.tiroir a[href="/"]').trigger('click')

    expect(wrapper.find('.bouton-menu').attributes('aria-expanded')).toBe('false')
  })
})
