import { THEMES_CANONIQUES } from '@/payload/types'
import type { Payload, Theme } from '@/payload/types'

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

/** The page-sequencing fields shared by each theme's Cahier content. */
export interface CahierPaginationContent {
  theme: Theme
  units: readonly { key: string; label: string }[]
}

function anchorFor(key: string): string {
  return key === 'acces-aux-services' ? 'figure-lecture' : `figure-${key}`
}

/**
 * Resolve the Cahier page sequence for the rendered units. The sequence is
 * deliberately kept outside ThemeContent: it is a layout concern, not a
 * semantic claim. Page order/count come from the shared app-owned fiche
 * grammar across all six themes, never from producer subgroup counts. The
 * default keeps the original isolated first-unit presentation; callers
 * rendering all units of the current theme opt in while retaining the global
 * spine's page numbers.
 */
export function cahierPaginationFor(
  _payload: Payload,
  content: CahierPaginationContent,
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

  const currentThemeIndex = THEMES_CANONIQUES.indexOf(currentTheme)
  const offset = THEMES_CANONIQUES.slice(0, currentThemeIndex).reduce(
    (total, theme) => total + sousGroupesFiche(theme).length,
    0,
  )
  const grammarPageCount = THEMES_CANONIQUES.reduce(
    (total, theme) => total + sousGroupesFiche(theme).length,
    0,
  )
  const totalPages = Math.max(grammarPageCount, currentUnits.length, 1)
  const currentPage = Math.max(1, offset + Math.max(0, currentIndex) + 1)
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
