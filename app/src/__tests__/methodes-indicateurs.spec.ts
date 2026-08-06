import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { THEMES_CONSTRUITS, THEMES_METHODES } from '../methodes/indicateurs'
import { SOURCES_METHODES } from '../methodes/sources'
import type { ThemeConstruit } from '../methodes/indicateurs'

/**
 * Le registre Méthodes des indicateurs & Stories (issue #129, docs/themes/
 * README.md §The Méthodes contract). La parité avec la payload : chaque clé
 * d'indicateur des trois thèmes construits (public/data/indicateurs_<theme>.json)
 * doit avoir une définition de registre, avec son unité et sa source en
 * ground truth ; chaque Story construite (public/data/histoires_<theme>.json)
 * doit être documentée. Le registre expose le mapping thème → documentation
 * dans la forme que le futur test de contrat de parité pourra asserter.
 */

const dataDir = join(process.cwd(), '..', 'public', 'data')

interface LigneIndicateur {
  theme: string
  key: string
  unit: string
  vintage_source: string
}

function indicateursCommites(theme: ThemeConstruit): LigneIndicateur[] {
  return JSON.parse(
    readFileSync(join(dataDir, `indicateurs_${theme}.json`), 'utf-8'),
  ) as LigneIndicateur[]
}

/** Les clés distinctes d'indicateurs de la payload, avec leur unité (ground truth). */
function clefsEtUnitesCommites(theme: ThemeConstruit): Record<string, string> {
  const parClef: Record<string, string> = {}
  for (const ligne of indicateursCommites(theme)) {
    if (ligne.theme === theme) parClef[ligne.key] = ligne.unit
  }
  return parClef
}

interface LigneHistoire {
  theme: string
  story_key: string
  classification: string | null
}

function histoiresCommites(theme: ThemeConstruit): LigneHistoire[] {
  return JSON.parse(
    readFileSync(join(dataDir, `histoires_${theme}.json`), 'utf-8'),
  ) as LigneHistoire[]
}

function clefsHistoiresCommites(theme: ThemeConstruit): Set<string> {
  return new Set(histoiresCommites(theme).map((h) => h.story_key))
}

/** Les classifications publiées (non nulles) de chaque Story — les lectures à documenter. */
function classificationsParStory(theme: ThemeConstruit): Record<string, string[]> {
  const parStory: Record<string, string[]> = {}
  for (const histoire of histoiresCommites(theme)) {
    if (histoire.classification === null) continue
    if (!parStory[histoire.story_key]) parStory[histoire.story_key] = []
    if (!parStory[histoire.story_key].includes(histoire.classification)) {
      parStory[histoire.story_key].push(histoire.classification)
    }
  }
  return parStory
}

describe('registre Méthodes — la forme exposée au contrat de parité', () => {
  it('couvre les trois thèmes construits, dans l\u2019ordre canonique', () => {
    expect(THEMES_CONSTRUITS).toEqual(['demographie', 'habitat', 'economie'])
    expect(Object.keys(THEMES_METHODES)).toEqual(THEMES_CONSTRUITS)
  })

  it('expose par thème un mapping { indicateurs, stories } asserable', () => {
    for (const theme of THEMES_CONSTRUITS) {
      const themeMethodes = THEMES_METHODES[theme]
      expect(themeMethodes, `thème « ${theme} » sans registre`).toBeDefined()
      expect(typeof themeMethodes.indicateurs).toBe('object')
      expect(Array.isArray(themeMethodes.stories)).toBe(true)
    }
  })

  it('chaque thème construit documente au moins une Story', () => {
    for (const theme of THEMES_CONSTRUITS) {
      expect(THEMES_METHODES[theme].stories.length, `« ${theme} » sans Story`).toBeGreaterThan(0)
    }
  })
})

describe('registre Méthodes — la parité avec les indicateurs de la payload', () => {
  it('couvre chaque clé d\u2019indicateur des trois thèmes construits', () => {
    for (const theme of THEMES_CONSTRUITS) {
      const clefs = clefsEtUnitesCommites(theme)
      expect(Object.keys(clefs).length, `« ${theme} » sans indicateurs commis`).toBeGreaterThan(0)
      for (const clef of Object.keys(clefs)) {
        expect(
          THEMES_METHODES[theme].indicateurs[clef],
          `clé « ${theme}.${clef} » sans définition de registre`,
        ).toBeDefined()
      }
    }
  })

  it('porte les unités ground truth de la payload, clé par clé', () => {
    for (const theme of THEMES_CONSTRUITS) {
      const clefs = clefsEtUnitesCommites(theme)
      for (const [clef, unite] of Object.entries(clefs)) {
        expect(THEMES_METHODES[theme].indicateurs[clef].unite, `unité « ${theme}.${clef} »`).toBe(
          unite,
        )
      }
    }
  })

  it('chaque indicateur porte label, définition et source (jamais vides)', () => {
    for (const theme of THEMES_CONSTRUITS) {
      for (const [clef, indicateur] of Object.entries(THEMES_METHODES[theme].indicateurs)) {
        expect(indicateur.label.length, `« ${theme}.${clef} » sans label`).toBeGreaterThan(0)
        expect(
          indicateur.definition.length,
          `« ${theme}.${clef} » sans définition`,
        ).toBeGreaterThan(20)
        expect(indicateur.source.length, `« ${theme}.${clef} » sans source`).toBeGreaterThan(0)
      }
    }
  })

  it('un sourceId résout toujours une entrée du registre des sources, au même nom', () => {
    for (const theme of THEMES_CONSTRUITS) {
      for (const [clef, indicateur] of Object.entries(THEMES_METHODES[theme].indicateurs)) {
        if (indicateur.sourceId === null) continue
        const source = SOURCES_METHODES[indicateur.sourceId]
        expect(source, `« ${theme}.${clef} » → sourceId « ${indicateur.sourceId} » introuvable`).toBeDefined()
        expect(indicateur.source, `« ${theme}.${clef} » → nom divergent`).toBe(source.nom)
      }
    }
  })
})

describe('registre Méthodes — la parité avec les Stories de la payload', () => {
  it('couvre chaque story_key des trois thèmes construits', () => {
    for (const theme of THEMES_CONSTRUITS) {
      const clefs = clefsHistoiresCommites(theme)
      expect(clefs.size, `« ${theme} » sans histoires commises`).toBeGreaterThan(0)
      const clefsRegistre = new Set(THEMES_METHODES[theme].stories.map((s) => s.clef))
      for (const clef of clefs) {
        expect(clefsRegistre.has(clef), `story_key « ${theme}.${clef} » non documentée`).toBe(true)
      }
    }
  })

  it('documente chaque lecture publiée (classification non nulle) de chaque Story', () => {
    for (const theme of THEMES_CONSTRUITS) {
      const parStory = classificationsParStory(theme)
      for (const story of THEMES_METHODES[theme].stories) {
        const classifications = parStory[story.clef] ?? []
        const lectures = new Set(story.lectures.map((l) => l.clef))
        for (const classification of classifications) {
          expect(
            lectures.has(classification),
            `« ${theme}.${story.clef} » → lecture « ${classification} » non documentée`,
          ).toBe(true)
        }
      }
    }
  })

  it('chaque Story porte titre, définition et des lectures nommées', () => {
    for (const theme of THEMES_CONSTRUITS) {
      for (const story of THEMES_METHODES[theme].stories) {
        expect(story.titre.length, `« ${theme}.${story.clef} » sans titre`).toBeGreaterThan(0)
        expect(
          story.definition.length,
          `« ${theme}.${story.clef} » sans définition`,
        ).toBeGreaterThan(20)
        for (const lecture of story.lectures) {
          expect(lecture.nom.length, `« ${theme}.${story.clef} » lecture sans nom`).toBeGreaterThan(0)
          expect(
            lecture.lecture.length,
            `« ${theme}.${story.clef} » lecture sans texte`,
          ).toBeGreaterThan(10)
        }
      }
    }
  })
})

describe('registre Méthodes — la langue publique, jamais celle du pipeline', () => {
  /** Les mots du pipeline à ne jamais publier (issue #129 : pas de gates, pas de noms d\u2019artefacts). */
  const MOTS_INTERNES = [
    /gate/i,
    /\.rds\b/,
    /parquet/i,
    /sidecar/i,
    /artefact/i,
    /manifeste/i,
    /plancher/i,
    /TOP_N/i,
    /dpe03existant/i,
    /sirene-v3/i,
    /histoires/,
  ]

  it('les définitions et lectures ne portent aucun mot interne au pipeline', () => {
    for (const theme of THEMES_CONSTRUITS) {
      for (const [clef, indicateur] of Object.entries(THEMES_METHODES[theme].indicateurs)) {
        const texte = indicateur.definition
        for (const motif of MOTS_INTERNES) {
          expect(
            motif.test(texte),
            `« ${theme}.${clef} » porte un mot interne : ${motif}`,
          ).toBe(false)
        }
      }
      for (const story of THEMES_METHODES[theme].stories) {
        const textes = [story.definition, ...story.lectures.map((l) => l.lecture)]
        for (const texte of textes) {
          for (const motif of MOTS_INTERNES) {
            expect(
              motif.test(texte),
              `« ${theme}.${story.clef} » porte un mot interne : ${motif}`,
            ).toBe(false)
          }
        }
      }
    }
  })

  it('les définitions parlent en français public (pas de clés brutes de payload)', () => {
    for (const theme of THEMES_CONSTRUITS) {
      for (const [clef, indicateur] of Object.entries(THEMES_METHODES[theme].indicateurs)) {
        // la clé brute n'apparaît jamais dans la définition — la définition est rédigée
        expect(indicateur.definition).not.toContain(clef)
      }
    }
  })
})
