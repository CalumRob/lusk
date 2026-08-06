/**
 * The Économie Story (issue #121, forme reshapée — issue #120): the LQ is the
 * Story, never a block indicator. TWO readings, one per story_key:
 *
 * - « ce que la commune abrite » — the top-5 specialisations by LQ, precomputed
 *   by the pipeline (never recomputed here). Communes, EPCIs, départements.
 *   Each ligne: the activity label (always from the payload, never hard-coded),
 *   its LQ and its establishment count. One fixed title for every territory
 *   type (issue #153) — the matière rides in the precision label, rendered
 *   with the title.
 * - « ce que la Bretagne abrite » — the région's top-5 by PRESENCE (its LQ is
 *   degenerate, all ≡ 1): n + part of the Breton parc. A structure list, not
 *   an LQ reading.
 *
 * The copy is generated from the payload rows — never hand-written per
 * territoire (reproducibility rule); the vintage rides on the rows themselves
 * (issue #74, formaterVintage). Null for a territory without an Économie
 * Story — the block never invents a reading.
 */

import type { HistoireEconomie } from '@/payload/types'
import { formaterNombreFR, formaterVintage } from '@/payload/selectors'

export interface LigneSpecialisation {
  rang: number
  label: string
  /** The formatted measure: LQ + n (specialisation) or n + part du parc (presence). */
  mesure: string
}

export interface StoryEconomie {
  storyKey: HistoireEconomie['story_key']
  titre: string
  /**
   * The small label naming the matière, rendered with the title (issues #153 +
   * #156): « Spécialisation des établissements actifs ». The title stays
   * fabric-neutral ("abrite"); the precision carries the establishment
   * reading. Only the specialisation story carries one — the région's presence
   * reading stays untouched.
   */
  precision?: string
  uneLigne: string
  commentLire: string
  lignes: LigneSpecialisation[]
  /** The story's own vintage stamp (issue #74) — the rows share one source. */
  vintage: string
}

/**
 * The « ce que la commune abrite » title — deliberately single and fixed for
 * every territory type (issue #153: an EPCI or département fiche shows the
 * same title, no per-type adaptation).
 */
const TITRE_SPECIALISATION = 'Ce que la commune abrite'

/** The matière, named with the title (issues #153 + #156). */
const PRECISION_SPECIALISATION = 'Spécialisation des établissements actifs'

const TITRE_PRESENCE = 'Ce que la Bretagne abrite'

const COMMENT_LIRE_SPECIALISATION =
  'Le quotient de localisation (LQ) compare la part de l’activité dans les établissements actifs du ' +
  'territoire à la moyenne bretonne : au-dessus de 1, l’activité est surreprésentée dans le ' +
  'tissu productif local. La mesure porte sur les établissements, jamais sur les emplois ni sur ' +
  'les personnes.'

const COMMENT_LIRE_PRESENCE =
  'La région est sa propre référence : son quotient de localisation vaut 1 pour toutes les ' +
  'activités, la lecture de spécialisation n’a pas de sens. La liste porte sur la présence — ' +
  'les types d’établissements les plus nombreux du parc breton, avec leur part du parc.'

/** The first three labels joined in French ("A, B et C"). */
function joindreTrois(labels: string[]): string {
  const trois = labels.slice(0, 3)
  if (trois.length <= 1) return trois[0] ?? ''
  return `${trois.slice(0, -1).join(', ')} et ${trois[trois.length - 1]}`
}

/** The establishment count with its unit, pluralized ("1 établissement" / "12 établissements"). */
function formaterEtablissements(n: number): string {
  return `${formaterNombreFR(n, 0)} établissement${n > 1 ? 's' : ''}`
}

export function storyEconomie(
  lignes: HistoireEconomie[],
  nom: string,
): StoryEconomie | null {
  if (lignes.length === 0) return null

  const premier = lignes[0]
  const labels = lignes.map((l) => l.activity_label)
  const nomPresence = premier.story_key === 'ce-que-la-bretagne-abrite' ? `La ${nom}` : nom

  const lignesAffichables: LigneSpecialisation[] = lignes.map((l) => ({
    rang: l.rang,
    label: l.activity_label,
    mesure:
      l.story_key === 'ce-que-la-bretagne-abrite'
        ? `${formaterEtablissements(l.n)} · ${formaterNombreFR(l.part_parc * 100, 1)} % du parc breton`
        : `LQ ${formaterNombreFR(l.lq, 1)} · ${formaterEtablissements(l.n)}`,
  }))

  return {
    storyKey: premier.story_key,
    titre:
      premier.story_key === 'ce-que-la-bretagne-abrite'
        ? TITRE_PRESENCE
        : TITRE_SPECIALISATION,
    ...(premier.story_key === 'ce-que-la-bretagne-abrite'
      ? {}
      : { precision: PRECISION_SPECIALISATION }),
    uneLigne:
      premier.story_key === 'ce-que-la-bretagne-abrite'
        ? `${nomPresence} abrite surtout ${joindreTrois(labels)}.`
        : `${nom} se distingue par la spécialisation de ses établissements actifs.`,
    commentLire:
      premier.story_key === 'ce-que-la-bretagne-abrite'
        ? COMMENT_LIRE_PRESENCE
        : COMMENT_LIRE_SPECIALISATION,
    lignes: lignesAffichables,
    vintage: formaterVintage(premier),
  }
}
