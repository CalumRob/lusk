import { flushPromises, mount } from '@vue/test-utils'

import { createMemoryHistory, createRouter } from 'vue-router'

import { afterEach, describe, expect, it } from 'vitest'

import AppHeader from '../components/AppHeader.vue'
import {
  apercuAvecNAFixture,
  chargerAvec,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import { PAYLOAD_CHARGER_KEY, type ChargerFichier } from '../payload/usePayload'
import type { Payload } from '../payload/types'
import { PayloadError } from '../payload/validate'
import { routes } from '../router'

/**
 * AppHeader (#410 — la bascule atomique): sticky 60px chrome, Lusk wordmark
 * (serif → /) — the sole home affordance (#61) — centered nav
 * **Territoires · Indicateurs · Sources · À propos** with a 2px underline on
 * the active route, Contact → calumrobertson.fr, and (F3, #53 + #61) the
 * search collapsed into a « Rechercher » button that expands an overlay below
 * the header. Mobile (<768px): full-screen drawer (transform-only,
 * scroll-lock, focus trap, Escape closes); a select inside the search closes
 * the drawer. Territoires is a disclosure dropdown to the three lists.
 *
 * La bascule (#410) : Carte et Méthodes ne sont plus des destinations de la
 * navigation — AUCUN lien vers /carte ni /methodologie ne survit ici
 * (/carte reste routée comme outil du PO sans lien face-utilisateur,
 * ruling 2026-08-26).
 */

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture,
  programmes: null,
}

const charger = chargerAvec(payload)

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
  document.documentElement.classList.remove('tiroir-verrouille')
  document.body.classList.remove('tiroir-verrouille')
  document.body.innerHTML = ''
})

const LIENS_NAV = ['Territoires', 'Indicateurs', 'Sources', 'À propos']

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
    const { router, wrapper } = await montage('/sources')

    const sources = wrapper.findAll('.nav-lien')[2]
    expect(sources.classes()).toContain('nav-lien--actif')

    await router.push('/communes')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.nav-lien')[2].classes()).not.toContain('nav-lien--actif')
    expect(wrapper.findAll('.nav-lien')[0].classes()).toContain('nav-lien--actif')
  })

  it('keeps Territoires active on the three list routes and the fiche', async () => {
    const { router, wrapper } = await montage('/communes')
    expect(wrapper.findAll('.nav-lien')[0].classes()).toContain('nav-lien--actif')

    await router.push('/territoire/commune/29002')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.nav-lien')[0].classes()).toContain('nav-lien--actif')
  })

  it('keeps Indicateurs active on the catalogue and its parameterized pages', async () => {
    const { router, wrapper } = await montage('/indicateurs')
    expect(wrapper.findAll('.nav-lien')[1].classes()).toContain('nav-lien--actif')

    await router.push('/indicateurs/demographie/densite')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.nav-lien')[1].classes()).toContain('nav-lien--actif')
  })

  it('keeps À propos active on its own route only', async () => {
    const { router, wrapper } = await montage('/a-propos')
    expect(wrapper.findAll('.nav-lien')[3].classes()).toContain('nav-lien--actif')

    await router.push('/')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.nav-lien')[3].classes()).not.toContain('nav-lien--actif')
  })

  it('exposes no link to /carte — épargnée mais sans lien (ruling PO, #410)', async () => {
    const { wrapper } = await montage()

    expect(wrapper.find('a[href="/carte"]').exists()).toBe(false)
  })

  it('exposes no Méthodes entry nor /methodologie link anywhere (#410)', async () => {
    const { wrapper } = await montage()

    expect(wrapper.find('.nav-bureau').text()).not.toContain('Méthodes')
    expect(wrapper.find('a[href="/methodologie"]').exists()).toBe(false)
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
  it('points Indicateurs, Sources and À propos at their registered routes (#410)', async () => {
    const { wrapper } = await montage()

    for (const [chemin, libelle] of [
      ['/indicateurs', 'Indicateurs'],
      ['/sources', 'Sources'],
      ['/a-propos', 'À propos'],
    ] as const) {
      const lien = wrapper.find(`.nav-bureau a[href="${chemin}"]`)
      expect(lien.exists(), chemin).toBe(true)
      expect(lien.text()).toBe(libelle)
      expect(routes.some((r) => r.path === chemin), chemin).toBe(true)
    }
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

describe('AppHeader — le menu Territoires', () => {
  it('opens the three data-list links on click', async () => {
    const { wrapper } = await montage()

    const territoires = wrapper.findAll('.nav-lien')[0]
    expect(territoires.attributes('aria-expanded')).toBe('false')

    await territoires.trigger('click')
    expect(territoires.attributes('aria-expanded')).toBe('true')
    const sous = wrapper.findAll('.sous-nav-lien')
    expect(sous.map((l) => l.text())).toEqual(['Les communes', 'Les EPCI', 'Les départements'])
    expect(sous[0].attributes('href')).toBe('/communes')
    expect(sous[1].attributes('href')).toBe('/epcis')
    expect(sous[2].attributes('href')).toBe('/departements')
  })

  it('closes the menu when a list link is chosen', async () => {
    const { wrapper } = await montage()

    await wrapper.findAll('.nav-lien')[0].trigger('click')
    await wrapper.findAll('.sous-nav-lien')[0].trigger('click')

    expect(wrapper.findAll('.nav-lien')[0].attributes('aria-expanded')).toBe('false')
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

  it('locks scroll on <html> too — html carries overflow-x: clip, so a body-only lock never reaches the viewport (#205)', async () => {
    const { wrapper } = await montage()

    await wrapper.find('.bouton-menu').trigger('click')
    expect(document.documentElement.classList.contains('tiroir-verrouille')).toBe(true)

    await wrapper.find('.bouton-menu').trigger('click')
    expect(document.documentElement.classList.contains('tiroir-verrouille')).toBe(false)
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

  it('renders Territoires as a non-link group label, with the three lists nested directly beneath it', async () => {
    const { wrapper } = await montage()

    await wrapper.find('.bouton-menu').trigger('click')
    const nav = wrapper.find('.nav-tiroir')

    expect(nav.findAll('a').filter((a) => a.text().trim() === 'Territoires')).toHaveLength(0)
    const etiquette = nav.find('.tiroir-groupe-titre')
    expect(etiquette.exists()).toBe(true)
    expect(etiquette.element.tagName).toBe('SPAN')
    expect(etiquette.text().trim()).toBe('Territoires')

    const liens = nav.findAll('a').map((a) => a.text().trim())
    expect(liens).toEqual([
      'Les communes',
      'Les EPCI',
      'Les départements',
      'Indicateurs',
      'Sources',
      'À propos',
      'Contact',
    ])
  })

  it('closes when a drawer link is chosen', async () => {
    const { wrapper } = await montage()

    await wrapper.find('.bouton-menu').trigger('click')
    await wrapper.find('.tiroir a[href="/sources"]').trigger('click')

    expect(wrapper.find('.bouton-menu').attributes('aria-expanded')).toBe('false')
  })

  it('renders the drawer as a sibling of the header, never nested inside it (#205)', async () => {
    const { wrapper } = await montage()

    const parent = wrapper.find('.en-tete').element.parentElement
    expect(wrapper.find('.tiroir').element.parentElement).toBe(parent)
    expect(parent?.contains(wrapper.find('.en-tete').element)).toBe(true)
  })

  it('toggles closed again on a second press of the burger button', async () => {
    const { wrapper } = await montage()
    const bouton = wrapper.find('.bouton-menu')

    await bouton.trigger('click')
    expect(wrapper.find('.tiroir').classes()).toContain('tiroir--ouvert')

    await bouton.trigger('click')
    expect(wrapper.find('.tiroir').classes()).not.toContain('tiroir--ouvert')
    expect(bouton.attributes('aria-expanded')).toBe('false')
  })

  it('swaps the toggle icon for a close cross while the drawer is open (pattern ACI)', async () => {
    const { wrapper } = await montage()
    const bouton = wrapper.find('.bouton-menu')

    expect(bouton.find('.lucide-menu').exists()).toBe(true)
    expect(bouton.find('.lucide-x').exists()).toBe(false)

    await bouton.trigger('click')
    expect(bouton.find('.lucide-x').exists()).toBe(true)
    expect(bouton.find('.lucide-menu').exists()).toBe(false)
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

  it('renders the search panel as a sibling of the header, never nested inside it (#270)', async () => {
    const { wrapper } = await montage()

    await wrapper.find('.bouton-recherche').trigger('click')
    await wrapper.vm.$nextTick()

    const panneau = wrapper.find('.recherche-superposee')
    expect(panneau.element.parentElement).toBe(wrapper.find('.en-tete').element.parentElement)
    expect(wrapper.find('.en-tete').element.contains(panneau.element)).toBe(false)
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

  it('stays open on a click inside the panel — the panel is now a sibling, `conteneurRecherche` no longer wraps it (#270)', async () => {
    const { wrapper } = await montage()

    await wrapper.find('.bouton-recherche').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.recherche-superposee').exists()).toBe(true)

    wrapper
      .find('.recherche-superposee-interieur')
      .element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.recherche-superposee').exists()).toBe(true)
    expect(wrapper.find('.bouton-recherche').attributes('aria-expanded')).toBe('true')
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

describe('AppHeader — le wait-set de la coquille (T3, #299)', () => {
  /** Un chargeur qui ne résout QUE le wait-set de la coquille — tout le reste pend. */
  const chargerCoquilleSeule: ChargerFichier = (fichier) => {
    if (fichier === 'territoires') return Promise.resolve(territoiresFixture)
    if (fichier === 'run-report') return Promise.resolve(runReportFraisFixture)
    return new Promise<unknown>(() => {})
  }

  it('rend la recherche vivante quand seuls territoires + run-report ont atterri — le reste coule en arrière-plan', async () => {
    const { wrapper } = await montage('/carte', {
      provide: { [PAYLOAD_CHARGER_KEY]: chargerCoquilleSeule },
    })
    await flushPromises()

    await wrapper.find('.bouton-recherche').trigger('click')
    await wrapper.vm.$nextTick()

    const input = wrapper.find('.recherche-superposee input[role="combobox"]')
    await input.trigger('focus')
    await input.setValue('epci')
    await new Promise((r) => setTimeout(r, 300))

    const options = wrapper.findAll('[role="option"]')
    expect(options.length).toBeGreaterThan(0)
    expect(options[0].text()).toContain('EPCI')
    // Le wait-set est réglé → ni spinner de chargement ni erreur, même si le reste pend.
    expect(wrapper.find('.recherche-superposee .global-search__spinner').exists()).toBe(false)
    expect(wrapper.find('.recherche-superposee .global-search__etat--erreur').exists()).toBe(false)
  })

  it('un échec d’arrière-plan (indicateurs_habitat) ne fait jamais passer la recherche en erreur — seul le wait-set compte', async () => {
    const chargerEchecArrierePlan: ChargerFichier = async (fichier) => {
      if (fichier === 'indicateurs_habitat') {
        throw new PayloadError('fetch', 'indicateurs_habitat.json', 'panne réseau')
      }
      return charger(fichier)
    }
    const { wrapper } = await montage('/carte', {
      provide: { [PAYLOAD_CHARGER_KEY]: chargerEchecArrierePlan },
    })
    await flushPromises()

    await wrapper.find('.bouton-recherche').trigger('click')
    await wrapper.vm.$nextTick()

    const input = wrapper.find('.recherche-superposee input[role="combobox"]')
    await input.trigger('focus')
    await wrapper.vm.$nextTick()

    // Requête vide + focus : une erreur de payload ouvrirait le panneau en
    // erreur — l'échec d'arrière-plan ne doit pas y arriver.
    expect(wrapper.find('.recherche-superposee .global-search__etat--erreur').exists()).toBe(false)

    // Et la recherche fonctionne malgré l'échec d'arrière-plan.
    await input.setValue('epci')
    await new Promise((r) => setTimeout(r, 300))
    expect(wrapper.findAll('[role="option"]').length).toBeGreaterThan(0)
  })

  it('un échec de wait-set (territoires) → l’erreur typée dans la recherche, jamais de résultats', async () => {
    const chargerEchecTerritoires: ChargerFichier = async (fichier) => {
      if (fichier === 'territoires') {
        throw new PayloadError('fetch', 'territoires.json', 'panne réseau')
      }
      return charger(fichier)
    }
    const { wrapper } = await montage('/carte', {
      provide: { [PAYLOAD_CHARGER_KEY]: chargerEchecTerritoires },
    })
    await flushPromises()

    await wrapper.find('.bouton-recherche').trigger('click')
    await wrapper.vm.$nextTick()

    const input = wrapper.find('.recherche-superposee input[role="combobox"]')
    await input.trigger('focus')
    await wrapper.vm.$nextTick()

    const erreur = wrapper.find('.recherche-superposee .global-search__etat--erreur')
    expect(erreur.exists()).toBe(true)
    expect(erreur.text()).toContain('Impossible de charger les territoires.')
    expect(wrapper.findAll('[role="option"]')).toHaveLength(0)
  })
})
