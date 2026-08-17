import { mount } from '@vue/test-utils'

import { afterEach, describe, expect, it } from 'vitest'

import IndicatorFigure from '../components/fiche/IndicatorFigure.vue'
import { indicateursDemographieFixture, metadonneesThemesFixtures } from '../payload/fixtures'
import type { Indicateur } from '../payload/types'

/**
 * IndicatorFigure - the fiche's indicator number (ui-elements.md
 * �Indicator/KPI figure): value + label + unit + rank-in-context chip +
 * vintage stamp, and the structure_age 7-tranche breakdown for multi-detail
 * keys. The vintage is always present; the chip only when a rank exists.
 * The detail labels are payload-owned (issue #318): the test passes the
 * theme's metadata detail_labels (the same map the fiche reads), never an
 * app-side dictionary.
 */

/** The structure_age detail labels — the metadata's detail_labels (the only source). */
const LABELS_TRANCHES = metadonneesThemesFixtures.demographie.detail_labels.structure_age

let montee: ReturnType<typeof mount> | null = null

function monter(props: Partial<{
  clef: string
  lignes: Indicateur[]
  libelle: string
  labelsDetail: Record<string, string>
  signe: boolean
  large: boolean
}>) {
  const wrapper = mount(IndicatorFigure, {
    props: {
      clef: 'densite',
      lignes: [],
      libelle: 'Densité de population',
      ...props,
    },
  })
  montee = wrapper
  return wrapper
}

afterEach(() => {
  montee?.unmount()
  montee = null
})

function ligne(key: string, detail: string | null = null, territoire = '22001'): Indicateur {
  const trouvee = indicateursDemographieFixture.find(
    (l) => l.territoire === territoire && l.key === key && l.detail === detail,
  )
  if (!trouvee) throw new Error(`ligne fixture introuvable : ${territoire} ${key} ${detail}`)
  return trouvee
}

describe('IndicatorFigure — the single-value figure', () => {
  it('renders the value, the unit and the label', () => {
    const wrapper = monter({ clef: 'densite', lignes: [ligne('densite')] })

    const valeur = wrapper.find('.valeur-numerique')
    expect(valeur.text()).toBe('200')
    expect(wrapper.find('.valeur-unite').text()).toBe('hab/km²')
    expect(wrapper.find('.figure-indicateur-libelle').text()).toBe('Densité de population')
  })

  it('renders the rank-in-context chip when a rank exists', () => {
    const wrapper = monter({ clef: 'densite', lignes: [ligne('densite')] })

    expect(wrapper.find('.puce-rang').text()).toBe("1er/2 de l'EPCI")
  })

  it('renders no chip when every rank is null (the région ranks nowhere)', () => {
    const wrapper = monter({ clef: 'densite', lignes: [ligne('densite', null, '53')] })

    expect(wrapper.find('.puce-rang').exists()).toBe(false)
  })

  it('always renders the vintage stamp — source, both dates, never optional', () => {
    const wrapper = monter({ clef: 'densite', lignes: [ligne('densite')] })

    const estampille = wrapper.find('.estampille-vintage')
    expect(estampille.exists()).toBe(true)
    expect(estampille.text()).toContain('INSEE')
    expect(estampille.text()).toContain('réf. 1 janv. 2023')
    expect(estampille.text()).toContain('publ. 30 juin 2026')
  })

  it('prefixes a "+" to a positive evolution when signe is set', () => {
    const wrapper = monter({ clef: 'evolution_1968', lignes: [ligne('evolution_1968')], signe: true })

    expect(wrapper.find('.valeur-numerique').text()).toBe('+33')
    expect(wrapper.find('.valeur-unite').text()).toBe('%')
  })

  it('keeps the minus sign of a negative evolution', () => {
    const wrapper = monter({
      clef: 'evolution_1968',
      lignes: [ligne('evolution_1968', null, '22002')],
      signe: true,
    })

    expect(wrapper.find('.valeur-numerique').text()).toBe('-33')
  })

  it('shows "—" and no unit for a null value (non calculable)', () => {
    const sansValeur = { ...ligne('densite'), value: null }
    const wrapper = monter({ clef: 'densite', lignes: [sansValeur] })

    expect(wrapper.find('.valeur-numerique').text()).toBe('—')
    expect(wrapper.find('.valeur-unite').exists()).toBe(false)
  })
})

describe('IndicatorFigure — the structure_age breakdown (multi-detail)', () => {
  const tranches = ['<15', '15-24', '25-39', '40-54', '55-64', '65-79', '80+'].map((detail) =>
    ligne('structure_age', detail),
  )

  it('renders the 7 tranches as a compact tabular breakdown', () => {
    const wrapper = monter({ clef: 'structure_age', lignes: tranches, labelsDetail: LABELS_TRANCHES, large: true })

    expect(wrapper.findAll('.tranche')).toHaveLength(7)
    expect(wrapper.find('.barre-segmentee').exists()).toBe(true)
    expect(wrapper.find('.figure-indicateur').classes()).toContain('figure-indicateur--large')
  })

  it('maps the tranche codes to their French labels and values', () => {
    const wrapper = monter({ clef: 'structure_age', lignes: tranches, labelsDetail: LABELS_TRANCHES })

    const premiere = wrapper.findAll('.tranche')[0]
    expect(premiere.find('.tranche-libelle').text()).toBe('Moins de 15 ans')
    // issue #390 : les tranches sont éclatées par sexe ; ce test lit la première
    // ligne par détail (F), part = 0.18 → « 18 »
    expect(premiere.find('.tranche-valeur').text()).toBe('18')

    const derniere = wrapper.findAll('.tranche')[6]
    expect(derniere.find('.tranche-libelle').text()).toBe('80 ans et plus')
    expect(derniere.find('.tranche-valeur').text()).toBe('3')
  })

  it('carries no single rank chip — the breakdown has 7 rows, no one rank', () => {
    const wrapper = monter({ clef: 'structure_age', lignes: tranches, labelsDetail: LABELS_TRANCHES })

    expect(wrapper.find('.puce-rang').exists()).toBe(false)
  })

  it('still renders the vintage stamp (the breakdown is one indicator)', () => {
    const wrapper = monter({ clef: 'structure_age', lignes: tranches, labelsDetail: LABELS_TRANCHES })

    expect(wrapper.find('.estampille-vintage').exists()).toBe(true)
  })

  it('gives the bar an accessible description built from the tranches', () => {
    const wrapper = monter({
      clef: 'structure_age',
      lignes: tranches,
      labelsDetail: LABELS_TRANCHES,
      libelle: 'Structure par âge',
    })

    const barre = wrapper.find('.barre-segmentee')
    expect(barre.attributes('aria-label')).toContain('Structure par âge')
    expect(barre.attributes('aria-label')).toContain('Moins de 15 ans 18')
  })
})
