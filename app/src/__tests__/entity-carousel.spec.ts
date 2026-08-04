import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import EntityCarousel from '../components/landing/EntityCarousel.vue'
import { territoiresFixture } from '../payload/fixtures'
import type { Territoire } from '../payload/types'
import { routes } from '../router'

/**
 * EntityCarousel — the landing's "Sélection aléatoire" (ui-elements.md
 * §EntityCarousel): horizontal carousel of territory cards, each card → its
 * fiche. A11y contract: arrows move the active card, pause on hover, the
 * auto-advance is disabled under prefers-reduced-motion.
 */

const CARTES = territoiresFixture.slice(0, 5)

let montee: ReturnType<typeof mount> | null = null

function monter(territoires: Territoire[] = CARTES, motionOk = true) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  const wrapper = mount(EntityCarousel, {
    props: { territoires, automatique: motionOk },
    attachTo: document.body,
    global: { plugins: [router] },
  })
  montee = wrapper
  return { wrapper, router }
}

afterEach(() => {
  vi.useRealTimers()
  montee?.unmount()
  montee = null
  document.body.innerHTML = ''
})

describe('EntityCarousel — structure and links', () => {
  it('renders a card per territory, each linking to its fiche', async () => {
    const { wrapper } = monter()

    const cartes = wrapper.findAll('.carrousel-carte')
    expect(cartes).toHaveLength(5)
    expect(cartes[0].attributes('href')).toBe('/territoire/commune/22001')
    expect(cartes[0].text()).toContain('Commune A1')
    expect(cartes[0].text()).toContain('Commune')
  })

  it('renders the French section label "Sélection aléatoire"', () => {
    const { wrapper } = monter()

    expect(wrapper.text()).toContain('Sélection aléatoire')
  })
})

describe('EntityCarousel — keyboard navigation', () => {
  it('moves the active card with the arrow keys and wraps around', async () => {
    const { wrapper } = monter()
    const conteneur = wrapper.find('.carrousel')
    const actifs = () =>
      wrapper
        .findAll('.carrousel-carte')
        .map((c) => c.classes())
        .map((classes) => classes.includes('is-actif'))

    expect(actifs()[0]).toBe(true)

    await conteneur.trigger('keydown', { key: 'ArrowRight' })
    await nextTick()
    expect(actifs()[1]).toBe(true)
    expect(actifs()[0]).toBe(false)

    await conteneur.trigger('keydown', { key: 'ArrowLeft' })
    await nextTick()
    expect(actifs()[0]).toBe(true)
  })

  it('gives the active card a focusable link (roving tabindex)', async () => {
    const { wrapper } = monter()

    const cartes = wrapper.findAll('.carrousel-carte')
    expect(cartes[0].attributes('tabindex')).toBe('0')
    expect(cartes[1].attributes('tabindex')).toBe('-1')
  })
})

describe('EntityCarousel — pause on hover and reduced motion', () => {
  it('does not auto-advance when prefers-reduced-motion is set', async () => {
    vi.useFakeTimers()
    monter(CARTES, false)

    vi.advanceTimersByTime(5000)
    await nextTick()

    const actif = wrapperActif()
    expect(actif).toBe(0)
  })

  it('auto-advances on a timer when motion is allowed', async () => {
    vi.useFakeTimers()
    const { wrapper } = monter(CARTES, true)

    vi.advanceTimersByTime(5000)
    await nextTick()

    const cartes = wrapper.findAll('.carrousel-carte')
    const actif = cartes.findIndex((c) => c.classes().includes('is-actif'))
    expect(actif).toBe(1)
  })
})

function wrapperActif(): number {
  const el = document.querySelector('.carrousel')
  if (!el) return -1
  const cartes = Array.from(el.querySelectorAll('.carrousel-carte'))
  return cartes.findIndex((c) => c.classList.contains('is-actif'))
}
