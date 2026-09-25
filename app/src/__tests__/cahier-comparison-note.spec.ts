import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'

import {
  OPTIONS_COMPARAISON_KEY,
  type OptionContexteComparaison,
  type PrésentationPortéeComparaison,
} from '@/fiche/comparisonContext'
import CahierComparisonNote from '@/fiche/prototype/CahierComparisonNote.vue'

const options: readonly OptionContexteComparaison[] = [
  {
    mode: 'densite',
    label: 'grands centres urbains bretons',
    description: 'Classe définie par l’Insee selon le nombre d’habitants et leur concentration sur le territoire communal.',
  },
  { mode: 'epci', label: 'communes de EPCI X', description: null },
  { mode: 'bretagne', label: 'communes bretonnes', description: null },
]

async function monter(props: {
  label?: string
  scopeKind?: PrésentationPortéeComparaison
} = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  await router.push('/?comparaison=epci')
  await router.isReady()
  const wrapper = mount(CahierComparisonNote, {
    attachTo: document.body,
    props: {
      label: 'Comparaison indisponible — moyenne des communes de EPCI X',
      ...props,
    },
    global: {
      plugins: [router],
      provide: { [OPTIONS_COMPARAISON_KEY as symbol]: ref(options) },
    },
  })
  return { router, wrapper }
}

describe('CahierComparisonNote', () => {
  it('keeps an unavailable comparison selectable', async () => {
    const { router, wrapper } = await monter()
    const selector = wrapper.get('.cahier-comparison-note')
    const trigger = selector.get('button[aria-haspopup="listbox"]')

    expect(selector.text()).toContain('Comparaison indisponible — moyenne des communes de EPCI X')
    expect(trigger.attributes('aria-current')).toBe('true')
    expect(trigger.attributes('aria-label')).toBe('Contexte de comparaison sélectionné : communes de EPCI X')
    await trigger.trigger('click')
    expect(selector.get('[role="option"][aria-selected="true"]').text()).toBe('communes de EPCI X')

    expect(selector.findAll('[role="option"][aria-selected="false"] .cahier-comparison-note__option-label').map((option) => option.text())).toEqual([
      'grands centres urbains bretons',
      'communes bretonnes',
    ])

    const densityOption = selector.find('[role="option"][aria-selected="false"]')
    expect(densityOption.attributes('aria-describedby')).toContain('densite-help')
    expect(selector.text()).toContain('Classe définie par l’Insee')

    await selector.findAll('[role="option"][aria-selected="false"]')[1]!.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.comparaison).toBe('bretagne')
    wrapper.unmount()
  })

  it('opens and moves through alternatives with the keyboard', async () => {
    const { wrapper } = await monter()
    const selector = wrapper.get('.cahier-comparison-note')
    const trigger = selector.get('button[aria-haspopup="listbox"]')

    await trigger.trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(selector.find('[role="option"][aria-selected="false"]').element)

    await selector.find('[role="option"][aria-selected="false"]').trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(selector.findAll('[role="option"][aria-selected="false"]')[1]!.element)

    await selector.findAll('[role="option"][aria-selected="false"]')[1]!.trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger.element)
    wrapper.unmount()
  })

  it('underline only the mutable territory scope for building comparisons', async () => {
    const { wrapper } = await monter({
      label: 'Groupe comparé : bâtiments des communes de EPCI X',
      scopeKind: 'bâtiments',
    })
    const selector = wrapper.get('.cahier-comparison-note')

    expect(selector.get('.cahier-comparison-note__phrase').text()).toBe('Groupe comparé :')
    expect(selector.get('.cahier-comparison-note__fixed').text()).toBe('bâtiments des')
    expect(selector.get('.cahier-comparison-note__scope').text()).toBe('communes de EPCI X')

    await selector.get('button[aria-haspopup="listbox"]').trigger('click')
    expect(selector.findAll('[role="option"][aria-selected="false"] .cahier-comparison-note__option-label').map((option) => option.text())).toEqual([
      'bâtiments des grands centres urbains bretons',
      'bâtiments des communes bretonnes',
    ])
    wrapper.unmount()
  })
})
