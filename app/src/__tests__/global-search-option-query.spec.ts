import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import GlobalSearchOptionRecherche from '../components/GlobalSearchOptionRecherche.vue'

describe('navigation depuis la recherche globale avec le prototype AEDAR', () => {
  it('conserve thème, prototype et comparaison explicite', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/territoire/:type/:id', name: 'territoire', component: { template: '<div />' } }, { path: '/', component: { template: '<div />' } }] })
    await router.push('/?theme=mobilite&aedar-proto=1&comparaison=epci')
    const wrapper = mount(GlobalSearchOptionRecherche, {
      props: { genre: 'territoire', actif: false, resultat: { type: 'commune', territoire: '35238', nom: 'Rennes', departement: '35', epci: null } },
      global: { plugins: [router] },
    })
    const target = wrapper.findComponent({ name: 'RouterLink' }).props('to')
    expect(router.resolve(target).query).toEqual({ theme: 'mobilite', 'aedar-proto': '1', comparaison: 'epci' })
  })
})
