/**
 * The Démographie Story — "Attractive ou fertile ?" (docs/themes/demographie.md).
 *
 * The pipeline computes ONE reading per territoire (the 2×2: growth vs the
 * région baseline × natural/migration dominance) and publishes it as the
 * histoires table's `classification`. This module maps that classification to
 * the app-side copy: the serif one-liner and the "comment lire" line.
 *
 * Wording is PROVISIONAL (theme contract) — factual, reproducible, French.
 * Unknown or missing classification → null: the block never invents a
 * one-liner (a territory without a reading shows no story angle, honestly).
 */

export type ClassificationDemographie = 'fertile' | 'attractive' | 'vieillissante' | 'exode'

export interface AngleStory {
  classification: string
  titre: string
  uneLigne: string
  commentLire: string
}

interface AngleParClassification {
  titre: string
  uneLigne: string
  commentLire: string
}

const ANGES_PAR_CLASSIFICATION: Record<ClassificationDemographie, AngleParClassification> = {
  fertile: {
    titre: 'Attractive ou fertile ?',
    uneLigne: 'La population se renouvelle sur place.',
    commentLire:
      'La croissance du territoire vient de son solde naturel — naissances moins décès — plus que de ses arrivées.',
  },
  attractive: {
    titre: 'Attractive ou fertile ?',
    uneLigne: 'La croissance vient des nouveaux arrivants.',
    commentLire:
      'La croissance du territoire vient de son solde migratoire — arrivées moins départs — plus que de ses naissances.',
  },
  vieillissante: {
    titre: 'Attractive ou fertile ?',
    uneLigne: 'La population se renouvelle de moins en moins.',
    commentLire:
      'Le déclin du territoire vient de son solde naturel — naissances moins décès — plus que de ses départs.',
  },
  exode: {
    titre: 'Attractive ou fertile ?',
    uneLigne: 'Les départs l’emportent sur les arrivées.',
    commentLire:
      'Le déclin du territoire vient de son solde migratoire — arrivées moins départs — plus que de ses naissances.',
  },
}

export function storyDemographie(classification: string | null | undefined): AngleStory | null {
  if (!classification) return null
  const angle = ANGES_PAR_CLASSIFICATION[classification as ClassificationDemographie]
  if (!angle) return null
  return { classification, ...angle }
}
