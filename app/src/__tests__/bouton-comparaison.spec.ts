import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import BoutonComparaison from '../components/fiche/BoutonComparaison.vue'
import type {
  PresetComparaisonOption,
  SelectionComparaison,
} from '../fiche/comparisonContext'

/**
 * #860 (ruling propriétaire 2026-11-03) — BoutonComparaison : le contrôle de
 * comparaison assis dans le page-heading collant du Cahier. Face laconique
 * « Comparaison » (« Sélection » reste du vocabulaire de glossaire, jamais du
 * copy UI) ; la portée active ne se lit que dans le nom accessible. Menu sans
 * entrée « Par défaut » : presets + « Aucune comparaison » ; quand le paramètre
 * d'URL est absent, le preset niveau-natif apparaît coché.
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
  return mount(BoutonComparaison, {
    attachTo: document.body,
    props: {
      selection,
      libelleActif: 'communes de EPCI X',
      presetDefaut: 'epci',
      presets,
      ...props,
    },
  })
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('BoutonComparaison — face « Comparaison » du page-heading collant (#860 ruling)', () => {
  it('affiche juste « Comparaison » en visible ; la portée active ride dans le nom accessible', () => {
    const wrapper = monter({ etat: 'defaut' })
    const bouton = wrapper.get('.bouton-comparaison__declencheur')

    expect(bouton.find('.bouton-comparaison__texte').text()).toBe('Comparaison')
    // aucune prose de portée en visible
    expect(bouton.text()).not.toContain('communes de EPCI X')
    expect(bouton.attributes('aria-label')).toBe('Comparaison : communes de EPCI X')
    expect(bouton.attributes('aria-haspopup')).toBe('menu')
    expect(bouton.attributes('aria-expanded')).toBe('false')
    // « Sélection » n'est jamais du copy UI (visible ni accessible)
    expect(wrapper.html()).not.toContain('Sélection')
    wrapper.unmount()
  })

  it('le copy UI (template) ne contient jamais « Sélection » — vocabulaire de glossaire uniquement', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'components', 'fiche', 'BoutonComparaison.vue'),
      'utf8',
    )
    const template = source.match(/<template>([\s\S]*?)<\/template>/)?.[1] ?? ''
    expect(template).not.toContain('Sélection')
    expect(template).toContain('Comparaison')
  })

  it('annonce l’état vide dans le nom accessible', () => {
    const wrapper = monter({ etat: 'vide' }, { libelleActif: 'Aucune comparaison' })
    expect(wrapper.get('.bouton-comparaison__declencheur').attributes('aria-label'))
      .toBe('Comparaison : Aucune comparaison')
    wrapper.unmount()
  })

  it('menu sans entrée « Par défaut » : presets + « Aucune comparaison », le preset niveau-natif coché quand le param est absent', async () => {
    const wrapper = monter({ etat: 'defaut' })
    await wrapper.get('.bouton-comparaison__declencheur').trigger('click')

    const entrees = wrapper.findAll('[role="menuitemradio"]')
    expect(entrees.map((e) => e.find('.bouton-comparaison__option-label').text())).toEqual([
      'communes de EPCI X',
      'communes bretonnes',
      'grands centres urbains bretons',
      'Aucune comparaison',
    ])
    expect(wrapper.text()).not.toContain('Par défaut')
    // état défaut → le preset niveau-natif (epci) est l'entrée cochée
    expect(entrees.map((e) => e.attributes('aria-checked'))).toEqual(['true', 'false', 'false', 'false'])
    wrapper.unmount()
  })

  it('coche le preset explicite actif, et « Aucune comparaison » pour une sélection vide', async () => {
    const presetActif = monter({ etat: 'preset', preset: 'densite' }, { libelleActif: 'grands centres urbains bretons' })
    await presetActif.get('.bouton-comparaison__declencheur').trigger('click')
    const entrees = presetActif.findAll('[role="menuitemradio"]')
    expect(entrees.map((e) => e.attributes('aria-checked'))).toEqual(['false', 'false', 'true', 'false'])
    const densite = entrees[2]!
    expect(densite.attributes('aria-describedby')).toBeTruthy()
    expect(presetActif.get(`#${densite.attributes('aria-describedby')}`).text()).toContain('Classe définie par l’Insee')
    presetActif.unmount()

    const vide = monter({ etat: 'vide' }, { libelleActif: 'Aucune comparaison' })
    await vide.get('.bouton-comparaison__declencheur').trigger('click')
    expect(vide.findAll('[role="menuitemradio"]').map((e) => e.attributes('aria-checked')))
      .toEqual(['false', 'false', 'false', 'true'])
    vide.unmount()
  })

  it('émet la Sélection typée choisie : preset, vide explicite, preset du défaut', async () => {
    const wrapper = monter({ etat: 'defaut' })
    await wrapper.get('.bouton-comparaison__declencheur').trigger('click')
    const entrees = wrapper.findAll('[role="menuitemradio"]')

    await entrees[1]!.trigger('click')
    expect(wrapper.emitted('choisir')?.[0]).toEqual([{ etat: 'preset', preset: 'bretagne' }])

    await wrapper.get('.bouton-comparaison__declencheur').trigger('click')
    await wrapper.findAll('[role="menuitemradio"]')[3]!.trigger('click')
    expect(wrapper.emitted('choisir')?.[1]).toEqual([{ etat: 'vide' }])

    // choisir le preset coché par défaut écrit le preset explicite dans l'URL
    await wrapper.get('.bouton-comparaison__declencheur').trigger('click')
    await wrapper.findAll('[role="menuitemradio"]')[0]!.trigger('click')
    expect(wrapper.emitted('choisir')?.[2]).toEqual([{ etat: 'preset', preset: 'epci' }])
    wrapper.unmount()
  })

  it('navigue au clavier : flèches, Home/End, Échap referme et rend le focus', async () => {
    const wrapper = monter({ etat: 'defaut' })
    const bouton = wrapper.get('.bouton-comparaison__declencheur')

    await bouton.trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    expect(bouton.attributes('aria-expanded')).toBe('true')
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
    expect(bouton.attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(bouton.element)

    await bouton.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(bouton.attributes('aria-expanded')).toBe('true')
    await wrapper.findAll('[role="menuitemradio"]')[0]!.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.emitted('choisir')?.[0]).toEqual([{ etat: 'preset', preset: 'epci' }])
    wrapper.unmount()
  })

  it('ferme le menu sur un clic hors du bouton', async () => {
    const wrapper = monter({ etat: 'defaut' })
    const bouton = wrapper.get('.bouton-comparaison__declencheur')
    await bouton.trigger('click')
    expect(bouton.attributes('aria-expanded')).toBe('true')

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(bouton.attributes('aria-expanded')).toBe('false')
    wrapper.unmount()
  })

  it('respecte les cibles tactiles du Cahier (44px au pointeur grossier) et la grammaire papier (pas de pilule)', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'components', 'fiche', 'BoutonComparaison.vue'),
      'utf8',
    )
    expect(source).toContain('@media (pointer: coarse)')
    expect(source).toMatch(/min-block-size:\s*44px/)
    // pas de chrome de pilule générique : pas de radius-full
    expect(source).not.toContain('radius-full')
    expect(source).toContain('var(--paper')
  })
})
