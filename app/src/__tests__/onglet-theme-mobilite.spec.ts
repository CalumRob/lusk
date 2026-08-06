import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'

import { describe, expect, it } from 'vitest'

import GraphiqueDistributionMobilite from '../components/fiche/GraphiqueDistributionMobilite.vue'
import OngletTheme from '../components/fiche/OngletTheme.vue'
import {
  apercuAvecNAFixture,
  histoiresMobiliteFixture,
  indicateursMobiliteFixture,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import type { Payload } from '../payload/types'

/**
 * OngletTheme — the Mobilité block (issue #142, ADR-0012): the overline →
 * the « Taille » → the isolation grid (the 5 parts, « sans accès » framing,
 * rank-in-context) → the demand/network tier → the sub-block under its label
 * « L'offre de mobilité alternative » → the snapshot stamp (distinct from the
 * weekly chips) → the flagship Story (the default distribution chart, or the
 * vélo salience where the payload carries it). Consumes the payload selectors
 * — never raw JSON.
 */

const payloadMobilite: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursMobiliteFixture,
  histoires: histoiresMobiliteFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture,
}

async function monter(territoire: string, payload: Payload = payloadMobilite) {
  const wrapper = mount(OngletTheme, {
    props: { theme: 'mobilite', payload, territoire },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
  await flushPromises()
  return wrapper
}

describe('OngletTheme — the Mobilité block (la grille + l’étage + le sous-bloc)', () => {
  it('renders the theme overline and the 11 figures in block order', async () => {
    const wrapper = await monter('22001')

    expect(wrapper.find('.onglet-theme-overline').text()).toBe('Mobilité')
    const figures = wrapper.findAll('.figure-indicateur').map((f) => f.attributes('data-clef'))
    expect(figures).toEqual([
      'nb_buildings',
      'iso_alimentation',
      'iso_sante',
      'iso_administration',
      'iso_ecole',
      'iso_banque',
      'voitures_menage',
      'reseaux',
      'offre_tc',
      'bornes_recharge',
      'places_stationnement_velo_1000',
    ])
  })

  it('renders the isolation grid as its own grid — the 5 parts with the « sans accès » framing', async () => {
    const wrapper = await monter('22001')

    const grille = wrapper.findAll('.grille-isolation .figure-indicateur')
    expect(grille.map((f) => f.attributes('data-clef'))).toEqual([
      'iso_alimentation',
      'iso_sante',
      'iso_administration',
      'iso_ecole',
      'iso_banque',
    ])
    for (const figure of grille) {
      expect(figure.text()).toContain('Part des bâtiments sans accès')
      expect(figure.text()).toContain('à pied ou en transports en commun')
    }
  })

  it('labels say « à pied ou en transports en commun », NEVER « sans voiture »', async () => {
    const wrapper = await monter('22001')

    const libelles = wrapper.findAll('.figure-indicateur-libelle').map((l) => l.text())
    for (const libelle of libelles) {
      expect(libelle).not.toContain('sans voiture')
    }
    expect(libelles.some((l) => l.includes('à pied ou en transports en commun'))).toBe(true)
    expect(libelles).toContain('Bâtiments résidentiels analysés')
    expect(libelles).toContain('Voitures par ménage')
    expect(libelles).toContain('Bornes de recharge pour véhicules électriques')
  })

  it('shows a rank-in-context chip per isolation part (a commune reads its EPCI rank)', async () => {
    const wrapper = await monter('22001')

    const alimentation = wrapper.find('.figure-indicateur[data-clef="iso_alimentation"]')
    // 0.8289… × 100 → P83 de l'EPCI
    expect(alimentation.find('.puce-rang').text()).toBe("P83 de l'EPCI")
    expect(wrapper.findAll('.grille-isolation .puce-rang')).toHaveLength(5)
  })

  it('renders the multi-detail figures with their own detail labels (voitures ×2, reseaux ×6)', async () => {
    const wrapper = await monter('22001')

    const voitures = wrapper.find('.figure-indicateur[data-clef="voitures_menage"]')
    expect(voitures.text()).toContain('Ménages sans voiture')
    expect(voitures.text()).toContain('Ménages avec 2 voitures ou plus')
    const reseaux = wrapper.find('.figure-indicateur[data-clef="reseaux"]')
    expect(reseaux.text()).toContain('Longueur — à pied ou en transports en commun')
    expect(reseaux.text()).toContain('Densité — à vélo')
    expect(reseaux.text()).toContain('Longueur — en voiture')
    // pas de barre segmentée sur des unités incommensurables (km + km/km²)
    expect(reseaux.find('.barre-segmentee').exists()).toBe(false)
  })

  it('groups the sub-block under its label « L’offre de mobilité alternative »', async () => {
    const wrapper = await monter('22001')

    const libelle = wrapper.find('.sous-bloc-mobilite-libelle')
    expect(libelle.exists()).toBe(true)
    expect(libelle.text()).toBe('L’offre de mobilité alternative')
    const sousBloc = wrapper.findAll('.sous-bloc-mobilite-libelle ~ .grille-indicateurs .figure-indicateur')
    expect(sousBloc.map((f) => f.attributes('data-clef'))).toEqual([
      'offre_tc',
      'bornes_recharge',
      'places_stationnement_velo_1000',
    ])
  })

  it('stamps the block with the snapshot estampille — distinct from the weekly chips', async () => {
    const wrapper = await monter('22001')

    const estampille = wrapper.find('.estampille-snapshot')
    expect(estampille.exists()).toBe(true)
    expect(estampille.text()).toBe(
      'Analyse calculée le 6 août 2026 — se rafraîchit sur un rythme lent',
    )
    expect(estampille.text()).not.toContain('semaine')
    expect(estampille.text()).not.toContain('actualis')
  })
})

describe('OngletTheme — the Mobilité Story angle', () => {
  it('renders the default story for a non-saillant commune: serif reading + titre + comment lire', async () => {
    const wrapper = await monter('22001')

    expect(wrapper.find('.angle-story-une-ligne').text()).toBe(
      'Sans voiture, 38 types de services disparaissent.',
    )
    // the title carries the comparison subtitle (ADR-0011 — même-échelle)
    const titre = wrapper.find('.angle-story-titre')
    expect(titre.text()).toContain('Vingt minutes sans voiture')
    expect(titre.text()).toContain('des communes de')
    expect(wrapper.find('.angle-story-courant').text()).toBe('Commune A1')
    expect(wrapper.find('.angle-story-conteneur').text()).toBe('EPCI X')
    expect(wrapper.find('.angle-story-comment-lire').text()).toContain('Comment lire')
    expect(wrapper.find('.angle-story-comment-lire').text()).toContain(
      'À pied ou en transports en commun à 20 minutes',
    )
    expect(wrapper.find('.angle-story-comment-lire').text()).toContain(
      'Analyse calculée le 6 août 2026',
    )
    expect(wrapper.find('.angle-story-source').text()).toContain(
      "Lusk — analyse d'accessibilité",
    )
  })

  it('feeds the story chart the distribution (signature), the median and the same-scale cloud', async () => {
    const wrapper = await monter('22001')

    const graphique = wrapper.findComponent(GraphiqueDistributionMobilite)
    expect(graphique.exists()).toBe(true)
    expect(graphique.props('mediane')).toBe(38)
    expect(graphique.props('distribution')).toMatchObject({ min: 28, max: 47 })
    expect(graphique.props('distribution')?.dec).toHaveLength(10)
    expect(graphique.props('nuage')).toHaveLength(2)
    expect(graphique.props('nuage')).toMatchObject([
      { nom: 'Commune A1', divLoss: 38 },
      { nom: 'Commune D', divLoss: 24 },
    ])
    // accessible text — the reading never depends on canvas alone (WCAG 2.2)
    const aria = graphique.find('.graphique-distribution-mobilite-canvas').attributes('aria-label')
    expect(aria).toContain('médiane 38')
  })

  it('shows the vélo salience instead of the default where the payload carries it — and no distribution chart', async () => {
    const wrapper = await monter('22002')

    expect(wrapper.find('.angle-story-une-ligne').text()).toBe(
      'Le vélo préserve déjà 11 types de services.',
    )
    expect(wrapper.find('.angle-story-titre').text()).toContain('Ce que le vélo préserve')
    expect(wrapper.find('.angle-story-comment-lire').text()).toContain(
      'à pied ou en transports en commun à 20 minutes',
    )
    expect(wrapper.find('.angle-story-comment-lire').text()).toContain('accès déjà réalisé')
    expect(wrapper.findComponent(GraphiqueDistributionMobilite).exists()).toBe(false)
  })

  it('renders the story angle for the région — the default Story serves the région fiche (ADR-0012)', async () => {
    const wrapper = await monter('53')

    expect(wrapper.find('.angle-story-titre').text()).toContain('Vingt minutes sans voiture')
    expect(wrapper.find('.angle-story-une-ligne').text()).toBe(
      'Sans voiture, 29 types de services disparaissent.',
    )
    const graphique = wrapper.findComponent(GraphiqueDistributionMobilite)
    expect(graphique.props('nuage').map((p: { territoire: string }) => p.territoire).sort()).toEqual([
      '22001',
      '22002',
    ])
  })

  it('links to Méthodes and keeps the whole block when the story renders', async () => {
    const wrapper = await monter('22001')

    const methodes = wrapper
      .findAllComponents(RouterLinkStub)
      .find((l) => l.props('to') === '/methodologie')
    expect(methodes).toBeTruthy()
    expect(wrapper.findAll('.figure-indicateur')).toHaveLength(11)
  })
})

describe('OngletTheme — the Mobilité block, honest edge cases', () => {
  it('renders the block without a story angle when the territory has no Mobilité Story', async () => {
    const wrapper = await monter('29002')

    expect(wrapper.findAll('.figure-indicateur')).toHaveLength(0)
    expect(wrapper.find('.angle-story').exists()).toBe(false)
    expect(wrapper.find('.estampille-snapshot').exists()).toBe(true)
  })
})
