import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'

import IndicateursView from '../views/IndicateursView.vue'
import { routes } from '../router'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import type { Fichier } from '../payload/loader'

async function monter(url = '/indicateurs') {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(url)
  await router.isReady()
  const charger = vi.fn((_fichier: Fichier) => new Promise<unknown>(() => {}))
  const wrapper = mount(IndicateursView, {
    global: {
      plugins: [router],
      provide: { [PAYLOAD_CHARGER_KEY]: charger },
    },
  })
  await flushPromises()
  return { wrapper, router, charger }
}

describe('IndicateursView — le catalogue groupé', () => {
  it('rend immédiatement ses pages produit sans métadonnées ni faits chargés', async () => {
    const { wrapper, charger } = await monter()

    const lien = wrapper.find('a[href="/indicateurs/demographie/densite"]')
    expect(lien.exists()).toBe(true)
    expect(lien.text()).toBe('Densité de population')
    expect(charger).not.toHaveBeenCalled()
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.attributes('aria-busy')).toBe('false')
  })

  it('rend les thèmes dans l’ordre canonique avec leurs libellés app-owned', async () => {
    const { wrapper } = await monter()
    const groupes = wrapper.findAll('[data-groupe-theme]')

    expect(groupes.map((groupe) => groupe.attributes('data-groupe-theme'))).toEqual([
      'mobilite',
      'demographie',
      'habitat',
      'economie',
      'milieux',
      'programmes',
    ])
    expect(groupes.map((groupe) => groupe.find('h2').text())).toEqual([
      'Mobilité',
      'Démographie',
      'Habitat',
      'Économie/Emploi',
      'Milieux',
      'Programmes et subventions',
    ])
  })

  it('garde les sous-groupes comme titres et omet le groupe devenu vide après le retrait des pages legacy', async () => {
    const { wrapper } = await monter()

    for (const titre of wrapper.findAll('[data-groupe-sous-groupe]')) {
      expect(titre.element.tagName).not.toBe('A')
      expect(titre.find('a').exists()).toBe(false)
    }
    for (const titre of wrapper.findAll('[data-groupe-theme] h2')) {
      expect(titre.find('a').exists()).toBe(false)
    }
    expect(wrapper.find('[data-clef-sous-groupe="acces-aux-services"]').exists()).toBe(false)
    expect(wrapper.find('[data-clef-sous-groupe="couverture"]').exists()).toBe(false)
  })

  it('lie les 31 entrées retenues aux URL publiques et conserve leurs vrais libellés', async () => {
    const { wrapper } = await monter('/indicateurs/demographie/densite')
    const liens = wrapper.findAll('a[href^="/indicateurs/"]')
    const hrefs = liens.map((lien) => lien.attributes('href'))
    const textes = liens.map((lien) => lien.text())

    expect(liens).toHaveLength(31)
    expect(new Set(hrefs).size).toBe(31)
    expect(hrefs).toContain('/indicateurs/mobilite/bornes_ev_par_station_service')
    expect(hrefs).toContain('/indicateurs/mobilite/raccordement_courbe')
    expect(hrefs).toContain('/indicateurs/programmes/subventions_par_domaine')
    expect(textes).toContain('Distribution des étiquettes DPE (A à G)')
    expect(textes).toContain('Subventions régionales par domaine')
    expect(textes.every((texte) => !/^[a-z_]+$/.test(texte.trim()))).toBe(true)
    expect(hrefs.some((href) => href?.includes('raccordement_reference'))).toBe(false)
  })
})
