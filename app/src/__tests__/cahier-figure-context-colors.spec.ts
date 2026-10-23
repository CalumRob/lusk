import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const tokensCss = readFileSync(join(process.cwd(), 'src', 'styles', 'tokens.css'), 'utf8')
const figureCss = readFileSync(join(process.cwd(), 'src', 'fiche', 'prototype', 'cahierFigure.css'), 'utf8')
let injectedStyles: HTMLStyleElement | undefined

describe('Cahier figure context colors', () => {
  afterEach(() => {
    injectedStyles?.remove()
    injectedStyles = undefined
    document.body.innerHTML = ''
  })

  it('derives reference and series labels from their own region and series colors', () => {
    injectedStyles = document.createElement('style')
    injectedStyles.textContent = `${tokensCss}\n${figureCss}`
    document.head.append(injectedStyles)
    document.body.innerHTML = `
      <div class="cahier" style="--cahier-region-emphasis: #c53952">
        <span class="cahier-figure-scalar-reference">Groupe comparé</span>
        <div class="cahier-figure-scalar cahier-figure-scalar--colored" style="--cahier-figure-scalar-color: #2e6171">
          <span class="cahier-figure-scalar-value">21</span>
        </div>
        <div class="cahier-figure-scalar cahier-figure-scalar--colored" style="--cahier-figure-scalar-color: #a94562">
          <span class="cahier-figure-scalar-value">34</span>
        </div>
      </div>
    `

    const cahier = document.querySelector<HTMLElement>('.cahier')!
    const referenceColor = getComputedStyle(cahier).getPropertyValue('--color-figure-reference')
    const series = [...document.querySelectorAll<HTMLElement>('.cahier-figure-scalar--colored')]
    const seriesColors = series.map((element) => getComputedStyle(element).getPropertyValue('--color-figure-series-label'))

    expect(referenceColor).toContain('#c53952')
    expect(referenceColor).not.toContain('#57726f')
    expect(seriesColors[0]).toContain('#2e6171')
    expect(seriesColors[1]).toContain('#a94562')
    expect(seriesColors[0]).not.toBe(seriesColors[1])
    expect(seriesColors.every((color) => color.includes('#232a2a'))).toBe(true)
    expect(figureCss).toContain('color: var(--color-figure-reference)')
    expect(figureCss).toContain('color: var(--color-figure-series-label)')
  })
})
