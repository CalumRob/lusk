import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import GlobalSearchBar from '../components/GlobalSearchBar.vue'
import { territoiresFixture } from '../payload/fixtures'
import type { Territoire } from '../payload/types'
import type { EntreeRechercheIndicateur } from '../search/recherche'
import { routes } from '../router'
import AccueilView from '../views/AccueilView.vue'

/**
 * GlobalSearchBar — the search into any fiche (ui-elements.md §Search).
 * A single untitled search box (#64) — the placeholder carries the
 * affordance, no tabs row. These tests pin the keyboard contract (arrows
 * move the active option via aria-activedescendant, Enter opens, Escape
 * closes), the navigation to /territoire/:type/:id, and the state machine
 * (debounced loading spinner, empty state, error state).
 */

const INPUT = 'input[role="combobox"]'

function monterRecherche(
  territoires: Territoire[] = territoiresFixture,
  props: Record<string, unknown> = {},
) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  const wrapper = mount(GlobalSearchBar, {
    props: { territoires, ...props },
    global: { plugins: [router] },
  })
  return { wrapper, router }
}

/** Type a query: focus the input, set the value, wait out the debounce. */
async function taper(wrapper: ReturnType<typeof mount>, texte: string) {
  const input = wrapper.find(INPUT)
  await input.trigger('focus')
  await input.setValue(texte)
  await nextTick()
  vi.advanceTimersByTime(300)
  await nextTick()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GlobalSearchBar — structure', () => {
  it('renders the combobox with the French placeholder and label', () => {
    const { wrapper } = monterRecherche()
    const input = wrapper.find(INPUT)

    expect(input.exists()).toBe(true)
    expect(input.attributes('placeholder')).toBe('Rechercher un territoire…')
    expect(input.attributes('aria-label')).toBe('Rechercher un territoire par son nom')
    expect(input.attributes('role')).toBe('combobox')
    expect(input.attributes('aria-autocomplete')).toBe('list')
    expect(input.attributes('aria-expanded')).toBe('false')
  })

  it('has no tabs row — a single untitled search box', () => {
    const { wrapper } = monterRecherche()

    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0)
    expect(wrapper.find('.global-search__tabs').exists()).toBe(false)
    expect(wrapper.findAll('input[type="text"]')).toHaveLength(1)
  })

  it('closes the dropdown when focus leaves the component', async () => {
    const { wrapper } = monterRecherche()
    await taper(wrapper, 'epci')
    expect(wrapper.find('.global-search__dropdown').exists()).toBe(true)

    await wrapper.find(INPUT).trigger('focusout')
    await nextTick()

    expect(wrapper.find('.global-search__dropdown').exists()).toBe(false)
    expect(wrapper.find(INPUT).attributes('aria-expanded')).toBe('false')
  })
})

describe('GlobalSearchBar — debounced search and states', () => {
  it('shows a loading spinner during the debounce, then the results', async () => {
    const { wrapper } = monterRecherche()
    const input = wrapper.find(INPUT)

    await input.trigger('focus')
    await input.setValue('epci')
    await nextTick()

    expect(wrapper.find('.global-search__spinner').exists()).toBe(true)

    vi.advanceTimersByTime(300)
    await nextTick()

    expect(wrapper.find('.global-search__spinner').exists()).toBe(false)
    expect(wrapper.findAll('[role="option"]')).toHaveLength(2)
  })

  it('searches the territoires reference table by name', async () => {
    const { wrapper } = monterRecherche()
    await taper(wrapper, 'epci')

    const options = wrapper.findAll('[role="option"]')
    const textes = options.map((o) => o.text())
    expect(textes.some((t) => t.includes('EPCI X'))).toBe(true)
    expect(textes.some((t) => t.includes('EPCI Y'))).toBe(true)
    // each row carries its French type chip and the page action
    expect(options[0].find('.global-search__chip').text()).toBe('EPCI')
    expect(options[0].find('.global-search__action').text()).toBe('Voir la page')
  })

  it('matches accent-insensitively — "departement" finds the Départements', async () => {
    const { wrapper } = monterRecherche()
    await taper(wrapper, 'departement')

    const textes = wrapper.findAll('[role="option"]').map((o) => o.text())
    expect(textes.some((t) => t.includes('Département 22'))).toBe(true)
    expect(textes.some((t) => t.includes('Département 29'))).toBe(true)
    // the type chip disambiguates the Département rows from the rest
    expect(wrapper.find('.global-search__chip').text()).toBe('Département')
  })

  it('shows the empty state when nothing matches', async () => {
    const { wrapper } = monterRecherche()
    await taper(wrapper, 'zzzz')

    expect(wrapper.findAll('[role="option"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('Aucun résultat trouvé.')
  })

  it('shows the host-driven loading spinner while the payload loads', () => {
    const { wrapper } = monterRecherche(territoiresFixture, { chargement: true })

    expect(wrapper.find('.global-search__spinner').exists()).toBe(true)
  })

  it('shows the muted error state with an icon when the payload failed', async () => {
    const { wrapper } = monterRecherche(territoiresFixture, {
      erreur: 'Impossible de charger les territoires.',
    })

    await wrapper.find(INPUT).trigger('focus')
    await nextTick()

    const etat = wrapper.find('.global-search__etat--erreur')
    expect(etat.exists()).toBe(true)
    expect(etat.text()).toContain('Impossible de charger les territoires.')
    expect(etat.find('svg').exists()).toBe(true)
  })

  it('clears the query with the effacer button', async () => {
    const { wrapper } = monterRecherche()
    const input = wrapper.find(INPUT)
    await taper(wrapper, 'epci')
    expect(wrapper.find('.global-search__effacer').exists()).toBe(true)

    await wrapper.find('.global-search__effacer').trigger('click')
    await nextTick()

    expect((input.element as HTMLInputElement).value).toBe('')
    expect(wrapper.find('.global-search__dropdown').exists()).toBe(false)
  })
})

describe('GlobalSearchBar — keyboard navigation and opening', () => {
  it('moves the active option with ArrowDown / ArrowUp (aria-activedescendant)', async () => {
    const { wrapper } = monterRecherche()
    const input = wrapper.find(INPUT)
    await taper(wrapper, 'epci')

    await input.trigger('keydown', { key: 'ArrowDown' })
    await nextTick()
    expect(input.attributes('aria-activedescendant')).toBe('gsb-option-0')
    expect(wrapper.findAll('[role="option"]')[0].classes()).toContain('is-actif')

    await input.trigger('keydown', { key: 'ArrowDown' })
    await nextTick()
    expect(input.attributes('aria-activedescendant')).toBe('gsb-option-1')
    expect(wrapper.findAll('[role="option"]')[1].classes()).toContain('is-actif')

    await input.trigger('keydown', { key: 'ArrowUp' })
    await nextTick()
    expect(input.attributes('aria-activedescendant')).toBe('gsb-option-0')
  })

  it('wraps around: ArrowUp from the first result selects the last', async () => {
    const { wrapper } = monterRecherche()
    const input = wrapper.find(INPUT)
    await taper(wrapper, 'epci')

    await input.trigger('keydown', { key: 'ArrowUp' })
    await nextTick()

    expect(input.attributes('aria-activedescendant')).toBe('gsb-option-1')
  })

  it('Enter opens the first result — navigating to /territoire/:type/:id', async () => {
    const { wrapper, router } = monterRecherche()
    const input = wrapper.find(INPUT)
    await taper(wrapper, 'epci')

    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/territoire/epci/200000001')
    expect(router.currentRoute.value.params.id).toBe('200000001')
  })

  it('Enter opens the highlighted result, not always the first', async () => {
    const { wrapper, router } = monterRecherche()
    const input = wrapper.find(INPUT)
    await taper(wrapper, 'epci')
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'ArrowDown' })
    await nextTick()

    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/territoire/epci/200000002')
  })

  it('emits select with the opened territoire on Enter', async () => {
    const { wrapper } = monterRecherche()
    const input = wrapper.find(INPUT)
    await taper(wrapper, 'epci')

    await input.trigger('keydown', { key: 'Enter' })

    const select = wrapper.emitted('select')
    expect(select).toBeTruthy()
    expect(select?.[0][0]).toMatchObject({ territoire: '200000001', type: 'epci', nom: 'EPCI X' })
  })

  it('clears the query after navigating', async () => {
    const { wrapper } = monterRecherche()
    const input = wrapper.find(INPUT)
    await taper(wrapper, 'epci')

    await input.trigger('keydown', { key: 'Enter' })
    await nextTick()

    expect((input.element as HTMLInputElement).value).toBe('')
  })

  it('Escape closes the dropdown and keeps the input', async () => {
    const { wrapper } = monterRecherche()
    const input = wrapper.find(INPUT)
    await taper(wrapper, 'epci')

    await input.trigger('keydown', { key: 'Escape' })
    await nextTick()

    expect(wrapper.find('.global-search__dropdown').exists()).toBe(false)
    expect(input.attributes('aria-expanded')).toBe('false')
    expect((input.element as HTMLInputElement).value).toBe('epci')
  })

  it('clicking a result row navigates to its fiche', async () => {
    const { wrapper, router } = monterRecherche()
    await taper(wrapper, 'epci')

    await wrapper.findAll('[role="option"]')[1].trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/territoire/epci/200000002')
    const select = wrapper.emitted('select')
    expect(select?.[0][0]).toMatchObject({ territoire: '200000002', nom: 'EPCI Y' })
  })
})

describe('GlobalSearchBar — le mode sans navigation (la carte zoome, #283)', () => {
  it('renders the results as buttons — never RouterLinks — in sans-navigation mode', async () => {
    const { wrapper } = monterRecherche(territoiresFixture, { sansNavigation: true })
    await taper(wrapper, 'epci')

    const options = wrapper.findAll('[role="option"]')
    expect(options.length).toBeGreaterThan(0)
    for (const option of options) {
      expect(option.element.tagName).toBe('BUTTON')
    }
    expect(options[0].find('.global-search__action').text()).toBe('Sur la carte')
  })

  it('emits select WITHOUT navigating on Enter in sans-navigation mode', async () => {
    const { wrapper, router } = monterRecherche(territoiresFixture, { sansNavigation: true })
    const input = wrapper.find(INPUT)
    await taper(wrapper, 'epci')

    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    const select = wrapper.emitted('select')
    expect(select).toBeTruthy()
    expect(select?.[0][0]).toMatchObject({ territoire: '200000001', type: 'epci', nom: 'EPCI X' })
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('clicking a result row emits select without navigating in sans-navigation mode', async () => {
    const { wrapper, router } = monterRecherche(territoiresFixture, { sansNavigation: true })
    await taper(wrapper, 'epci')

    await wrapper.findAll('[role="option"]')[1].trigger('click')
    await flushPromises()

    expect(wrapper.emitted('select')?.[0][0]).toMatchObject({ territoire: '200000002', nom: 'EPCI Y' })
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('keeps the keyboard contract (ArrowDown active option, Enter emits) in sans-navigation mode', async () => {
    const { wrapper } = monterRecherche(territoiresFixture, { sansNavigation: true })
    const input = wrapper.find(INPUT)
    await taper(wrapper, 'epci')

    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'ArrowDown' })
    await nextTick()
    expect(input.attributes('aria-activedescendant')).toBe('gsb-option-1')

    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('select')?.[0][0]).toMatchObject({ territoire: '200000002' })
  })

  it('the default mode keeps the RouterLink rows — the header and landing instances still navigate', async () => {
    const { wrapper } = monterRecherche()
    await taper(wrapper, 'epci')

    const options = wrapper.findAll('[role="option"]')
    expect(options.length).toBeGreaterThan(0)
    expect(options[0].element.tagName).toBe('A')
    expect(options[0].find('.global-search__action').text()).toBe('Voir la page')
  })
})

describe('GlobalSearchBar — la recherche groupée Territoires + Indicateurs (#409)', () => {
  const INDICATEURS: EntreeRechercheIndicateur[] = [
    {
      theme: 'demographie',
      themeLabel: 'Démographie',
      label: 'Densité de population',
      href: '/indicateurs/demographie/densite',
    },
    {
      theme: 'habitat',
      themeLabel: 'Habitat',
      label: 'Médiane prix au m²',
      href: '/indicateurs/habitat/prix_m2',
    },
  ]

  function monterGroupee() {
    return monterRecherche(territoiresFixture, { indicateurs: INDICATEURS })
  }

  it('groupe les résultats sous « Territoires » puis « Indicateurs », avec des titres de groupe accessibles', async () => {
    const { wrapper } = monterGroupee()
    await taper(wrapper, 'densite')

    // La requête ne touche que le catalogue : le seul groupe rendu est Indicateurs.
    expect(wrapper.findAll('[role="group"]').map((g) => g.attributes('aria-label'))).toEqual([
      'Indicateurs',
    ])

    // Une requête qui ne touche que les territoires : le seul groupe rendu est Territoires.
    await taper(wrapper, 'epci')
    expect(wrapper.findAll('[role="group"]').map((g) => g.attributes('aria-label'))).toEqual([
      'Territoires',
    ])

    // Une requête qui traverse les deux groupes rend les DEUX titres, dans l'ordre.
    const { wrapper: deuxGroupes } = monterGroupee()
    await taper(deuxGroupes, 'e')
    const labels = deuxGroupes.findAll('[role="group"]').map((groupe) => groupe.attributes('aria-label'))
    expect(labels).toEqual(['Territoires', 'Indicateurs'])
    expect(deuxGroupes.findAll('[role="option"]').length).toBeGreaterThan(2)
  })

  it('fait traverser le clavier les deux groupes — la liste plate continue au-delà des territoires', async () => {
    const { wrapper } = monterGroupee()
    const input = wrapper.find(INPUT)
    await taper(wrapper, 'e')

    // ArrowDown jusqu'à la dernière option TERRITOIRE…
    const total = wrapper.findAll('[role="option"]').length
    for (let press = 1; press < total; press++) {
      await input.trigger('keydown', { key: 'ArrowDown' })
      await nextTick()
      expect(input.attributes('aria-activedescendant')).toBe(`gsb-option-${press - 1}`)
    }
    // La liste plate traverse les groupes : la dernière option du DOM est une
    // entrée Indicateur portant l'id plat (total - 1).
    const derniere = wrapper.findAll('[role="option"]')[total - 1]!
    expect(derniere.attributes('id')).toBe(`gsb-option-${total - 1}`)
    expect(derniere.text()).toContain('Densité de population')
  })

  it('Enter sur une entrée Indicateurs navigue vers sa page et émet select-indicateur', async () => {
    const { wrapper, router } = monterGroupee()
    const input = wrapper.find(INPUT)
    await taper(wrapper, 'densite')

    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/indicateurs/demographie/densite')
    const selectIndicateur = wrapper.emitted('select-indicateur')
    expect(selectIndicateur).toBeTruthy()
    expect(selectIndicateur?.[0][0]).toMatchObject({ theme: 'demographie', href: '/indicateurs/demographie/densite' })
    expect((input.element as HTMLInputElement).value).toBe('')
  })

  it('le clic sur une ligne Indicateur navigue pareillement', async () => {
    const { wrapper, router } = monterGroupee()
    await taper(wrapper, 'prix')

    const options = wrapper.findAll('[role="option"]')
    await options[options.length - 1]!.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/indicateurs/habitat/prix_m2')
    expect(wrapper.emitted('select-indicateur')?.[0][0]).toMatchObject({ theme: 'habitat' })
  })

  it('les lignes Indicateur portent le libellé canon et le thème — jamais une clé brute', async () => {
    const { wrapper } = monterGroupee()
    await taper(wrapper, 'densite')

    const option = wrapper.findAll('[role="option"]')[0]
    expect(option!.text()).toContain('Densité de population')
    expect(option!.text()).toContain('Démographie')
    expect(option!.text()).not.toContain('densite')
    expect(option!.find('.global-search__action').text()).toBe('Voir l’indicateur')
  })

  it('sans prop indicateurs — la recherche du héros et de la carte reste territoire-only', async () => {
    const { wrapper } = monterRecherche()
    await taper(wrapper, 'densite')
    expect(wrapper.findAll('[role="group"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('Aucun résultat trouvé.')
    // Le mode groupé n'a jamais été activé : le comportement historique tient.
    await taper(wrapper, 'epci')
    expect(wrapper.findAll('[role="group"]')).toHaveLength(0)
    expect(wrapper.findAll('[role="option"]')).toHaveLength(2)
  })

  it('le clavier historique tient dans le mode groupé : Enter sur un territoire ouvre la fiche', async () => {
    const { wrapper, router } = monterGroupee()
    const input = wrapper.find(INPUT)
    await taper(wrapper, 'epci')

    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/territoire/epci/200000001')
    expect(wrapper.emitted('select')).toBeTruthy()
  })
})

describe('AccueilView — la recherche du héros (D3 landing)', () => {
  it('renders the single untitled search in the landing hero — no tabs row', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/')
    const wrapper = mount(AccueilView, { global: { plugins: [router] } })

    const input = wrapper.find(INPUT)
    expect(input.exists()).toBe(true)
    expect(input.attributes('aria-label')).toBe('Rechercher un territoire par son nom')
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0)
    expect(wrapper.findAll('input[type="text"]')).toHaveLength(1)
  })

  it('surfaces a payload failure through the search error state', async () => {
    // fetch is stubbed to 404 (setup.ts) — the loader's typed error path
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/')
    const wrapper = mount(AccueilView, { global: { plugins: [router] } })
    await flushPromises()

    await wrapper.find(INPUT).trigger('focus')
    await nextTick()

    const etat = wrapper.find('.global-search__etat--erreur')
    expect(etat.exists()).toBe(true)
    expect(etat.text()).toContain('Impossible de charger les données.')
  })
})
