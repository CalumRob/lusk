/**
 * The Milieux Story copy (issue #174, ADR-0014, re-keyed by spec #225) —
 * « Se densifier, s'étaler, ou s'en aller », the SINGLE Story of the fifth
 * theme: a territory's growth against its land, read as exactly ONE of four
 * readings by the SIGNS of the two forces (seuil 0 — ZAN is a zero-objective
 * and the data is a complete census: a 0 is a real 0):
 *
 * - grandir-en-se-densifiant — population up, per-capita state falling
 * - grandir-en-setalant — population up, per-capita state rising
 * - sen-aller-et-consommer-quand-meme — population down, per-capita state
 *   rising
 * - les-departs-laissent-la-place-a-la-renaturation — population down,
 *   per-capita state falling (requires land itself to shrink — MEASURED
 *   désartificialisation, never an aspiration)
 *
 * The land force is the OCS-GE per-capita STATE trajectory
 * (`trajectoire_artif_par_habitant`, the M3/M2 per-capita ratio) — not the
 * CONSOENAF flow — so renaturation is measured (artif_m3 < artif_m2 is real
 * désartificialisation) and the per-capita figure exists for every territory.
 * The « comment lire » quotes both forces on their own clocks (the population
 * window `periode_pop` and the OCS-GE state window `periode_artif`), states
 * the bracketing population rule once (the RP millésimes of `periode_pop`,
 * never hard-coded), and names the per-département millésimes when the
 * aggregate mixes them (cross-département EPCIs, the région). The intensity
 * is the figure's job now (#65) — it stays OUT of the prose. Pure, isolated,
 * deterministic; the copy is keyed by the pipeline's classification.
 */

import { formaterNombreFR } from '@/payload/selectors'

export type LectureMilieux =
  | 'grandir-en-se-densifiant'
  | 'grandir-en-setalant'
  | 'sen-aller-et-consommer-quand-meme'
  | 'les-departs-laissent-la-place-a-la-renaturation'

export interface StoryMilieux {
  clef: LectureMilieux
  titre: string
  uneLigne: string
  commentLire: string
}

const TITRE = 'Se densifier, s’étaler, ou s’en aller'

const UNE_LIGNE: Record<LectureMilieux, string> = {
  'grandir-en-se-densifiant': 'La population grandit plus vite que la terre artificialisée.',
  'grandir-en-setalant': 'Le territoire grandit en s’étalant.',
  'sen-aller-et-consommer-quand-meme': 'Le territoire se vide — et consomme quand même.',
  'les-departs-laissent-la-place-a-la-renaturation': 'Les départs laissent la place à la renaturation.',
}

/**
 * Le rider de lecture — ce que le signe dit, en plus du socle commun. La
 * trajectoire par habitant (le ratio M3/M2 publié) y est citée : c'est la
 * seconde force de la lecture, mesurée. La renaturation, elle, est une phrase
 * honnête sur ce que l'état est — un état final inférieur à l'état initial,
 * une désartificialisation MESURÉE (plus aucun disclaimer « potentielle,
 * jamais mesurée »).
 */
const RIDER: Record<LectureMilieux, (ratio: string) => string> = {
  'grandir-en-se-densifiant': (ratio) =>
    `La surface artificialisée par habitant diminue (trajectoire par habitant de ${ratio}) : ` +
    `la population croît plus vite que la terre — le territoire se densifie.`,
  'grandir-en-setalant': (ratio) =>
    `La surface artificialisée par habitant augmente (trajectoire par habitant de ${ratio}) : ` +
    `la population croît moins vite que la terre — le territoire s’étale.`,
  'sen-aller-et-consommer-quand-meme': (ratio) =>
    `La population diminue et la surface artificialisée par habitant continue d’augmenter ` +
    `(trajectoire par habitant de ${ratio}) : le territoire se vide, et consomme quand même.`,
  'les-departs-laissent-la-place-a-la-renaturation': (ratio) =>
    `La population diminue et la surface artificialisée par habitant recule ` +
    `(trajectoire par habitant de ${ratio}) : l’état final est inférieur à l’état initial — ` +
    `la désartificialisation est mesurée.`,
}

/**
 * The Story of a Milieux territoire — the copy keyed by the pipeline's
 * classification. Null for an unknown/absent classification — the block
 * never invents a reading. The two forces are quoted on their own clocks:
 * the population window (`periodePop`) and the OCS-GE state window
 * (`periodeArtif` — a plain M2-M3 pair for a single-département territory, a
 * per-département span for the cross-département aggregates).
 */
export function storyMilieux(
  classification: string | null,
  deltaPopulation: number,
  artifM2ParHabitant: number,
  artifM3ParHabitant: number,
  trajectoire: number,
  periodePop: string,
  periodeArtif: string,
): StoryMilieux | null {
  if (classification === null || !(classification in UNE_LIGNE)) return null
  const lecture = classification as LectureMilieux

  const population =
    `${formaterNombreFR(deltaPopulation, 0)} habitant${Math.abs(deltaPopulation) > 1 ? 's' : ''}`
  const etatInitial = formaterNombreFR(Math.round(artifM2ParHabitant), 0)
  const etatFinal = formaterNombreFR(Math.round(artifM3ParHabitant), 0)
  const ratio = formaterNombreFR(trajectoire, 2)

  // la fenêtre des états : une paire « M2-M3 » (mono-département) ou un span
  // avec les dates par département (agrégats multi-dépt) — le rider de
  // mélange ne s'ajoute que dans le second cas, jamais une fenêtre unique
  // inventée pour un agrégat dont les millésimes diffèrent
  const etats = /^(\d{4})-(\d{4})$/.exec(periodeArtif)
  // le bracket RP de la fenêtre de population — les deux millésimes de la
  // règle de bracketing, jamais codés en dur (ils glissent avec la série)
  const rp = /^(\d{4})-(\d{4})$/.exec(periodePop)

  const socleCommun = etats
    ? `Entre ${periodePop}, la population a évolué de ${population} ; entre ` +
      `${etats[1]} et ${etats[2]} (millésimes OCS-GE), la surface artificialisée ` +
      `par habitant est passée de ${etatInitial} à ${etatFinal} m².`
    : `Entre ${periodePop}, la population a évolué de ${population} ; sur la fenêtre ` +
      `des états OCS-GE, la surface artificialisée par habitant est passée de ` +
      `${etatInitial} à ${etatFinal} m².`

  const bracketing = rp
    ? `La population est au recensement le plus proche de chaque état — ` +
      `${rp[1]} pour l’état initial, ${rp[2]} pour l’état final.`
    : `La population est au recensement le plus proche de chaque état.`

  const melange = etats
    ? ''
    : ` Les millésimes des états OCS-GE diffèrent entre les départements de ce ` +
      `territoire : ${periodeArtif}.`

  return {
    clef: lecture,
    titre: TITRE,
    uneLigne: UNE_LIGNE[lecture],
    commentLire: `${socleCommun} ${RIDER[lecture](ratio)} ${bracketing}${melange}`,
  }
}
