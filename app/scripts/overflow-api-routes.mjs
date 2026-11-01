// #868 — table des routes API interceptées par la preuve mobile overflow, dans
// l'ORDRE D'ENREGISTREMENT Playwright (page.route) : le DERNIER handler enregistré
// qui matche gagne. Le catch-all fail-closed (599) est donc enregistré EN PREMIER,
// puis les routes supportées (catalogue GET /api/resources, read-batch), puis les
// routes retirées (theme-facts) — jamais l'inverse, sinon le catch-all masque tout.
//
// resolveApiRoute(url) rejoue cette sémantique sans navigateur : itéré depuis la fin,
// le premier pattern qui matche gagne — exactement comme Playwright.

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

function globToRegExp(pattern) {
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
 * Résout la route API pour une URL, sémantique Playwright « dernier enregistré
 * qui matche gagne » : on itère la table depuis la fin.
 */
export function resolveApiRoute(url) {
  for (let i = API_ROUTE_TABLE.length - 1; i >= 0; i--) {
    if (globToRegExp(API_ROUTE_TABLE[i].pattern).test(url)) return API_ROUTE_TABLE[i].kind
  }
  return 'unmatched'
}
