import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Contrat d'hygiène de mise en page (issue #331, parent #206 items 48-49) :
 * l'intro de /methodologie au corps standard, la cellule licence qui se plie
 * (jamais de débordement, les cellules version/date gardent leur traitement
 * tabulaire one-line), et les pages /methodologie + /a-propos sur la colonne
 * de contenu standard (--content-max-width, base.css §.page) — comme
 * l'accueil, les fiches et les listes. DESIGN.md est un doc de travail local
 * (gitignoré) ; la source commise est le CSS des composants + ces assertions
 * (même esprit que fiche-subheader.spec.ts / app-header-contract.spec.ts).
 */

function extraireStyleScoped(chemin: string): string {
  const source = readFileSync(join(process.cwd(), 'src', chemin), 'utf-8')
  const bloc = source.match(/<style scoped>([\s\S]*?)<\/style>/)
  if (!bloc) throw new Error(`aucun <style scoped> dans ${chemin}`)
  return bloc[1]
}

function regle(css: string, selecteur: string): string {
  const reg = new RegExp(`${selecteur}\\s*\\{([\\s\\S]*?)\\}`)
  const match = css.match(reg)
  if (!match) throw new Error(`règle introuvable : ${selecteur}`)
  return match[1]
}

const cssMethodologie = extraireStyleScoped('views/MethodologieView.vue')
const cssAPropos = extraireStyleScoped('views/AProposView.vue')
  const cssSources = extraireStyleScoped('methodes/SourcesTable.vue')
  const cssIndicateurs = extraireStyleScoped('methodes/MethodesIndicateurs.vue')
const baseCss = readFileSync(join(process.cwd(), 'src', 'styles', 'base.css'), 'utf-8')

describe('#331 — l\u2019intro de /methodologie au corps standard (item 48)', () => {
  it('rend l\u2019intro sous « Sources & Méthodes » au corps standard (--text-body), plus le corps élargi (--text-body-lg)', () => {
    expect(regle(cssMethodologie, '\\.methodologie__intro p')).toContain('font: var(--text-body)')
    expect(regle(cssMethodologie, '\\.methodologie__intro p')).not.toContain('text-body-lg')
  })
})

describe('#331 — la cellule licence se plie, jamais de débordement (item 49)', () => {
  it('donne à la cellule licence une classe dédiée qui autorise le retour à la ligne', () => {
    expect(regle(cssSources, '\\.cellule-licence')).toContain('white-space: normal')
  })

  it('garde les cellules version/date sur une ligne (traitement tabulaire one-line)', () => {
    expect(regle(cssSources, '\\.cellule-fraicheur')).toContain('white-space: nowrap')
    expect(regle(cssSources, '\\.cellule-fraicheur')).toContain(
      'font-variant-numeric: tabular-nums',
    )
  })
})

describe('#331 — /methodologie et /a-propos sur la colonne de contenu standard (1200px)', () => {
  it('ne resserrent plus la page à 900px — la colonne revient à .page (base.css, --content-max-width)', () => {
    expect(cssMethodologie).not.toMatch(/max-width:\s*900px/)
    expect(cssAPropos).not.toMatch(/max-width:\s*900px/)
  })

  it('la colonne de contenu standard reste la grille du site (.page → --content-max-width)', () => {
    const reglePage = /\.page\s*\{([\s\S]*?)\}/.exec(baseCss)
    expect(reglePage).not.toBeNull()
    expect(reglePage![1]).toContain('max-width: var(--content-max-width)')
    expect(reglePage![1]).toContain('margin-inline: auto')
  })
})

describe('#334 — les blocs d\u2019indicateurs défilent sous le header (ancre #indicateur-<clef>)', () => {
  it('porte la marge de scroll du header — la même convention que les blocs de thème', () => {
    expect(regle(cssIndicateurs, '\\.bloc-indicateur')).toContain(
      'scroll-margin-top: calc(var(--header-height) + 12px)',
    )
  })
})
