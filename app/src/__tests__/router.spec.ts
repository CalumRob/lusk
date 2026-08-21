import { createMemoryHistory, createRouter } from 'vue-router'

import { describe, expect, it } from 'vitest'

import { routes } from '../router'

/**
 * The route table is the app's skeleton — it must match the site map
 * (site-map.md, /, /carte, /communes, /epcis, /departements,
 * /territoire/:type/:id, /methodologie, /a-propos) so later tickets slot
 * their views in without renaming anything.
 */

describe('router — route table', () => {
  it('registers every site-map route, in order', () => {
    expect(routes.map((r) => r.path)).toEqual([
      '/',
      '/carte',
      '/communes',
      '/epcis',
      '/departements',
      '/territoire/:type/:id',
      '/methodologie',
      '/sources',
      '/a-propos',
      '/indicateurs/:theme/:indicator',
    ])
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
    '/methodologie',
    '/sources',
    '/a-propos',
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
