/**
 * The Mobilité Story (issue #142, ADR-0012) — the flagship's headline. ONE
 * resolved reading per territoire (issue #312), discriminated by story_key:
 *
 * - « vingt-minutes-sans-voiture » — the DEFAULT, always on: reads div_loss_t,
 *   "Sans voiture, X types de services disparaissent" — the count of service
 *   types that leave the territory's reach à pied ou en transports en commun
 *   at 20 minutes. The block renders the building-level distribution (the
 *   pipeline's precomputed density signature, median marked) against a
 *   same-scale comparison cloud (ADR-0011).
 * - « ce-que-le-velo-preserve » — the SALIENCE, replacing the default ONLY
 *   where the bike delta is real (the payload carries the resolved reading —
 *   salience_reason « delta-velo-saillant »): reads the delta — the service
 *   types cycling already rescues beyond foot/transit. Realized access only,
 *   never potential (no counterfactual).
 *
 * The selection is the PIPELINE's (issue #312 — the candidate pool is never
 * in the payload, ADR-0002): this mapper renders the resolved row, it never
 * chooses. The title « Vingt minutes sans voiture » is the ONE sanctioned
 * "sans voiture" phrase (CONTEXT.md): the « comment lire » carries the
 * precision « à pied ou en transports en commun à 20 minutes » AND quotes the
 * snapshot date — the flagship is a frozen computation on a slow clock, and
 * says so. The copy is generated from the payload rows, never hand-written
 * per territoire; the vintage rides on the rows themselves (issue #74).
 */

import type { HistoireMobilite } from '@/payload/types'
import { formaterDateFrancaise, formaterNombreFR, formaterVintage } from '@/payload/selectors'

import { SCALAIRES_STORY } from './storyScalaires'

/** The precomputed building-level distribution of div_loss_t (ADR-0012). */
export interface DistributionMobilite {
  /** Les 10 densités de la signature (une par bin de décile). */
  dens: (number | null)[]
  /** Les 10 bornes de déciles de la distribution. */
  dec: (number | null)[]
  min: number | null
  max: number | null
}

export interface StoryMobilite {
  storyKey: 'vingt-minutes-sans-voiture' | 'ce-que-le-velo-preserve'
  titre: string
  uneLigne: string
  commentLire: string
  divLossT: number
  divLossB: number
  delta: number
  /** L'estampille snapshot de la lecture (formaterVintage sur la ligne). */
  vintage: string
  /** La signature de distribution — portée par le défaut seulement (le vélo est hors contrat). */
  distribution: DistributionMobilite | null
}

const TITRE_VINGT_MINUTES = 'Vingt minutes sans voiture'
const TITRE_VELO = 'Ce que le vélo préserve'

/** Un compte de services au singulier/pluriel (« 35 types de services » / « 1 type de service »). */
function formaterTypes(n: number): string {
  return `${formaterNombreFR(n, 0)} type${n > 1 ? 's' : ''} de service${n > 1 ? 's' : ''}`
}

function distributionDe(histoire: HistoireMobilite): DistributionMobilite {
  return {
    dens: [
      histoire.dens_1, histoire.dens_2, histoire.dens_3, histoire.dens_4, histoire.dens_5,
      histoire.dens_6, histoire.dens_7, histoire.dens_8, histoire.dens_9, histoire.dens_10,
    ],
    dec: [
      histoire.dec_1, histoire.dec_2, histoire.dec_3, histoire.dec_4, histoire.dec_5,
      histoire.dec_6, histoire.dec_7, histoire.dec_8, histoire.dec_9, histoire.dec_10,
    ],
    min: histoire.dens_min,
    max: histoire.dens_max,
  }
}

/**
 * The Story of a Mobilité territoire — the resolved reading (issue #312): the
 * vélo reading when the payload carries it (story_key ce-que-le-velo-preserve,
 * salience_reason « delta-velo-saillant »), the default everywhere else.
 * Null for a territory without any Mobilité Story — the block never invents a
 * reading.
 */
export function storyMobilite(histoire: HistoireMobilite | null): StoryMobilite | null {
  if (!histoire) return null

  const [champLossT, champLossB, champDelta] = SCALAIRES_STORY.mobilite
  const date = formaterDateFrancaise(histoire.vintage_date_publication)

  if (histoire.story_key === 'ce-que-le-velo-preserve') {
    return {
      storyKey: histoire.story_key,
      titre: TITRE_VELO,
      uneLigne: `Le vélo préserve déjà ${formaterTypes(histoire[champDelta])}.`,
      commentLire:
        `Sans voiture, à pied ou en transports en commun à 20 minutes, ` +
        `${formaterTypes(histoire[champLossT])} sortent de l’accès quotidien ; à vélo, ` +
        `seulement ${formaterTypes(histoire[champLossB])}. Le vélo lit l’accès déjà réalisé — ` +
        `ce que le réseau actuel permet, jamais des infrastructures hypothétiques. ` +
        `Analyse calculée le ${date}.`,
      divLossT: histoire[champLossT],
      divLossB: histoire[champLossB],
      delta: histoire[champDelta],
      vintage: formaterVintage(histoire),
      distribution: null,
    }
  }

  return {
    storyKey: 'vingt-minutes-sans-voiture',
    titre: TITRE_VINGT_MINUTES,
    uneLigne: `Sans voiture, ${formaterTypes(histoire[champLossT])} disparaissent.`,
    commentLire:
      `À pied ou en transports en commun à 20 minutes, ${formaterTypes(histoire[champLossT])} ` +
      `(alimentation, santé, administration, école, banque) sortent de l’accès quotidien du ` +
      `territoire. La lecture est la médiane de la distribution bâtiment par bâtiment. ` +
      `Analyse calculée le ${date}.`,
    divLossT: histoire[champLossT],
    divLossB: histoire[champLossB],
    delta: histoire[champDelta],
    vintage: formaterVintage(histoire),
    distribution: distributionDe(histoire),
  }
}
