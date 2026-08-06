import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { THEMES_CONSTRUITS } from '../methodes/indicateurs'
import type { ThemeConstruit } from '../methodes/indicateurs'

/**
 * Le contrat Méthodes de parité (issue #130, CONTEXT.md → Méthodes : « a
 * theme is not "built" until its sources and variables are documented here,
 * never an afterthought »). Un thème présent dans la payload commise
 * (public/data/indicateurs_<theme>.json) DOIT avoir sa documentation Méthodes
 * dans le registre (app/src/methodes/indicateurs.ts, THEMES_CONSTRUITS) — la
 * section Méthodes d'un thème expédie avec son payload, jamais après.
 *
 * Direction de l'assertion : bidirectionnelle.
 * - payload ⊆ registre (la règle de l'issue #130, l'essentiel) : un thème dont
 *   le payload est commis sans section Méthodes échoue en le nommant. C'est
 *   l'enforcement : quand le payload de la Mobilité part, ce test force sa
 *   documentation Méthodes à partir avec lui.
 * - registre ⊆ payload (l'inverse, gratuit à asserter) : le registre est
 *   « thèmes construits uniquement » par construction, mais rien ne vérifie à
 *   l'exécution qu'un thème documenté a bien un payload commis — l'inverse
 *   verrouille le contrat des deux côtés (pas de section fantôme pour un
 *   thème dont le payload serait retiré).
 *
 * Le « thème présent dans la payload » est déterminé par EXISTENCE des
 * fichiers commis, jamais par leur contenu : indicateurs_economie.json pèse
 * 82 Mo — le matérialiser (JSON.parse) reproduirait le flake de
 * payload-contract.spec.ts. Un readdir + une expression régulière sur le nom
 * suffisent, en quelques millisecondes.
 */

const dataDir = join(process.cwd(), '..', 'public', 'data')

/** Les thèmes dont un payload est commis — l'existence du fichier, jamais son contenu. */
function themesDeLaPayload(): string[] {
  const themes: string[] = []
  for (const nom of readdirSync(dataDir)) {
    const correspondance = nom.match(/^indicateurs_([a-z]+)\.json$/)
    if (correspondance) themes.push(correspondance[1])
  }
  return themes.sort()
}

/**
 * Le cœur de l'enforcement : les thèmes de payload sans documentation
 * Méthodes — tout ce qui n'est pas dans le registre des thèmes construits.
 */
function themesSansDocumentation(payloadThemes: string[]): string[] {
  return payloadThemes.filter((theme) => !THEMES_CONSTRUITS.includes(theme as ThemeConstruit))
}

describe('contrat Méthodes — chaque thème de la payload a sa documentation', () => {
  it('l\u2019enforcement a des dents : un thème de payload sans section Méthodes est nommé', () => {
    // Quand le payload de la Mobilité part (indicateurs_mobilite.json commis)
    // sans sa section Méthodes, le contrat doit la nommer — jamais échouer en
    // silence sur une liste vide. Ce test fixe le comportement de détection :
    // sans lui, l'assertion de parité pourrait passer par vacuité.
    expect(themesSansDocumentation(['demographie', 'habitat', 'economie', 'mobilite'])).toEqual([
      'mobilite',
    ])
  })

  it('découvre les payloads commis — les thèmes construits du registre, ni plus ni moins', () => {
    // L'ancre de la découverte : le registre lui-même, jamais une liste
    // dupliquée. Un fichier indicateurs_<theme>.json de plus (ou de moins)
    // fait échouer ce test en nommant le thème dans le diff.
    expect(new Set(themesDeLaPayload())).toEqual(new Set(THEMES_CONSTRUITS))
  })

  it('chaque thème présent dans la payload a sa section Méthodes (payload ⊆ registre)', () => {
    const manquants = themesSansDocumentation(themesDeLaPayload())
    for (const theme of manquants) {
      expect(
        THEMES_CONSTRUITS.includes(theme as (typeof THEMES_CONSTRUITS)[number]),
        `« ${theme} » est dans la payload (indicateurs_${theme}.json) mais n'a pas de section Méthodes — un thème n'est « construit » qu'avec sa documentation (CONTEXT.md → Méthodes).`,
      ).toBe(true)
    }
  })

  it('le registre ne documente aucun thème sans payload commise (registre ⊆ payload)', () => {
    const payload = new Set(themesDeLaPayload())
    for (const theme of THEMES_CONSTRUITS) {
      expect(
        payload.has(theme),
        `« ${theme} » est documenté dans le registre Méthodes mais n'a pas de payload commise (indicateurs_${theme}.json) — une section Méthodes n'expédie qu'avec son payload.`,
      ).toBe(true)
    }
  })
})
