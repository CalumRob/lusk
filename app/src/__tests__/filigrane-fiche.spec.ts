import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import FiligraneFiche from '../components/fiche/FiligraneFiche.vue'
import { FILIGRANE_ALEA_KEY, RAPPORT_ERMINE } from '../fiche/filigrane'

/**
 * FiligraneFiche — the fiche watermark (DESIGN.md §7): the locked ermine
 * behind the tab content, ink kept, accents in the active theme's anchor,
 * whole-mark opacity from the token, size/position drawn once per mount
 * (re-renders never move it; a remount re-draws).
 */

function boite(zone: { largeur: number; hauteur: number }): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: zone.largeur,
    bottom: zone.hauteur,
    width: zone.largeur,
    height: zone.hauteur,
    toJSON: () => ({}),
  } as DOMRect)
}

function aleaAvec(valeurs: number[]): () => number {
  let i = 0
  return () => valeurs[i++ % valeurs.length]
}

function valeurStyle(style: string | undefined, propriete: string): string | null {
  if (!style) return null
  const m = style.match(new RegExp(`${propriete}:\\s*([^;]+)`))
  return m ? m[1].trim() : null
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('FiligraneFiche — rendu', () => {
  it('renders the locked ermine (5 paths) as a decorative background mark', async () => {
    boite({ largeur: 1000, hauteur: 800 })
    const wrapper = mount(FiligraneFiche, {
      props: { theme: null },
      global: { provide: { [FILIGRANE_ALEA_KEY]: aleaAvec([0.5, 0.5, 0.5]) } },
    })
    await flushPromises()

    expect(wrapper.attributes('aria-hidden')).toBe('true')
    expect(wrapper.classes()).toContain('filigrane-fiche')
    expect(wrapper.find('svg').attributes('focusable')).toBe('false')
    expect(wrapper.findAll('svg path')).toHaveLength(5)
    expect(valeurStyle(wrapper.attributes('style'), 'opacity')).toBe(
      'var(--filigrane-opacity)',
    )
  })

  it('keeps the ink fills at the locked ink color', async () => {
    boite({ largeur: 1000, hauteur: 800 })
    const wrapper = mount(FiligraneFiche, {
      props: { theme: null },
      global: { provide: { [FILIGRANE_ALEA_KEY]: aleaAvec([0.5, 0.5, 0.5]) } },
    })
    await flushPromises()

    const remplissages = wrapper
      .findAll('svg path')
      .map((p) => p.attributes('fill'))
    expect(remplissages.filter((f) => f === '#1B1B19')).toHaveLength(2)
    expect(remplissages.filter((f) => f === 'var(--filigrane-accent)')).toHaveLength(3)
  })
})

describe('FiligraneFiche — couleur d’accent', () => {
  it('uses the brand anchor on Aperçu (theme null) — the canonical lockup colors', async () => {
    boite({ largeur: 1000, hauteur: 800 })
    const wrapper = mount(FiligraneFiche, {
      props: { theme: null },
      global: { provide: { [FILIGRANE_ALEA_KEY]: aleaAvec([0.5, 0.5, 0.5]) } },
    })
    await flushPromises()

    expect(valeurStyle(wrapper.attributes('style'), '--filigrane-accent')).toBe(
      'var(--brand-500)',
    )
  })

  it('uses the theme’s anchor on a theme tab', async () => {
    boite({ largeur: 1000, hauteur: 800 })
    const wrapper = mount(FiligraneFiche, {
      props: { theme: 'demographie' },
      global: { provide: { [FILIGRANE_ALEA_KEY]: aleaAvec([0.5, 0.5, 0.5]) } },
    })
    await flushPromises()

    expect(valeurStyle(wrapper.attributes('style'), '--filigrane-accent')).toBe(
      'var(--theme-demographie-line)',
    )
  })
})

describe('FiligraneFiche — le tirage', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true })
    boite({ largeur: 1000, hauteur: 800 })
  })

  it('positions and sizes per the draw, inside the content area', async () => {
    const wrapper = mount(FiligraneFiche, {
      props: { theme: null },
      global: { provide: { [FILIGRANE_ALEA_KEY]: aleaAvec([0.5, 0.5, 0.5]) } },
    })
    await flushPromises()

    const style = wrapper.attributes('style')
    // viewport 1024 → bornes [245.76, 655.36] → alea 0.5 → largeur 450.56
    expect(parseFloat(valeurStyle(style, 'left')!)).toBeCloseTo(274.72, 1)
    expect(parseFloat(valeurStyle(style, 'width')!)).toBeCloseTo(450.56, 1)
    expect(parseFloat(valeurStyle(style, 'top')!)).toBeCloseTo(
      0.5 * (800 - 450.56 * RAPPORT_ERMINE),
      1,
    )
  })

  it('stays put across re-renders within the same mount (draw-once)', async () => {
    const wrapper = mount(FiligraneFiche, {
      props: { theme: null },
      global: { provide: { [FILIGRANE_ALEA_KEY]: aleaAvec([0.5, 0.5, 0.5]) } },
    })
    await flushPromises()
    const avant = valeurStyle(wrapper.attributes('style'), 'left')

    await wrapper.setProps({ theme: 'habitat' })

    expect(valeurStyle(wrapper.attributes('style'), 'left')).toBe(avant)
    expect(valeurStyle(wrapper.attributes('style'), '--filigrane-accent')).toBe(
      'var(--theme-habitat-line)',
    )
  })

  it('re-draws on a fresh mount (new tab switch = new position)', async () => {
    const premiere = mount(FiligraneFiche, {
      props: { theme: null },
      global: { provide: { [FILIGRANE_ALEA_KEY]: aleaAvec([0.1, 0.1, 0.1]) } },
    })
    await flushPromises()
    const gauche1 = valeurStyle(premiere.attributes('style'), 'left')
    premiere.unmount()

    const seconde = mount(FiligraneFiche, {
      props: { theme: null },
      global: { provide: { [FILIGRANE_ALEA_KEY]: aleaAvec([0.9, 0.9, 0.9]) } },
    })
    await flushPromises()
    const gauche2 = valeurStyle(seconde.attributes('style'), 'left')

    expect(gauche1).not.toBe(gauche2)
  })
})
