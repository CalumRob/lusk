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
  themeMetadata: Object.fromEntries(THEMES_CANONIQUES.map((theme) => [
    theme,
    { ...metadonneesThemesFixtures[theme], subgroups: [] },
  ])),
} as Payload

describe('cahierPaginationFor — le fil global de présentation du Cahier', () => {
  it('keeps all six canonical theme groups in the continuous spine in both render modes', () => {
    const isolated = cahierPaginationFor(payloadCanonique, contenuPour('mobilite'))
    const allUnits = cahierPaginationFor(payloadCanonique, contenuPour('mobilite'), true)

    expect(isolated).toMatchObject({ currentPage: 1, totalPages: 14 })
    expect(isolated.entries.map(({ page }) => page)).toEqual([1, null])
    expect(allUnits).toMatchObject({ currentPage: 1, totalPages: 14 })
    expect(allUnits.entries.map(({ page }) => page)).toEqual([1, 2, 3, 4, null])
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
