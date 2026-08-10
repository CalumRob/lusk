import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'

import { describe, expect, it } from 'vitest'

import GraphiqueQuadrantMilieux from '../components/fiche/GraphiqueQuadrantMilieux.vue'
import OngletTheme from '../components/fiche/OngletTheme.vue'
import type { HistoireMilieux } from '../payload/types'
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
 * OngletTheme — the Milieux block (issue #172 → #174, ADR-0014, re-keyed by
 * spec #225, câblé par #242) : l'overline → l'angle Story « Se densifier,
 * s'étaler, ou s'en aller » (la une-ligne par lecture, le GRAPHE QUADRANT au
 * premier plan — le nuage des pairs au même échelle, ADR-0011 + ADR-0017 —,
 * les riders de précision, la source) → les figures « Intensité état · Série
 * annuelle ». La fenêtre et la trajectoire ZAN sont mortes avec les flux
 * CONSOENAF : leurs figures ne rendent plus. L'intensité est la figure, pas
 * le prose (#65). Consumes the payload selectors — never raw JSON.
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

describe('OngletTheme — the Milieux block (la Story + les deux figures Intensité état · Série annuelle)', () => {
  it('renders the theme overline and the 2 figures in contract order', async () => {
    const wrapper = await monter('22001')

    expect(wrapper.find('.onglet-theme-overline').text()).toBe('Milieux')
    const figures = wrapper.findAll('.figure-indicateur').map((f) => f.attributes('data-clef'))
    expect(figures).toEqual(['artif_par_habitant', 'conso_enaf_annuel'])
  })

  it('labels the two figures in French public (the product terms)', async () => {
    const wrapper = await monter('22001')

    const libelles = wrapper.findAll('.figure-indicateur-libelle').map((l) => l.text())
    expect(libelles).toEqual([
      'Intensité état',
      'Consommation d’ENAF — série annuelle',
    ])
  })

  it('renders the two removed figures NOTHING — la fenêtre et la trajectoire ZAN quittent le bloc', async () => {
    const wrapper = await monter('22001')

    expect(wrapper.find('.figure-indicateur[data-clef="conso_enaf_fenetre"]').exists()).toBe(false)
    expect(wrapper.find('.figure-indicateur[data-clef="trajectoire_zan"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Trajectoire ZAN')
    expect(wrapper.text()).not.toContain('Consommation d’ENAF 2021-2025')
  })

  it('renders the Intensité état figure as the two state rows (M2 then M3, m²/hab)', async () => {
    const wrapper = await monter('22001') // M2 2021 : 2 250 · M3 2025 : 2 550 m²/hab

    const etat = wrapper.find('.figure-indicateur[data-clef="artif_par_habitant"]')
    expect(etat.text()).toContain('2021')
    expect(etat.text()).toContain('2 250')
    expect(etat.text()).toContain('2025')
    expect(etat.text()).toContain('2 550')
    expect(etat.text()).toContain('m²/hab')
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

  it('mounts the quadrant graph inside the Story angle, above the grid', async () => {
    const wrapper = await monter('22001')

    const graphique = wrapper.findComponent(GraphiqueQuadrantMilieux)
    expect(graphique.exists()).toBe(true)
    const story = wrapper.find('.angle-story')
    expect(story.element.contains(graphique.element)).toBe(true)
    expect(story.element.compareDocumentPosition(wrapper.find('.grille-indicateurs').element)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('feeds the quadrant graph the two forces, the classification and the same-scale nuage', async () => {
    const wrapper = await monter('22001') // Δpop +200, Δm²/hab = 2550 − 2250 = +300

    const graphique = wrapper.findComponent(GraphiqueQuadrantMilieux)
    expect(graphique.props()).toMatchObject({
      deltaPopulation: 200,
      deltaM2ParHabitant: 300,
      classification: 'grandir-en-setalant',
      nom: 'Commune A1',
      periodeArtif: '2021-2025',
    })
    // le nuage au même échelle : la commune voit les communes de SON EPCI
    expect(graphique.props('nuage')).toHaveLength(2)
    expect(graphique.props('nuage')).toMatchObject([
      { nom: 'Commune A1', type: 'commune', territoire: '22001' },
      { nom: 'Commune D', type: 'commune', territoire: '22002' },
    ])
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

  it('renders the precision riders in « comment lire » (les deux horloges, la règle de bracketing)', async () => {
    const wrapper = await monter('22001')

    const commentLire = wrapper.find('.angle-story-comment-lire').text()
    // les deux forces sur leurs propres horloges — jamais fusionnées
    expect(commentLire).toContain('Entre 2017-2023')
    expect(commentLire).toContain('entre 2021 et 2025')
    expect(commentLire).toContain('millésimes OCS-GE')
    // la règle de bracketing, énoncée une fois (le recensement le plus proche)
    expect(commentLire).toContain('2017 pour l’état initial')
    expect(commentLire).toContain('2023 pour l’état final')
  })

  it('renders NO intensity line in the prose — la figure porte l’intensité, pas le prose (#65)', async () => {
    const wrapper = await monter('22001') // Δpop +200, état final 2550 m²/hab

    expect(wrapper.find('.angle-story-precision').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('m² d’ENAF par habitant ajouté')
    // l'état par habitant, lui, vit dans le « comment lire » — Y à Z m²
    expect(wrapper.find('.angle-story-comment-lire').text()).toContain('2 250 à 2 550 m²')
  })

  it('quotes the per-capita state for a shrinking territory — définie pour tout territoire (spec #225, US 7)', async () => {
    // L'ancien « intensité supprimée » (m² d'ENAF par habitant AJOUTÉ, null
    // sous Δpopulation non positif) meurt avec le re-key : l'état par habitant
    // (m²/hab) existe pour CHAQUE territoire et atteint le « comment lire »
    // (Y à Z m²) — la leçon de la spec #225.
    const wrapper = await monter('29001') // Δpop −150, état final 530 m²/hab

    expect(wrapper.find('.angle-story-comment-lire').text()).toContain('500 à 530 m²')
  })

  it('renders the exhaustive source line — la série historique + les vintages OCS-GE présents', async () => {
    const wrapper = await monter('22001')

    // le FIXTURE synthétique ne porte pas les vintages OCS-GE (les huit
    // archives millésimées entrent dans la table réelle avec la régénération
    // #243) — la ligne cite ce que la table fournit (la série historique),
    // JAMAIS la consommation : la lecture ne cite plus CONSOENAF (spec #225).
    const source = wrapper.find('.angle-story-source').text()
    expect(source).toContain('INSEE — Série historique du recensement')
    expect(source).not.toContain('CONSOENAF')
  })

  it('renders the sen-aller reading for a territory that consumes while emptying', async () => {
    const wrapper = await monter('29001') // sen-aller-et-consommer-quand-meme

    expect(wrapper.find('.angle-story-une-ligne').text()).toBe(
      'Le territoire se vide — et consomme quand même.',
    )
  })

  it('renders the renaturation reading stating the measured decrease plainly (spec #225)', async () => {
    const histoires = histoiresMilieuxFixture.map((h) =>
      h.territoire === '29002'
        ? {
            ...h,
            delta_population: -10,
            // la renaturation MESURÉE : l'état final par habitant chute
            artif_m3: 99,
            artif_m3_par_habitant: 380,
            trajectoire_artif_par_habitant: 0.95,
            classification: 'les-departs-laissent-la-place-a-la-renaturation',
          }
        : h,
    )
    const wrapper = await monter('29002', { ...payloadMilieux, histoires })

    expect(wrapper.find('.angle-story-une-ligne').text()).toBe(
      'Les départs laissent la place à la renaturation.',
    )
    const commentLire = wrapper.find('.angle-story-comment-lire').text()
    expect(commentLire).toContain('400 à 380 m²')
    expect(commentLire).toContain('l’état final est inférieur à l’état initial')
    expect(commentLire).toContain('la désartificialisation est mesurée')
    // le disclaimer de l'ancienne copie est mort avec les flux
    expect(commentLire).not.toMatch(/potentielle, jamais mesurée/)
  })

  it('renders no invented story for a territory with a null classification', async () => {
    const histoires = histoiresMilieuxFixture.filter((h) => h.territoire !== '29001')
    const wrapper = await monter('29001', { ...payloadMilieux, histoires })

    expect(wrapper.find('.angle-story').exists()).toBe(false)
  })

  it('renders the honest infobox for an M2 = 0 territory — la lecture absente, jamais inventée (fix #243)', async () => {
    // La découverte #243 : un territoire sans AUCUNE terre artificialisée à
    // l'état initial (M2 = 0) a une trajectoire M3/M2 INDÉFINIE — le pipeline
    // publie trajectoire null + classification null, l'angle affiche une
    // infobox au lieu d'une lecture fabriquée sur un rapport sans sens.
    const histoires = (histoiresMilieuxFixture as HistoireMilieux[]).map((h) =>
      h.territoire === '22001'
        ? {
            ...h,
            artif_m2: 0,
            artif_m2_par_habitant: 0,
            trajectoire_artif_par_habitant: null,
            classification: null,
          }
        : h,
    )
    const wrapper = await monter('22001', { ...payloadMilieux, histoires })

    expect(wrapper.find('.angle-story').exists()).toBe(true)
    const infobox = wrapper.find('.angle-story-infobox')
    expect(infobox.exists()).toBe(true)
    expect(infobox.attributes('role')).toBe('note')
    expect(wrapper.find('.angle-story-une-ligne').text()).toBe(
      'La lecture de l’artificialisation n’est pas disponible pour ce territoire.',
    )
    // pas de graphe quadrant, pas de lecture inventée
    expect(wrapper.findComponent(GraphiqueQuadrantMilieux).exists()).toBe(false)
    expect(wrapper.text()).not.toContain('s’étalant')
    // les figures de l'état restent sous le bloc
    const figures = wrapper.findAll('.figure-indicateur').map((f) => f.attributes('data-clef'))
    expect(figures).toEqual(['artif_par_habitant', 'conso_enaf_annuel'])
  })

  it('keeps the silent block for an ABSENT histoire — M2 = 0 n’est pas une donnée manquante', async () => {
    // Un territoire SANS histoire (la donnée absente, le trou NA) reste
    // silencieux : l'infobox n'est pas une explication fabriquée pour un
    // cas qui n'est pas le M2 = 0 de la découverte #243.
    const histoires = histoiresMilieuxFixture.filter((h) => h.territoire !== '22002')
    const wrapper = await monter('22002', { ...payloadMilieux, histoires })

    expect(wrapper.find('.angle-story').exists()).toBe(false)
    expect(wrapper.find('.angle-story-infobox').exists()).toBe(false)
  })

  it('does NOT render the Milieux Story in another theme’s tab — the theme gate (issue #219)', async () => {
    // le payload porte la Story Milieux — le gate doit la tenir hors de l'onglet Démographie (#219)
    const wrapper = await monter('22001', payloadMilieux, 'demographie')

    expect(wrapper.find('.onglet-theme-overline').text()).toBe('Démographie')
    expect(wrapper.find('.angle-story').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Se densifier, s’étaler, ou s’en aller')
  })
})
