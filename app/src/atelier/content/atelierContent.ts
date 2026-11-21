/**
 * Stable Atelier presentation grammar — display labels owned by the app's
 * content/config layer (AGENTS.md), never produced by the join's computation.
 * The identities they label are the producer-declared Catégories and
 * Appartenances from CONTEXT.md; this file only names them for the reader.
 */

import type { Attribute } from '../state'

/** Display labels for a couleur bound to a Catégorie or Appartenance. */
export const ATTRIBUTE_LABELS: Record<Attribute, string> = {
  densite: 'Classe de densité',
  littoral: 'Classification littorale',
  departement: 'Département',
  epci: 'EPCI',
}
