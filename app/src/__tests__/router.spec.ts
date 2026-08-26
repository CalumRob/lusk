import { createMemoryHistory, createRouter } from 'vue-router'

import { describe, expect, it } from 'vitest'

import { routes } from '../router'

/**
 * The route table is the app's skeleton (#410 — la bascule atomique) : les
 * fiches, les listes, le catalogue des Pages d'indicateur, Sources et À
 * propos. `/methodologie` est RETIRÉ (Méthodes vit désormais dans Sources et
 * À propos — #406) ; `/carte` reste routé mais SANS AUCUN LIEN face-utilisateur
 * (ruling produit 2026-08-26 : outil d'exploration personnel du PO).
 */

const CARTES_ATTENDUES = [
  '/',
  '/carte',
  '/communes',
  '/epcis',
  '/departements',
  '/territoire/:type/:id',
  '/sources',
  '/a-propos',
  // Le catalogue (#409) — la route exacte AVANT sa sœur paramétrée.
  '/indicateurs',
  '/indicateurs/:theme/:indicator',
]

describe('router — route table', () => {
  it('registers every site-map route, in order', () => {
    expect(routes.map((r) => r.path)).toEqual(CARTES_ATTENDUES)
  })

  it('retires /methodologie — no partial alias survives the cutover (#410)', () => {
    expect(routes.some((r) => r.path === '/methodologie')).toBe(false)
    expect(routes.some((r) => r.name === 'methodologie')).toBe(false)
  })

  it('keeps /carte routed — épargnée par ruling PO (2026-08-26), outil sans lien (#410)', () => {
    const carte = routes.find((r) => r.path === '/carte')
    expect(carte).toBeDefined()
    expect(carte?.name).toBe('carte')
  })

  it('gives each route a stable name', () => {
    const names = routes.map((r) => r.name)
    for (const name of names) expect(name).toBeTruthy()
    expect(new Set(names).size).toBe(names.length)
  })

  it('passes route params as props on the territoire route', () => {
    const territoire = routes.find((r) => r.path === '/territoire/:type/:id')
    expect(territoire?.props).toBe(true)
  })
})

describe('router — navigation resolves to the French placeholder views', () => {
  it.each([
    '/',
    '/carte',
    '/communes',
    '/epcis',
    '/departements',
    '/territoire/commune/35000',
    '/sources',
    '/a-propos',
    '/indicateurs',
    '/indicateurs/demographie/densite',
  ])('resolves "%s" to a registered component', async (path) => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push(path)
    await router.isReady()

    const matched = router.currentRoute.value.matched[0]
    expect(matched).toBeTruthy()
    expect(matched.components?.default).toBeTruthy()
    expect(router.currentRoute.value.fullPath).toBe(path)
    expect(router.currentRoute.value.name).toBeTruthy()
  })
})
