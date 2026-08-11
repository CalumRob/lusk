import { mount } from '@vue/test-utils'
import { BookOpen, Database, Landmark } from 'lucide-vue-next'

import { afterEach, describe, expect, it } from 'vitest'

import ThemeTabs from '../components/ThemeTabs.vue'
import type { SlugOnglet } from '../fiche/onglets'
import type { Theme } from '../payload/types'

/**
 * ThemeTabs — the payload-driven theme subheader (ADR-0007 + ui-elements.md
 * §ThemeTabs): Aperçu always first, then exactly the themes present in the
 * payload, in canonical order; the selected tab wears its theme (or the brand
 * ramp for Aperçu); keyboard-navigable (roving tabindex + arrows + Home/End);
 * emits the slug so the view owns the ?theme= URL.
 */

let montee: ReturnType<typeof mount> | null = null

function montage(themes: Theme[], selected: Theme | null = null) {
  const wrapper = mount(ThemeTabs, {
    props: { themes, selected },
    attachTo: document.body, // le focus (roving tabindex) exige le DOM réel
  })
  montee = wrapper
  return wrapper
}

afterEach(() => {
  montee?.unmount()
  montee = null
  document.body.innerHTML = ''
})

const textesOnglets = (wrapper: ReturnType<typeof mount>): string[] =>
  wrapper.findAll('[role="tab"]').map((o) => o.text().trim())

describe('ThemeTabs — the payload-driven tab bar', () => {
  it('renders Aperçu first, then the payload themes in canonical order', () => {
    const wrapper = montage(['demographie', 'habitat'])

    expect(textesOnglets(wrapper)).toEqual(['Aperçu', 'Démographie', 'Habitat'])
  })

  it('renders only Aperçu when no theme is present in the payload', () => {
    const wrapper = montage([])

    expect(textesOnglets(wrapper)).toEqual(['Aperçu'])
  })

  it('exposes a role=tablist with role=tab children', () => {
    const wrapper = montage(['demographie'])

    expect(wrapper.find('[role="tablist"]').exists()).toBe(true)
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(2)
  })

  it('selects Aperçu by default (absent ?theme=)', () => {
    const wrapper = montage(['demographie', 'habitat'])

    const apercu = wrapper.findAll('[role="tab"]')[0]
    expect(apercu.attributes('aria-selected')).toBe('true')
    for (const onglet of wrapper.findAll('[role="tab"]').slice(1)) {
      expect(onglet.attributes('aria-selected')).toBe('false')
    }
  })

  it('selects the theme passed in (the URL ?theme= state)', () => {
    const wrapper = montage(['demographie', 'habitat'], 'demographie')

    const demographie = wrapper.findAll('[role="tab"]')[1]
    expect(demographie.attributes('aria-selected')).toBe('true')
    expect(wrapper.findAll('[role="tab"]')[0].attributes('aria-selected')).toBe('false')
  })

  it('gives each tab a stable id and an aria-controls pointing at its panel', () => {
    const wrapper = montage(['demographie'])

    const demographie = wrapper.findAll('[role="tab"]')[1]
    expect(demographie.attributes('id')).toBe('onglet-demographie')
    expect(demographie.attributes('aria-controls')).toBe('panneau-demographie')
    expect(wrapper.findAll('[role="tab"]')[0].attributes('id')).toBe('onglet-apercu')
  })

  it('keeps only the selected tab in the tab order (roving tabindex)', () => {
    const wrapper = montage(['demographie', 'habitat'], 'demographie')

    const [apercu, demographie, habitat] = wrapper.findAll('[role="tab"]')
    expect(demographie.attributes('tabindex')).toBe('0')
    expect(apercu.attributes('tabindex')).toBe('-1')
    expect(habitat.attributes('tabindex')).toBe('-1')
  })
})

describe('ThemeTabs — the tab logic (URL state)', () => {
  it('emits the theme slug when a theme tab is clicked', async () => {
    const wrapper = montage(['demographie', 'habitat'])

    await wrapper.findAll('[role="tab"]')[1].trigger('click')

    expect(wrapper.emitted('select')).toEqual([['demographie']])
  })

  it('emits null (Aperçu) when the Aperçu tab is clicked', async () => {
    const wrapper = montage(['demographie'])

    await wrapper.findAll('[role="tab"]')[0].trigger('click')

    expect(wrapper.emitted('select')).toEqual([[null]])
  })
})

describe('ThemeTabs — le label du premier onglet (override, ADR-0019 #282)', () => {
  it('override le premier onglet pour la carte — « Programmes & financements » au lieu d’Aperçu', () => {
    const wrapper = mount(ThemeTabs, {
      props: {
        themes: ['demographie'],
        selected: 'programmes',
        libellePremier: 'Programmes & financements',
        premierSlug: 'programmes',
      },
      attachTo: document.body,
    })
    montee = wrapper

    expect(textesOnglets(wrapper)[0]).toBe('Programmes & financements')
    expect(textesOnglets(wrapper)[1]).toBe('Démographie')
  })

  it('émet « programmes » quand le premier onglet renommé est cliqué (l’état ?onglet= de la carte)', async () => {
    const wrapper = mount(ThemeTabs, {
      props: {
        themes: ['demographie'],
        selected: 'programmes',
        libellePremier: 'Programmes & financements',
        premierSlug: 'programmes',
      },
      attachTo: document.body,
    })
    montee = wrapper

    await wrapper.findAll('[role="tab"]')[0].trigger('click')

    expect(wrapper.emitted('select')).toEqual([['programmes']])
  })

  it('marque le premier onglet renommé sélectionné quand la carte le passe (aria-selected + roving tabindex)', () => {
    const wrapper = mount(ThemeTabs, {
      props: {
        themes: ['demographie'],
        selected: 'programmes',
        libellePremier: 'Programmes & financements',
        premierSlug: 'programmes',
      },
      attachTo: document.body,
    })
    montee = wrapper

    const premier = wrapper.findAll('[role="tab"]')[0]
    expect(premier.attributes('aria-selected')).toBe('true')
    expect(premier.attributes('tabindex')).toBe('0')
    expect(wrapper.findAll('[role="tab"]')[1].attributes('aria-selected')).toBe('false')
    expect(wrapper.findAll('[role="tab"]')[1].attributes('tabindex')).toBe('-1')
  })

  it('garde le slug du premier onglet dans ses ids stables — onglet-programmes / panneau-programmes', () => {
    const wrapper = mount(ThemeTabs, {
      props: {
        themes: [],
        selected: 'programmes',
        libellePremier: 'Programmes & financements',
        premierSlug: 'programmes',
      },
      attachTo: document.body,
    })
    montee = wrapper

    const premier = wrapper.findAll('[role="tab"]')[0]
    expect(premier.attributes('id')).toBe('onglet-programmes')
    expect(premier.attributes('aria-controls')).toBe('panneau-programmes')
  })

  it('les thèmes restent sélectionnables quand le premier onglet est renommé (Home → programmes, flèches → thème)', async () => {
    const wrapper = mount(ThemeTabs, {
      props: {
        themes: ['demographie', 'habitat'],
        selected: 'programmes',
        libellePremier: 'Programmes & financements',
        premierSlug: 'programmes',
      },
      attachTo: document.body,
    })
    montee = wrapper

    await wrapper.findAll('[role="tab"]')[0].trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('select')).toEqual([['demographie']])

    await wrapper.findAll('[role="tab"]')[1].trigger('keydown', { key: 'Home' })
    expect(wrapper.emitted('select')).toEqual([['demographie'], ['programmes']])
  })

  it('sans override, la fiche garde Aperçu qui émet null — le comportement hérité intact', () => {
    const wrapper = montage(['demographie'])

    expect(textesOnglets(wrapper)[0]).toBe('Aperçu')
    expect(wrapper.findAll('[role="tab"]')[0].attributes('id')).toBe('onglet-apercu')
  })
})

describe('ThemeTabs — keyboard navigation', () => {
  it('moves selection and focus with ArrowRight', async () => {
    const wrapper = montage(['demographie', 'habitat'])

    await wrapper.findAll('[role="tab"]')[0].trigger('keydown', { key: 'ArrowRight' })

    expect(wrapper.emitted('select')).toEqual([['demographie']])
    const demographie = wrapper.findAll('[role="tab"]')[1].element as HTMLElement
    expect(document.activeElement).toBe(demographie)
  })

  it('moves selection and focus with ArrowLeft', async () => {
    const wrapper = montage(['demographie', 'habitat'], 'demographie')

    await wrapper.findAll('[role="tab"]')[1].trigger('keydown', { key: 'ArrowLeft' })

    expect(wrapper.emitted('select')).toEqual([[null]])
    const apercu = wrapper.findAll('[role="tab"]')[0].element as HTMLElement
    expect(document.activeElement).toBe(apercu)
  })

  it('wraps around: ArrowLeft from the first tab selects the last', async () => {
    const wrapper = montage(['demographie', 'habitat'])

    await wrapper.findAll('[role="tab"]')[0].trigger('keydown', { key: 'ArrowLeft' })

    expect(wrapper.emitted('select')).toEqual([['habitat']])
  })

  it('wraps around: ArrowRight from the last tab selects Aperçu', async () => {
    const wrapper = montage(['demographie', 'habitat'], 'habitat')

    await wrapper.findAll('[role="tab"]')[2].trigger('keydown', { key: 'ArrowRight' })

    expect(wrapper.emitted('select')).toEqual([[null]])
  })

  it('Home selects the first tab, End the last', async () => {
    const wrapper = montage(['demographie', 'habitat'], 'demographie')

    await wrapper.findAll('[role="tab"]')[1].trigger('keydown', { key: 'End' })
    expect(wrapper.emitted('select')).toEqual([['habitat']])

    await wrapper.findAll('[role="tab"]')[2].trigger('keydown', { key: 'Home' })
    expect(wrapper.emitted('select')).toEqual([['habitat'], [null]])
  })
})

describe('ThemeTabs — les onglets supplémentaires (le shell Méthodes, #332)', () => {
  const ongletsMethodes = [
    { slug: 'methodes' as const, nom: 'Méthodes', icone: BookOpen },
    { slug: 'programmes' as const, nom: 'Programmes et subventions', icone: Landmark },
  ]

  function montageShell(selected: SlugOnglet = 'sources') {
    const wrapper = mount(ThemeTabs, {
      props: {
        themes: ['demographie'],
        selected,
        libellePremier: 'Sources',
        premierSlug: 'sources',
        iconePremier: Database,
        ongletsSupplementaires: ongletsMethodes,
      },
      attachTo: document.body,
    })
    montee = wrapper
    return wrapper
  }

  it('rend le premier onglet renommé, puis les onglets supplémentaires, puis les thèmes', () => {
    const wrapper = montageShell()

    expect(textesOnglets(wrapper)).toEqual([
      'Sources',
      'Méthodes',
      'Programmes et subventions',
      'Démographie',
    ])
  })

  it('marque un onglet supplémentaire sélectionné (aria-selected + roving tabindex)', () => {
    const wrapper = montageShell('methodes')

    const methodes = wrapper.findAll('[role="tab"]')[1]
    expect(methodes.attributes('aria-selected')).toBe('true')
    expect(methodes.attributes('tabindex')).toBe('0')
    expect(wrapper.findAll('[role="tab"]')[0].attributes('aria-selected')).toBe('false')
    expect(wrapper.findAll('[role="tab"]')[0].attributes('tabindex')).toBe('-1')
  })

  it('donne à chaque onglet supplémentaire un id stable et un aria-controls', () => {
    const wrapper = montageShell()

    const methodes = wrapper.findAll('[role="tab"]')[1]
    expect(methodes.attributes('id')).toBe('onglet-methodes')
    expect(methodes.attributes('aria-controls')).toBe('panneau-methodes')
    const programmes = wrapper.findAll('[role="tab"]')[2]
    expect(programmes.attributes('id')).toBe('onglet-programmes')
    expect(programmes.attributes('aria-controls')).toBe('panneau-programmes')
  })

  it('émet le slug d\u2019un onglet supplémentaire au clic (l\u2019état ?onglet= de Méthodes)', async () => {
    const wrapper = montageShell()

    await wrapper.findAll('[role="tab"]')[1].trigger('click')

    expect(wrapper.emitted('select')).toEqual([['methodes']])
  })

  it('la navigation clavier couvre les onglets supplémentaires (Home → premier, flèche → suivant)', async () => {
    const wrapper = montageShell('methodes')

    await wrapper.findAll('[role="tab"]')[1].trigger('keydown', { key: 'Home' })
    expect(wrapper.emitted('select')).toEqual([['sources']])

    // la sélection appartient au parent — re-montée sur le premier onglet, la
    // flèche droite avance vers l'onglet supplémentaire suivant
    const suivant = montageShell('sources')
    await suivant.findAll('[role="tab"]')[0].trigger('keydown', { key: 'ArrowRight' })
    expect(suivant.emitted('select')).toEqual([['methodes']])
  })

  it('sans onglets supplémentaires, le composant garde le comportement hérité (Aperçu + thèmes)', () => {
    const wrapper = montage(['demographie'])

    expect(textesOnglets(wrapper)).toEqual(['Aperçu', 'Démographie'])
  })
})

describe('ThemeTabs — le label de la barre et l\u2019icône du premier onglet (Méthodes, #332)', () => {
  it('porte un aria-label par défaut (« Thèmes de la fiche ») et le laisse remplacer', () => {
    const defaut = montage(['demographie'])
    expect(defaut.find('[role="tablist"]').attributes('aria-label')).toBe('Thèmes de la fiche')

    const remplace = mount(ThemeTabs, {
      props: {
        themes: [],
        selected: null,
        ariaLabel: 'Sections de la page Méthodes',
      },
      attachTo: document.body,
    })
    montee = remplace
    expect(remplace.find('[role="tablist"]').attributes('aria-label')).toBe(
      'Sections de la page Méthodes',
    )
  })

  it('rend une icône dans le premier onglet renommé (icone-premier)', () => {
    const wrapper = mount(ThemeTabs, {
      props: {
        themes: [],
        selected: 'sources',
        libellePremier: 'Sources',
        premierSlug: 'sources',
        iconePremier: Database,
      },
      attachTo: document.body,
    })
    montee = wrapper

    expect(wrapper.findAll('[role="tab"]')[0].find('svg').exists()).toBe(true)
  })
})
