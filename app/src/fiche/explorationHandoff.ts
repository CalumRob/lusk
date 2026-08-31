/**
 * La passarelle « Explorer » (#409 ; le libellé compact est #468) — l'écrivain
 * du handoff fiche → Page
 * d'indicateur. Le contrat (CONTEXT.md, Page d'indicateur) : la passarelle
 * emporte SON territoire comme état explicite de l'URL — il reste mis en
 * avant à travers Repères et Carte jusqu'à ce qu'il soit effacé ou remplacé —
 * et son niveau quand il est comparable (commune / EPCI / département).
 * Depuis #505, CE vocabulaire (les clés de query, la règle « la Région ne
 * porte pas de niveau », la route nommée) vit dans le contrat d'exploration
 * (contratExploration.ts) — ce fichier n'y ajoute que la facette qu'il ne
 * porte PAS (détail comparé, sexe…) : la page résout SA facette canon déclarée
 * par le descripteur.
 *
 * Règle d'honnêteté verrouillée par test : un indicateur SANS page publiée
 * (`indicator_pages`) ne porte AUCUNE passarelle — jamais un lien mort vers
 * une famille de page non supportée. L'affordance rendue (libellé compact,
 * nouvelle fenêtre, vraie ancre) vit dans PassarelleExploration.vue (#468).
 */

import type { ThemeMetadata } from '@/payload/types'
import type { RouteLocationRaw } from 'vue-router'

import { routeIndicateur } from './contratExploration'
import type { RefTerritoire } from './contratExploration'
import type { ExplorationTarget } from './content/themeContent'

/** Le libellé unique du handoff — la microcopie compacte (#468), la copie
 *  française du produit ; le composant partagé PassarelleExploration la rend
 *  à l'identique sur chaque site. */
export const LIBELLE_HANDOFF = 'Explorer'

export function handoffExploration(
  metadata: ThemeMetadata | null | undefined,
  clef: string,
  territoire: RefTerritoire | null | undefined,
): RouteLocationRaw | null {
  const theme = metadata?.theme
  if (!theme || !metadata.indicator_pages?.[clef]) return null
  return routeIndicateur(theme, clef, territoire)
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
  territoire: RefTerritoire | null | undefined,
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

/**
 * Map a semantic content target to an already published indicator page. The
 * direct access shares are the canonical facts of the new content grammar, but
 * their existing fiche handoffs still land on the published isolation mirror.
 * Targets without a published page deliberately return null.
 */
const PAGE_KEY_FOR_TARGET: Readonly<Record<string, string>> = {
  // The diversity reading is a derived story fact. Its handoff remains honest
  // by landing on the published total-loss indicator, as the old Cahier did.
  div_loss_t: 'tot_loss_t',
  div_loss_b: 'tot_loss_b',
  share_food_t: 'iso_alimentation',
  share_health_t: 'iso_sante',
  share_admin_t: 'iso_administration',
  share_school_t: 'iso_ecole',
  share_bank_t: 'iso_banque',
  tot_loss_t: 'tot_loss_t',
  tot_loss_b: 'tot_loss_b',
}

const ACCESS_PAGE_KEY_FOR_SERVICE: Readonly<Record<string, string>> = {
  administration: 'iso_administration',
  alimentation: 'iso_alimentation',
  sante: 'iso_sante',
  banque: 'iso_banque',
  ecole: 'iso_ecole',
}

export function routePourCibleExploration(
  target: ExplorationTarget,
): RouteLocationRaw | null {
  const pageKey = PAGE_KEY_FOR_TARGET[target.key]
  return pageKey
    ? routeIndicateur(target.theme, pageKey, {
        territoire: target.territory.code,
        type: target.territory.type,
      })
    : null
}

/** Resolve a normalized access fact to its published isolation indicator page. */
export function routePourFaitExploration(
  key: string,
  detail: string | null,
  territoire: { code: string; type: RefTerritoire['type'] },
): RouteLocationRaw | null {
  if (!key.startsWith('access.') || detail !== 'walkTransit') return null
  const service = key.slice('access.'.length)
  const pageKey = ACCESS_PAGE_KEY_FOR_SERVICE[service]
  return pageKey
    ? routeIndicateur('mobilite', pageKey, {
        territoire: territoire.code,
        type: territoire.type,
      })
    : null
}
