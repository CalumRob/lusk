import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import LuskBrand from '../components/LuskBrand.vue'
import { MARQUE_LUSK_LOCKUP, REMPLISSAGES_MARQUE_LUSK } from '../components/luskBrandMark'

/**
 * Contract test for issue #204 — the ermine must scale with the wordmark text.
 * The horizontal lockup, the vertical lock-up and the hero's brand column all
 * size the ermine in `em` (relative to the wordmark's font), never fixed px:
 * when the hero text shrinks via clamp()/rem on mobile, the brand column keeps
 * its proportions instead of leaving a disproportionately large fixed ermine.
 * Since #1024 the em value is owned by `MARQUE_LUSK_LOCKUP`, the same owner the
 * PDF painter consumes, and the committed SFC binds it at runtime.
 */

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
  it('dimensionne l’ermine horizontale en em — depuis l’owner partagé, jamais une taille fixe', () => {
    expect(MARQUE_LUSK_LOCKUP.ermineEm).toBe(1.18)
    const style = mount(LuskBrand).get('.lusk-marque__ermine').attributes('style')!
    expect(style).toContain(`--lusk-ermine-em: ${MARQUE_LUSK_LOCKUP.ermineEm}em`)
    expect(style).not.toMatch(/\d+px/)
    // The committed SFC consumes the injected property for the box.
    const css = readFileSync(join(process.cwd(), 'src', 'components', 'LuskBrand.vue'), 'utf-8')
    expect(css).toMatch(/width:\s*var\(--lusk-ermine-em\)/)
    expect(css).toMatch(/height:\s*var\(--lusk-ermine-em\)/)
  })

  it('dimensionne l’ermine verticale (34 px fixes → em) pour qu’elle réduise avec le texte', () => {
    expect(MARQUE_LUSK_LOCKUP.ermineVerticaleEm).toBe(1.55)
    const style = mount(LuskBrand, { props: { verticale: true } })
      .get('.lusk-marque__ermine').attributes('style')!
    expect(style).toContain(`--lusk-ermine-em: ${MARQUE_LUSK_LOCKUP.ermineVerticaleEm}em`)
    expect(style).not.toMatch(/\d+px/)
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

/**
 * Identity contract for the locked mark's fills (#1024). The mark is a brand
 * asset, so its *design* identity belongs to this owner contract, not to an
 * incidental PDF-ownership assertion. Both anchors are external to the module:
 * the accent is the canonical `--brand-500` anchor (§2/§7), and the locked body
 * ink is the stable `#1B1B19` recorded for the watermark (§7). The module owns
 * the literal; consumers must resolve it from here (their no-copy scan lives in
 * `cahier-pdf-composer.spec.ts`).
 */
describe('#1024 — identité verrouillée des remplissages de l’hermine', () => {
  const tokens = readFileSync(
    join(process.cwd(), 'src', 'styles', 'tokens.css'),
    'utf-8',
  ).toLowerCase()
  const design = readFileSync(join(process.cwd(), '..', 'DESIGN.md'), 'utf-8').toLowerCase()

  it('ancre l’accent sur --brand-500 et garde une encre de corps distincte', () => {
    const ancre = /--brand-500:\s*(#[0-9a-f]{6})/.exec(tokens)?.[1]
    expect(ancre).toBeTruthy()
    expect(REMPLISSAGES_MARQUE_LUSK.accent.toLowerCase()).toBe(ancre)
    expect(design).toContain('#1b1b19')
    expect(REMPLISSAGES_MARQUE_LUSK.ink.toLowerCase()).toBe('#1b1b19')
    expect(REMPLISSAGES_MARQUE_LUSK.ink.toLowerCase())
      .not.toBe(REMPLISSAGES_MARQUE_LUSK.accent.toLowerCase())
  })
})
