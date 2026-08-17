import type { Indicateur } from '@/payload/types'
import { formaterValeur } from '@/payload/selectors'

/**
 * La figure « structure_age » (Démographie, famille composition, issue #371).
 *
 * Une VRAIE pyramide des âges est à DEUX côtés — hommes à gauche, femmes à
 * droite — et exige une dimension sexe. Le payload legacy (avant l'issue
 * bloquante #390) ne porte PAS cette dimension : une seule série totale par
 * tranche (sept lignes). Présenter ces sept lignes comme une pyramide à un
 * seul côté serait trompeur — ce n'est pas un pyramid, c'est une distribution.
 * La grammaire (#371) fait alors repli sur la décomposition segmentée/liste
 * honnête (corps hérité, IndicatorFigure), jamais sur une pyramide unilatérale.
 *
 * Ce module porte la détection de la forme sexuée complète et le calcul des
 * bandes du pyramid à deux côtés. Le champ `sex` est ajouté au contrat par
 * #390 (sept tranches × F+M = 14 lignes par territoire) ; cet issue ne
 * l'invente PAS sur le type Indicateur (compatibilité de contrat) — on le lit
 * en option pour être prêt dès que #390 arrive.
 */

/** L'ordre d'âge canonique du contrat — jeune en premier, pour empiler jeune-en-bas. */
export const ORDRE_AGE = ['<15', '15-24', '25-39', '40-54', '55-64', '65-79', '80+'] as const

export type TrancheAge = (typeof ORDRE_AGE)[number]

/** Une ligne structure_age qui PEUT porter la dimension sexe (ajoutée par #390). */
export type IndicateurAvecSexe = Indicateur & { sex?: 'F' | 'M' | null }

/**
 * Vrai UNIQUEMENT pour la forme sexuée complète qui justifie un vrai pyramid
 * hommes/femmes : sept tranches d'âge, chacune présente pour les DEUX sexes,
 * chaque ligne portant une valeur `sex` explicite « F » ou « M ». Tout le reste
 * (les sept lignes totales legacy, une forme partielle, un sexe manquant) est
 * faux — on ne doit jamais présenter un chart à un côté comme une pyramide.
 */
export function estPyramideSexuee(lignes: Indicateur[]): boolean {
  // forme exacte : sept tranches × F + M = 14 lignes, ni plus ni moins
  if (lignes.length !== 14) return false
  const sexuees = lignes as IndicateurAvecSexe[]
  const paires = new Set<string>()
  const bandesParSexe: Record<'F' | 'M', Set<string>> = { F: new Set(), M: new Set() }
  for (const l of sexuees) {
    if (l.detail == null) return false
    if (l.sex !== 'F' && l.sex !== 'M') return false
    // une même paire (detail, sex) ne doit apparaître qu'une fois — pas de doublon
    const cle = `${l.sex}|${l.detail}`
    if (paires.has(cle)) return false
    paires.add(cle)
    bandesParSexe[l.sex].add(l.detail)
  }
  // sept bandes par sexe, et les mêmes sept des deux côtés
  if (bandesParSexe.F.size !== 7 || bandesParSexe.M.size !== 7) return false
  return [...bandesParSexe.F].every((b) => bandesParSexe.M.has(b))
}

export interface BandePyramide {
  tranche: string
  libelle: string
  /** Côté hommes */
  valeurHommes: number | null
  texteHommes: string
  largeurHommes: number
  /** Côté femmes */
  valeurFemmes: number | null
  texteFemmes: string
  largeurFemmes: number
}

/**
 * Les bandes du pyramid à deux côtés, ordonnées jeune-en-bas (ORDRE_AGE). Les
 * largeurs sont rapportées au max des DEUX sexes (échelle commune) pour que la
 * forme soit lisible. `labelsDetail` vient de la métadonnée (jamais une clé
 * brute) ; une tranche sans libellé rend sa clé.
 */
export function bandesPyramideSexuee(
  lignes: Indicateur[],
  labelsDetail?: Record<string, string>,
): BandePyramide[] {
  const sexuees = lignes as IndicateurAvecSexe[]
  const parTrancheSexe = new Map<string, { F?: Indicateur; M?: Indicateur }>()
  for (const l of sexuees) {
    if (l.detail == null) continue
    const entree = parTrancheSexe.get(l.detail) ?? {}
    if (l.sex === 'F' || l.sex === 'M') entree[l.sex] = l
    parTrancheSexe.set(l.detail, entree)
  }
  const max = Math.max(
    1,
    ...[...parTrancheSexe.values()].flatMap((e) => [e.F?.value ?? 0, e.M?.value ?? 0]),
  )
  return ORDRE_AGE.map((tranche) => {
    const entree = parTrancheSexe.get(tranche)
    // convention INSEE : M = hommes (barre gauche), F = femmes (barre droite)
    const h = entree?.M?.value ?? null
    const f = entree?.F?.value ?? null
    const texteHommes = h == null ? '—' : (formaterValeur(entree!.M!) ?? '—')
    const texteFemmes = f == null ? '—' : (formaterValeur(entree!.F!) ?? '—')
    return {
      tranche,
      libelle: labelsDetail?.[tranche] ?? tranche,
      valeurHommes: h,
      texteHommes,
      largeurHommes: h == null ? 0 : (h / max) * 100,
      valeurFemmes: f,
      texteFemmes,
      largeurFemmes: f == null ? 0 : (f / max) * 100,
    }
  })
}
