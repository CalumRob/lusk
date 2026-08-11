/**
 * The story-scalar declaration (ADR-0019 — « la Carte, miroir de la fiche ») :
 * per theme, the scalar FIELD NAMES of the Story's numbers, in contract order
 * (the declaration order of the Histoire interfaces in payload/types.ts — the
 * order the pipeline publishes them). Consumed by the carte's layer model
 * (carte/coucheModel.ts), which derives the theme's story layers AND its
 * default layer (the FIRST scalar — the α rule of ADR-0019) from here.
 *
 * A theme without a story scalar (Économie today — its LQ Story reads a list,
 * never a per-territory scalar) declares [] : the carte has no map default for
 * it. Distribution signatures (the dens_* / dec_* bins of the Mobilité Story)
 * are deliberately NOT declared — a choropleth needs one value per territory.
 */

import type { Theme } from '@/payload/types'

export const SCALAIRES_STORY = {
  /** « Trajectoire démographique » — the two annualized per-mille rates the reading crosses. */
  demographie: ['taux_solde_naturel', 'taux_solde_migratoire'],
  /** « Vingt minutes sans voiture » — the reading, the vélo mark, and the delta the salience fires on. */
  mobilite: ['div_loss_t', 'div_loss_b', 'delta'],
  /** « L'état énergétique du parc » — the share of the DPE base in F/G. */
  habitat: ['part_passoires'],
  /** « Se densifier, s'étaler, ou s'en aller » — the artif scalars (the per-capita states + the trajectory). */
  milieux: ['artif_m2_par_habitant', 'artif_m3_par_habitant', 'trajectoire_artif_par_habitant'],
  /** The LQ Story reads a top-5 list, never a scalar — no map default (ADR-0019). */
  economie: [],
} as const satisfies Record<Theme, readonly string[]>
