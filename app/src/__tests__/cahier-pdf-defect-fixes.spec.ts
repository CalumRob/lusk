/**
 * #1024 — the waffle title is the exact owner sentence, not renderer copy.
 */
import { describe, expect, it } from 'vitest'

import { aedarWaffleTitre } from '@/fiche/content/aedarAccessSection'
import { projectShare } from '@/fiche/prototype/cahierExportAdapters'
import { capturePartDense } from './helpers/cahierPdfFixtures'

describe('corrections de la revue données réelles (#1024)', () => {
  it('2. le titre du waffle est la phrase exacte du propriétaire', () => {
    expect(aedarWaffleTitre(15)).toBe(
      'Part des adresses résidentielles situées à 15 minutes ou moins par mode de transport.',
    )
  })

  it('6. a served 18.1 percent fraction is painted as 18,1, never 181,1', () => {
    const capture = capturePartDense()
    const figure = capture.figures.find((candidate) => candidate.family === 'mobilite-share')!
    if (figure.family !== 'mobilite-share') throw new Error('famille inattendue')
    figure.model.value.fact.value = 0.181
    const share = projectShare(capture, figure)
    expect(share.display).toBe('18,1 %')
    expect(share.tables[0]!.rows[0]!.cells[0]!.display).toBe('18,1 %')
    expect(share.display).not.toContain('181,1')
    expect(Number.parseFloat(share.display)).toBeLessThanOrEqual(100)
  })
})
