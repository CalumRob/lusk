import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CahierComparisonNote from '@/fiche/prototype/CahierComparisonNote.vue'

/**
 * #860 — CahierComparisonNote rend la note de nommage EN LECTURE SEULE
 * (« Groupe comparé : <statistique + portée résolue> »). Le rôle de sélecteur
 * par figure est retiré (la Sélection de comparaison appartient à la puce
 * d'en-tête, PuceSelectionComparaison) : aucun bouton, aucun listbox, aucune
 * écriture d'URL depuis la note.
 */

describe('CahierComparisonNote — note de nommage en lecture seule (#860)', () => {
  it('rend la marque « Groupe comparé » et la portée publiée', () => {
    const wrapper = mount(CahierComparisonNote, {
      props: { label: 'Médiane des communes de EPCI X' },
    })

    const note = wrapper.get('.cahier-comparison-note')
    expect(note.attributes('role')).toBe('note')
    expect(note.find('.cahier-comparison-note__label').text()).toBe('Groupe comparé')
    expect(note.text()).toContain('Médiane des communes de EPCI X')
    wrapper.unmount()
  })

  it('ne rend aucun contrôle : pas de bouton, pas de menu, pas de listbox', () => {
    const wrapper = mount(CahierComparisonNote, {
      props: { label: 'Moyenne des communes bretonnes' },
    })

    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.find('[aria-haspopup]').exists()).toBe(false)
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('ne rend rien sans libellé', () => {
    const wrapper = mount(CahierComparisonNote, { props: { label: null } })
    expect(wrapper.find('.cahier-comparison-note').exists()).toBe(false)
    wrapper.unmount()
  })

  it('rend aussi la grammaire des portées bâtiments telle que publiée', () => {
    const wrapper = mount(CahierComparisonNote, {
      props: { label: 'Moyenne des bâtiments des communes de EPCI X' },
    })
    expect(wrapper.get('.cahier-comparison-note').text())
      .toContain('bâtiments des communes de EPCI X')
    wrapper.unmount()
  })
})
