import { describe, expect, it } from 'vitest'

import { THEMES_CONSTRUITS, THEMES_METHODES } from '../methodes/indicateurs'
import type { ThemeConstruit } from '../methodes/indicateurs'
import { THEMES_CANONIQUES } from '../payload/types'
import { PRODUCER_THEME_METADATA } from './helpers/producerThemeMetadata'

/**
 * Numeric observations belong to the API, not committed per-theme files.
 * This contract keeps the app-owned Methodes registry aligned with the
 * canonical theme roster while leaving Programmes documentation to its owner.
 */
const THEMES_DOCUMENTATION_DEDIEE = ['programmes'] as const

// Producer metadata retains old Mobilité Story declarations although the
// current app surface has no Mobilité Story. Economy's second note is app-owned
// analysis explicitly paused, not a published producer Story.
const STORIES_PRODUCTEUR_HORS_REGISTRE = {
  mobilite: ['vingt-minutes-sans-voiture', 'ce-que-le-velo-preserve'],
} as const
const STORIES_METHODES_EN_PAUSE = {
  economie: ['le-matin-la-commune-se-vide'],
} as const

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

  it('matches published Story keys and classification codes to producer-owned contracts', () => {
    for (const theme of THEMES_CONSTRUITS) {
      const producer = PRODUCER_THEME_METADATA[theme]
      const stories = THEMES_METHODES[theme].stories
      const publishedKeys = stories.filter((story) => story.statut === 'publiee')
        .map((story) => story.clef).sort()
      const pausedKeys = stories.filter((story) => story.statut === 'en-pause')
        .map((story) => story.clef).sort()
      const producerOnly = STORIES_PRODUCTEUR_HORS_REGISTRE[theme as keyof typeof STORIES_PRODUCTEUR_HORS_REGISTRE] ?? []
      const paused = STORIES_METHODES_EN_PAUSE[theme as keyof typeof STORIES_METHODES_EN_PAUSE] ?? []

      expect(publishedKeys, `${theme} published producer Story keys`).toEqual(
        (producer.story_keys as string[]).filter((key) => !(producerOnly as readonly string[]).includes(key)).sort())
      expect(pausedKeys, `${theme} explicitly paused Methods notes`).toEqual(paused)
      for (const key of producer.story_keys as string[]) {
        expect(publishedKeys.includes(key) || (producerOnly as readonly string[]).includes(key),
          `${theme}.${key} published or explicitly excluded`).toBe(true)
      }
      for (const key of producerOnly) expect(producer.story_keys).toContain(key)

      const documentedClassifications = stories.filter((story) => story.statut === 'publiee')
        .flatMap((story) => story.lectures.map((lecture) => lecture.clef)).sort()
      const producerClassifications = Object.keys(producer.classification_labels ?? {}).sort()
      expect(documentedClassifications, `${theme} Methods classification codes`)
        .toEqual(producerClassifications)
    }
  })
})
