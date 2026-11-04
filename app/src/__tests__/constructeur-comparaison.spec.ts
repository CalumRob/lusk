import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import ConstructeurComparaison from '../components/fiche/ConstructeurComparaison.vue'
import type { SelectionComparaison } from '../fiche/comparisonContext'

const focal = { type: 'commune', territoire: '1', nom: 'Étel', epci: 'E' }
const territoires = [
  focal,
  { ...focal, territoire: '2', nom: 'Erdeven' },
  { ...focal, territoire: '3', nom: 'Andel', epci: 'Z' },
  { type: 'epci', territoire: 'E', nom: 'Erdeven communauté' },
]
const presets = [
  { preset: 'epci', label: 'EPCI · communes de l’EPCI', description: null },
  { preset: 'bretagne', label: 'Bretagne', description: null },
] as const

afterEach(() => { document.body.innerHTML = '' })

describe('ConstructeurComparaison — modal indépendante, lecture seule puis édition', () => {
  it('montre le groupe par défaut sans le modifier, puis recherche et édite les membres', async () => {
    const wrapper = mount(ConstructeurComparaison, { attachTo: document.body, props: {
      selection: { etat: 'defaut' }, presetDefaut: 'epci', focal: focal as any, territoires: territoires as any, presets,
    } })
    expect(wrapper.find('dialog').exists()).toBe(true)
    expect(wrapper.find('dialog').attributes('open')).toBeUndefined()
    await wrapper.get('[aria-label="Construire un groupe de comparaison"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('dialog').attributes('aria-modal')).toBe('true')
    expect(wrapper.find('dialog').attributes('open')).toBeDefined()
    expect(wrapper.emitted('choisir')).toBeUndefined()
    expect(wrapper.find('[aria-label="Retirer Étel"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Retirer Erdeven"]').exists()).toBe(true)
    expect(wrapper.findAll('.constructeur-comparaison__presets button').map((item) => item.text()))
      .toEqual(['EPCI · communes de l’EPCI', 'Bretagne'])
    expect(wrapper.get('input[type="search"]').attributes('aria-label'))
      .toBe('Rechercher un territoire du même niveau')
    await wrapper.get('input[type="search"]').setValue('andel')
    expect(wrapper.findAll('[data-testid="ajouter-membre"]').map((item) => item.text())).toEqual(['Ajouter Andel'])
    await wrapper.get('[data-testid="ajouter-membre"]').trigger('click')
    const custom = { etat: 'membres', membres: [
      { territory_type: 'commune', territory_id: '1' }, { territory_type: 'commune', territory_id: '2' },
      { territory_type: 'commune', territory_id: '3' },
    ] }
    expect(wrapper.emitted('choisir')?.at(-1)).toEqual([custom])
    await wrapper.setProps({ selection: custom as SelectionComparaison })
    expect(wrapper.find('[aria-label="Retirer Andel"]').exists()).toBe(true)
    await wrapper.get('[aria-label="Retirer Étel"]').trigger('click')
    expect(wrapper.emitted('choisir')?.at(-1)).toEqual([{ etat: 'membres', membres: [
      { territory_type: 'commune', territory_id: '2' }, { territory_type: 'commune', territory_id: '3' },
    ] }])
    await wrapper.get('[aria-label="Fermer la fenêtre"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('dialog').attributes('open')).toBeUndefined()
    wrapper.unmount()
  })
  it('la première édition d’une sélection explicitement vide préajoute le focal', async () => {
    const wrapper = mount(ConstructeurComparaison, { attachTo: document.body, props: {
      selection: { etat: 'vide' }, presetDefaut: 'epci', focal: focal as any, territoires: territoires as any, presets,
    } })
    await wrapper.get('[aria-label="Construire un groupe de comparaison"]').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('choisir')).toBeUndefined()
    expect(wrapper.find('[aria-label="Retirer Étel"]').exists()).toBe(false)
    await wrapper.get('input[type="search"]').setValue('andel')
    await wrapper.get('[data-testid="ajouter-membre"]').trigger('click')
    expect(wrapper.emitted('choisir')?.at(-1)).toEqual([{ etat: 'membres', membres: [
      { territory_type: 'commune', territory_id: '1' }, { territory_type: 'commune', territory_id: '3' },
    ] }])
    wrapper.unmount()
  })
  it('un preset de démarrage remplace la sélection complète', async () => {
    const wrapper = mount(ConstructeurComparaison, { attachTo: document.body, props: {
      selection: { etat: 'membres', membres: [{ territory_type: 'commune', territory_id: '2' }] },
      presetDefaut: 'epci', focal: focal as any, territoires: territoires as any, presets,
    } })
    await wrapper.get('[aria-label="Construire un groupe de comparaison"]').trigger('click')
    await flushPromises()
    await wrapper.get('.constructeur-comparaison__presets button').trigger('click')
    expect(wrapper.emitted('choisir')?.at(-1)).toEqual([{ etat: 'preset', preset: 'epci' }])
    wrapper.unmount()
  })
})
