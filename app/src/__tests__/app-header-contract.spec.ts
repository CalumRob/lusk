import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Contract test for issue #80 — the header nav is centered RELATIVE to the
 * free space between the logo (left) and the right cluster (Rechercher +
 * Contact), not hardcoded to the full-header center.
 *
 * DESIGN.md is a local-only working doc (gitignored); the committed source of
 * truth is the component CSS + these contract assertions (same spirit as
 * tokens.spec.ts / fiche-subheader.spec.ts).
 */

const source = readFileSync(
  join(process.cwd(), 'src', 'components', 'AppHeader.vue'),
  'utf-8',
)

function regle(selecteur: string): string {
  const reg = new RegExp(`${selecteur}\\s*\\{([\\s\\S]*?)\\}`)
  const match = source.match(reg)
  if (!match) throw new Error(`règle introuvable : ${selecteur}`)
  return match[1]
}

describe('#80 — la navigation du header est centrée entre le logo et le bouton Contact', () => {
  it('fait de la nav un élément flex qui absorbe l’espace libre (flex: 1), centré par justify-content', () => {
    const nav = regle('\\.nav-bureau')
    expect(nav).toMatch(/flex:\s*1/)
    expect(nav).toContain('justify-content: center')
  })

  it('ne positionne plus la nav en absolu à 50 % de la largeur du header', () => {
    const nav = regle('\\.nav-bureau')
    expect(nav).not.toContain('position: absolute')
    expect(nav).not.toContain('left: 50%')
    expect(nav).not.toContain('transform: translateX(-50%)')
  })

  it('n’écrase plus la recherche vers la droite avec margin-left: auto — l’espace revient à la nav', () => {
    const recherche = regle('\\.en-tete-recherche')
    expect(recherche).not.toContain('margin-left: auto')
  })
})
