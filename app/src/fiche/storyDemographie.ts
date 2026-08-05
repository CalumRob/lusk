/**
 * The Démographie Story — "Trajectoire démographique" (ADR-0011,
 * docs/themes/demographie.md).
 *
 * The pipeline computes ONE reading per territoire — the quadrant of its two
 * annualized per-mille rates (taux_solde_naturel × taux_solde_migratoire) —
 * and publishes it as the histoires table's `classification`. This module
 * maps that classification to the app-side copy: the serif one-liner and the
 * "comment lire" line, which quotes the territory's ACTUAL rates (issue #73:
 * the story speaks the territory's own two forces, nothing relative).
 *
 * Wording is PROVISIONAL (theme contract) and deliberately factual/neutral —
 * no dramatic wording even when a rate is negative (issue #73). Unknown or
 * missing classification → null: the block never invents a one-liner; a
 * missing rate → null: the comment-lire would have nothing to quote.
 */

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
  uneLigne: string
  /** The fixed sentence frames that quote the two actual rates. */
  commentLire: (tauxNaturel: number, tauxMigratoire: number) => string
}

/** A signed annualized per-mille rate, French ("+4,99 ‰/an", "-3,30 ‰/an"). */
function formaterTaux(taux: number): string {
  const signe = taux > 0 ? '+' : ''
  const deux = taux.toFixed(2).replace('.', ',')
  return `${signe}${deux} ‰/an`
}

const ANGLES_PAR_CLASSIFICATION: Record<ClassificationDemographie, AngleParClassification> = {
  'attire-renouvelle': {
    titre: 'Trajectoire démographique',
    uneLigne: 'La population se renouvelle et attire.',
    commentLire: (tauxNaturel, tauxMigratoire) =>
      `Les deux forces sont positives — solde naturel ${formaterTaux(tauxNaturel)}, ` +
      `solde migratoire ${formaterTaux(tauxMigratoire)} : la population croît sur ses deux composantes.`,
  },
  'attire-meurt': {
    titre: 'Trajectoire démographique',
    uneLigne: 'Les arrivées compensent un solde naturel négatif.',
    commentLire: (tauxNaturel, tauxMigratoire) =>
      `Le solde naturel est négatif (${formaterTaux(tauxNaturel)}) et le solde migratoire positif ` +
      `(${formaterTaux(tauxMigratoire)}) : la population se maintient grâce aux arrivées.`,
  },
  'vide-meurt': {
    titre: 'Trajectoire démographique',
    uneLigne: 'La population diminue sur ses deux composantes.',
    commentLire: (tauxNaturel, tauxMigratoire) =>
      `Les deux forces sont négatives — solde naturel ${formaterTaux(tauxNaturel)}, ` +
      `solde migratoire ${formaterTaux(tauxMigratoire)} : la population diminue.`,
  },
  'vide-renouvelle': {
    titre: 'Trajectoire démographique',
    uneLigne: 'Les naissances compensent les départs.',
    commentLire: (tauxNaturel, tauxMigratoire) =>
      `Le solde naturel est positif (${formaterTaux(tauxNaturel)}) et le solde migratoire négatif ` +
      `(${formaterTaux(tauxMigratoire)}) : la population se maintient grâce aux naissances.`,
  },
}

export function storyDemographie(
  classification: string | null | undefined,
  tauxNaturel: number | null | undefined,
  tauxMigratoire: number | null | undefined,
): AngleStory | null {
  if (!classification) return null
  const angle = ANGLES_PAR_CLASSIFICATION[classification as ClassificationDemographie]
  if (!angle) return null
  if (tauxNaturel === null || tauxNaturel === undefined) return null
  if (tauxMigratoire === null || tauxMigratoire === undefined) return null
  return {
    classification,
    titre: angle.titre,
    uneLigne: angle.uneLigne,
    commentLire: angle.commentLire(tauxNaturel, tauxMigratoire),
  }
}
