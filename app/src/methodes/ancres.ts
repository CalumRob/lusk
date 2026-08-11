/**
 * Le slug d'ancre partagé des registres Méthodes — #source-<slug> (sources.ts)
 * et #indicateur-<clef> (indicateurs.ts) normalisent la même clé de payload
 * (un slug stable déjà : part_passoires), préfixée pour ne jamais entrer en
 * collision avec l'ancrage de section (#sources, #indicateurs).
 */
export function slugifierAncre(prefixe: string, valeur: string): string {
  return `${prefixe}-${valeur.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`
}
