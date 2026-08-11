/**
 * The Démographie Story — "Trajectoire démographique" (ADR-0011,
 * docs/themes/demographie.md).
 *
 * The pipeline computes ONE reading per territoire — the quadrant of its two
 * annualized per-mille rates (taux_solde_naturel × taux_solde_migratoire) —
 * and publishes it as the histoires table's `classification`. This module
 * maps that classification to the app-side copy: the serif one-liner and the
 * "comment lire" line, which quotes the territory's ACTUAL rates (issue #73:
 * the story speaks the territory's own two forces, nothing relative). The two
 * rate field names come from the SCALAIRES_STORY declaration (ADR-0019 — the
 * fiche and the carte read the same list).
 *
 * The reading is the SIGN of the two rates (ADR-0011 — the four quadrants of
 * a plot whose axes cross at 0); the copy is MAGNITUDE-AWARE within the two
 * mixed quadrants (issue #73, follow-up): "compensation" is only claimed when
 * the positive force actually outweighs the negative one. Moréac (natural
 * +1,43 / migration −4,15 → net −2,72) reads "la population diminue malgré
 * les naissances" — never "compensent".
 *
 * Wording is PROVISIONAL (theme contract) and deliberately factual/neutral —
 * no dramatic wording even when a rate is negative (issue #73). An unknown or
 * missing classification → null: the block never invents a one-liner. The
 * rates are non-nullable on the row by contract — a row that validated
 * carries its two forces, the comment-lire always has something to quote.
 */

import type { HistoireDemographie } from '@/payload/types'

import { formaterTaux } from '@/payload/selectors'

import { SCALAIRES_STORY } from './storyScalaires'

export type ClassificationDemographie =
  | 'attire-renouvelle'
  | 'attire-meurt'
  | 'vide-meurt'
  | 'vide-renouvelle'

export interface AngleStory {
  classification: string
  titre: string
  uneLigne: string
  commentLire: string
}

interface AngleParClassification {
  titre: string
  /** The one-liner — a function of the rates: the mixed quadrants branch on which force dominates. */
  uneLigne: (tauxNaturel: number, tauxMigratoire: number) => string
  /** The fixed sentence frames that quote the two actual rates. */
  commentLire: (tauxNaturel: number, tauxMigratoire: number) => string
}

/** The shared signed-rate number (formaterTaux, selectors) with the unit spelled out — "pour 1 000 habitants" is what ‰ means (issue #73: ‰/an alone is cryptic in a sentence; the chart's axes keep the compact form). */
function formaterTauxUnite(taux: number): string {
  return `${formaterTaux(taux)}/an pour 1 000 hab.`
}

/** Does the positive force outweigh the negative one? |positive| ≥ |negative|. */
function positiveCompense(tauxNaturel: number, tauxMigratoire: number): boolean {
  return Math.abs(tauxNaturel) >= Math.abs(tauxMigratoire)
}

const ANGLES_PAR_CLASSIFICATION: Record<ClassificationDemographie, AngleParClassification> = {
  'attire-renouvelle': {
    titre: 'Trajectoire démographique',
    uneLigne: () => 'Le territoire attire et se renouvelle.',
    commentLire: (tauxNaturel, tauxMigratoire) =>
      `Les deux forces sont positives — solde naturel ${formaterTauxUnite(tauxNaturel)}, ` +
      `solde migratoire ${formaterTauxUnite(tauxMigratoire)} : la population croît sur ses deux composantes.`,
  },
  'attire-meurt': {
    titre: 'Trajectoire démographique',
    // migration positive × naturel négatif : les arrivées ne « compensent »
    // que si elles l'emportent sur le déficit naturel (magnitudes, pas signes)
    uneLigne: (tauxNaturel, tauxMigratoire) =>
      positiveCompense(tauxMigratoire, tauxNaturel)
        ? 'Les arrivées compensent un solde naturel négatif.'
        : 'La population diminue malgré les arrivées.',
    commentLire: (tauxNaturel, tauxMigratoire) =>
      positiveCompense(tauxMigratoire, tauxNaturel)
        ? `Le solde naturel est négatif (${formaterTauxUnite(tauxNaturel)}) et le solde migratoire positif ` +
          `(${formaterTauxUnite(tauxMigratoire)}) : la population se maintient grâce aux arrivées.`
        : `Le solde naturel est négatif (${formaterTauxUnite(tauxNaturel)}), plus marqué que le solde ` +
          `migratoire positif (${formaterTauxUnite(tauxMigratoire)}) : la population diminue malgré les arrivées.`,
  },
  'vide-meurt': {
    titre: 'Trajectoire démographique',
    uneLigne: () => 'La population diminue sur ses deux composantes.',
    commentLire: (tauxNaturel, tauxMigratoire) =>
      `Les deux forces sont négatives — solde naturel ${formaterTauxUnite(tauxNaturel)}, ` +
      `solde migratoire ${formaterTauxUnite(tauxMigratoire)} : la population diminue.`,
  },
  'vide-renouvelle': {
    titre: 'Trajectoire démographique',
    // naturel positif × migration négative : les naissances ne « compensent »
    // que si elles l'emportent sur le déficit migratoire — le cas Moréac
    // (natural +1,43 / migration −4,15 → net −2,72) lit la deuxième branche.
    uneLigne: (tauxNaturel, tauxMigratoire) =>
      positiveCompense(tauxNaturel, tauxMigratoire)
        ? 'Les naissances compensent les départs.'
        : 'La population diminue malgré les naissances.',
    commentLire: (tauxNaturel, tauxMigratoire) =>
      positiveCompense(tauxNaturel, tauxMigratoire)
        ? `Le solde naturel est positif (${formaterTauxUnite(tauxNaturel)}) et le solde migratoire négatif ` +
          `(${formaterTauxUnite(tauxMigratoire)}) : la population se maintient grâce aux naissances.`
        : `Le solde naturel est positif (${formaterTauxUnite(tauxNaturel)}), moins marqué que le solde ` +
          `migratoire négatif (${formaterTauxUnite(tauxMigratoire)}) : la population diminue malgré les naissances.`,
  },
}

export function storyDemographie(histoire: HistoireDemographie): AngleStory | null {
  const { classification, periode } = histoire
  if (!classification) return null
  const angle = ANGLES_PAR_CLASSIFICATION[classification as ClassificationDemographie]
  if (!angle) return null
  // les deux forces de la lecture — les champs de la déclaration, jamais
  // codés en dur (ADR-0019 : ajouter un scalaire met la fiche ET la carte à jour)
  const [champNaturel, champMigratoire] = SCALAIRES_STORY.demographie
  const tauxNaturel = histoire[champNaturel]
  const tauxMigratoire = histoire[champMigratoire]
  return {
    classification,
    titre: periode ? `${angle.titre} (${periode})` : angle.titre,
    uneLigne: angle.uneLigne(tauxNaturel, tauxMigratoire),
    commentLire: angle.commentLire(tauxNaturel, tauxMigratoire),
  }
}
