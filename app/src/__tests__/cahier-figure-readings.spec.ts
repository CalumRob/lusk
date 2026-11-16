import { describe, expect, it } from 'vitest'

import type { TimeRampFigureData } from '@/fiche/content/territoryFacts'
import {
  timeRampAccessibleReading,
  timeRampTooltipRows,
} from '@/fiche/prototype/cahierFigureReadings'

const timeRamp: TimeRampFigureData = {
  availability: 'incomplete',
  xAxis: { label: 'Temps de trajet', unit: 'minutes' },
  yAxis: { label: "Types d'équipements", unit: 'types' },
  comparisonLabel: 'Moyenne de l’EPCI test',
  comparisonLayerSupported: true,
  provenance: null,
  series: [
    {
      key: 'walk',
      label: 'À pied',
      points: [
        { xValue: 5, xLabel: '5 min', value: 0, referenceValue: 1.5, referenceRank: { position: 1, size: 3, ties: 2 } },
        { xValue: 10, xLabel: '10 min', value: null, referenceValue: null, referenceRank: null },
      ],
    },
    {
      key: 'transit',
      label: 'Transports en commun',
      points: [
        { xValue: 5, xLabel: '5 min', value: 0.04, referenceValue: 2, referenceRank: { position: 2, size: 3 } },
        { xValue: 10, xLabel: '10 min', value: 2, referenceValue: 3, referenceRank: null },
      ],
    },
  ],
}

describe('Cahier time-ramp readings (#1022)', () => {
  it('reads one cut for every visible series with bare values and unit-bearing accessible names', () => {
    const rows = timeRampTooltipRows({
      timeRamp,
      series: timeRamp.series,
      cut: { xValue: 5, xLabel: '5 min' },
      territoryName: 'Rennes',
      comparisonLayerSupported: true,
    })

    expect(rows).toEqual([
      {
        seriesKey: 'walk',
        cutKey: 5,
        label: 'À pied',
        value: '0',
        numericValue: 0,
        referenceValue: 1.5,
        referenceRank: { position: 1, size: 3, ties: 2 },
        tone: 't',
        icon: expect.anything(),
        markerColor: 'color-mix(in srgb, var(--cahier-mode-foot) 55%, var(--paper))',
        ariaLabel: 'Rennes : À pied : 0 types',
        comparison: {
          value: '1,5',
          rank: '=1er/3',
          rankEvidence: { position: 1, size: 3, ties: 2 },
          ariaLabel: 'Groupe comparé : Moyenne de l’EPCI test : 1,5 types, rang 1er/3 (ex æquo)',
        },
      },
      {
        seriesKey: 'transit',
        cutKey: 5,
        label: 'Transports en commun',
        value: '0',
        numericValue: 0.04,
        referenceValue: 2,
        referenceRank: { position: 2, size: 3 },
        tone: 't',
        icon: expect.anything(),
        markerColor: 'var(--cahier-mode-foot)',
        ariaLabel: 'Rennes : Transports en commun : 0 types',
        comparison: {
          value: '2',
          rank: '2e/3',
          rankEvidence: { position: 2, size: 3 },
          ariaLabel: 'Groupe comparé : Moyenne de l’EPCI test : 2 types, rang 2e/3',
        },
      },
    ])
  })

  it('keeps zero distinct from absent and preserves the native numeric value', () => {
    const rows = timeRampTooltipRows({
      timeRamp,
      series: timeRamp.series,
      cut: { xValue: 5, xLabel: '5 min' },
      territoryName: 'Rennes',
      comparisonLayerSupported: true,
    })
    expect(rows[0]?.numericValue).toBe(0)
    expect(rows[1]?.numericValue).toBeCloseTo(0.04, 10)

    const absent = timeRampTooltipRows({
      timeRamp,
      series: timeRamp.series,
      cut: { xValue: 10, xLabel: '10 min' },
      territoryName: 'Rennes',
      comparisonLayerSupported: true,
    })
    expect(absent[0]).toMatchObject({ value: 'Indisponible', numericValue: null, referenceValue: null, referenceRank: null })
    expect(absent[0]?.comparison).toMatchObject({ value: 'Indisponible', rank: null })
    expect(absent[1]).toMatchObject({ value: '2', numericValue: 2, referenceValue: 3, referenceRank: null })
    expect(absent[1]?.comparison?.rank).toBeNull()
  })

  it('withholds reference values and ranks when the reference layer is hidden', () => {
    const rows = timeRampTooltipRows({
      timeRamp,
      series: timeRamp.series,
      cut: { xValue: 5, xLabel: '5 min' },
      territoryName: 'Rennes',
      comparisonLayerSupported: false,
    })
    expect(rows.every((row) => row.comparison === undefined)).toBe(true)
    expect(rows.map((row) => row.numericValue)).toEqual([0, 0.04])

    const reading = timeRampAccessibleReading({
      timeRamp,
      series: timeRamp.series,
      territoryName: 'Rennes',
      comparisonLayerSupported: false,
    })
    expect(reading).toContain("Rennes. Types d'équipements (types) selon Temps de trajet, par mode de déplacement.")
    expect(reading).toContain('À pied : 5 min 0, 10 min indisponible')
    expect(reading).not.toContain('Référence')
    expect(reading).not.toContain('1,5')
  })

  it('applies the visible series subset to both the rows and the accessible reading', () => {
    const series = timeRamp.series.filter((candidate) => candidate.key === 'transit')
    const rows = timeRampTooltipRows({
      timeRamp,
      series,
      cut: { xValue: 5, xLabel: '5 min' },
      territoryName: 'Rennes',
      comparisonLayerSupported: true,
    })
    expect(rows.map((row) => row.seriesKey)).toEqual(['transit'])
    const reading = timeRampAccessibleReading({
      timeRamp,
      series,
      territoryName: 'Rennes',
      comparisonLayerSupported: true,
    })
    expect(reading).not.toContain('À pied')
    expect(reading).toContain('Transports en commun : 5 min 0, 10 min 2')
  })
})
