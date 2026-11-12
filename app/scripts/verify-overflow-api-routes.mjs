// #868 — régression SANS navigateur du câblage RÉEL des routes API de la preuve
// mobile overflow : on installe via installApiRoutes (la même boucle que le
// vérifieur) sur un faux page qui enregistre les handlers, puis on pilote les
// handlers enregistrés avec latest-first matching (sémantique Playwright).
// Prouve : GET /api/resources -> fixture catalogue, read-batch -> fixtures,
// API inconnue / routes retirées -> 599, /data non intercepté. Et la sensibilité :
// inverser la boucle d'installation réelle ou câbler un mauvais handler DOIT être
// détecté par ce contrôle. Aucun navigateur lancé.
import assert from 'node:assert/strict'
import { API_ROUTE_TABLE, globToRegExp, installApiRoutes, makeApiHandlers } from './overflow-api-routes.mjs'

// Faux page/route/request : enregistre les handlers installés et rejoue la
// sémantique Playwright (dernier enregistré qui matche gagne).
function fakePage() {
  const registrations = []
  return {
    registrations,
    route(pattern, handler) { registrations.push({ pattern, handler }) },
    async fetch(url, body) {
      for (let i = registrations.length - 1; i >= 0; i--) {
        if (globToRegExp(registrations[i].pattern).test(url)) {
          const route = {
            request: () => ({ postDataJSON: () => body }),
            fulfilled: null,
            async fulfill(response) { this.fulfilled = response },
          }
          await registrations[i].handler(route)
          return route.fulfilled
        }
      }
      return null // non intercepté
    },
  }
}

// Fausses fixtures identifiables (mêmes contrats que les vraies fixtures natives)
const catalogueFixture = { contract: 'semantic-resource-catalogue-v1', resources: [{ resource_id: 'FIXTURE-CATALOGUE' }] }
const deps = {
  catalogue: () => ({ json: async () => catalogueFixture }),
  resourceKind: (resource) => resource === 'aedar_territorial_aggregate' ? 'aedar_source_grain'
    : resource === 'aedar_territory_summary' ? 'aedar_territory_summary' : null,
  themeBatch: ({ items }) => ({ results: items.map((item) => ({ id: item.id, resource: item.resource, data: { fixture: 'theme-batch' } })) }),
  aedarBatch: ({ items }) => ({ results: items.map((item) => ({ id: item.id, resource: item.resource, data: { fixture: 'aedar-batch' } })) }),
  readCalls: { retiredThemeFactsRoutes: 0, themeBatches: 0, aedarBatches: 0, aedarItems: [] },
}

const page = fakePage()
await installApiRoutes(page, makeApiHandlers(deps))

// le catch-all fail-closed est bien installé EN PREMIER (dernier-gagnant sinon)
assert.equal(page.registrations[0].pattern, '**/api/**')
assert.equal(page.registrations.length, API_ROUTE_TABLE.length)

// GET /api/resources -> fixture catalogue (200)
const catalogue = await page.fetch('/api/resources')
assert.equal(catalogue.status, 200)
assert.deepEqual(JSON.parse(catalogue.body), catalogueFixture)

// POST read-batch -> fixtures thème + AEDAR
const batch = await page.fetch('/api/resources/read-batch', { items: [
  { id: 't1', resource: 'subventions_annuelles', target: { kind: 'territory', type: 'commune', id: '35238' }, intent: { kind: 'facts' } },
  { id: 'a1', resource: 'aedar_territorial_aggregate', target: { kind: 'territory', type: 'commune', id: '35238' }, coordinates: { typequ: ['A'] }, intent: { kind: 'facts' }, fields: [] },
  { id: 's1', resource: 'aedar_territory_summary', target: { kind: 'territory', type: 'commune', id: '35238' }, intent: { kind: 'facts' } },
  { id: 'c1', resource: 'aedar_territorial_aggregate', target: { kind: 'territory', type: 'commune', id: '35238' }, coordinates: { measure: ['count_20_car_mean'] }, intent: { kind: 'fixed_comparison', context: 'density_class' }, fields: ['group_value'] },
] })
assert.equal(batch.status, 200)
const batchBody = JSON.parse(batch.body)
assert.equal(batchBody.contract, 'semantic-read-batch-v1')
assert.deepEqual(batchBody.results.map((r) => r.data.fixture).sort(), ['aedar-batch', 'aedar-batch', 'aedar-batch', 'theme-batch'])
assert.equal(deps.readCalls.themeBatches, 1)
assert.equal(deps.readCalls.aedarBatches, 1)
assert.equal(deps.readCalls.aedarSummaryBatches, 1)
assert.equal(deps.readCalls.aedarComparisonBatches, 1)
assert.equal(deps.readCalls.aedarItems.length, 1)

// API inconnue -> 599 fail-closed
assert.equal((await page.fetch('/api/anything/else')).status, 599)
// routes theme-facts retirées -> 599 + compteur
assert.equal((await page.fetch('/api/territories/commune/35238/themes/mobilite/facts')).status, 599)
assert.equal((await page.fetch('/api/territories/commune/35238/themes/mobilite/comparison')).status, 599)
assert.equal(deps.readCalls.retiredThemeFactsRoutes, 2)
// /data n'est pas une route API interceptée
assert.equal(await page.fetch('/data/territoires.json'), null)

// SENSIBILITÉ : inverser la boucle d'installation réelle doit être détecté
// (le catch-all passerait alors en dernier -> /api/resources retomberait en 599)
const reversed = fakePage()
await installApiRoutes(reversed, makeApiHandlers(deps), [...API_ROUTE_TABLE].reverse())
assert.equal((await reversed.fetch('/api/resources')).status, 599,
  'installation inversée : le contrôle DOIT voir /api/resources retomber en 599')

// SENSIBILITÉ : câbler le catalogue sur le mauvais handler doit être détecté
const miswired = fakePage()
const handlers = makeApiHandlers(deps)
await installApiRoutes(miswired, { ...handlers, catalogue: handlers['fail-closed-599'] })
assert.equal((await miswired.fetch('/api/resources')).status, 599,
  'handler catalogue mal câblé : le contrôle DOIT voir 599')

console.log(JSON.stringify({ ok: true, installed: page.registrations.map((r) => r.pattern) }))
