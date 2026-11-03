import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import PuceSelectionComparaison from '../components/fiche/PuceSelectionComparaison.vue'
import type {
  PresetComparaisonOption,
  SelectionComparaison,
} from '../fiche/comparisonContext'

/**
 * #860 — PuceSelectionComparaison : le contrôle de la Sélection de comparaison
 * assis dans la rangée collante de l’en-tête de la fiche (spec #768). La puce
 * annonce la portée active (aria), ouvre un menu rapide de presets (rôle menu,
 * menuitemradio), et émet la valeur d’URL à écrire dans `?comparaison=`.
 * Le constructeur complet (recherche, membres) est #861 — hors de cette tranche.
 */

const presets: readonly PresetComparaisonOption[] = [
  { preset: 'epci', label: 'communes de EPCI X', description: null },
  { preset: 'bretagne', label: 'communes bretonnes', description: null },
  {
    preset: 'densite',
    label: 'grands centres urbains bretons',
    description: 'Classe définie par l’Insee selon le nombre d’habitants et leur concentration sur le territoire communal.',
  },
]

function monter(selection: SelectionComparaison, props: Record<string, unknown> = {}) {
  return mount(PuceSelectionComparaison, {
    attachTo: document.body,
    props: {
      selection,
      libelleActif: 'communes de EPCI X',
      libelleDefaut: 'communes de EPCI X',
      presets,
      ...props,
    },
  })
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('PuceSelectionComparaison — la puce de sélection dans l’en-tête collant', () => {
  it('affiche la portée active avec un libellé visible et un nom accessible complet', () => {
    const wrapper = monter({ etat: 'defaut' })
    const puce = wrapper.get('.puce-selection__trigger')

    expect(puce.text()).toContain('Sélection')
    expect(puce.text()).toContain('communes de EPCI X')
    expect(puce.attributes('aria-label')).toBe('Sélection de comparaison active : communes de EPCI X')
    expect(puce.attributes('aria-haspopup')).toBe('menu')
    expect(puce.attributes('aria-expanded')).toBe('false')
    wrapper.unmount()
  })

  it('annonce l’état vide (« aucune comparaison ») dans le libellé accessible', () => {
    const wrapper = monter({ etat: 'vide' }, { libelleActif: 'Aucune comparaison' })
    expect(wrapper.get('.puce-selection__trigger').attributes('aria-label'))
      .toBe('Sélection de comparaison active : Aucune comparaison')
    wrapper.unmount()
  })

  it('annonce une sélection de membres tapés par son compte', () => {
    const wrapper = monter(
      { etat: 'membres', membres: [
        { territory_type: 'commune', territory_id: '22001' },
        { territory_type: 'commune', territory_id: '22002' },
      ] },
      { libelleActif: '2 communes' },
    )
    expect(wrapper.get('.puce-selection__trigger').attributes('aria-label'))
      .toBe('Sélection de comparaison active : 2 communes')
    wrapper.unmount()
  })

  it('ouvre le menu rapide : défaut + presets + aucune comparaison, état coché en aria', async () => {
    const wrapper = monter({ etat: 'defaut' })
    const puce = wrapper.get('.puce-selection__trigger')
    await puce.trigger('click')

    expect(puce.attributes('aria-expanded')).toBe('true')
    const menu = wrapper.get('[role="menu"]')
    expect(menu.attributes('aria-label')).toBe('Sélection de comparaison')
    const entrees = wrapper.findAll('[role="menuitemradio"]')
    expect(entrees.map((e) => e.find('.puce-selection__option-label').text())).toEqual([
      'Par défaut : communes de EPCI X',
      'communes de EPCI X',
      'communes bretonnes',
      'grands centres urbains bretons',
      'Aucune comparaison',
    ])
    expect(entrees.map((e) => e.attributes('aria-checked'))).toEqual(['true', 'false', 'false', 'false', 'false'])
    wrapper.unmount()
  })

  it('coche le preset actif quand la sélection est un preset explicite', async () => {
    const wrapper = monter({ etat: 'preset', preset: 'densite' }, { libelleActif: 'grands centres urbains bretons' })
    await wrapper.get('.puce-selection__trigger').trigger('click')
    const entrees = wrapper.findAll('[role="menuitemradio"]')
    expect(entrees.map((e) => e.attributes('aria-checked'))).toEqual(['false', 'false', 'false', 'true', 'false'])
    const densite = entrees[3]!
    expect(densite.attributes('aria-describedby')).toBeTruthy()
    expect(wrapper.get(`#${densite.attributes('aria-describedby')}`).text()).toContain('Classe définie par l’Insee')
    wrapper.unmount()
  })

  it('émet la Sélection choisie (typée) : preset, vide explicite, et retour au défaut', async () => {
    const wrapper = monter({ etat: 'defaut' })
    await wrapper.get('.puce-selection__trigger').trigger('click')
    const entrees = wrapper.findAll('[role="menuitemradio"]')

    await entrees[2]!.trigger('click')
    expect(wrapper.emitted('choisir')?.[0]).toEqual([{ etat: 'preset', preset: 'bretagne' }])

    await wrapper.get('.puce-selection__trigger').trigger('click')
    await wrapper.findAll('[role="menuitemradio"]')[4]!.trigger('click')
    expect(wrapper.emitted('choisir')?.[1]).toEqual([{ etat: 'vide' }])

    await wrapper.get('.puce-selection__trigger').trigger('click')
    await wrapper.findAll('[role="menuitemradio"]')[0]!.trigger('click')
    expect(wrapper.emitted('choisir')?.[2]).toEqual([{ etat: 'defaut' }])
    wrapper.unmount()
  })

  it('navigue au clavier : flèches, Home/End, Échap referme et rend le focus', async () => {
    const wrapper = monter({ etat: 'defaut' })
    const puce = wrapper.get('.puce-selection__trigger')

    await puce.trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    expect(puce.attributes('aria-expanded')).toBe('true')
    const entrees = () => wrapper.findAll('[role="menuitemradio"]')
    expect(document.activeElement).toBe(entrees()[0]!.element)

    await entrees()[0]!.trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(entrees()[1]!.element)
    await entrees()[1]!.trigger('keydown', { key: 'End' })
    expect(document.activeElement).toBe(entrees()[entrees().length - 1]!.element)
    await entrees()[entrees().length - 1]!.trigger('keydown', { key: 'Home' })
    expect(document.activeElement).toBe(entrees()[0]!.element)

    await entrees()[0]!.trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(puce.attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(puce.element)

    await puce.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(puce.attributes('aria-expanded')).toBe('true')
    await wrapper.findAll('[role="menuitemradio"]')[1]!.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.emitted('choisir')?.[0]).toEqual([{ etat: 'preset', preset: 'epci' }])
    wrapper.unmount()
  })

  it('ferme le menu sur un clic hors de la puce', async () => {
    const wrapper = monter({ etat: 'defaut' })
    const puce = wrapper.get('.puce-selection__trigger')
    await puce.trigger('click')
    expect(puce.attributes('aria-expanded')).toBe('true')

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(puce.attributes('aria-expanded')).toBe('false')
    wrapper.unmount()
  })

  it('respecte les cibles tactiles du Cahier (44px au pointeur grossier)', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'components', 'fiche', 'PuceSelectionComparaison.vue'),
      'utf8',
    )
    expect(source).toContain('@media (pointer: coarse)')
    expect(source).toMatch(/min-block-size:\s*44px/)
  })
})
