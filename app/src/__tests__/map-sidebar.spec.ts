import { mount } from '@vue/test-utils'

import { createMemoryHistory, createRouter } from 'vue-router'

import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import MapSidebar from '../components/carte/MapSidebar.vue'
import { COULEUR_CONTOUR, COULEUR_NEUTRE } from '../carte/couleurs'
import type { Couche, EntreeCouches } from '../carte/coucheModel'
import { territoiresFixture } from '../payload/fixtures'
import { routes } from '../router'

/**
 * MapSidebar (layouts.md §3): the 360px panel with the search (GlobalSearchBar
 * — territoires prop), the mask-level controls (synced with the map — a level
 * without geometry is absent, honest) and — ADR-0019 — the LAYER SELECTOR:
 * the active theme's full layer set (story scalar first, the multi-detail
 * keys and story-pool siblings as expandable groups); clicking a layer emits
 * `couche-change` to the view. Aperçu (no theme) keeps the honest
 * masks-only note.
 */

const coucheTauxSoldeNaturel: Couche = {
  source: 'histoire',
  clef: 'taux_solde_naturel',
  detail: null,
  libelle: 'taux_solde_naturel',
  parDefaut: true,
}

const coucheTauxSoldeMigratoire: Couche = {
  source: 'histoire',
  clef: 'taux_solde_migratoire',
  detail: null,
  libelle: 'taux_solde_migratoire',
  parDefaut: false,
}

const coucheDensite: Couche = {
  source: 'indicateur',
  clef: 'densite',
  detail: null,
  libelle: 'Densité de population',
  parDefaut: false,
}

const coucheMoin15: Couche = {
  source: 'indicateur',
  clef: 'structure_age',
  detail: '<15',
  libelle: 'Moins de 15 ans',
  parDefaut: false,
}

/** The Démographie layer set, as couchesDuTheme emits it: the story scalar,
 *  the story-pool group, the scalar figures, the multi-detail group. */
const entreesDemographie: EntreeCouches[] = [
  { type: 'couche', couche: coucheTauxSoldeNaturel },
  { type: 'groupe', groupe: { libelle: 'La Story', couches: [coucheTauxSoldeMigratoire] } },
  { type: 'couche', couche: coucheDensite },
  { type: 'groupe', groupe: { libelle: 'Structure par âge', couches: [coucheMoin15] } },
]

function montage(overrides: Record<string, unknown> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  return mount(MapSidebar, {
    props: {
      territoires: territoiresFixture,
      niveau: 'communes',
      niveauxDisponibles: ['communes', 'epcis', 'departements'],
      entrees: [],
      coucheActive: null,
      couleurs: [],
      seuils: [],
      estDivergente: false,
      unite: '',
      estPourcentage: false,
      // the map's neutral rendering, threaded through to the legend (issue #68)
      couleurVide: COULEUR_NEUTRE,
      couleurContour: COULEUR_CONTOUR,
      // the membership highlight, threaded through to the legend (#282)
      couleurMembre: '#2f4745',
      ...overrides,
    },
    global: { plugins: [router] },
  })
}

describe("MapSidebar — le panneau d'options de la carte", () => {
  it('embeds the search over the territoires reference table', () => {
    const wrapper = montage()

    expect(wrapper.findComponent({ name: 'GlobalSearchBar' }).exists()).toBe(true)
    expect(wrapper.find('input[role="combobox"]').exists()).toBe(true)
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0)
  })

  it('renders one radio per available mask level, the active one checked', () => {
    const wrapper = montage({ niveau: 'epcis' })

    const boutons = wrapper.findAll('[role="radio"]')
    expect(boutons.map((b) => b.text())).toEqual(['Communes', 'EPCI', 'Départements'])
    expect(boutons[1].attributes('aria-checked')).toBe('true')
    expect(boutons[0].attributes('aria-checked')).toBe('false')
  })

  it('emits the chosen level and does not render absent levels', async () => {
    const wrapper = montage({ niveauxDisponibles: ['communes', 'departements'] })

    const boutons = wrapper.findAll('[role="radio"]')
    expect(boutons.map((b) => b.text())).toEqual(['Communes', 'Départements'])

    await boutons[1].trigger('click')
    expect(wrapper.emitted('niveau-change')).toEqual([['departements']])
  })

  it("explains honestly when a level's geometry is not published", () => {
    const wrapper = montage({ niveauxDisponibles: ['communes'] })

    expect(wrapper.find('.carte-sidebar-note').text()).toContain('sans géométrie sont indisponibles')
  })

  it('hides the panel on close and offers a reopen button', async () => {
    const wrapper = montage()

    await wrapper.find('.carte-sidebar-fermer').trigger('click')
    expect(wrapper.find('.carte-sidebar').attributes('aria-hidden')).toBe('true')
    expect(wrapper.find('.carte-sidebar-rouvrir').exists()).toBe(true)

    await wrapper.find('.carte-sidebar-rouvrir').trigger('click')
    expect(wrapper.find('.carte-sidebar').attributes('aria-hidden')).toBe('false')
  })

  it('forwards the map neutral rendering to the legend — one shared source (issue #68)', () => {
    const wrapper = montage()

    const legende = wrapper.findComponent({ name: 'MapLegend' })
    expect(legende.props('couleurVide')).toBe(COULEUR_NEUTRE)
    expect(legende.props('couleurContour')).toBe(COULEUR_CONTOUR)
  })

  it('forwards the active couche to the legend — the legend follows the layer (ADR-0019)', () => {
    const wrapper = montage({ coucheActive: coucheDensite })

    const legende = wrapper.findComponent({ name: 'MapLegend' })
    expect(legende.props('couche')).toEqual(coucheDensite)
  })
})

describe('MapSidebar — la recherche de la carte (#283)', () => {
  it('passe la recherche en mode sans navigation — les résultats ne naviguent pas vers la fiche', () => {
    const wrapper = montage()

    expect(wrapper.findComponent({ name: 'GlobalSearchBar' }).props('sansNavigation')).toBe(true)
  })

  it('remonte le territoire sélectionné — recherche-territoire, la carte zoome dessus', async () => {
    const wrapper = montage()
    const epciX = territoiresFixture.find((t) => t.territoire === '200000001')

    wrapper.findComponent({ name: 'GlobalSearchBar' }).vm.$emit('select', epciX)
    await nextTick()

    expect(wrapper.emitted('recherche-territoire')).toEqual([[epciX]])
  })
})

describe('MapSidebar — le sélecteur de couches (ADR-0019)', () => {
  it('lists the theme’s layers — story scalar first, the groups expandable by default', () => {
    const wrapper = montage({ entrees: entreesDemographie, coucheActive: coucheTauxSoldeNaturel })

    const couches = wrapper.findAll('.carte-sidebar-couche').map((b) => b.text().trim())
    expect(couches).toEqual([
      'taux_solde_naturel',
      'taux_solde_migratoire',
      'Densité de population',
      'Moins de 15 ans',
    ])
    const groupes = wrapper.findAll('.carte-sidebar-groupe-titre').map((b) => b.text().trim())
    expect(groupes).toEqual(['La Story', 'Structure par âge'])
    for (const groupe of wrapper.findAll('.carte-sidebar-groupe-titre')) {
      expect(groupe.attributes('aria-expanded')).toBe('true')
    }
  })

  it('marks the active layer — the theme’s default (story) layer on a fresh theme', () => {
    const wrapper = montage({ entrees: entreesDemographie, coucheActive: coucheTauxSoldeNaturel })

    const actifs = wrapper.findAll('.carte-sidebar-couche.est-actif').map((b) => b.text().trim())
    expect(actifs).toEqual(['taux_solde_naturel'])
    expect(wrapper.find('.carte-sidebar-couche').attributes('aria-pressed')).toBe('true')
  })

  it('emits couche-change with the clicked layer — a grouped detail or a scalar', async () => {
    const wrapper = montage({ entrees: entreesDemographie, coucheActive: coucheTauxSoldeNaturel })

    const densite = wrapper
      .findAll('.carte-sidebar-couche')
      .find((b) => b.text().includes('Densité'))
    await densite?.trigger('click')
    expect(wrapper.emitted('couche-change')).toEqual([[coucheDensite]])

    const tranche = wrapper
      .findAll('.carte-sidebar-couche')
      .find((b) => b.text().includes('Moins de 15 ans'))
    await tranche?.trigger('click')
    expect(wrapper.emitted('couche-change')?.at(1)).toEqual([coucheMoin15])
  })

  it('collapses a group on its header click and re-expands it', async () => {
    const wrapper = montage({ entrees: entreesDemographie })

    const titre = wrapper.findAll('.carte-sidebar-groupe-titre')[0]
    await titre.trigger('click')
    expect(titre.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.carte-sidebar-groupe-couches').attributes('style')).toContain(
      'display: none',
    )

    await titre.trigger('click')
    expect(titre.attributes('aria-expanded')).toBe('true')
  })

  it('keeps the honest masks-only note in Aperçu (no theme → no layers)', () => {
    const wrapper = montage()

    expect(wrapper.find('.carte-sidebar-couches-vide').text()).toContain(
      "Aucune couche d'indicateurs — les masques seuls.",
    )
  })
})
