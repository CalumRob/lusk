import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'

import { describe, expect, it } from 'vitest'

import GraphiqueSoldes from '../components/fiche/GraphiqueSoldes.vue'
import OngletTheme from '../components/fiche/OngletTheme.vue'
import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import type { Histoire, Payload } from '../payload/types'

/**
 * OngletTheme — the ThemeBlock (ui-elements.md §ThemeBlock): overline (-strong)
 * → 4 indicator figures in contract order → story angle (serif one-liner keyed
 * by the pipeline's rate-quadrant classification + the quadrant chart) →
 * "comment lire" + Méthodes link. Consumes the payload selectors — never raw
 * JSON.
 */

const payloadDemographie: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture,
}

async function monter(territoire: string, histoires: Histoire[] = histoiresDemographieFixture) {
  const wrapper = mount(OngletTheme, {
    props: {
      theme: 'demographie',
      payload: { ...payloadDemographie, histoires },
      territoire,
    },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
  await flushPromises()
  return wrapper
}

describe('OngletTheme — the standard block', () => {
  it('renders the theme overline in the block', async () => {
    const wrapper = await monter('22001')

    expect(wrapper.find('.onglet-theme-overline').text()).toBe('Démographie')
  })

  it('renders the 4 indicators in contract order (densite → structure_age → evolution → menages)', async () => {
    const wrapper = await monter('22001')

    const figures = wrapper.findAll('.figure-indicateur').map((f) => f.attributes('data-clef'))
    expect(figures).toEqual(['densite', 'structure_age', 'evolution_1968', 'taille_menages'])
  })

  it('renders each figure with its French label and its vintage stamp', async () => {
    const wrapper = await monter('22001')

    expect(wrapper.text()).toContain('Densité de population')
    expect(wrapper.text()).toContain('Évolution de la population depuis 1968')
    expect(wrapper.text()).toContain('Taille moyenne des ménages')
    expect(wrapper.findAll('.estampille-vintage').length).toBe(4)
  })
})

describe('OngletTheme — the story angle', () => {
  it('renders the serif one-liner keyed by the territory’s classification, first in the card', async () => {
    const wrapper = await monter('22001') // attire-renouvelle

    const uneLigne = wrapper.find('.angle-story-une-ligne')
    expect(uneLigne.text()).toBe('Le territoire attire et se renouvelle.')
    // the reading leads the card; the dated subtitle follows beneath it
    const titre = wrapper.find('.angle-story-titre')
    expect(titre.exists()).toBe(true)
    expect(uneLigne.element.compareDocumentPosition(titre.element)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('dates the subtitle from the published period and names the comparison (current + container)', async () => {
    const wrapper = await monter('22001') // commune in EPCI X

    const titre = wrapper.find('.angle-story-titre').text()
    expect(titre).toContain('Trajectoire démographique (2017-2023)')
    // the current territory wears the courant color, the container the cloud's
    expect(wrapper.find('.angle-story-courant').text()).toBe('Commune A1')
    expect(titre).toContain('des communes de')
    expect(wrapper.find('.angle-story-conteneur').text()).toBe('EPCI X')
    const liens = wrapper.findAllComponents(RouterLinkStub)
    const lien = liens.find(
      (l) => (l.props('to') as { name?: string } | undefined)?.name === 'territoire',
    )
    expect(lien?.props('to')).toEqual({ name: 'territoire', params: { type: 'epci', id: '200000001' } })
  })

  it('changes the one-liner with the reading (vide-meurt ≠ attire-renouvelle)', async () => {
    const wrapper = await monter('29002') // vide-meurt

    expect(wrapper.find('.angle-story-une-ligne').text()).toBe(
      'La population diminue sur ses deux composantes.',
    )
  })

  it('passes the two rates and the classification to the chart', async () => {
    const wrapper = await monter('29001') // attire-renouvelle, +20 / +380

    const graphique = wrapper.findComponent(GraphiqueSoldes)
    expect(graphique.exists()).toBe(true)
    expect(graphique.props()).toMatchObject({
      tauxNaturel: 1.19047619047619,
      tauxMigratoire: 22.61904761904762,
      classification: 'attire-renouvelle',
      nom: 'Commune B',
    })
  })

  it('feeds the chart the context cloud at the same scale: 22001 → its EPCI’s communes', async () => {
    const wrapper = await monter('22001') // commune in EPCI X → X's communes

    const graphique = wrapper.findComponent(GraphiqueSoldes)
    expect(graphique.props('nuage')).toHaveLength(2)
    expect(graphique.props('nuage')).toMatchObject([
      { nom: 'Commune A1', type: 'commune', territoire: '22001' },
      { nom: 'Commune D', type: 'commune', territoire: '22002' },
    ])
  })

  it('renders the "comment lire" line quoting the rates, the exhaustive source, and the Méthodes link', async () => {
    const wrapper = await monter('22001')

    expect(wrapper.find('.angle-story-comment-lire').text()).toContain('Comment lire')
    expect(wrapper.find('.angle-story-comment-lire').text()).toContain('solde naturel')
    expect(wrapper.find('.angle-story-comment-lire').text()).toContain('/an pour 1 000 hab.')
    // the datasets used are named exhaustively (from the vintages table, never
    // hardcoded): the série historique (rates) AND the base des EPCI (nuage)
    expect(wrapper.find('.angle-story-source').text()).toContain('Source')
    expect(wrapper.find('.angle-story-source').text()).toContain('Série historique')
    expect(wrapper.find('.angle-story-source').text()).toContain('Base des EPCI')
    expect(wrapper.find('.angle-story-methodes').text()).toBe('Méthodes')
    const methodes = wrapper
      .findAllComponents(RouterLinkStub)
      .find((l) => l.props('to') === '/methodologie')
    expect(methodes).toBeTruthy()
  })
})

describe('OngletTheme — honest edge cases', () => {
  it('renders the standard block but no story angle when the territory has no story', async () => {
    const wrapper = await monter('22001', [])

    expect(wrapper.findAll('.figure-indicateur')).toHaveLength(4)
    expect(wrapper.find('.angle-story').exists()).toBe(false)
    expect(wrapper.find('.angle-story-une-ligne').exists()).toBe(false)
  })

  it('renders the story angle for the région, with the whole region’s communes as cloud', async () => {
    const wrapper = await monter('53') // région → all communes in the cloud

    expect(wrapper.findAll('.figure-indicateur').length).toBeGreaterThan(0)
    expect(wrapper.find('.angle-story').exists()).toBe(true)
    const graphique = wrapper.findComponent(GraphiqueSoldes)
    expect(graphique.exists()).toBe(true)
    expect(graphique.props('nuage')).toHaveLength(4)
  })
})
