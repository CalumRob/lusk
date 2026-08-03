import { mount } from '@vue/test-utils'

import { createMemoryHistory, createRouter } from 'vue-router'

import { describe, expect, it } from 'vitest'

import ContexteSwitcher from '../components/fiche/ContexteSwitcher.vue'
import { territoiresFixture } from '../payload/fixtures'
import { routes } from '../router'
import type { Territoire } from '../payload/types'

/**
 * ContexteSwitcher — the rank-in-context ladder (site-map.md §Fiche):
 * commune → son EPCI → son département → la région. It receives the computed
 * ladder (echelleContexte — pure, tested separately) and renders the steps as
 * fiche links, the current territory as a non-link with aria-current="page",
 * chevrons between steps. Steps that don't apply never reach this component.
 *
 * Fixture references: [3] Commune C (29002), [5] EPCI Y, [7] Département 29,
 * [8] Bretagne — the full ladder of Commune C.
 */

function monter(echelons: Territoire[]) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  return mount(ContexteSwitcher, {
    props: { echelons },
    global: { plugins: [router] },
  })
}

describe('ContexteSwitcher — the context ladder UI', () => {
  it('renders the parent steps as links to their fiche, in order', () => {
    const wrapper = monter([territoiresFixture[3], territoiresFixture[5], territoiresFixture[7], territoiresFixture[8]])

    // l'échelon courant est un span (aria-current), les parents sont des liens
    expect(wrapper.find('[aria-current="page"]').text()).toBe('Commune C')
    const liens = wrapper.findAll('a')
    expect(liens.map((l) => l.text())).toEqual(['EPCI Y', 'Département 29', 'Bretagne'])
    expect(liens[0].attributes('href')).toBe('/territoire/epci/200000002')
    expect(liens[1].attributes('href')).toBe('/territoire/departement/29')
    expect(liens[2].attributes('href')).toBe('/territoire/region/53')
  })

  it('marks the current territory as the page (non-link, aria-current)', () => {
    const wrapper = monter([territoiresFixture[3], territoiresFixture[5]])

    const actuel = wrapper.find('[aria-current="page"]')
    expect(actuel.exists()).toBe(true)
    expect(actuel.text()).toBe('Commune C')
    expect(actuel.element.tagName).toBe('SPAN')
    expect(wrapper.findAll('a').map((l) => l.text())).toEqual(['EPCI Y'])
  })

  it('separates the steps with chevrons', () => {
    const wrapper = monter([territoiresFixture[0], territoiresFixture[4], territoiresFixture[8]])

    // 2 séparateurs pour 3 échelons, placés entre les étapes
    expect(wrapper.findAll('.contexte-switcher-separateur')).toHaveLength(2)
  })

  it('renders a single step (la région) without separators or links', () => {
    const wrapper = monter([territoiresFixture[8]])

    expect(wrapper.findAll('a')).toHaveLength(0)
    expect(wrapper.findAll('.contexte-switcher-separateur')).toHaveLength(0)
    expect(wrapper.find('[aria-current="page"]').text()).toBe('Bretagne')
  })

  it('renders nothing for an empty ladder', () => {
    const wrapper = monter([])

    expect(wrapper.text()).toBe('')
  })
})
