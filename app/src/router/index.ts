import { createRouter, createWebHistory } from 'vue-router'

import AccueilView from '../views/AccueilView.vue'
import AProposView from '../views/AProposView.vue'
import CommunesView from '../views/CommunesView.vue'
import DepartementsView from '../views/DepartementsView.vue'
import EpcisView from '../views/EpcisView.vue'
import TerritoireView from '../views/TerritoireView.vue'
import IndicateursView from '../views/IndicateursView.vue'
import IndicateurView from '../views/IndicateurView.vue'
import SourcesView from '../views/SourcesView.vue'

/**
 * The site map (#410 — la bascule atomique) : /, /carte, /communes, /epcis,
 * /departements, /territoire/:type/:id, /sources, /a-propos et le catalogue
 * /indicateurs. History mode (createWebHistory) matches the deploy path: the
 * SPA fallback serves dist/ at the site root (nginx try_files / Vercel
 * rewrites).
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
    // ⚠️ ÉPARGNÉE par ruling produit (2026-08-26, ticket #410) : la route
    // standalone /carte NE retire PAS. Elle reste routée et fonctionnelle
    // comme outil d'exploration personnel du PO — mais AUCUN lien face-
    // utilisateur ne doit pointer vers elle (ni header, ni footer, ni accueil,
    // ni recherche, ni listes). Seule Méthodes est retirée par #410 ; les AC
    // « no standalone map shell » sont amendés en conséquence.
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
    // /methodologie — RETIRÉE (#410) : Méthodes n'est plus une destination.
    // Son contenu vit dans Sources (#406) et À propos ; les liens internes
    // (y compris ceux possédés par le payload, theme_<theme>.json) pointent
    // désormais vers leurs nouvelles maisons. Aucun alias partiel ne survit.
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
    // Le catalogue des indicateurs (#409) — la route EXACTE précède sa sœur
    // paramétrée : /indicateurs liste les Pages d'indicateur publiées,
    // groupées par thème canonique et sous-groupe de fiche.
    path: '/indicateurs',
    name: 'indicateurs',
    component: IndicateursView,
    meta: { title: 'Indicateurs' },
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
