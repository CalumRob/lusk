/**
 * La passarelle « Explorer » (#409 ; le libellé compact est #468) — le
 * handoff fiche → Page
 * d'indicateur. Le contrat (CONTEXT.md, Page d'indicateur) : la passarelle
 * emporte SON territoire comme état explicite de l'URL — il reste mis en
 * avant à travers Repères et Carte jusqu'à ce qu'il soit effacé ou remplacé —
 * et son niveau quand il est comparable (commune / EPCI / département). La
 * Région est exclue de la comparaison data-first : son handoff porte le
 * territoire SANS niveau — la page résout alors son repli honnête et nomme
 * « absent à ce niveau » un territoire hors périmètre, jamais une invention.
 * La facette (détail comparé, sexe…), elle, n'est PAS portée : la page résout
 * SA facette canon déclarée par le descripteur.
 *
 * Règle d'honnêteté verrouillée par test : un indicateur SANS page publiée
 * (`indicator_pages`) ne porte AUCUNE passarelle — jamais un lien mort vers
 * une famille de page non supportée. L'affordance rendue (libellé compact,
 * nouvelle fenêtre, vraie ancre) vit dans PassarelleExploration.vue (#468).
 */

import type { TerritoireType, ThemeMetadata } from '@/payload/types'
import type { RouteLocationRaw } from 'vue-router'

/** Le libellé unique du handoff — la microcopie compacte (#468), la copie
 *  française du produit ; le composant partagé PassarelleExploration la rend
 *  à l'identique sur chaque site. */
export const LIBELLE_HANDOFF = 'Explorer'

/** Les niveaux comparables d'une Page d'indicateur (la Région n'y figure pas). */
const NIVEAUX_COMPARABLES: ReadonlySet<string> = new Set(['commune', 'epci', 'departement'])

export function handoffExploration(
  metadata: ThemeMetadata | null | undefined,
  clef: string,
  territoire: { territoire: string; type: TerritoireType } | null | undefined,
): RouteLocationRaw | null {
  const theme = metadata?.theme
  if (!theme || !metadata.indicator_pages?.[clef]) return null

  const query: Record<string, string> = {}
  if (territoire) {
    query.territoire = territoire.territoire
    if (NIVEAUX_COMPARABLES.has(territoire.type)) query.niveau = territoire.type
  }
  return { name: 'indicateur', params: { theme, indicator: clef }, query }
}

/**
 * Les constituants PUBLIÉS de chaque grande lecture (#473, l'audit du ticket)
 * : la lecture Mobilité interprète les pertes totales et les cinq parts sans
 * accès de son sous-groupe ; la lecture Milieux trace la trajectoire des états
 * par habitant que « Intensité état » publie (M2→M3). Les quantités calculées
 * pour la SEULE lecture — div_loss_* et la signature dens/dec, les deux taux
 * de solde, le top-N LQ, taux_variation_population — ne sont pas des
 * indicateurs publiés : elles n'apparaissent ici JAMAIS (aucune page
 * inventée), elles sont consignées hors périmètre sur le ticket.
 */
const CONSTITUANTS_PUBLIES_PAR_STORY: Readonly<Record<string, readonly string[]>> = {
  'vingt-minutes-sans-voiture': [
    'tot_loss_t',
    'tot_loss_b',
    'iso_alimentation',
    'iso_sante',
    'iso_administration',
    'iso_ecole',
    'iso_banque',
  ],
  'ce-que-le-velo-preserve': [
    'tot_loss_t',
    'tot_loss_b',
    'iso_alimentation',
    'iso_sante',
    'iso_administration',
    'iso_ecole',
    'iso_banque',
  ],
  'se-densifier-setaler-ou-sen-aller': ['artif_par_habitant'],
}

/** Une passarelle d'une grande lecture : sa clé publiée, son libellé publié
 *  (indicator_labels — jamais une clé brute, #318) et sa route résolue. */
export interface PassarelleLecture {
  clef: string
  libelle: string
  to: RouteLocationRaw
}

/**
 * Les passarelles d'une grande lecture (#473) : chaque constituant déclaré ci-
 * dessus qui POSÈDE une page publiée devient une route handoffExploration —
 * le même contrat que la grille (territoire + niveau comparables emportés).
 * Un constituant sans page publiée est LAISSÉ TOMBER (la règle d'honnêteté
 * verrouillée par test) : jamais un lien mort vers une page non supportée.
 */
export function passarellesLecture(
  metadata: ThemeMetadata | null | undefined,
  storyKey: string,
  territoire: { territoire: string; type: TerritoireType } | null | undefined,
): PassarelleLecture[] {
  const resultats: PassarelleLecture[] = []
  for (const clef of CONSTITUANTS_PUBLIES_PAR_STORY[storyKey] ?? []) {
    const to = handoffExploration(metadata, clef, territoire)
    const libelle = metadata?.indicator_labels?.[clef]
    if (!to || !libelle) continue
    resultats.push({ clef, libelle, to })
  }
  return resultats
}
