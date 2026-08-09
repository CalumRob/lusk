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

const baseCss = readFileSync(
  join(process.cwd(), 'src', 'styles', 'base.css'),
  'utf-8',
)

function regle(selecteur: string): string {
  const reg = new RegExp(`${selecteur}\\s*\\{([\\s\\S]*?)\\}`)
  const match = source.match(reg)
  if (!match) throw new Error(`règle introuvable : ${selecteur}`)
  return match[1]
}

function blocMedia(maxWidth: string): string {
  const debut = source.indexOf(`@media (max-width: ${maxWidth}) {`)
  if (debut === -1) throw new Error(`media query introuvable : max-width: ${maxWidth}`)
  let profondeur = 0
  for (let i = debut; i < source.length; i++) {
    if (source[i] === '{') profondeur++
    else if (source[i] === '}') {
      profondeur--
      if (profondeur === 0) return source.slice(debut, i + 1)
    }
  }
  throw new Error('media query non fermée')
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

describe('#205 — le tiroir mobile est hors du header (contenant bloc du backdrop-filter)', () => {
  it('rend le tiroir (#menu-mobile) en dehors de l’élément <header> — le `backdrop-filter` de .en-tete en ferait un contenant bloc et réduirait `position: fixed; inset: 0` à la hauteur du header', () => {
    const finHeader = source.indexOf('</header>')
    const tiroir = source.indexOf('id="menu-mobile"')

    expect(finHeader).toBeGreaterThan(-1)
    expect(tiroir).toBeGreaterThan(-1)
    expect(finHeader).toBeLessThan(tiroir)
  })

  it('garde le tiroir en plein écran : `position: fixed` + `inset: 0`', () => {
    const tiroir = regle('\\.tiroir')
    expect(tiroir).toContain('position: fixed')
    expect(tiroir).toContain('inset: 0')
  })

  it('garde le flou d’arrière-plan (backdrop-filter) sur le chrome du header — inchangé au desktop', () => {
    const enTete = regle('\\.en-tete')
    expect(enTete).toContain('backdrop-filter')
  })
})

describe('#270 — le panneau de recherche est hors du header (contenant bloc du backdrop-filter)', () => {
  it('rend le panneau (#recherche-superposee) en dehors de l’élément <header> — le même piège que #205, latent sur le panneau desktop : le `backdrop-filter` de .en-tete en ferait un contenant bloc et réduirait `position: fixed; left: 0; right: 0` à la boîte du header', () => {
    const finHeader = source.indexOf('</header>')
    const panneau = source.indexOf('id="recherche-superposee"')

    expect(finHeader).toBeGreaterThan(-1)
    expect(panneau).toBeGreaterThan(-1)
    expect(finHeader).toBeLessThan(panneau)
  })

  it('garde le panneau en fixed sous le header : `position: fixed` + `top: var(--header-height)` — la position reste inchangée une fois sibling (le header garde `position: sticky; top: 0`)', () => {
    const panneau = regle('\\.recherche-superposee')
    expect(panneau).toContain('position: fixed')
    expect(panneau).toContain('top: var(--header-height)')
    expect(panneau).toContain('left: 0')
    expect(panneau).toContain('right: 0')
  })

  it('masque le panneau sur mobile — sorti du header, il n’est plus couvert par le `display: none` de .en-tete-recherche (<768px) : le panneau est desktop-only, la recherche mobile vit dans le tiroir', () => {
    expect(blocMedia('767.98px')).toMatch(/\.recherche-superposee\s*\{\s*display:\s*none\s*;\s*\}/)
  })
})

describe('#205 — le verrouillage du défilement touche aussi <html>', () => {
  it('définit html.tiroir-verrouille en overflow: clip — html porte overflow-x: clip, donc le verrou sur body seul ne propage jamais au viewport', () => {
    const regleHtml = /html\.tiroir-verrouille\s*\{([\s\S]*?)\}/.exec(baseCss)
    expect(regleHtml).not.toBeNull()
    expect(regleHtml![1]).toContain('overflow: clip')
  })
})
