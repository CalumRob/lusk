/**
 * ⚠️ PROTOTYPE JETABLE (#500) — à supprimer avec la branche.
 *
 * Façonnage partagé des trois variantes de la table Sources bornée
 * (/sources?variant=A|B|C). Ce module n'est PAS une abstraction de production :
 * il prépare les enregistrements publiés (`sourceRecords`, l'autorité commune)
 * pour le rendu prototype et injecte UNE ligne synthétique d'épreuve de
 * bornage (17 consommateurs — au-delà du maximum réel, 7 : mobilite_snapshot),
 * clairement étiquetée « démonstration ». Aucune autorité n'est modifiée :
 * les descripteurs, le jointeur et le registre restent intouchés (audit #478).
 *
 * Décisions héritées, jamais réinventées ici :
 * - ADR-0022 : granularité jeu de données, millésimes imbriqués sous
 *   l'en-tête du jeu, repli seulement quand la fraîcheur est identique ;
 * - #478 §F3 : les jeux sans consommateur restent visibles (« includeUnpublished »),
 *   l'état vide honnête remplace la disparition silencieuse ;
 * - #478 §F4/F9 : les thèmes d'autorité sont rendus en chips libellées en
 *   français (NOMS_THEMES), jamais le slug brut.
 */

import { NOMS_THEMES } from '@/fiche/onglets'
import {
  formaterDateFrancaise,
  sourceRecords,
  type SourceConsumerRecord,
  type SourceDatasetRecord,
} from '@/payload/selectors'
import type {
  Payload,
  SourceClock,
  SourceVintageRecord,
  Theme,
} from '@/payload/types'

/** Les identifiants de variante portés par /sources?variant=… */
export const VARIANTES = ['A', 'B', 'C'] as const
export type Variante = (typeof VARIANTES)[number]

export interface JeuPrototype {
  /** L'id du jeu — la clé d'ancrage #source-<id> (ADR-0022). */
  id: string
  /** Le nom publié du jeu — parfois long (prose Cerema, F8) ; chaque variante le borne à sa façon. */
  nom: string
  editeur: string
  url: string | null
  licence: string | null
  /** L'étendue des versions des lignes vintages (« 2021 – 2025 ») — l'en-tête replié. */
  etendueVersions: string | null
  /** L'étendue des dates de publication, formatée en français — l'en-tête replié. */
  etenduePublications: string | null
  themes: Theme[]
  caveat: string | null
  horloges: SourceClock[]
  vintages: SourceVintageRecord[]
  consommateurs: SourceConsumerRecord[]
  /** true = les lignes vintages partagent leur fraîcheur → enfants masqués (ADR-0022). */
  replie: boolean
  /** true = ligne synthétique d'épreuve de bornage (jamais un record publié). */
  demo: boolean
}

/** Les valeurs distinctes triées d'une colonne, jointes par l'étendue X – Y. */
function etendue(valeurs: (string | null)[]): string | null {
  const distinctes = [...new Set(valeurs.filter((v): v is string => Boolean(v)))].sort()
  if (distinctes.length === 0) return null
  if (distinctes.length === 1) return distinctes[0]
  return `${distinctes[0]} – ${distinctes[distinctes.length - 1]}`
}

/** L'étendue des dates ISO, triée chronologiquement avant formatage français. */
function etendueDates(isos: (string | null)[]): string | null {
  const distinctes = [...new Set(isos.filter((v): v is string => Boolean(v)))].sort()
  if (distinctes.length === 0) return null
  if (distinctes.length === 1) return formaterDateFrancaise(distinctes[0])
  return `${formaterDateFrancaise(distinctes[0])} – ${formaterDateFrancaise(distinctes[distinctes.length - 1])}`
}

/**
 * La ligne synthétique d'épreuve de bornage (#478 §6-1 prescrit une fixture à
 * 16+ consommateurs ; le payload réel plafonne à 7). Les « consommateurs »
 * sont des puces NON cliquables — jamais de lien mort vers un indicateur qui
 * n'existe pas. Étiquetée « démonstration » sur chaque variante.
 */
const CONSOMMATEURS_DEMO = 17
function jeuDemo(): JeuPrototype {
  const consommateurs: SourceConsumerRecord[] = Array.from(
    { length: CONSOMMATEURS_DEMO },
    (_, i) => ({
      key: `demo_${i + 1}`,
      label: `Indicateur de démonstration ${String(i + 1).padStart(2, '0')}`,
      theme: 'mobilite' as Theme,
      caveat: null,
    }),
  )
  return {
    id: 'demo-bornage-prototype',
    nom: 'Jeu fictif d’épreuve de bornage — liste longue de consommateurs (prototype)',
    editeur: 'Prototype #500',
    url: null,
    licence: null,
    etendueVersions: 'démo',
    etenduePublications: null,
    themes: [],
    caveat:
      'Ligne synthétique injectée par le prototype (#500) pour éprouver le bornage au-delà du maximum réel du payload (7 consommateurs : mobilite_snapshot). Elle ne correspond à aucune donnée publiée et disparaît avec la branche.',
    horloges: [],
    vintages: [
      {
        id: 'demo-bornage-prototype',
        label: 'Millésime de démonstration',
        version: 'démo',
        licence: null,
        dateReference: null,
        datePublication: null,
      },
    ],
    consommateurs,
    replie: true,
    demo: true,
  }
}

/** Le registre prototype : les jeux publiés (+ ceux sans consommateur) + la ligne d'épreuve. */
export function jeuxPrototype(payload: Payload): JeuPrototype[] {
  const publies: JeuPrototype[] = sourceRecords(payload, { includeUnpublished: true }).map(
    (record: SourceDatasetRecord) => ({
      id: record.id,
      nom: record.dataset,
      editeur: record.publisher,
      url: record.url,
      licence: record.licence,
      etendueVersions: etendue(record.vintages.map((v) => v.version)),
      etenduePublications: etendueDates(record.vintages.map((v) => v.datePublication)),
      themes: [...record.themes],
      caveat: record.caveat,
      horloges: record.clocks,
      vintages: record.vintages,
      consommateurs: record.consumers,
      replie: record.replie,
      demo: false,
    }),
  )
  return [...publies, jeuDemo()]
}

/** Le libellé français d'un thème (jamais le slug brut — audit #478 §F9). */
export function libelleTheme(theme: Theme): string {
  return NOMS_THEMES[theme] ?? theme
}

/** La variable CSS de remplissage doux d'un thème (les chips). */
export function fondTheme(theme: Theme): string {
  return `var(--theme-${theme}-soft)`
}

/** La variable CSS de texte fort d'un thème (les chips). */
export function texteTheme(theme: Theme): string {
  return `var(--theme-${theme}-strong)`
}
