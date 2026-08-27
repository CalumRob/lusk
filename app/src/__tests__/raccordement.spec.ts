import { mount, RouterLinkStub } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import FigureTrajectoire from '../components/fiche/FigureTrajectoire.vue'
import OngletTheme from '../components/fiche/OngletTheme.vue'
import {
  indicateursRaccordementFixture,
  metadonneesMobiliteRaccordementFixture,
  territoiresFixture,
} from '../payload/fixtures'
import { phraseRaccordement } from '../payload/selectors'
import type { Indicateur, Payload } from '../payload/types'
import { validerIndicateurs, validerThemeMetadata } from '../payload/validate'
import { SOURCES_METHODES } from '../methodes/sources'
import { THEMES_METHODES } from '../methodes/indicateurs'

function ligne(detail: string, value: number | null): Indicateur {
  return {
    territoire: '22001',
    type: 'commune',
    theme: 'mobilite',
    key: 'raccordement_courbe',
    detail,
    value,
    unit: '%',
    rider: null,
    rang_epci: null,
    rang_epci_n: null,
    rang_dep: null,
    rang_dep_n: null,
    rang_reg: null,
    rang_reg_n: null,
    vintage_source: 'Lusk — matrice temps mairie à mairie',
    vintage_version: '2026-09-16',
    vintage_date_reference: '2026-08-25',
    vintage_date_publication: '2026-08-26',
  }
}

const courbe = [ligne('t0000', 0.02), ligne('t0090', 0.42), ligne('t0600', 0.95)]
const reference = [
  { ...ligne('t0000', 0.01), key: 'raccordement_reference', territoire: '53', type: 'region' as const },
  { ...ligne('t0090', 0.31), key: 'raccordement_reference', territoire: '53', type: 'region' as const },
  { ...ligne('t0600', 0.9), key: 'raccordement_reference', territoire: '53', type: 'region' as const },
]

const payloadRaccordement: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursRaccordementFixture,
  histoires: [],
  apercu: null,
  runReport: null,
  vintages: null,
  programmes: null,
  themeMetadata: { mobilite: metadonneesMobiliteRaccordementFixture },
}

describe('raccordement — fiche et accessibilité', () => {
  it('compose la prose approuvée sans élision de la mesure', () => {
    const scalaire = { ...ligne('t0090', 0.42), key: 'raccordement_tc', detail: null }
    expect(phraseRaccordement('Allineuc', scalaire)).toBe(
      'Un mercredi de période scolaire, 42 % de la population bretonne peut rejoindre Allineuc en moins de 90 minutes en train, en car ou en bus de mairie à mairie.',
    )
  })

  it('ne fabrique pas de prose pour une commune non routée', () => {
    const scalaire = { ...ligne('t0090', null), key: 'raccordement_tc', detail: null }
    expect(phraseRaccordement('Commune non routée', scalaire)).toBeNull()
  })

  it('dessine la courbe du territoire, la médiane et le repère des 90 minutes', () => {
    const wrapper = mount(FigureTrajectoire, {
      props: {
        lignes: courbe,
        clef: 'raccordement_courbe',
        theme: 'mobilite',
        reference,
        referenceLabel: 'Commune bretonne médiane',
        nom: 'Allineuc',
        libelle: 'Courbe cumulative',
        trajectory: {
          endpoints: ['t0000', 't0600'],
          axis: 'numeric',
          marker: { detail: 't0090', label: 'Seuil de 90 minutes' },
        },
      },
    })

    expect(wrapper.find('.trajectoire-courante').exists()).toBe(true)
    expect(wrapper.find('.trajectoire-reference').exists()).toBe(true)
    expect(wrapper.find('.trajectoire-marqueur').attributes('data-detail')).toBe('t0090')
    expect(wrapper.find('.trajectoire-marqueur-libelle').text()).toContain('90 minutes')
    expect(wrapper.find('svg').attributes('aria-label')).toContain('Allineuc')
    expect(wrapper.find('svg').attributes('aria-label')).toContain('médiane')
    expect(wrapper.find('svg').attributes('aria-label')).toContain('90 minutes')
    expect(wrapper.findAll('path[role], line[role]')).toHaveLength(0)
    expect(wrapper.find('.liste-points').text()).toContain('90 min')
    expect(wrapper.text()).toContain('Temps de trajet (minutes)')
    expect(wrapper.text()).toContain('Part de population (%)')
  })

  it('rend une absence honnête quand le territoire est non routé', () => {
    const wrapper = mount(FigureTrajectoire, {
      props: {
        lignes: courbe.map((l) => ({ ...l, value: null })),
        clef: 'raccordement_courbe',
        theme: 'mobilite',
        reference,
        nom: 'Commune non routée',
        libelle: 'Courbe cumulative',
        trajectory: { endpoints: ['t0000', 't0600'], axis: 'numeric' },
      },
    })

    expect(wrapper.find('.trajectoire-courante').exists()).toBe(false)
    expect(wrapper.find('[role="status"]').text()).toContain('indisponible')
  })

  it('garde une interruption quand un point intermédiaire est NA', () => {
    const wrapper = mount(FigureTrajectoire, {
      props: {
        lignes: [ligne('t0000', 0.1), ligne('t0010', 0.2), ligne('t0020', null), ligne('t0030', 0.4), ligne('t0040', 0.5)],
        clef: 'raccordement_courbe',
        theme: 'mobilite',
        libelle: 'Courbe cumulative',
        nom: 'Allineuc',
        trajectory: { endpoints: ['t0000', 't0020'], axis: 'numeric' },
      },
    })

    expect(wrapper.findAll('.trajectoire-courante')).toHaveLength(2)
    expect(wrapper.find('.liste-points').text()).toContain('20 min')
  })

  it('publie les trois niveaux, les 61 détails de la courbe et la référence régionale dans le contrat', () => {
    const lignes = validerIndicateurs(
      indicateursRaccordementFixture,
      'fixture-indicateurs-mobilite.json',
      territoiresFixture,
    )

    expect([...new Set(lignes.filter((ligne) => ligne.key === 'raccordement_tc').map((ligne) => ligne.type))]).toEqual([
      'commune',
      'epci',
      'departement',
      'region',
    ])
    expect(lignes.filter((ligne) => ligne.key === 'raccordement_courbe')).toHaveLength(549)
    expect(lignes.filter((ligne) => ligne.key === 'raccordement_reference')).toHaveLength(61)
    expect(lignes.filter((ligne) => ligne.key === 'raccordement_courbe' && ligne.detail === 't0090'))
      .toHaveLength(9)
    expect(lignes.find((ligne) => ligne.key === 'raccordement_reference' && ligne.detail === 't0090' && ligne.territoire === '53')?.value)
      .toBe(0.31)
  })

  it('garde le registre metadata autoportant et bijectif', () => {
    const validee = validerThemeMetadata(
      metadonneesMobiliteRaccordementFixture,
      'fixture-theme-mobilite.json',
    )

    expect(validee.indicator_keys).toContain('raccordement_tc')
    expect(validee.sources.raccordement_courbe).toBe('matrice_temps_mairies')
    expect(validee.detail_labels.raccordement_courbe?.t0600).toBe('600 minutes')
  })

  it('publie la méthode du raccordement avec ses autorités et ses garde-fous', () => {
    const methodes = THEMES_METHODES.mobilite.indicateurs
    const raccordement = methodes.raccordement_tc

    expect(raccordement).toMatchObject({
      sourceId: 'matrice_temps_mairies',
      direction: 'plus-est-mieux',
    })
    expect(raccordement.definition).toMatch(/mairie à mairie/)
    expect(raccordement.definition).toMatch(/mercredi réel de période scolaire/)
    expect(raccordement.definition).toMatch(/meilleur départ/)
    expect(raccordement.definition).toMatch(/marche plafonnée à 40 minutes/)
    expect(raccordement.definition).toMatch(/sans aucun trajet en voiture/)
    expect(SOURCES_METHODES.matrice_temps_mairies.caveat).toMatch(/SNCF Voyageurs national/)
    expect(SOURCES_METHODES.matrice_temps_mairies.caveat).toMatch(/KorrigoBret hors SNCF/)
    expect(SOURCES_METHODES.matrice_temps_mairies.caveat).toMatch(/TGV et maritime/)
    expect(SOURCES_METHODES.matrice_temps_mairies.caveat).toMatch(/mairies DILA/)
  })

  it.each([
    ['22001', 'Commune A1'],
    ['200000001', 'EPCI X'],
    ['22', 'Département 22'],
  ])('rend le scalaire et la figure pour le niveau %s', async (territoire, nom) => {
    const wrapper = mount(OngletTheme, {
      props: { theme: 'mobilite', payload: payloadRaccordement, territoire },
      global: { stubs: { RouterLink: RouterLinkStub } },
    })

    const scalar = wrapper.find('.figure-indicateur[data-clef="raccordement_tc"]')
    expect(scalar.exists()).toBe(true)
    expect(scalar.text()).toContain('population bretonne')
    expect(scalar.text()).toContain(nom)
    expect(wrapper.find('.figure-trajectoire').exists()).toBe(true)
  })

  it('rend le motif non routé sans transformer la valeur en zéro', () => {
    const wrapper = mount(OngletTheme, {
      props: { theme: 'mobilite', payload: payloadRaccordement, territoire: '29002' },
      global: { stubs: { RouterLink: RouterLinkStub } },
    })

    const scalar = wrapper.find('.figure-indicateur[data-clef="raccordement_tc"]')
    expect(scalar.text()).toContain('Non routée')
    expect(scalar.text()).not.toContain('population bretonne peut rejoindre')
    expect(wrapper.find('.figure-trajectoire [role="status"]').text()).toContain('indisponible')
  })
})
