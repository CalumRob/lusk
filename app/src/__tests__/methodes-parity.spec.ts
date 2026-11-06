import { describe, expect, it } from 'vitest'

import { THEMES_CONSTRUITS } from '../methodes/indicateurs'
import type { ThemeConstruit } from '../methodes/indicateurs'
import { THEMES_CANONIQUES } from '../payload/types'

/**
 * Numeric observations belong to the API, not committed per-theme files.
 * This contract keeps the app-owned Methodes registry aligned with the
 * canonical theme roster while leaving Programmes documentation to its owner.
 */
const THEMES_DOCUMENTATION_DEDIEE = ['programmes'] as const

function themesSansDocumentation(themes: string[]): string[] {
  return themes.filter((theme) =>
    !THEMES_CONSTRUITS.includes(theme as ThemeConstruit) &&
    !(THEMES_DOCUMENTATION_DEDIEE as readonly string[]).includes(theme))
}

describe('contrat Méthodes — couverture du registre canonique', () => {
  it('names a synthetic theme that has no Methodes documentation', () => {
    expect(themesSansDocumentation([
      'demographie', 'habitat', 'economie', 'mobilite', 'milieux', 'eau',
    ])).toEqual(['eau'])
  })

  it('covers every canonical theme once, with Programmes documented by its descriptor', () => {
    expect(new Set([...THEMES_CONSTRUITS, ...THEMES_DOCUMENTATION_DEDIEE])).toEqual(
      new Set(THEMES_CANONIQUES),
    )
    expect(THEMES_CONSTRUITS).not.toContain('programmes')
  })
})
