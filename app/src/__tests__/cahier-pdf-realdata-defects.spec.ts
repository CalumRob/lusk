/**
 * #1025 real-data review regressions — behavioural checks at the public seams.
 */
import { describe, expect, it, vi } from 'vitest'

import { formatTimeRampNumber } from '@/fiche/prototype/cahierFigureReadings'
import { ROLE_PDF } from '@/fiche/prototype/cahierPdfGrammaire'
import { roleCelluleTableau } from '@/fiche/prototype/cahierPdfTableau'
import { CAHIER_EXPORT_SURFACE, cahierExportHiddenSelectors, reflowVisibleFigureTracks } from '@/fiche/prototype/cahierExportSurface'

function rect(width: number): DOMRect {
  return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 80, width, height: 80, toJSON() {} } as DOMRect
}

function mountSpread(tracks: string, withSource: boolean) {
  document.body.innerHTML = `<div id="root">
    <div id="spread" data-cahier-export-layout="spread" style="display:grid;grid-template-columns:${tracks}">
      <div id="prose"><p class="argument-copy">Texte</p>${withSource ? '<p class="cahier-evidence-source">Source : INSEE</p>' : ''}</div>
      <figure id="figure"></figure>
    </div>
  </div>`
  const root = document.getElementById('root') as HTMLElement
  const spread = document.getElementById('spread') as HTMLElement
  const prose = document.getElementById('prose') as HTMLElement
  const figure = document.getElementById('figure') as HTMLElement
  const widths = new WeakMap<Element, number>([[figure, 240]])
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rect(widths.get(this) ?? 0)
  })
  return { root, spread, prose, figure }
}

describe('real-data PDF defect regressions (#1025)', () => {
  it('keeps French grouping separators in figure text', () => {
    expect(formatTimeRampNumber(6440)).toBe('6 440')
    expect(formatTimeRampNumber(12881)).toBe('12 881')
    expect(formatTimeRampNumber(6440)).not.toMatch(/[\u202f\u00a0]/u)
  })

  it('measures raw/Mode cells with the role the composer paints', () => {
    expect(roleCelluleTableau(true)).toEqual(ROLE_PDF.libelleTableau)
    expect(roleCelluleTableau(false)).toEqual(ROLE_PDF.valeurTableau)
  })

  it('collapses a prose+figure spread even when the prose still shows a source stamp', () => {
    const { root, spread, prose, figure } = mountSpread('1fr 1fr', true)
    expect(CAHIER_EXPORT_SURFACE.proseSelector).toContain('.cahier-evidence-source')
    reflowVisibleFigureTracks(root)
    expect(prose.style.display).toBe('none')
    expect(spread.style.gridTemplateColumns).toBe('repeat(1, minmax(0, 1fr))')
    // Native width pinned before any mutation — no stretch, no shrink.
    expect(figure.style.width).toBe('240px')
    expect(figure.style.maxWidth).toBe('240px')
    vi.restoreAllMocks()
  })

  it('does not mistake a paragraph with a link icon for a figure child', () => {
    document.body.innerHTML = `<div id="root"><div id="spread" data-cahier-export-layout="spread" style="display:grid;grid-template-columns:1fr 1fr">
      <p id="copy">Lire la source <svg></svg></p><figure id="figure"></figure></div></div>`
    const root = document.getElementById('root') as HTMLElement
    const spread = document.getElementById('spread') as HTMLElement
    const copy = document.getElementById('copy') as HTMLElement
    reflowVisibleFigureTracks(root)
    // No prose-role child to drop, so the authored two-track layout is kept.
    expect(copy.style.display).not.toBe('none')
    expect(spread.style.gridTemplateColumns).not.toContain('repeat(')
    vi.restoreAllMocks()
  })

  it('centres nothing and pins nothing when there is no prose to remove', () => {
    document.body.innerHTML = `<div id="root"><div id="spread" data-cahier-export-layout="spread" style="display:grid;grid-template-columns:1fr">
      <figure id="figure"></figure></div></div>`
    const root = document.getElementById('root') as HTMLElement
    const spread = document.getElementById('spread') as HTMLElement
    const figure = document.getElementById('figure') as HTMLElement
    reflowVisibleFigureTracks(root)
    expect(spread.style.gridTemplateColumns).not.toContain('repeat(')
    expect(spread.style.justifyItems).toBe('')
    expect(spread.style.justifyContent).toBe('')
    expect(figure.style.width).toBe('')
    vi.restoreAllMocks()
  })

  it('centres every band of a reflowed figure on the pinned plate axis', () => {
    document.body.innerHTML = `<div id="root"><figure id="block">
      <figcaption id="title">Titre de la figure</figcaption>
      <div id="spread" data-cahier-export-layout="spread" style="display:grid;grid-template-columns:1fr 1fr">
        <div id="prose"><p class="argument-copy">Texte</p></div>
        <figure id="plate"><svg></svg></figure>
        <div id="legend">Légende : faible — forte</div>
      </div>
    </figure></div>`
    const root = document.getElementById('root') as HTMLElement
    const title = document.getElementById('title') as HTMLElement
    const legend = document.getElementById('legend') as HTMLElement
    const prose = document.getElementById('prose') as HTMLElement
    const boxes = new WeakMap<Element, { x: number; width: number }>([
      [document.getElementById('spread')!, { x: 100, width: 200 }], // body axis = 200
      [document.getElementById('plate')!, { x: 100, width: 200 }], // plate axis = 200
      [title, { x: 40, width: 100 }],   // centre 90  -> dx +110
      [legend, { x: 50, width: 60 }],   // centre 80  -> dx +120
      [prose, { x: 0, width: 100 }],
    ])
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const b = boxes.get(this) ?? { x: 0, width: 0 }
      return { x: b.x, y: 0, top: 0, left: b.x, right: b.x + b.width,
        bottom: 80, width: b.width, height: 80, toJSON() {} } as DOMRect
    })
    reflowVisibleFigureTracks(root)
    expect(prose.style.display).toBe('none')
    // The title band lives outside the reflowed layout; the legend band lives
    // inside it. Both are translated only: authored alignment/wrapping stay.
    expect(title.style.translate).toBe('110px')
    expect(legend.style.translate).toBe('120px')
    expect(title.style.textAlign).toBe('')
    expect(legend.style.textAlign).toBe('')
    expect(title.style.transform).toBe('')
    vi.restoreAllMocks()
  })

  it('never translates a band wider than the body, so it cannot overrun the page', () => {
    document.body.innerHTML = `<div id="root"><figure id="block">
      <figcaption id="title">Titre très large</figcaption>
      <div id="spread" data-cahier-export-layout="spread" style="display:grid;grid-template-columns:1fr 1fr">
        <div id="prose"><p class="argument-copy">Texte</p></div>
        <figure id="plate"></figure>
      </div>
    </figure></div>`
    const root = document.getElementById('root') as HTMLElement
    const title = document.getElementById('title') as HTMLElement
    const boxes = new WeakMap<Element, { x: number; width: number }>([
      [document.getElementById('spread')!, { x: 100, width: 200 }], // body [100,300]
      [document.getElementById('plate')!, { x: 100, width: 200 }],
      [title, { x: -100, width: 500 }], // wider than the body: no translation can fit
      [document.getElementById('prose')!, { x: 0, width: 100 }],
    ])
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const b = boxes.get(this) ?? { x: 0, width: 0 }
      return { x: b.x, y: 0, top: 0, left: b.x, right: b.x + b.width,
        bottom: 80, width: b.width, height: 80, toJSON() {} } as DOMRect
    })
    reflowVisibleFigureTracks(root)
    expect(title.style.translate).toBe('')
    vi.restoreAllMocks()
  })

  it('leaves a container untouched when hidden prose exists elsewhere but was not removed here', () => {
    document.body.innerHTML = `<div id="root">
      <p class="argument-copy" style="display:none">Prose cachée ailleurs</p>
      <figure id="block">
        <figcaption id="title">Titre</figcaption>
        <div id="spread" data-cahier-export-layout="spread" style="display:grid;grid-template-columns:1fr">
          <figure id="plate"><svg></svg></figure>
        </div>
      </figure>
    </div>`
    const root = document.getElementById('root') as HTMLElement
    const spread = document.getElementById('spread') as HTMLElement
    const title = document.getElementById('title') as HTMLElement
    const plate = document.getElementById('plate') as HTMLElement
    reflowVisibleFigureTracks(root)
    expect(spread.style.gridTemplateColumns).not.toContain('repeat(')
    expect(spread.style.justifyItems).toBe('')
    expect(plate.style.width).toBe('')
    expect(title.style.translate).toBe('')
    expect(title.style.textAlign).toBe('')
  })

  it('shares one owned prose list between the mount hide and the reflow removal', () => {
    const selector = CAHIER_EXPORT_SURFACE.proseSelector
    // Chrome-hidden figure notes and CahierProse's implementation class are not
    // prose roles: the one list excludes both.
    expect(selector).not.toContain('.cahier-prose')
    expect(selector).toContain('.cahier-evidence-source:not(.cahier-map-legend__note)')
    // The mount builds its hide CSS from that very constant.
    expect(cahierExportHiddenSelectors()).toContain(selector)
    // The reflow pass removes exactly that role, not a parallel list.
    document.body.innerHTML = `<div id="root"><div id="spread" data-cahier-export-layout="spread"
      style="display:grid;grid-template-columns:1fr 1fr"><div id="prose">
      <p class="${selector.split(',')[0]!.trim().slice(1)}">Texte</p></div><figure id="plate"></figure></div></div>`
    const root = document.getElementById('root') as HTMLElement
    const prose = document.getElementById('prose') as HTMLElement
    reflowVisibleFigureTracks(root)
    expect(prose.style.display).toBe('none')
  })

})
