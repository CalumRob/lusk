/**
 * #1025 real-data review regressions — behavioural checks at the public seams.
 */
import { describe, expect, it, vi } from 'vitest'

import { formatTimeRampNumber } from '@/fiche/prototype/cahierFigureReadings'
import { ROLE_PDF } from '@/fiche/prototype/cahierPdfGrammaire'
import { estCelluleBrute, roleCelluleTableau } from '@/fiche/prototype/cahierPdfTableau'
import { plierTexte, type MesureTexte } from '@/fiche/prototype/cahierPdfMesure'
import type { CahierTableColumn } from '@/fiche/prototype/cahierExportAdapters'
import { CAHIER_EXPORT_SURFACE, cahierExportHiddenSelectors, reflowVisibleFigureTracks } from '@/fiche/prototype/cahierExportSurface'

const MESURE_TABLEAU_FIXE: MesureTexte = {
  largeur: (texte, _police, taillePt) => texte.length * taillePt * 0.35,
  hauteurLigne: (_police, taillePt) => taillePt,
  espace: (_police, taillePt) => taillePt * 0.3,
}

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

  it('derives the presentation role from the column kind, not the measurement flag', () => {
    const mode = { kind: 'raw' } as CahierTableColumn
    const focal = { kind: 'focal' } as CahierTableColumn
    expect(estCelluleBrute(mode)).toBe(true)
    expect(estCelluleBrute(focal)).toBe(false)
    expect(roleCelluleTableau(mode)).toEqual(ROLE_PDF.libelleTableau)
    expect(roleCelluleTableau(focal)).toEqual(ROLE_PDF.valeurTableau)
    // cahierExportAdapters copies `reading.raw` onto focal and comparison
    // cells too (lines 1142/1150): per-cell raw is a measurement flag, not a
    // presentation fact. The column kind is the correct presentation owner.
    expect(roleCelluleTableau(focal)).toEqual(ROLE_PDF.valeurTableau)
  })

  it('reserves one consistent role height for a raw column and a value column', () => {
    const mode = { kind: 'raw' } as CahierTableColumn
    const focal = { kind: 'focal' } as CahierTableColumn
    const display = 'Transports en commun'
    // The row-height code and the painter both call roleCelluleTableau(column):
    // each cell reserves exactly the role its glyphs are painted with, so a
    // raw label cannot be measured short and cross the row separator.
    const hauteurReservee = (column: CahierTableColumn) =>
      plierTexte(display, MESURE_TABLEAU_FIXE, {
        police: roleCelluleTableau(column).police,
        taillePt: roleCelluleTableau(column).taille,
        largeurMax: 120,
        casserMotsLongs: true,
      }).length
    expect(hauteurReservee(mode)).toBeGreaterThanOrEqual(hauteurReservee(focal))
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

  it('does not form a plan when the only prose is already display:none', () => {
    document.body.innerHTML = `<div id="root"><figure id="block">
      <div id="spread" data-cahier-export-layout="spread" style="display:grid;grid-template-columns:1fr 1fr">
        <p class="argument-copy" style="display:none">Déjà cachée</p>
        <figure id="plate"><svg></svg></figure>
      </div>
    </figure></div>`
    const root = document.getElementById('root') as HTMLElement
    const spread = document.getElementById('spread') as HTMLElement
    const plate = document.getElementById('plate') as HTMLElement
    reflowVisibleFigureTracks(root)
    expect(spread.style.gridTemplateColumns).not.toContain('repeat(')
    expect(spread.style.justifyItems).toBe('')
    expect(plate.style.width).toBe('')
    expect(plate.style.translate).toBe('')
  })

  it('leaves a container untouched when the mount hides its prose but it owns no figure', () => {
    // Mount CSS hides prose BEFORE the pass. A container with hidden prose but
    // no figure child cannot form a plan and must remain byte-for-byte intact.
    document.body.innerHTML = `<div id="root"><figure id="block">
      <figcaption id="title">Titre</figcaption>
      <div id="spread" data-cahier-export-layout="spread" style="display:grid;grid-template-columns:1fr">
        <p class="argument-copy" style="display:none">Prose cachée par le mount</p>
      </div>
    </figure></div>`
    const root = document.getElementById('root') as HTMLElement
    const spread = document.getElementById('spread') as HTMLElement
    const title = document.getElementById('title') as HTMLElement
    reflowVisibleFigureTracks(root)
    expect(spread.style.gridTemplateColumns).not.toContain('repeat(')
    expect(spread.style.justifyItems).toBe('')
    expect(title.style.translate).toBe('')
    expect(title.style.textAlign).toBe('')
  })

  it('never hides an overview aside that owns both prose and the scalar figure', () => {
    // Real CahierAedarOverviewSection markup: the aside holds the prose AND
    // figure.aedar-car-overview-scalars. The mount CSS hides prose BEFORE the
    // pass runs, so only the nested-prose branch is exercised here.
    const markup = `<div id="root"%s>
      <div class="evidence-side evidence-figure"><svg></svg></div>
      <aside class="argument-side aedar-car-overview-reading">
        <div class="aedar-car-overview-copy">
          <div class="argument-copy cahier-prose" style="display:none">Texte</div>
          <p class="cahier-evidence-source" style="display:none">Source</p>
        </div>
        <figure id="scalars" class="aedar-car-overview-scalars">
          <figcaption class="cahier-figure-title">Scalaires</figcaption>
          <div class="summary-metrics"><span>209,3</span></div>
        </figure>
      </aside>
    </div>`
    for (const documentRoute of [true, false]) {
      document.body.innerHTML = markup.replace('%s',
        documentRoute ? ' data-cahier-export-layout="spread"' : '')
      if (!documentRoute) {
        const inner = document.getElementById('root')!
        inner.innerHTML = `<div data-cahier-export-layout="spread">${inner.innerHTML}</div>`
      }
      const root = document.getElementById('root') as HTMLElement
      const scalars = document.getElementById('scalars') as HTMLElement
      const prose = document.querySelector('.argument-copy') as HTMLElement
      const figureStyle = getComputedStyle(scalars)
      reflowVisibleFigureTracks(root)
      // The scalars survive in both routes; only prose is removed.
      expect(scalars.style.display).toBe('')
      expect(figureStyle.display).not.toBe('none')
      expect(prose.style.display).toBe('none')
      expect(scalars.textContent).toContain('209,3')
    }
    vi.restoreAllMocks()
  })

  it('sees a section-level export-layout declaration when the root is the section', () => {
    document.body.innerHTML = `<section id="root" data-cahier-export-layout="spread"
      style="display:grid;grid-template-columns:1fr 1fr">
      <div id="prose"><p class="argument-copy" style="display:none">Texte</p></div>
      <figure id="figure"></figure>
    </section>`
    const root = document.getElementById('root') as HTMLElement
    reflowVisibleFigureTracks(root)
    // If the root were skipped by querySelectorAll, no plan would exist.
    expect(root.style.gridTemplateColumns).toBe('repeat(1, minmax(0, 1fr))')
    expect(document.getElementById('figure')!.style.width).toBe('0px')
  })

  it('sees all nine section-level declarations in both routes', () => {
    const section = (id: number) => `<section id="s${id}" data-cahier-export-layout="spread"
      style="display:grid;grid-template-columns:1fr 1fr">
      <div><p class="argument-copy" style="display:none">Texte</p></div>
      <figure id="f${id}"><svg></svg></figure>
    </section>`
    for (const documentRoute of [true, false]) {
      document.body.innerHTML = `<div id="root">${Array.from({ length: 9 }, (_, i) => section(i)).join('')}</div>`
      const root = document.getElementById('root') as HTMLElement
      if (documentRoute) {
        // In the document route each section is the pass root itself.
        for (let i = 0; i < 9; i += 1) reflowVisibleFigureTracks(document.getElementById(`s${i}`) as HTMLElement)
      } else {
        reflowVisibleFigureTracks(root)
      }
      for (let i = 0; i < 9; i += 1) {
        expect(document.getElementById(`s${i}`)!.style.gridTemplateColumns,
          `${documentRoute ? 'document' : 'figure'} route section ${i}`).toBe('repeat(1, minmax(0, 1fr))')
      }
    }
    vi.restoreAllMocks()
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
