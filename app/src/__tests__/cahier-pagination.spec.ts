import { describe, expect, it } from 'vitest'

import { cahierPaginationFor } from '@/fiche/prototype/cahierPagination'
import { sousGroupesFiche } from '@/fiche/content/ficheGrammar'
import { metadonneesThemesFixtures } from '@/payload/fixtures'
import { THEMES_CANONIQUES } from '@/payload/types'
import type { Payload, Theme } from '@/payload/types'

function contenuPour(theme: Theme) {
  return {
    theme,
    units: sousGroupesFiche(theme).map(({ key, label }) => ({ key, label })),
  } as unknown as Parameters<typeof cahierPaginationFor>[1]
}

const payloadCanonique = { themeMetadata: metadonneesThemesFixtures } as Payload

const payloadPresentationAmontPerimee = {
  themeMetadata: Object.fromEntries(THEMES_CANONIQUES.map((theme) => {
    const metadata = metadonneesThemesFixtures[theme]!
    const subgroups = [...metadata.subgroups]
    if (theme === 'mobilite') subgroups.push({ ...subgroups[0]!, key: 'upstream-extra' })
    if (theme === 'habitat') subgroups.reverse()
    return [theme, { ...metadata, subgroups }]
  })),
} as unknown as Payload

describe('cahierPaginationFor — le fil global de présentation du Cahier', () => {
  it.each([
    ['mobilite', 1, 4],
    ['demographie', 5, 2],
    ['habitat', 7, 3],
    ['economie', 10, 2],
    ['milieux', 12, 1],
    ['programmes', 13, 2],
  ] as const)('keeps %s at its global position in isolated and all-unit modes', (theme, firstPage, count) => {
    const content = contenuPour(theme)
    const isolated = cahierPaginationFor(payloadCanonique, content)
    const allUnits = cahierPaginationFor(payloadCanonique, content, true)

    expect(isolated).toMatchObject({ currentPage: firstPage, totalPages: 14 })
    expect(isolated.entries.map(({ page }) => page)).toEqual([firstPage, null])
    expect(allUnits).toMatchObject({ currentPage: firstPage, totalPages: 14 })
    expect(allUnits.entries.map(({ page }) => page)).toEqual([
      ...Array.from({ length: count }, (_, index) => firstPage + index), null,
    ])
  })

  it('derives the later-theme offset from app grammar, not stale upstream subgroup counts or order', () => {
    const isolated = cahierPaginationFor(payloadPresentationAmontPerimee, contenuPour('habitat'))
    const allUnits = cahierPaginationFor(payloadPresentationAmontPerimee, contenuPour('habitat'), true)

    expect(isolated).toMatchObject({ currentPage: 7, totalPages: 14 })
    expect(isolated.entries.map(({ page }) => page)).toEqual([7, null])
    expect(allUnits).toMatchObject({ currentPage: 7, totalPages: 14 })
    expect(allUnits.entries.map(({ page }) => page)).toEqual([7, 8, 9, null])
  })
})
