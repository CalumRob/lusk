// #868 — régression SANS navigateur de la sémantique de routage Playwright utilisée
// par verify-mobile-cahier-overflow.mjs : la table des routes API est enregistrée dans
// l'ordre, le dernier handler qui matche gagne. On vérifie au seam réel (resolveApiRoute)
// que GET /api/resources reçoit la fixture catalogue, le read-batch sa fixture, et que
// toute autre requête API (y compris une ancienne route theme-facts) retombe en 599.
// Aucun lancement de navigateur ici.
import assert from 'node:assert/strict'
import { API_ROUTE_TABLE, resolveApiRoute } from './overflow-api-routes.mjs'

assert.equal(resolveApiRoute('/api/resources'), 'catalogue',
  'GET /api/resources doit recevoir la fixture catalogue, pas le catch-all 599')
assert.equal(resolveApiRoute('/api/resources/read-batch'), 'read-batch',
  'POST /api/resources/read-batch doit recevoir sa fixture')
assert.equal(resolveApiRoute('/api/resources/read'), 'fail-closed-599',
  'une route API non supportée doit échouer fermé (599), jamais le proxy public')
assert.equal(resolveApiRoute('/api/territories/commune/35238/themes/mobilite/facts'), 'retired-599',
  'les routes theme-facts retirées doivent rester 599')
assert.equal(resolveApiRoute('/api/territories/commune/35238/themes/mobilite/comparison'), 'retired-599')
assert.equal(resolveApiRoute('/api/anything/else'), 'fail-closed-599')
assert.equal(resolveApiRoute('/data/territoires.json'), 'unmatched',
  'les requêtes /data/ ne sont pas des routes API interceptées')

// le catch-all est bien enregistré EN PREMIER (sinon il masquerait tout, sémantique
// dernier-enregistré-gagne de Playwright)
assert.equal(API_ROUTE_TABLE[0].kind, 'fail-closed-599',
  'le catch-all fail-closed doit être le premier handler enregistré')
assert.ok(API_ROUTE_TABLE.findIndex((r) => r.kind === 'catalogue') > 0)
assert.ok(API_ROUTE_TABLE.findIndex((r) => r.kind === 'read-batch') > API_ROUTE_TABLE.findIndex((r) => r.kind === 'catalogue'))

console.log(JSON.stringify({ ok: true, table: API_ROUTE_TABLE.map((r) => r.kind) }))
