/**
 * [PROTOTYPE #499 — JETABLE] Le registre des trois variantes de lecture de la
 * fiche et le commutateur fixe du bas.
 *
 * Développement UNIQUEMENT : tout ce module est sous `import.meta.env.DEV` —
 * un build de production reçoit des tableaux vides, `varianteDeUrl` renvoie
 * toujours null, le commutateur n'existe pas (les composants ne sont jamais
 * chargés : imports dynamiques dans la branche morte, éliminés au build).
 *
 * Le choix vit dans l'URL (`?variant=A|B|C`) — rechargement et partage
 * stables — aux côtés des autres paramètres de la fiche (?theme=…), que
 * `choisirOnglet` préserve désormais.
 */

import { defineAsyncComponent } from 'vue'
import type { Component } from 'vue'

/** Une variante : sa clé d'URL, son nom affiché, son composant paresseux. */
export interface VarianteProto {
  clef: 'A' | 'B' | 'C'
  nom: string
  composant: Component
}

const CLEFS = ['A', 'B', 'C'] as const

export const VARIANTES: readonly VarianteProto[] = import.meta.env.DEV
  ? [
      {
        clef: 'A',
        nom: 'Journal',
        composant: defineAsyncComponent(() => import('./VarianteJournal.vue')),
      },
      {
        clef: 'B',
        nom: 'Cahier',
        composant: defineAsyncComponent(() => import('./VarianteCahier.vue')),
      },
      {
        clef: 'C',
        nom: 'Fil',
        composant: defineAsyncComponent(() => import('./VarianteFil.vue')),
      },
    ]
  : []

/** La variante demandée par l'URL — null hors dev ou hors A|B|C. */
export function varianteDeUrl(valeur: unknown): VarianteProto | null {
  if (!import.meta.env.DEV) return null
  if (typeof valeur !== 'string') return null
  const clef = valeur.toUpperCase()
  return VARIANTES.find((v) => v.clef === clef) ?? null
}

/** La clé voisine pour le cyclage clavier (← / →), en boucle. */
export function clefVoisine(clef: 'A' | 'B' | 'C' | null, sens: 1 | -1): 'A' | 'B' | 'C' {
  const base = clef ? CLEFS.indexOf(clef) : sens === 1 ? -1 : 0
  const index = (base + sens + CLEFS.length) % CLEFS.length
  return CLEFS[index]
}

/** Le commutateur fixe du bas — null hors développement (jamais monté). */
export const CommutateurPrototype: Component | null = import.meta.env.DEV
  ? defineAsyncComponent(() => import('./CommutateurPrototype.vue'))
  : null
