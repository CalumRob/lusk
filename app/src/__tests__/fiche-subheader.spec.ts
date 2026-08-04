import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Contract test for issue #70 — the fiche subheader delimits the background
 * zones, and the fiche's action row (type chip + context switcher) is centered.
 *
 * DESIGN.md is a local-only working doc (gitignored); the committed source of
 * truth is the component CSS + these contract assertions, in the same spirit as
 * tokens.spec.ts (which reads tokens.css and asserts the DESIGN.md contract).
 */

function extraireStyleScoped(chemin: string): string {
  const source = readFileSync(join(process.cwd(), 'src', chemin), 'utf-8')
  const bloc = source.match(/<style scoped>([\s\S]*?)<\/style>/)
  if (!bloc) throw new Error(`aucun <style scoped> dans ${chemin}`)
  return bloc[1]
}

const cssThemeTabs = extraireStyleScoped('components/ThemeTabs.vue')
const cssTerritoire = extraireStyleScoped('views/TerritoireView.vue')

function regle(css: string, selecteur: string): string {
  const reg = new RegExp(`${selecteur}\\s*\\{([\\s\\S]*?)\\}`)
  const match = css.match(reg)
  if (!match) throw new Error(`règle introuvable : ${selecteur}`)
  return match[1]
}

describe('#70 — le sous-en-tête de la fiche délimite les zones de fond', () => {
  it('donne au sous-en-tête complet une surface solide', () => {
    expect(regle(cssTerritoire, '\\.fiche-en-tete-surface')).toContain(
      'background: var(--surface-primary)',
    )
  })

  it('donne au bandeau ThemeTabs un fond solide distinct du fond de page (--surface-primary, pas le chrome translucide)', () => {
    expect(regle(cssThemeTabs, '\\.theme-tabs')).toContain('background: var(--surface-primary)')
  })

  it('garde la séparation basse du bandeau complet (border-bottom)', () => {
    expect(regle(cssThemeTabs, '\\.theme-tabs')).toContain('border-bottom: 1px solid var(--border-subtle)')
  })
})

describe('#70 — les boutons d’action de la fiche sont centrés', () => {
  it('centre le bloc d’identité (H1 + chip de type)', () => {
    expect(regle(cssTerritoire, '\\.fiche-titre')).toContain('justify-content: center')
  })

  it('centre la rangée d’actions (chip de type + contexte) sous le titre', () => {
    expect(regle(cssTerritoire, '\\.fiche-actions')).toContain('justify-content: center')
    expect(regle(cssTerritoire, '\\.fiche-actions')).toContain('flex-wrap: wrap')
  })
})
