// #868 — câblage RÉEL des routes API interceptées par la preuve mobile overflow,
// partagé entre le vérifieur (verify-mobile-cahier-overflow.mjs) et le contrôle
// sans navigateur (verify-overflow-api-routes.mjs) :
//   - API_ROUTE_TABLE : patterns dans l'ORDRE D'ENREGISTREMENT page.route
//     (Playwright : le DERNIER handler enregistré qui matche gagne) — le catch-all
//     fail-closed 599 est donc EN PREMIER.
//   - makeApiHandlers(deps) : les vrais handlers (fixture catalogue, read-batch,
//     routes retirées 599, catch-all 599).
//   - installApiRoutes(page, handlers) : la vraie boucle d'installation, appelée
//     telle quelle par les deux consommateurs — un ordre ou un handler mal câblé
//     est donc détectable sans navigateur via un faux page.

export const API_ROUTE_TABLE = [
  // fail-closed en premier : aucune requête API hors fixtures n'atteint le proxy public
  { pattern: '**/api/**', kind: 'fail-closed-599' },
  // découverte servie par la fixture catalogue native
  { pattern: '**/api/resources', kind: 'catalogue' },
  // lectures sémantiques en lot servies par les fixtures natives
  { pattern: '**/api/resources/read-batch', kind: 'read-batch' },
  // routes theme-facts retirées (#868) : jamais appelées par le navigateur
  { pattern: '**/api/territories/commune/35238/themes/mobilite/facts', kind: 'retired-599' },
  { pattern: '**/api/territories/commune/35238/themes/mobilite/comparison', kind: 'retired-599' },
]

export function globToRegExp(pattern) {
  // conversion minimale des jokers Playwright utilisés ici : ** = n'importe quoi, * = segment
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '*') {
      if (pattern[i + 1] === '*') { re += '.*'; i++ } else { re += '[^/]*' }
    } else {
      re += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp('^' + re + '$')
}

/**
 * Les vrais handlers, câblés sur les fixtures. deps :
 *   catalogue()        -> Response-like { json() } de la fixture catalogue native
 *   themeBatch({items})-> { results } fixture des lectures non-AEDAR
 *   aedarBatch({items})-> { results } fixture AEDAR
 *   readCalls          -> compteurs partagés (retiredThemeFactsRoutes, themeBatches, aedarBatches, aedarItems)
 */
export function makeApiHandlers(deps) {
  return {
    'fail-closed-599': async (route) => {
      await route.fulfill({ status: 599, contentType: 'application/json',
        body: JSON.stringify({ error: 'unexpected API traffic in fixture-only proof' }) })
    },
    'catalogue': async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(await deps.catalogue().json()) })
    },
    'read-batch': async (route) => {
      const request = route.request().postDataJSON()
      // Route by the DECLARED producer resource kind, not by the shape of one
      // item: the AEDAR summary and aggregate-comparison reads carry no TYPEQU
      // coordinate and must never fall into the theme-facts fixture (#955).
      const resourceKind = deps.resourceKind ?? (() => undefined)
      const isAedarItem = (item) => {
        const kind = resourceKind(item.resource)
        return kind ? kind.startsWith('aedar_') : Array.isArray(item.coordinates?.typequ)
      }
      const aedarItems = request.items.filter(isAedarItem)
      const themeItems = request.items.filter((item) => !isAedarItem(item))
      if (aedarItems.length) {
        const aedarFactItems = aedarItems.filter((item) =>
          item.intent?.kind === 'facts' && Array.isArray(item.coordinates?.typequ))
        const aedarSummaryItems = aedarItems.filter((item) => item.resource === 'aedar_territory_summary')
        const aedarComparisonItems = aedarItems.filter((item) =>
          item.resource === 'aedar_territorial_aggregate' && item.intent?.kind !== 'facts')
        if (aedarFactItems.length) deps.readCalls.aedarBatches += 1
        if (aedarSummaryItems.length) {
          deps.readCalls.aedarSummaryBatches = (deps.readCalls.aedarSummaryBatches ?? 0) + 1
          deps.readCalls.aedarSummaryTargets ??= []
          deps.readCalls.aedarSummaryTargets.push(...aedarSummaryItems.map((item) => ({
            id: item.id, target: item.target,
          })))
        }
        if (aedarComparisonItems.length) deps.readCalls.aedarComparisonBatches = (deps.readCalls.aedarComparisonBatches ?? 0) + 1
        deps.readCalls.aedarItems.push(...aedarFactItems.map((item) => ({
          id: item.id,
          resource: item.resource,
          target: item.target,
          typequ: item.coordinates.typequ,
          fields: item.fields ?? [],
        })))
      }
      if (themeItems.length) deps.readCalls.themeBatches += 1
      const results = []
      // Compat : themeBatch/aedarBatch peuvent renvoyer un Response (fixture
      // native) ou un simple { results } (contrôle sans navigateur).
      const batchResults = async (batch) => (batch && typeof batch.json === 'function' ? (await batch.json()).results : batch?.results) ?? []
      if (themeItems.length) results.push(...await batchResults(deps.themeBatch({ items: themeItems })))
      if (aedarItems.length) results.push(...await batchResults(deps.aedarBatch({ items: aedarItems })))
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ contract: 'semantic-read-batch-v1', results }) })
    },
    'retired-599': async (route) => {
      deps.readCalls.retiredThemeFactsRoutes += 1
      await route.fulfill({ status: 599, contentType: 'application/json', body: 'retired route' })
    },
  }
}

/**
 * La vraie boucle d'installation : enregistre chaque pattern de la table DANS
 * L'ORDRE via page.route(pattern, handlers[kind]). Partagée par le vérifieur réel
 * et le contrôle sans navigateur (qui passe un faux page).
 */
export async function installApiRoutes(page, handlers, table = API_ROUTE_TABLE) {
  for (const entry of table) {
    await page.route(entry.pattern, handlers[entry.kind])
  }
}
