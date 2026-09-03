import { mount, RouterLinkStub } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import FigureTrajectoire from '../components/fiche/FigureTrajectoire.vue'
import OngletTheme from '../components/fiche/OngletTheme.vue'
import {
  indicateursRaccordementFixture,
  metadonneesMobiliteRaccordementFixture,
  territoiresRaccordementFixture,
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

const courbe = indicateursRaccordementFixture.filter((ligne) => ligne.key === 'raccordement_courbe' && ligne.territoire === '22001')
const reference = indicateursRaccordementFixture.filter((ligne) => ligne.key === 'raccordement_reference')

const payloadRaccordement: Payload = {
  territoires: territoiresRaccordementFixture,
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
          endpoints: ['t0000', 't0360'],
          axis: 'numeric',
          axisLabels: { x: 'Temps de trajet (minutes)', y: 'Population joignable (%)' },
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
    expect(wrapper.find('.trajectoire-resume').text()).toContain('90 minutes')
    expect(wrapper.find('.liste-points').exists()).toBe(false)
    expect(wrapper.text()).toContain('Temps de trajet (minutes)')
    expect(wrapper.text()).toContain('Population joignable (%)')
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
        trajectory: { endpoints: ['t0000', 't0360'], axis: 'numeric' },
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
    expect(wrapper.find('.trajectoire-resume').text()).toContain('interrompent')
  })

  it('publie les trois niveaux, une tranche littérale de courbe et la référence régionale dans le contrat', () => {
    const lignes = validerIndicateurs(
      indicateursRaccordementFixture,
      'fixture-indicateurs-mobilite.json',
      territoiresRaccordementFixture,
    )

    expect([...new Set(lignes.filter((ligne) => ligne.key === 'raccordement_tc').map((ligne) => ligne.type))]).toEqual([
      'commune',
      'epci',
      'departement',
      'region',
    ])
    expect(lignes.filter((ligne) => ligne.key === 'raccordement_courbe')).toHaveLength(33)
    expect(lignes.filter((ligne) => ligne.key === 'raccordement_reference')).toHaveLength(11)
    expect(lignes.filter((ligne) => ligne.key === 'raccordement_courbe' && ligne.detail === 't0090'))
      .toHaveLength(3)
    expect(lignes.find((ligne) => ligne.key === 'raccordement_reference' && ligne.detail === 't0090' && ligne.territoire === '53')?.value)
      .toBe(0.014584982185152652)
  })

  it('garde le registre metadata autoportant et bijectif', () => {
    const validee = validerThemeMetadata(
      metadonneesMobiliteRaccordementFixture,
      'fixture-theme-mobilite.json',
    )

    expect(validee.indicator_keys).toContain('raccordement_tc')
    expect(validee.sources.raccordement_courbe).toBe('matrice_temps_mairies')
    expect(Object.keys(validee.detail_labels.raccordement_courbe ?? {})).toEqual([
      't0000', 't0015', 't0030', 't0045', 't0060', 't0090',
      't0120', 't0180', 't0240', 't0300', 't0360',
    ])
    expect(validee.detail_labels.raccordement_courbe?.t0360).toBe('6 h')
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
    ['22001', 'Allineuc'],
    ['200027027', 'CC Arc Sud Bretagne'],
    ['22', 'Côtes-d’Armor'],
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
    const payloadNonRoute: Payload = {
      ...payloadRaccordement,
      indicateurs: payloadRaccordement.indicateurs.map((ligne) =>
        ligne.key === 'raccordement_tc' || ligne.key === 'raccordement_courbe'
          ? { ...ligne, territoire: '22001', value: null, rider: 'Non routée — aucune valeur mesurable publiée.' }
          : ligne,
      ),
    }
    const wrapper = mount(OngletTheme, {
      props: { theme: 'mobilite', payload: payloadNonRoute, territoire: '22001' },
      global: { stubs: { RouterLink: RouterLinkStub } },
    })

    const scalar = wrapper.find('.figure-indicateur[data-clef="raccordement_tc"]')
    expect(scalar.text()).toContain('Non routée')
    expect(scalar.text()).not.toContain('population bretonne peut rejoindre')
    expect(wrapper.find('.figure-trajectoire [role="status"]').text()).toContain('indisponible')
  })
})
