import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'

import { describe, expect, it } from 'vitest'

import OngletTheme from '../components/fiche/OngletTheme.vue'
import {
  apercuAvecNAFixture,
  histoiresMilieuxFixture,
  indicateursMilieuxFixture,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import type { Payload, Theme } from '../payload/types'

/**
 * OngletTheme — the Milieux block (issue #172 → #174, ADR-0014): the
 * overline → the Story angle « Se densifier, s'étaler, ou s'en aller » (the
 * one-liner keyed by the reading, the precision riders, l'intensité quand
 * elle est publiée, la source exhaustive série historique + CONSOENAF) → the
 * three indicator figures (la fenêtre, la série annuelle, la trajectoire
 * ZAN). Consumes the payload selectors — never raw JSON.
 */

const payloadMilieux: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursMilieuxFixture,
  histoires: histoiresMilieuxFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture,
  programmes: null,
}

async function monter(territoire: string, payload: Payload = payloadMilieux, theme: Theme = 'milieux') {
  const wrapper = mount(OngletTheme, {
    props: { theme, payload, territoire },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
  await flushPromises()
  return wrapper
}

describe('OngletTheme — the Milieux block (la Story + les trois indicateurs)', () => {
  it('renders the theme overline and the 3 figures in contract order', async () => {
    const wrapper = await monter('22001')

    expect(wrapper.find('.onglet-theme-overline').text()).toBe('Milieux')
    const figures = wrapper.findAll('.figure-indicateur').map((f) => f.attributes('data-clef'))
    expect(figures).toEqual(['conso_enaf_fenetre', 'conso_enaf_annuel', 'trajectoire_zan'])
  })

  it('labels the three figures in French public (the product terms)', async () => {
    const wrapper = await monter('22001')

    const libelles = wrapper.findAll('.figure-indicateur-libelle').map((l) => l.text())
    expect(libelles).toEqual([
      'Consommation d’ENAF 2021-2025',
      'Consommation d’ENAF — série annuelle',
      'Trajectoire ZAN',
    ])
  })

  it('renders the multi-detail annual series with its year labels (2011 … 2024)', async () => {
    const wrapper = await monter('22001')

    const annuel = wrapper.find('.figure-indicateur[data-clef="conso_enaf_annuel"]')
    expect(annuel.text()).toContain('2011')
    expect(annuel.text()).toContain('2024')
  })

  it('renders the Story angle ABOVE the indicator grid (issue #71 — the reading leads)', async () => {
    const wrapper = await monter('22001')

    const story = wrapper.find('.angle-story')
    const grille = wrapper.find('.grille-indicateurs')
    expect(story.exists()).toBe(true)
    expect(story.element.compareDocumentPosition(grille.element)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('renders the one-liner keyed by the territory’s classification (22001 s’étale)', async () => {
    const wrapper = await monter('22001') // grandir-en-setalant

    expect(wrapper.find('.angle-story-une-ligne').text()).toBe(
      'Le territoire grandit en s’étalant.',
    )
    expect(wrapper.find('.angle-story-titre').text()).toBe(
      'Se densifier, s’étaler, ou s’en aller',
    )
  })

  it('renders the precision riders in « comment lire » (les deux horloges, la règle de source)', async () => {
    const wrapper = await monter('22001')

    const commentLire = wrapper.find('.angle-story-comment-lire').text()
    expect(commentLire).toContain('2017-2023')
    expect(commentLire).toContain('série historique du recensement')
    expect(commentLire).toContain('horloge')
    expect(commentLire).toContain('CONSOENAF')
  })

  it('renders the intensity when published — 2 550 m² d’ENAF par habitant ajouté', async () => {
    const wrapper = await monter('22001') // Δpop +200, 51 ha → 2550 m²/hab

    expect(wrapper.find('.angle-story-precision').text()).toContain('2 550')
    expect(wrapper.find('.angle-story-precision').text()).toContain(
      'm² d’ENAF par habitant ajouté',
    )
  })

  it('does NOT render the intensity when suppressed (Δpopulation non positif)', async () => {
    const wrapper = await monter('29001') // Δpop −150 → intensité null

    expect(wrapper.find('.angle-story-precision').exists()).toBe(false)
  })

  it('renders the exhaustive source line — série historique + CONSOENAF, from the vintages table', async () => {
    const wrapper = await monter('22001')

    const source = wrapper.find('.angle-story-source').text()
    expect(source).toContain('INSEE — Série historique du recensement')
    expect(source).toContain('CONSOENAF')
  })

  it('renders the sen-aller reading for a territory that consumes while emptying', async () => {
    const wrapper = await monter('29001') // sen-aller-et-consommer-quand-meme

    expect(wrapper.find('.angle-story-une-ligne').text()).toBe(
      'Le territoire se vide — et consomme quand même.',
    )
  })

  it('renders the renaturation reading with its rider — potentielle, jamais mesurée', async () => {
    const histoires = histoiresMilieuxFixture.map((h) =>
      h.territoire === '29002'
        ? {
            ...h,
            delta_population: -10,
            conso_fenetre: 0,
            classification: 'les-departs-laissent-la-place-a-la-renaturation',
            intensite_m2_par_habitant: null,
          }
        : h,
    )
    const wrapper = await monter('29002', { ...payloadMilieux, histoires })

    expect(wrapper.find('.angle-story-une-ligne').text()).toBe(
      'Les départs laissent la place à la renaturation.',
    )
    const commentLire = wrapper.find('.angle-story-comment-lire').text()
    expect(commentLire).toMatch(/potentielle, jamais mesurée/)
  })

  it('renders no invented story for a territory with a null classification', async () => {
    const histoires = histoiresMilieuxFixture.filter((h) => h.territoire !== '29001')
    const wrapper = await monter('29001', { ...payloadMilieux, histoires })

    expect(wrapper.find('.angle-story').exists()).toBe(false)
  })

  it('does NOT render the Milieux Story in another theme’s tab — the theme gate (issue #219)', async () => {
    // le payload porte la Story Milieux — le gate doit la tenir hors de l'onglet Démographie (#219)
    const wrapper = await monter('22001', payloadMilieux, 'demographie')

    expect(wrapper.find('.onglet-theme-overline').text()).toBe('Démographie')
    expect(wrapper.find('.angle-story').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Se densifier, s’étaler, ou s’en aller')
  })
})
