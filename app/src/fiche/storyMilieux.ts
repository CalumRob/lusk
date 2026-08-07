/**
 * The Milieux Story copy (issue #174, ADR-0014) — « Se densifier, s'étaler,
 * ou s'en aller », the SINGLE Story of the fifth theme: a territory's growth
 * against its land, read as exactly ONE of four readings by the SIGNS of the
 * two forces (seuil 0 — ZAN is a zero-objective and the data is a complete
 * census: a 0 is a real 0):
 *
 * - grandir-en-se-densifiant — population up, zero new consumption
 * - grandir-en-setalant — population up, consumption > 0
 * - sen-aller-et-consommer-quand-meme — population down, consumption > 0
 * - les-departs-laissent-la-place-a-la-renaturation — population down,
 *   zero new consumption. Renaturation is POTENTIAL, never measured: the
 *   flux counts consumption, not renaturation — the prose says it.
 *
 * The « comment lire » carries the precision riders: the two forces and
 * their sources (the population from the Démographie série historique, never
 * CONSOENAF's embedded fields), the two-clocks gap (the « Consommation
 * d'ENAF » indicator runs on the annual CONSOENAF clock and is deliberately
 * fresher than this reading, pinned to the population clock whose window
 * derives from the RP millésimes — 2017-2023 today, sliding when RP
 * updates), and the intensity (m² of ENAF per added inhabitant, published
 * only when Δpopulation is meaningfully positive). Pure, isolated,
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
  /** L'intensité (m² d'ENAF par habitant ajouté) — null sous le seuil (jamais inventée). */
  intensite: string | null
}

const TITRE = 'Se densifier, s’étaler, ou s’en aller'

const UNE_LIGNE: Record<LectureMilieux, string> = {
  'grandir-en-se-densifiant': 'Le territoire grandit sans consommer de nouveaux espaces.',
  'grandir-en-setalant': 'Le territoire grandit en s’étalant.',
  'sen-aller-et-consommer-quand-meme': 'Le territoire se vide — et consomme quand même.',
  'les-departs-laissent-la-place-a-la-renaturation': 'Les départs laissent la place à la renaturation.',
}

/** Le rider de lecture — ce que le signe dit, en plus du socle commun. */
const RIDER: Record<LectureMilieux, string> = {
  'grandir-en-se-densifiant':
    'La population augmente sans nouvelle consommation : le territoire se densifie, la croissance est absorbée par le bâti existant — le zéro est un vrai zéro, l’objectif ZAN atteint sur la fenêtre.',
  'grandir-en-setalant':
    'La population augmente et la consommation suit : la croissance s’étale sur de nouveaux espaces naturels, agricoles et forestiers.',
  'sen-aller-et-consommer-quand-meme':
    'La population diminue et la consommation continue : le territoire se vide, et consomme quand même.',
  'les-departs-laissent-la-place-a-la-renaturation':
    'La population diminue et la consommation s’arrête. La renaturation est potentielle, jamais mesurée : la donnée montre l’absence de nouvelle consommation, pas un retour de la nature.',
}

/**
 * The Story of a Milieux territoire — the copy keyed by the pipeline's
 * classification. Null for an unknown/absent classification — the block
 * never invents a reading.
 */
export function storyMilieux(
  classification: string | null,
  deltaPopulation: number,
  consoFenetre: number,
  intensiteM2ParHabitant: number | null,
  periode: string,
): StoryMilieux | null {
  if (classification === null || !(classification in UNE_LIGNE)) return null
  const lecture = classification as LectureMilieux

  const population = `${formaterNombreFR(deltaPopulation, 0)} habitant${Math.abs(deltaPopulation) > 1 ? 's' : ''}`
  const conso = `${formaterNombreFR(consoFenetre, 2)} ha`
  const intensite =
    intensiteM2ParHabitant === null
      ? null
      : `${formaterNombreFR(Math.round(intensiteM2ParHabitant), 0)} m² d’ENAF par habitant ajouté`

  return {
    clef: lecture,
    titre: TITRE,
    uneLigne: UNE_LIGNE[lecture],
    commentLire:
      `Entre ${periode}, la lecture croise deux forces : ${population} et ` +
      `${conso} d’espaces naturels, agricoles et forestiers consommés. ` +
      `La population vient de la série historique du recensement, jamais des ` +
      `champs embarqués de CONSOENAF ; la consommation est la somme des annuels ` +
      `CONSOENAF sur la même fenêtre. ${RIDER[lecture]} ` +
      `La lecture est épinglée à l’horloge de la population — sa fenêtre dérive ` +
      `des millésimes du recensement et glisse quand l’INSEE publie ; ` +
      `l’indicateur « Consommation d’ENAF », lui, tourne sur l’horloge annuelle ` +
      `CONSOENAF et est délibérément plus frais.`,
    intensite,
  }
}
