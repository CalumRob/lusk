import { THEMES_CANONIQUES } from '@/payload/types'
import type { Payload } from '@/payload/types'

import type { ThemeContent } from '@/fiche/content/themeContent'

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
 * Resolve the Cahier page sequence from published subgroup order. The sequence
 * is deliberately kept outside ThemeContent: it is a layout concern, not a
 * semantic claim. A missing metadata sequence still gets a usable one-page
 * presentation for the prototype.
 */
export function cahierPaginationFor(
  payload: Payload,
  content: ThemeContent,
): CahierPagination {
  const metadata = payload.themeMetadata ?? {}
  const currentTheme = content.theme
  const currentUnits = content.units
  const currentSubgroups = metadata[currentTheme]?.subgroups ?? []
  const firstUnit = currentUnits[0]
  const currentIndex = firstUnit
    ? currentSubgroups.findIndex((subgroup) => subgroup.key === firstUnit.key)
    : -1

  let offset = 0
  for (const theme of THEMES_CANONIQUES) {
    if (theme === currentTheme) break
    offset += metadata[theme]?.subgroups.length ?? 0
  }

  const declaredTotal = Object.values(metadata).reduce(
    (total, theme) => total + (theme?.subgroups.length ?? 0),
    0,
  )
  const totalPages = Math.max(declaredTotal, currentUnits.length, 1)
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
