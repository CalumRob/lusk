import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const donutSource = readFileSync(
  join(process.cwd(), 'src', 'fiche', 'prototype', 'CahierDonut.vue'),
  'utf8',
)
const figureCss = readFileSync(
  join(process.cwd(), 'src', 'fiche', 'prototype', 'cahierFigure.css'),
  'utf8',
)

function declaration(source: string, property: string): string {
  const match = source.match(new RegExp(`  ${property}:\\r?\\n([\\s\\S]*?)\\r?\\n\\}`))
  if (!match) throw new Error(`Missing ${property} declaration`)
  return match[1].replace(/\s+/g, ' ').trim().replace(/;$/, '')
}

describe('Cahier donut primitive', () => {
  it('keeps the inaccessible sector background parseable by the browser', () => {
    const probe = document.createElement('div')
    probe.style.backgroundImage = declaration(donutSource, 'background-image')

    expect(probe.style.backgroundImage).not.toBe('')
  })

  it('keeps popover tooltips wide enough to escape a narrow donut column', () => {
    const popoverRule = figureCss.match(
      /\.cahier-figure-tooltip--popover\s*\{([\s\S]*?)\n\}/,
    )?.[1]

    expect(popoverRule).toContain('100vw')
  })
})
