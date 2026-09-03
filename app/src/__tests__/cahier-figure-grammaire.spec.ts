import { describe, expect, it } from 'vitest'

import {
  graduationsPourDomaine,
  layoutCahierSummaryPlot,
  valeursGraduationPourDomaine,
} from '@/fiche/cahierFigureGrammaire'

describe('grammaire des graduations du Cahier', () => {
  it('grades types by tens while preserving the exact data maximum', () => {
    expect(valeursGraduationPourDomaine(53, {
      grading: { kind: 'fixed', step: 10, maximumGap: 5 },
    })).toEqual([
      0,
      10,
      20,
      30,
      40,
      53,
    ])
  })

  it('chooses readable equipment intervals without extending the domain', () => {
    expect(valeursGraduationPourDomaine(1467.78, {
      grading: { kind: 'adaptive', targetCount: 6 },
    })).toEqual([
      0,
      250,
      500,
      750,
      1000,
      1250,
      1467.78,
    ])
  })

  it('omits only a graduation label that would collide with a plotted value', () => {
    const labels = graduationsPourDomaine(1467.78, undefined, {
      grading: { kind: 'adaptive', targetCount: 6 },
      labels: { avoidValues: [1032] },
    }).map((tick) => tick.label)

    expect(labels).not.toContain('1 000')
    expect(labels).toContain('1 250')
    expect(labels.at(-1)).toBe('1 468')
  })

  it('derives plot height from group and row counts while keeping the row pitch shared', () => {
    const equipment = layoutCahierSummaryPlot(2, 3)
    const types = layoutCahierSummaryPlot(2, 4)

    expect(equipment.geometry.height).toBe(340)
    expect(types.geometry.height).toBe(400)
    expect(equipment.rowPitch).toBe(types.rowPitch)
    expect(equipment.groupCenters[1]! - equipment.groupCenters[0]!).toBe(114)
    expect(types.groupCenters[1]! - types.groupCenters[0]!).toBe(144)
  })
})
