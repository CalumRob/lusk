import { createRouter, createWebHistory } from 'vue-router'

import AccueilView from '../views/AccueilView.vue'
import AProposView from '../views/AProposView.vue'
import CommunesView from '../views/CommunesView.vue'
import DepartementsView from '../views/DepartementsView.vue'
import EpcisView from '../views/EpcisView.vue'
import MethodologieView from '../views/MethodologieView.vue'
import TerritoireView from '../views/TerritoireView.vue'
import IndicateurView from '../views/IndicateurView.vue'
import SourcesView from '../views/SourcesView.vue'

/**
 * The site map (site-map.md, /, /carte, /communes, /epcis, /departements,
 * /territoire/:type/:id, /methodologie, /a-propos) as a route table.
 *
 * History mode (createWebHistory) matches the deploy path: nginx serves
 * dist/ at the site root with `try_files $uri /index.html` (SPA fallback,
 * docs/self-hosting.md). Later tickets replace the placeholder views —
 * names and paths are the contract, do not rename them.
 *
 * La carte est chargée paresseusement : maplibre-gl (~230 ko gzip) ne pèse
 * que sur /carte, jamais dans le bundle initial (issue #39).
 */
const CarteView = () => import('../views/CarteView.vue')
export const routes = [
  {
    path: '/',
    name: 'accueil',
    component: AccueilView,
    meta: { title: 'Accueil' },
  },
  {
    path: '/carte',
    name: 'carte',
    component: CarteView,
    meta: { title: 'Carte', sansPied: true },
  },
  {
    path: '/communes',
    name: 'communes',
    component: CommunesView,
    meta: { title: 'Communes' },
  },
  {
    path: '/epcis',
    name: 'epcis',
    component: EpcisView,
    meta: { title: 'EPCI' },
  },
  {
    path: '/departements',
    name: 'departements',
    component: DepartementsView,
    meta: { title: 'Départements' },
  },
  {
    path: '/territoire/:type/:id',
    name: 'territoire',
    component: TerritoireView,
    props: true,
    meta: { title: 'Fiche d’identité' },
  },
  {
    path: '/methodologie',
    name: 'methodologie',
    component: MethodologieView,
    meta: { title: 'Méthodologie' },
  },
  {
    path: '/sources',
    name: 'sources',
    component: SourcesView,
    meta: { title: 'Sources' },
  },
  {
    path: '/a-propos',
    name: 'a-propos',
    component: AProposView,
    meta: { title: 'À propos' },
  },
  {
    path: '/indicateurs/:theme/:indicator',
    name: 'indicateur',
    component: IndicateurView,
    props: true,
    meta: { title: 'Indicateur' },
  },
] as const

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to) => {
  if (to.name === 'indicateur' && to.query.vue !== undefined && to.query.vue !== 'carte' && to.query.vue !== 'indicateur') {
    const query = { ...to.query }
    delete query.vue
    return { ...to, query }
  }
  return true
})

export default router
