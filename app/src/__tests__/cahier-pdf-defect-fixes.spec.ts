/**
 * Regressions for the four real-data review defects (#1024): the header open-link
 * icon is vector ink, the waffle title is the owner sentence, every map plate
 * keeps its ring, and hidden prose no longer offsets the remaining figures.
 */
import { describe, expect, it } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

import { composerCahierPdf } from '@/fiche/prototype/cahierPdfComposer'
import { aedarWaffleTitre } from '@/fiche/content/aedarAccessSection'
import { LARGEUR_CORPS_PT, PADDING_SECTION_PT, PAGE_APPROUVEE } from '@/fiche/prototype/cahierPdfGrammaire'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import { chargeurPoliceTest, lirePdf, cheminsPdf } from './helpers/cahierPdfRuntime'
import { capturePdfFixture, captureProfilRangsDense } from './helpers/cahierPdfFixtures'

const CORPS_CENTRE = PAGE_APPROUVEE.insetGauchePt + PADDING_SECTION_PT + LARGEUR_CORPS_PT / 2

type Capture = ReturnType<typeof capturePdfFixture>

async function generate(capture: Capture) {
  const offered = capture.capabilities.selectableSeries.map((serie) => serie.id)
  const projection = projeterRequeteExport(capture, offered.slice(0, 3))
  if (projection.status !== 'ready') throw new Error(projection.reason)
  return lirePdf((await composerCahierPdf(projection.request, {
    signal: new AbortController().signal,
    chargerPolice: chargeurPoliceTest,
    urlPublique: 'https://lusk.test/territoire/commune/22001',
    urlAccueil: 'https://lusk.test/',
  })).blob)
}

describe('corrections de la revue données réelles (#1024)', () => {
  it('1. l’en-tête ne porte que le nom du territoire, sans flèche ni trait parasite', async () => {
    const capture = capturePdfFixture('aedar-car-overview')
    const lecture = await generate(capture)
    const headerText = lecture.textes.filter((item) => item.page === 1 && item.y > 770 && item.x > 400)
      .map((item) => item.str).join(' ').trim()
    expect(headerText).toContain(capture.identity.territory.name)
    // No external-link glyph (Unicode arrow, superscript or replacement box)
    // and no stray vector mark where the arrow used to be painted.
    expect(headerText).not.toMatch(/[↗↖↑→⇒⁎*†‡\ufffd]/)
    const paths = await cheminsPdf(lecture.octets, 1)
    const iconMarks = paths.filter((p) => p.kind === 'stroke' && p.y < 60 && p.x > 540
      && p.width < 30 && p.height < 30 && Math.max(p.width, p.height) > 2)
    expect(iconMarks, 'no stray vector mark at the former icon position').toHaveLength(0)
  })

  it('2. le titre du waffle est la phrase exacte du propriétaire', () => {
    expect(aedarWaffleTitre(15)).toBe(
      'Part des adresses résidentielles situées à 15 minutes ou moins par mode de transport.',
    )
  })

  it('3. chaque plaque cartographique déclarée garde son anneau', async () => {
    const lecture = await generate(capturePdfFixture('reseaux'))
    const paths = await cheminsPdf(lecture.octets, 1)
    const rings = paths.filter((p) => p.kind === 'stroke'
      && Math.abs(p.width - p.height) < 1 && p.width > 20
      && p.largeur !== null && p.largeur > 1.5)
    // The paired network maps are car, walk and bike; the bike plate's
    // `map-viewport--cycling` ring is a transparent border with a gradient,
    // which used to be dropped entirely. All three must now paint a ring.
    expect(rings.length).toBeGreaterThanOrEqual(3)
  })

  it('4. les figures restent centrées dans le corps quand la prose est masquée', async () => {
    for (const key of ['aedar-car-overview', 'aedar-access', 'stationnement-ravitaillement'] as const) {
      const lecture = await generate(capturePdfFixture(key))
      const paths = await cheminsPdf(lecture.octets, 1)
      const pdf = await getDocument({ data: Uint8Array.from(lecture.octets) }).promise
      const page = await pdf.getPage(1)
      const items = (await page.getTextContent()).items as Array<{ str: string; transform: number[]; width: number }>
      // Figure band above the value-table heading (top-origin y ~ 90..640),
      // measured from both painted paths and selectable text.
      const bornes: Array<{ x: number; droite: number }> = []
      for (const p of paths) {
        if (p.width > 8 && p.height > 8 && p.y > 90 && p.y < 640 && p.x > 20 && p.x + p.width < 590) {
          bornes.push({ x: p.x, droite: p.x + p.width })
        }
      }
      for (const it of items) {
        if (!it.str.trim()) continue
        const y = 841.89 - it.transform[5]
        if (y > 90 && y < 640 && it.transform[4] > 20 && it.transform[4] + it.width < 590) {
          bornes.push({ x: it.transform[4], droite: it.transform[4] + it.width })
        }
      }
      expect(bornes.length, key).toBeGreaterThan(0)
      const gauche = Math.min(...bornes.map((b) => b.x))
      const droite = Math.max(...bornes.map((b) => b.droite))
      expect(Math.abs((gauche + droite) / 2 - CORPS_CENTRE), key).toBeLessThan(20)
    }
  }, 120000)

  it('5. le graphique réseaux reste centré sous la rangée de cartes pleine largeur', async () => {
    const lecture = await generate(capturePdfFixture('reseaux'))
    const paths = await cheminsPdf(lecture.octets, 1)
    // The bar chart's own plot grid: long horizontal strokes below the map row.
    const grille = paths.filter((p) => p.kind === 'stroke' && p.height < 1
      && p.width > 100 && p.width < 400 && p.y > 560 && p.y < 700)
    expect(grille.length, 'plot grid lines').toBeGreaterThan(0)
    const centre = (Math.min(...grille.map((p) => p.x)) + Math.max(...grille.map((p) => p.x + p.width))) / 2
    expect(Math.abs(centre - CORPS_CENTRE)).toBeLessThan(2)
  })

  it('6. a served 18.1 percent fraction is painted as 18,1, never 181,1', async () => {
    // Literal served fraction from the real 35238 / G103 API row.
    const formatte = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 })
      .format(0.181).replace(/\s/g, ' ')
    expect(formatte).toBe('18,1 %')
    const capture = captureProfilRangsDense()
    const lecture = await generate(capture)
    const pourcents = lecture.textes.filter((item) => /^\d+(?:[.,]\d+)?\s*%$/.test(item.str.trim()))
      .map((item) => parseFloat(item.str.trim().replace(',', '.')))
    expect(pourcents.length).toBeGreaterThan(0)
    // The waffle reader only receives fractions in [0, 1]: no painted
    // percentage may exceed 100 unless the served value itself does.
    for (const valeur of pourcents) expect(valeur).toBeLessThanOrEqual(100)
  })
})
