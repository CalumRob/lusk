import type { SemanticResourceDeclaration } from '@/payload/semanticResourceClient'
import type { Theme } from '@/payload/types'

import { sousGroupesFiche } from './ficheGrammar'

/**
 * #986 — app-owned demand inventory for one theme.
 *
 * The chapter (subgroup) sequence and its indicator identities come from the
 * shared app grammar; the producer catalogue decides which of those identities
 * exist at the requested level and whether they are numeric facts or a named
 * reference. Only the *organisation* is app-owned: no numeric value, unit,
 * axis, eligibility rule or source policy is copied here.
 *
 * A retained producer indicator that no chapter claims ("unclaimed") is not
 * silently dropped: it joins the first chapter that renders numeric evidence,
 * so a new producer resource is always demanded by the page that can display
 * it rather than being hidden. The demand contract test pins today's
 * distribution and fails when the producer adds an indicator the app has not
 * placed.
 */
/** The demand state of one visible chapter: idle before admission, then the
 *  bounded read's own lifecycle. Never inferred from a missing fact. */
export type ChapitreDemandStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface ChapterDemandInventory {
  /** The app grammar subgroup key that owns these indicators. */
  key: string
  /** Producer indicator identities this chapter displays, in grammar order. */
  indicators: readonly string[]
  /** Indicator identities this chapter displays that are not numeric facts. */
  namedReferences: readonly string[]
}

function declarationByIdentity(
  declarations: readonly SemanticResourceDeclaration[],
  theme: Theme,
): Map<string, SemanticResourceDeclaration> {
  return new Map(declarations
    .filter((declaration) => declaration.theme_id === theme)
    .map((declaration) => [declaration.indicator_id, declaration]))
}

function isNumericFact(declaration: SemanticResourceDeclaration | undefined): boolean {
  return declaration !== undefined && declaration.target_kinds.includes('territory')
}

function isNamedReference(declaration: SemanticResourceDeclaration | undefined): boolean {
  return declaration !== undefined &&
    (declaration.target_kinds.includes('named_reference') || declaration.shapes.includes('named_reference'))
}

/**
 * Split the theme's displayed demand by chapter. `declarations` is the producer
 * catalogue already narrowed to the requested territory level by the caller.
 */
export function chapitresDemandes(
  theme: Theme,
  declarations: readonly SemanticResourceDeclaration[],
): ChapterDemandInventory[] {
  const byIdentity = declarationByIdentity(declarations, theme)
  const chapters = sousGroupesFiche(theme).map((subgroup) => ({
    key: subgroup.key,
    indicators: [...subgroup.indicators],
    namedReferences: subgroup.indicators.filter((indicator) => isNamedReference(byIdentity.get(indicator))),
  }))
  const claimed = new Set(chapters.flatMap((chapter) => chapter.indicators))
  const unclaimed = [...byIdentity.keys()].filter((indicator) => !claimed.has(indicator) &&
    (isNumericFact(byIdentity.get(indicator)) || isNamedReference(byIdentity.get(indicator))))
  if (unclaimed.length) {
    const target = chapters.find((chapter) => chapter.indicators.some((indicator) =>
      isNumericFact(byIdentity.get(indicator))))
    if (!target) throw new Error(`Aucun chapitre numérique ne peut porter les indicateurs ${unclaimed.join(', ')}`)
    target.indicators.push(...unclaimed)
    target.namedReferences.push(...unclaimed.filter((indicator) => isNamedReference(byIdentity.get(indicator))))
  }
  return chapters
}

/** One chapter's demand, or undefined when this theme has no such chapter. */
export function chapitreDemande(
  theme: Theme,
  chapterKey: string,
  declarations: readonly SemanticResourceDeclaration[],
): ChapterDemandInventory | undefined {
  return chapitresDemandes(theme, declarations).find((chapter) => chapter.key === chapterKey)
}

/**
 * The chapter the route anchor asks for (`#figure-<subgroup>`), or undefined
 * when the URL carries no chapter anchor. The anchor is the existing page/scroll
 * signal of the Cahier spine; no new observer or route grammar is introduced.
 */
export function chapitreDemandeDepuisAncre(theme: Theme, hash: string | undefined): string | undefined {
  const anchor = (hash ?? '').replace(/^#/, '')
  if (!anchor) return undefined
  return sousGroupesFiche(theme)
    .find((subgroup) => anchor === subgroup.key || anchor === `figure-${subgroup.key}` ||
      // #1008 — the spine's page-1 entry is the special `figure-lecture`
      // anchor (cahierPagination), not `figure-acces-aux-services`. Without
      // this mapping a scroll back to page 1 never reactivates AEDAR.
      (subgroup.key === 'acces-aux-services' && anchor === 'figure-lecture'))
    ?.key
}

/**
 * The default numeric chapter of a theme: the first chapter the producer
 * actually serves numeric facts for. A page that is not deep-linked to another
 * chapter demands this one first: it is the chapter whose prose and figures the
 * reader meets at the top of the numeric body.
 */
export function chapitreNumeriqueParDefaut(
  theme: Theme,
  declarations: readonly SemanticResourceDeclaration[],
): ChapterDemandInventory | undefined {
  return chapitresDemandes(theme, declarations).find((chapter) => chapter.indicators.some((indicator) =>
    isNumericFact(declarationByIdentity(declarations, theme).get(indicator))))
}
