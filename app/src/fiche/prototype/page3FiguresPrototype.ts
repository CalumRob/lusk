/**
 * [PROTOTYPE page 3 — JETABLE] Interrupteur de développement `?page3-prototype=1`.
 *
 * Hors développement, les deux composants valent `null` : la branche morte est
 * éliminée au build, aucun chunk de prototype n'est produit, et la page 3 garde
 * exactement ses figures de production. Aucune route, aucun paramètre d'API,
 * aucune donnée : seul le rendu interne des deux figures est remplacé, avec
 * l'alignement vertical de la prose de couverture scopé à cette section.
 */
import { defineAsyncComponent } from 'vue'
import type { Component } from 'vue'

export const PAGE3_FIGURES_PROTOTYPE = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('page3-prototype') === '1'

export const FigureCouverturePrototype: Component | null = PAGE3_FIGURES_PROTOTYPE
  ? defineAsyncComponent(() => import('./CahierMobiliteShareTrack.prototype.vue'))
  : null

export const FigureRaccordementPrototype: Component | null = PAGE3_FIGURES_PROTOTYPE
  ? defineAsyncComponent(() => import('./CahierMobiliteRaccordementCurve.prototype.vue'))
  : null

/**
 * [PROTOTYPE page 3 — JETABLE] Stable app-owned figure title for the curve.
 * A presentation override only: no producer descriptor, contract or factual
 * metadata is regenerated.
 */
export const TITRE_COURBE_PROTOTYPE = 'Population bretonne joignable selon le temps de trajet'
