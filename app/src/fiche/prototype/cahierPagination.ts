import type { Payload } from '@/payload/types'

import type { ThemeContent } from '@/fiche/content/themeContent'
import { sousGroupesFiche } from '@/fiche/content/ficheGrammar'

/** One navigable entry in the Cahier's continuous spine. */
export interface CahierPaginationEntry {
  key: string
  label: string
  page: number | null
  anchor: string
}

/** Presentation-only pagination for a Cahier surface. */
export interface CahierPagination {
  currentPage: number
  totalPages: number
  entries: readonly CahierPaginationEntry[]
}

function anchorFor(key: string): string {
  return key === 'acces-aux-services' ? 'figure-lecture' : `figure-${key}`
}

/**
 * Resolve the Cahier page sequence for the rendered units. The sequence is
 * deliberately kept outside ThemeContent: it is a layout concern, not a
 * semantic claim. Page order/count come from the shared app-owned fiche
 * grammar for this theme, never from producer metadata. The default keeps the
 * original isolated first-unit presentation; callers rendering all units of
 * this theme opt in. It does not count unrelated themes as pages in this Cahier.
 */
export function cahierPaginationFor(
  _payload: Payload,
  content: ThemeContent,
  renderAllUnits = false,
): CahierPagination {
  const currentTheme = content.theme
  const currentUnits = renderAllUnits
    ? [...content.units]
    : content.units[0]
      ? [content.units[0]]
      : []
  const currentSubgroups = sousGroupesFiche(currentTheme)
  const firstUnit = currentUnits[0]
  const currentIndex = firstUnit
    ? currentSubgroups.findIndex((subgroup) => subgroup.key === firstUnit.key)
    : -1

  const declaredTotal = renderAllUnits ? currentSubgroups.length : currentUnits.length
  const totalPages = Math.max(declaredTotal, currentUnits.length, 1)
  const currentPage = Math.max(1, Math.max(0, currentIndex) + 1)
  const entries: CahierPaginationEntry[] = currentUnits.map((unit, index) => ({
    key: unit.key,
    label: unit.label,
    page: currentPage + index,
    anchor: anchorFor(unit.key),
  }))

  entries.push({
    key: 'sources',
    label: 'Carnet des sources',
    page: null,
    anchor: 'figure-sources',
  })

  return { currentPage, totalPages, entries }
}
