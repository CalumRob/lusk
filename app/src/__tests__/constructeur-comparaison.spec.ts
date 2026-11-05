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
    expect(wrapper.find('[aria-label="Ajouter Andel"]').exists()).toBe(true)
    expect(wrapper.findAll('.membres-comparaison__table tbody tr')).toHaveLength(2)
    expect(wrapper.find('[data-testid="ajouter-membre"]').exists()).toBe(false)
    expect(wrapper.findAll('.constructeur-comparaison__preset').map((item) => item.text()))
      .toEqual(['EPCI · communes de l’EPCI', 'Bretagne', 'Aucune comparaison'])
    expect(wrapper.findAll('.constructeur-comparaison__preset').map((item) => item.attributes('aria-pressed')))
      .toEqual(['true', 'false', 'false'])
    expect(wrapper.get('input[type="search"]').attributes('aria-label'))
      .toBe('Rechercher un territoire')
    expect(wrapper.find('input[type="search"]').element.compareDocumentPosition(wrapper.find('table').element) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy()
    expect(wrapper.find('table tbody tr').text()).toContain('Étel')
    expect(wrapper.find('table tbody tr').text()).toContain('Territoire de la fiche')
    await wrapper.get('input[type="search"]').setValue('andel')
    expect(wrapper.findAll('.membres-comparaison__table tbody tr')).toHaveLength(1)
    expect(wrapper.get('[aria-label="Ajouter Andel"]').text()).toBe('Ajouter')
    await wrapper.get('[aria-label="Ajouter Andel"]').trigger('click')
    const custom = { etat: 'membres', membres: [
      { territory_type: 'commune', territory_id: '1' }, { territory_type: 'commune', territory_id: '2' },
      { territory_type: 'commune', territory_id: '3' },
    ] }
    expect(wrapper.emitted('choisir')?.at(-1)).toEqual([custom])
    await wrapper.setProps({ selection: custom as SelectionComparaison })
    expect(wrapper.find('[aria-label="Retirer Andel"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Ajouter Étel"]').exists()).toBe(false)
    await wrapper.get('input[type="search"]').setValue('')
    expect(wrapper.findAll('.membres-comparaison__table tbody tr')).toHaveLength(3)
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
    await wrapper.get('[aria-label="Ajouter Andel"]').trigger('click')
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
    await wrapper.get('.constructeur-comparaison__preset').trigger('click')
    expect(wrapper.emitted('choisir')?.at(-1)).toEqual([{ etat: 'preset', preset: 'epci' }])
    await wrapper.setProps({ selection: { etat: 'preset', preset: 'epci' } })
    expect(wrapper.find('.constructeur-comparaison__preset[aria-pressed="true"]').text()).toBe('EPCI · communes de l’EPCI')
    wrapper.unmount()
  })
  it('le bouton Aucune comparaison vide aussi une sélection preset', async () => {
    const wrapper = mount(ConstructeurComparaison, { props: {
      selection: { etat: 'preset', preset: 'bretagne' }, presetDefaut: 'epci', focal: focal as any, territoires: territoires as any, presets,
    } })
    await wrapper.get('[aria-label="Construire un groupe de comparaison"]').trigger('click')
    await flushPromises()
    const empty = wrapper.findAll('.constructeur-comparaison__preset')[2]!
    expect(empty.attributes('aria-pressed')).toBe('false')
    await empty.trigger('click')
    expect(wrapper.emitted('choisir')?.at(-1)).toEqual([{ etat: 'vide' }])
    wrapper.unmount()
  })
})
