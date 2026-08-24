/**
 * The Programmes et subventions theme's display vocabulary (#408 — the
 * migrated half of the former Aperçu element; CONTEXT.md §Programmes et
 * subventions) — the French badge vocabulary and number formatting that turn
 * the theme's facts into the figures its block renders.
 *
 * This is the DISPLAY layer, not the payload layer: the selectors (payload/
 * selectors.ts) stay the single seam for raw payload → French strings, and
 * this module owns what a badge looks like and what a programme is. The badge
 * vocabulary (sigle → French nom) lives in the APP (ADR-0013 : « les mots
 * sont l'app »), jamais dans le payload.
 *
 * The former Aperçu identity helpers (libelleApercu / formaterValeurApercu)
 * died with the Aperçu tab (the #400 verdict: remove) — population, density,
 * area and composition anchors are gone completely, never a persistent header.
 */

import type { SigleProgramme } from '@/payload/types'
import type { BadgeProgramme } from '@/payload/selectors'

/** French number formatting: « 2 000 », « 133 » — digits never jitter (DESIGN.md §3). */
const FORMATEUR_NOMBRE = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })

/**
 * Un programme d'État ou régional couvrant le territoire (CONTEXT.md
 * §Programmes et subventions) — l'adhésion affichée, jamais un résultat.
 */
export interface Programme {
  /** Le sigle affiché sur le badge (ex. « ACV », « PVD »). */
  sigle: string
  /** Le nom complet (ex. « Action Cœur de Ville ») — l'expansion accessible. */
  nom: string
}

/** L'expansion accessible d'un programme — « ACV — Action Cœur de Ville ». */
export function libelleProgramme(programme: Programme): string {
  return programme.sigle === programme.nom
    ? programme.sigle
    : `${programme.sigle} — ${programme.nom}`
}

/**
 * La vocabulaire des badges (PRD #162 — le sigle → le nom français complet,
 * CONTEXT.md §Programmes et subventions) : ACV — Action Cœur de Ville · PVD —
 * Petites Villes de Demain · CRTE — Contrat de Relance et de Transition
 * Écologique · Territoires d'industrie (sigle provisoire — le programme est
 * officiellement nommé sans acronyme) · ORT — Opération de revitalisation de
 * territoire. La vocabulaire vit ICI, dans l'app — jamais dans le payload
 * (ADR-0013 : la dérivation est une jointure, les mots sont l'app).
 */
export const NOMS_PROGRAMMES: Record<SigleProgramme, string> = {
  ACV: 'Action Cœur de Ville',
  PVD: 'Petites Villes de Demain',
  CRTE: 'Contrat de Relance et de Transition Écologique',
  "Territoires d'industrie": "Territoires d'industrie",
  ORT: 'Opération de revitalisation de territoire',
}

/** Le nom complet d'un sigle — le sigle lui-même quand le programme n'a pas d'acronyme (TI). */
export function nomProgramme(sigle: SigleProgramme): string {
  return NOMS_PROGRAMMES[sigle]
}

/**
 * La phrase de voix d'un badge — le verbe honnête de l'ancrage (PRD #162-13,
 * les verbes ne sur-réclament jamais) : la commune « est lauréate » de son
 * label, le territoire « est couvert » par le contrat (commune par son EPCI,
 * EPCI par son propre contrat), l'EPCI « porte » les labels de ses communes
 * membres (le portage nommé), le département/région « compte » avec les
 * EPCIs/communes nommés, et le badge-outil ORT lit le périmètre de la
 * convention signée. La liste nommée n'est jamais dans la phrase — elle
 * s'affiche à part, complète et scrollable.
 */
export function phraseVoix(badge: BadgeProgramme): string {
  const n = badge.noms.length
  const pluriel = n > 1
  switch (badge.voix) {
    case 'laureate':
      return 'Commune lauréate du programme'
    case 'couverte':
      return 'Territoire couvert par le contrat'
    case 'porte':
      return `Porte le programme sur ${n} commune${pluriel ? 's' : ''}`
    case 'compte':
      if (badge.sigle === 'ORT') {
        return `Compte ${n} commune${pluriel ? 's' : ''} en périmètre ORT`
      }
      if (badge.sigle === 'CRTE' || badge.sigle === "Territoires d'industrie") {
        return `Compte ${n} contrat${pluriel ? 's' : ''} signé${pluriel ? 's' : ''}`
      }
      return `Compte ${n} commune${pluriel ? 's' : ''} lauréate${pluriel ? 's' : ''}`
    case 'ort':
      return n > 0
        ? 'Territoire couvert par une convention ORT signée'
        : "Dans le périmètre d'une convention ORT signée"
  }
}

/**
 * L'expansion accessible COMPLÈTE d'un badge — le sigle, le nom français, la
 * voix honnête, la liste nommée (jamais tronquée — les lecteurs d'écran
 * reçoivent TOUT) et le rider « convention valant ORT » quand le label le
 * porte (le fait accessible du badge-outil, jamais un second badge).
 */
export function libelleBadge(badge: BadgeProgramme): string {
  const expansion = libelleProgramme({ sigle: badge.sigle, nom: NOMS_PROGRAMMES[badge.sigle] })
  const noms = badge.noms.length > 0 ? ` : ${badge.noms.join(', ')}` : ''
  const rider = badge.conventionValantOrt ? ' · convention valant ORT' : ''
  return `${expansion} · ${phraseVoix(badge)}${noms}${rider}`
}

/**
 * Un montant en euros, formaté français — « 30 000 € » sous le million, et le
 * contrat #305 : à partir de 1 000 000 € le montant bascule en millions
 * « X,XX M€ » (DEUX décimales, jamais tronquées — « 7 725 740 € » →
 * « 7,73 M€ », « 1 000 000 € » → « 1,00 M€ »). Un seul formateur pour le
 * total ET les axes.
 */
export function formaterMontant(x: number): string {
  if (x >= 1_000_000) {
    const [entiers, decimales] = (x / 1_000_000).toFixed(2).split('.')
    return `${entiers.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F')},${decimales} M€`
  }
  return `${FORMATEUR_NOMBRE.format(x)} €`
}

/** La cible de la part de contexte (issue #305) — « du total de l'EPCI » / « du total de la région ». */
export function libellePartContexte(parent: 'epci' | 'region'): string {
  return parent === 'epci' ? "du total de l'EPCI" : 'du total de la région'
}

/**
 * La part de contexte (issue #305) — une part [0,1] en « X,YY % » (DEUX
 * décimales, jamais tronquées — « 0,94186 » → « 94,19 % », « 1 » →
 * « 100,00 % »), la même discipline que le formateur M€.
 */
export function formaterPartContexte(part: number): string {
  const [entiers, decimales] = (part * 100).toFixed(2).split('.')
  return `${entiers.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F')},${decimales} %`
}

/** Le texte du lien de provenance (issue #305) — « communes de l'EPCI » / « communes du département » / « communes de Bretagne ». */
export function libelleProvenance(niveau: 'epci' | 'departement' | 'region'): string {
  if (niveau === 'epci') return "communes de l'EPCI"
  if (niveau === 'departement') return 'communes du département'
  return 'communes de Bretagne'
}

/** Le lien « Région subventions » du thème — le portail officiel des aides. */
export const LIEN_SUBVENTIONS = {
  libelle: 'Subventions de la Région Bretagne',
  href: 'https://www.bretagne.bzh/aides/',
} as const
