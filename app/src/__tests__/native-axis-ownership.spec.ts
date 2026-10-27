import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { mount, RouterLinkStub } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import FigureTrajectoire from '@/components/fiche/FigureTrajectoire.vue'
import OngletTheme from '@/components/fiche/OngletTheme.vue'
import {
  apercuAvecNAFixture,
  indicateursHabitatFixture,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '@/payload/fixtures'
import type { Indicateur, NativeThemeFactContract, Payload, ThemeMetadata } from '@/payload/types'

const axisValues = ['3', '1', '2']
const nativeOrdinalContract: NativeThemeFactContract = {
  label: 'Série ordinale déclarée',
  shapes: ['ordered_series'],
  axisKind: 'declared_detail',
  axisValues,
  axes: axisValues.map((key, order) => ({ name: 'detail', key, label: `Catégorie ${key}`, order })),
}

function lignesAvecContratAxe(
  values: string[],
  contract: NativeThemeFactContract,
  unit = '€/m²',
  theme: Indicateur['theme'] = 'habitat',
  key = 'prix_m2',
): Indicateur[] {
  const template = indicateursHabitatFixture.find((row) => row.territoire === '22001' && row.key === 'prix_m2')!
  return values.map((detail, index) => ({
    ...template,
    theme,
    key,
    detail,
    value: 1000 + index * 100,
    unit,
    numericAxisValue: undefined,
    nativeContract: contract,
  }))
}

function payload(indicateurs: Indicateur[], themeMetadata: Payload['themeMetadata'] = {}): Payload {
  return {
    territoires: territoiresFixture,
    indicateurs,
    histoires: [],
    apercu: apercuAvecNAFixture,
    runReport: runReportFraisFixture,
    vintages: vintagesFixture,
    programmes: null,
    themeMetadata,
  }
}

function monterOnglet(indicateurs: Indicateur[], metadata: ThemeMetadata | undefined, metadataStatus: 'ready' | 'error') {
  return mount(OngletTheme, {
    props: {
      theme: 'habitat',
      territoire: '22001',
      metadataStatus,
      payload: payload(indicateurs, metadata ? { habitat: metadata } : {}),
    },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
}

describe('ownership des axes natifs — fiche #851', () => {
  it('labels native year/price coordinates as years and keeps the fact unit in visual and accessible axes', () => {
    const values = ['2024', '2025']
    const contract: NativeThemeFactContract = {
      label: 'Prix immobilier — contrat natif',
      shapes: ['ordered_series'],
      axisKind: 'year',
      axisValues: values,
      axisNumericValues: [2024, 2025],
    }
    const wrapper = mount(FigureTrajectoire, {
      props: {
        clef: 'prix_m2',
        lignes: lignesAvecContratAxe(values, contract),
        libelle: contract.label!,
        theme: 'habitat',
        trajectory: {
          axis: 'numeric',
          endpoints: values,
          ticks: values.map((detail, index) => ({ detail, label: detail, numericValue: 2024 + index })),
        },
      },
    })

    expect(wrapper.get('.trajectoire-axe-x-label').text()).toBe('Année')
    expect(wrapper.get('.trajectoire-axe-y-label').text()).toBe('€/m²')
    expect(wrapper.get('svg[role="img"]').attributes('aria-label'))
      .toContain('Axe horizontal : Année. Axe vertical : €/m².')
    expect(wrapper.get('svg[role="img"]').attributes('aria-label')).not.toMatch(/trajet|minutes/i)
    wrapper.unmount()
  })

  it('does not bind stale catalogue axis meanings to native year/price coordinates', () => {
    const values = ['2024', '2025']
    const contract: NativeThemeFactContract = {
      label: 'Prix immobilier — contrat natif',
      shapes: ['ordered_series'],
      axisKind: 'year',
      axisValues: values,
      axisNumericValues: [2024, 2025],
    }
    const metadata = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/theme_habitat.json'), 'utf8')) as ThemeMetadata
    const page = metadata.indicator_pages?.prix_m2
    if (!page || page.family !== 'trajectory') throw new Error('Fixture prix_m2 trajectory missing')
    page.trajectory = {
      axis: 'numeric',
      endpoints: values,
      ticks: values.map((detail) => ({ detail, label: detail })),
      axisLabels: { x: 'Temps de trajet (minutes)', y: 'Part de population (%)' },
    }
    const wrapper = monterOnglet(lignesAvecContratAxe(values, contract), metadata, 'ready')
    const figure = wrapper.getComponent(FigureTrajectoire)

    expect(figure.props('trajectory')?.axisLabels).toBeUndefined()
    expect(wrapper.get('.trajectoire-axe-x-label').text()).toBe('Année')
    expect(wrapper.get('.trajectoire-axe-y-label').text()).toBe('€/m²')
    expect(wrapper.get('svg[role="img"]').attributes('aria-label'))
      .toContain('Axe horizontal : Année. Axe vertical : €/m².')
    expect(wrapper.get('svg[role="img"]').attributes('aria-label')).not.toMatch(/trajet|minutes|Part de population/i)
    wrapper.unmount()
  })

  it('preserves the supported native Mobilité duration semantics and fact unit', () => {
    const values = ['t0000', 't0090']
    const contract: NativeThemeFactContract = {
      label: 'Courbe native de raccordement',
      shapes: ['ordered_series'],
      axisKind: 'duration_minute',
      axisValues: values,
      axisNumericValues: [0, 90],
    }
    const wrapper = mount(FigureTrajectoire, {
      props: {
        clef: 'raccordement_courbe',
        lignes: lignesAvecContratAxe(values, contract, '%', 'mobilite', 'raccordement_courbe'),
        libelle: contract.label!,
        theme: 'mobilite',
        trajectory: {
          axis: 'numeric',
          endpoints: values,
          axisLabels: { x: 'Année', y: '€/m²' },
          ticks: values.map((detail, index) => ({ detail, label: detail, numericValue: index * 90 })),
        },
      },
    })

    expect(wrapper.get('.trajectoire-axe-x-label').text()).toBe('Temps de trajet (minutes)')
    expect(wrapper.get('.trajectoire-axe-y-label').text()).toBe('%')
    expect(wrapper.get('svg[role="img"]').attributes('aria-label'))
      .toContain('Axe horizontal : Temps de trajet (minutes). Axe vertical : %.')
    expect(wrapper.get('svg[role="img"]').attributes('aria-label')).not.toContain('Année')
    wrapper.unmount()
  })

  it('uses neutral axis wording for an unknown native numeric kind instead of guessing travel minutes', () => {
    const values = ['lower', 'upper']
    const contract: NativeThemeFactContract = {
      label: 'Série native à coordonnée inconnue',
      shapes: ['ordered_series'],
      axisKind: 'unregistered_measure',
      axisValues: values,
      axisNumericValues: [12, 970],
    }
    const wrapper = mount(FigureTrajectoire, {
      props: {
        clef: 'prix_m2',
        lignes: lignesAvecContratAxe(values, contract),
        libelle: contract.label!,
        theme: 'habitat',
        trajectory: {
          axis: 'numeric',
          endpoints: values,
          ticks: values.map((detail, index) => ({ detail, label: detail, numericValue: [12, 970][index] })),
        },
      },
    })

    expect(wrapper.get('.trajectoire-axe-x-label').text()).toBe('Coordonnée')
    expect(wrapper.get('.trajectoire-axe-y-label').text()).toBe('€/m²')
    expect(wrapper.get('svg[role="img"]').attributes('aria-label'))
      .toContain('Axe horizontal : Coordonnée. Axe vertical : €/m².')
    expect(wrapper.get('svg[role="img"]').attributes('aria-label')).not.toMatch(/trajet|minutes/i)
    wrapper.unmount()
  })

  it('keeps mixed-null native year coordinates ordinal without parsing its numeric-looking axis values', () => {
    const values = ['2025', '2024', '2026']
    const contract: NativeThemeFactContract = {
      label: 'Série annuelle native',
      shapes: ['ordered_series'],
      axisKind: 'year',
      axisValues: values,
      axisNumericValues: [2025, null, 2026],
    }
    const valueByDetail: Record<string, number> = { '2025': 10, '2024': 20, '2026': 30 }
    const rows = lignesAvecContratAxe(['2024', '2025', '2026'], contract)
      .map((row) => ({ ...row, value: valueByDetail[row.detail!] }))
    const wrapper = mount(FigureTrajectoire, {
      props: {
        clef: 'prix_m2',
        lignes: rows,
        libelle: contract.label!,
        theme: 'habitat',
        trajectory: {
          axis: 'numeric',
          endpoints: values,
          ticks: values.map((detail) => ({ detail, label: detail })),
        },
      },
    })

    expect(wrapper.get('.trajectoire-courante').attributes('d'))
      .toBe('M 58.0 168.0 L 339.0 99.0 L 620.0 30.0')
    expect(wrapper.get('.trajectoire-axe-x-label').text()).toBe('Année')
    expect(wrapper.get('svg[role="img"]').attributes('aria-label')).not.toMatch(/trajet|minutes/i)
    wrapper.unmount()
  })

  it('draws ordinal points in the declared producer order, not parsed-key order', () => {
    const template = indicateursHabitatFixture.find((row) => row.territoire === '22001' && row.key === 'prix_m2')!
    const rows = axisValues.map((detail, index) => ({
      ...template,
      detail,
      value: 10 + index * 10,
      numericAxisValue: undefined,
      nativeContract: nativeOrdinalContract,
    }))
    const reference = [...rows].reverse().map((row, index) => ({ ...row, key: 'prix_m2_reference', value: 10 + index * 10 }))

    const wrapper = mount(FigureTrajectoire, {
      props: {
        clef: 'prix_m2',
        lignes: rows,
        libelle: nativeOrdinalContract.label!,
        theme: 'habitat',
        reference,
        trajectory: {
          axis: 'ordinal',
          endpoints: [],
          ticks: axisValues.map((detail) => ({ detail, label: `Catégorie ${detail}` })),
        },
      },
    })

    expect(wrapper.get('.trajectoire-courante').attributes('d'))
      .toBe('M 58.0 168.0 L 339.0 99.0 L 620.0 30.0')
    expect(wrapper.get('.trajectoire-reference').attributes('d'))
      .toBe('M 58.0 30.0 L 339.0 99.0 L 620.0 168.0')
    wrapper.unmount()
  })

  it('keeps declared ordinal gaps in axis order instead of rejoining by numeric-looking keys', () => {
    const orderedKeys = ['3', '1', '2', '4']
    const contract: NativeThemeFactContract = {
      ...nativeOrdinalContract,
      axisValues: orderedKeys,
      axes: orderedKeys.map((key, order) => ({ name: 'detail', key, order })),
    }
    const template = indicateursHabitatFixture.find((row) => row.territoire === '22001' && row.key === 'prix_m2')!
    const rows = orderedKeys.map((detail) => ({
      ...template,
      detail,
      value: detail === '1' ? null : detail === '3' ? 10 : detail === '2' ? 20 : 30,
      nativeContract: contract,
    }))
    const wrapper = mount(FigureTrajectoire, {
      props: {
        clef: 'prix_m2',
        lignes: rows,
        libelle: contract.label!,
        theme: 'habitat',
        trajectory: { axis: 'ordinal', endpoints: [], ticks: orderedKeys.map((detail) => ({ detail, label: detail })) },
      },
    })

    expect(wrapper.findAll('.trajectoire-courante').map((path) => path.attributes('d')))
      .toEqual(['M 432.7 99.0 L 620.0 30.0'])
    wrapper.unmount()
  })

  it('uses exact producer numeric coordinates instead of parsing category keys', () => {
    const keys = ['first', 'second']
    const contract: NativeThemeFactContract = {
      label: 'Série à coordonnées numériques',
      shapes: ['ordered_series'],
      axisKind: 'year',
      axisValues: keys,
      axisNumericValues: [20, 80],
      axes: keys.map((key, order) => ({ name: 'detail', key, label: key, order })),
    }
    const template = indicateursHabitatFixture.find((row) => row.territoire === '22001' && row.key === 'prix_m2')!
    const rows = keys.map((detail, index) => ({
      ...template,
      detail,
      value: 10 + index * 10,
      numericAxisValue: undefined,
      nativeContract: contract,
    }))
    const reference = [...rows].reverse().map((row) => ({
      ...row,
      key: 'prix_m2_reference',
      nativeContract: undefined,
      numericAxisValue: undefined,
    }))
    const wrapper = mount(FigureTrajectoire, {
      props: {
        clef: 'prix_m2',
        lignes: rows,
        libelle: contract.label!,
        theme: 'habitat',
        reference,
        trajectory: {
          axis: 'numeric',
          endpoints: keys,
          ticks: keys.map((detail, index) => ({ detail, label: detail, numericValue: [20, 80][index] })),
        },
      },
    })

    expect(wrapper.get('.trajectoire-courante').attributes('d'))
      .toBe('M 58.0 168.0 L 620.0 30.0')
    expect(wrapper.get('.trajectoire-reference').attributes('d'))
      .toBe('M 58.0 168.0 L 620.0 30.0')
    wrapper.unmount()
  })

  it('uses native axis coordinates and domain instead of stale catalogue axis policy and annotations', () => {
    const template = indicateursHabitatFixture.find((row) => row.territoire === '22001' && row.key === 'prix_m2')!
    const rows = [
      ...axisValues.map((detail, index) => ({
      ...template,
      detail,
      value: 10 + index * 10,
      numericAxisValue: undefined,
      nativeContract: nativeOrdinalContract,
      })),
      { ...template, detail: '2020', value: 999, nativeContract: nativeOrdinalContract },
    ]
    const metadata = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/theme_habitat.json'), 'utf8')) as ThemeMetadata
    const page = metadata.indicator_pages?.prix_m2
    if (!page || page.family !== 'trajectory') throw new Error('Fixture prix_m2 trajectory missing')
    page.trajectory = {
      axis: 'numeric',
      endpoints: ['2020', '2035'],
      marker: { detail: '2025', label: 'Ancien marqueur' },
      ticks: [{ detail: '2020', label: 'Ancien domaine' }],
    }

    const wrapper = monterOnglet(rows, metadata, 'ready')
    const figure = wrapper.getComponent(FigureTrajectoire)
    const trajectory = figure.props('trajectory')

    expect(trajectory?.axis).toBe('ordinal')
    expect(trajectory?.endpoints).toEqual(['3', '2'])
    expect(trajectory?.ticks?.map((tick) => tick.detail)).toEqual(axisValues)
    expect(wrapper.find('.trajectoire-marqueur').exists()).toBe(false)
    expect(figure.findAll('.trajectoire-point--courant')).toHaveLength(axisValues.length)
    expect(wrapper.get('svg[role="img"]').attributes('aria-label')).toContain('À Catégorie 2')
    expect(wrapper.text()).not.toContain('Ancien marqueur')
    wrapper.unmount()
  })

  it('uses the native final axis value when a stale catalogue endpoint still belongs to the domain', () => {
    const values = ['2024', '2025']
    const contract: NativeThemeFactContract = {
      ...nativeOrdinalContract,
      axisKind: 'declared_detail',
      axisValues: values,
      axes: values.map((key, order) => ({ name: 'detail', key, label: `Année ${key}`, order })),
    }
    const template = indicateursHabitatFixture.find((row) => row.territoire === '22001' && row.key === 'prix_m2')!
    const rows = values.map((detail, index) => ({
      ...template,
      detail,
      value: 10 + index * 10,
      numericAxisValue: undefined,
      nativeContract: contract,
    }))
    const metadata = JSON.parse(readFileSync(resolve(process.cwd(), '../public/data/theme_habitat.json'), 'utf8')) as ThemeMetadata
    const page = metadata.indicator_pages?.prix_m2
    if (!page || page.family !== 'trajectory') throw new Error('Fixture prix_m2 trajectory missing')
    page.trajectory = {
      axis: 'numeric',
      endpoints: ['2024'],
      ticks: values.map((detail) => ({ detail, label: `Année ${detail}` })),
    }
    const wrapper = monterOnglet(rows, metadata, 'ready')

    expect(wrapper.getComponent(FigureTrajectoire).props('trajectory')?.endpoints).toEqual(['2024', '2025'])
    expect(wrapper.get('svg[role="img"]').attributes('aria-label')).toContain('À Année 2025')
    wrapper.unmount()
  })

  it('renders declared native DPE category order while keeping official colors keyed by category', () => {
    const keys = ['B', 'A']
    const contract: NativeThemeFactContract = {
      label: 'DPE — domaine déclaré',
      shapes: ['declared_profile'],
      axisValues: keys,
      axes: keys.map((key, order) => ({ name: 'detail', key, label: `Étiquette ${key}`, order })),
    }
    const rows = indicateursHabitatFixture
      .filter((row) => row.territoire === '22001' && row.key === 'distribution_dpe' && ['A', 'B', 'C'].includes(row.detail ?? ''))
      .map((row) => ({ ...row, nativeContract: contract }))
    const wrapper = monterOnglet(rows, undefined, 'error')

    expect(wrapper.findAll('.barre-dpe [data-etiquette]').map((item) => item.attributes('data-etiquette')))
      .toEqual(keys)
    expect(wrapper.findAll('.barre-dpe [data-etiquette]').map((item) => item.attributes('style')))
      .toEqual(expect.arrayContaining([expect.stringContaining('#2BAE6E'), expect.stringContaining('#008659')]))
    const widths = wrapper.findAll('.barre-dpe [data-etiquette]')
      .map((item) => Number.parseFloat(item.attributes('style')?.match(/width: ([\d.]+)%/)?.[1] ?? '0'))
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100)
    wrapper.unmount()
  })
})
