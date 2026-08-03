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
} from '../payload/fixtures'
import type { Histoire, Payload } from '../payload/types'

/**
 * OngletTheme — the ThemeBlock (ui-elements.md §ThemeBlock): overline (-strong)
 * → 4 indicator figures in contract order → story angle (serif one-liner keyed
 * by the pipeline's classification + the 2×2 chart) → "comment lire" + Méthodes
 * link. Consumes the payload selectors — never raw JSON.
 */

const payloadDemographie: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
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
  it('renders the serif one-liner keyed by the territory’s classification', async () => {
    const wrapper = await monter('22001') // fertile

    expect(wrapper.find('.angle-story-titre').text()).toBe('Attractive ou fertile ?')
    expect(wrapper.find('.angle-story-une-ligne').text()).toBe('La population se renouvelle sur place.')
  })

  it('changes the one-liner with the reading (exode ≠ fertile)', async () => {
    const wrapper = await monter('29002') // exode

    expect(wrapper.find('.angle-story-une-ligne').text()).toBe('Les départs l’emportent sur les arrivées.')
  })

  it('passes the two soldes and the classification to the chart', async () => {
    const wrapper = await monter('29001') // attractive, +20 / +380

    const graphique = wrapper.findComponent(GraphiqueSoldes)
    expect(graphique.exists()).toBe(true)
    expect(graphique.props()).toMatchObject({
      soldeNaturel: 20,
      soldeMigratoire: 380,
      classification: 'attractive',
      nom: 'Commune B',
    })
  })

  it('renders the "comment lire" line and the Méthodes link', async () => {
    const wrapper = await monter('22001')

    expect(wrapper.find('.angle-story-comment-lire').text()).toContain('Comment lire')
    expect(wrapper.find('.angle-story-comment-lire').text()).toContain('solde naturel')
    expect(wrapper.find('.angle-story-methodes').text()).toBe('Méthodes')
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toBe('/methodologie')
  })
})

describe('OngletTheme — honest edge cases', () => {
  it('renders the standard block but no story angle when the territory has no story', async () => {
    const wrapper = await monter('22001', [])

    expect(wrapper.findAll('.figure-indicateur')).toHaveLength(4)
    expect(wrapper.find('.angle-story').exists()).toBe(false)
    expect(wrapper.find('.angle-story-une-ligne').exists()).toBe(false)
  })
})
