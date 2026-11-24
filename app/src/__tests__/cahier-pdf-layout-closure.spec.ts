/**
 * #1024 — the captured curve model is the minimal native input. It must not be
 * widened to a full screen-evidence object before the production geometry
 * consumer reads it.
 */
import { describe, expect, it } from 'vitest'

import { curveGeometry } from '@/fiche/prototype/cahierFigureNativeGeometry'
import { captureCourbeDense } from './helpers/cahierPdfFixtures'

describe('#1024 — contrat de type du modèle de courbe capturé', () => {
  it('consomme le modèle capturé, jamais un faux modèle complet', () => {
    const capture = captureCourbeDense()
    const curve = capture.figures.find((figure) => figure.family === 'mobilite-curve')!
    if (curve.family !== 'mobilite-curve') throw new Error('famille inattendue')
    const modele = curve.model
    expect('prose' in modele).toBe(false)
    expect('sources' in modele).toBe(false)

    const geometry = curveGeometry(modele, {
      width: 640,
      height: 300,
      margin: { top: 22, right: 68, bottom: 62, left: 64 },
    })
    expect(geometry.xTicks).toHaveLength(73)
    expect(geometry.yTicks.map((tick) => tick.label)).toEqual(['0 %', '25 %', '50 %', '75 %', '100 %'])
  })
})
