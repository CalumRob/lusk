import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Contract test for issue #204 — the ermine must scale with the wordmark text.
 * The horizontal lockup, the vertical lock-up and the hero's brand column all
 * size the ermine in `em` (relative to the wordmark's font), never fixed px:
 * when the hero text shrinks via clamp()/rem on mobile, the brand column keeps
 * its proportions instead of leaving a disproportionately large fixed ermine.
 * Same spirit as app-header-contract.spec.ts / tokens.spec.ts — the committed
 * SFC CSS is the source of truth.
 */

const luskBrandSource = readFileSync(
  join(process.cwd(), 'src', 'components', 'LuskBrand.vue'),
  'utf-8',
)
const accueilSource = readFileSync(
  join(process.cwd(), 'src', 'views', 'AccueilView.vue'),
  'utf-8',
)

function regle(source: string, selecteur: string): string {
  const reg = new RegExp(`(?:^|\\n)${selecteur}\\s*\\{([\\s\\S]*?)\\}`)
  const match = source.match(reg)
  if (!match) throw new Error(`règle introuvable : ${selecteur}`)
  return match[1]
}

describe('#204 — l’ermine suit le texte (em, pas de px fixe)', () => {
  it('dimensionne l’ermine horizontale en em — relative au mot, pas à une taille fixe', () => {
    const ermine = regle(luskBrandSource, '\\.lusk-marque__ermine')
    expect(ermine).toMatch(/width:\s*[\d.]+em/)
    expect(ermine).toMatch(/height:\s*[\d.]+em/)
    expect(ermine).not.toMatch(/\d+px/)
  })

  it('dimensionne l’ermine verticale (34 px fixes → em) pour qu’elle réduise avec le texte', () => {
    const verticale = regle(
      luskBrandSource,
      '\\.lusk-marque--verticale \\.lusk-marque__ermine',
    )
    expect(verticale).toMatch(/width:\s*[\d.]+em/)
    expect(verticale).toMatch(/height:\s*[\d.]+em/)
    expect(verticale).not.toMatch(/\d+px/)
  })

  it('dimensionne l’ermine du héros en em — les proportions de la colonne de marque tiennent à petite largeur', () => {
    const hero = regle(
      accueilSource,
      '\\.accueil-hero-marque :deep\\(\\.lusk-marque__ermine\\)',
    )
    expect(hero).toMatch(/width:\s*[\d.]+em/)
    expect(hero).toMatch(/height:\s*[\d.]+em/)
    expect(hero).toMatch(/margin-bottom:\s*-[\d.]+em/)
    expect(hero).not.toMatch(/\d+px/)
  })
})
