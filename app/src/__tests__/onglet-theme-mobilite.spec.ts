import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'

import { describe, expect, it } from 'vitest'

import GraphiqueDistributionMobilite from '../components/fiche/GraphiqueDistributionMobilite.vue'
import OngletTheme from '../components/fiche/OngletTheme.vue'
import {
  apercuAvecNAFixture,
  histoiresMobiliteFixture,
  indicateursMobiliteFixture,
  metadonneesThemesFixtures,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import type { Payload } from '../payload/types'

/**
 * OngletTheme — the Mobilité block through the SHARED subgroup anatomy
 * (issue #314): the metadata subgroup « L'accès aux services » — the reading
 * slot (the metadata template with the resolved div_loss, the flagship's
 * distribution chart and the snapshot stamp), the compact figure (famille
 * scalar → « L'offre cyclable ») and the 11 other indicator figures in the
 * metadata key order, ranks and vintages intact. The vélo salience keeps its
 * row-driven no-chart honesty. Consumes the payload selectors — never raw JSON.
 */

const payloadMobilite: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursMobiliteFixture,
  histoires: histoiresMobiliteFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture,
  programmes: null,
  themeMetadata: { mobilite: metadonneesThemesFixtures.mobilite },
}

async function monter(territoire: string, payload: Payload = payloadMobilite) {
  const wrapper = mount(OngletTheme, {
    props: { theme: 'mobilite', payload, territoire },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
  await flushPromises()
  return wrapper
}

describe('OngletTheme — the shared subgroup anatomy (Mobilité, la grille + le sous-bloc)', () => {
  it('renders the metadata subgroup and the 11 figures — compact figure first, then the key order', async () => {
    const wrapper = await monter('22001')

    expect(wrapper.find('.onglet-theme-overline').text()).toBe('Mobilité')
    expect(wrapper.find('.sous-groupe-titre').text()).toBe('L’accès aux services')
    const figures = wrapper
      .findAll('.grille-indicateurs .figure-indicateur')
      .map((f) => f.attributes('data-clef'))
    expect(figures).toEqual([
      'offre_cyclable',
      'voitures_menage',
      'reseaux',
      'offre_tc',
      'bornes_recharge',
      'places_stationnement_velo_1000',
      'iso_alimentation',
      'iso_sante',
      'iso_administration',
      'iso_ecole',
      'iso_banque',
    ])
  })

  it('renders the compact figure as the metadata’s scalar family — L’offre cyclable leads the grid', async () => {
    const wrapper = await monter('22001')

    const compacte = wrapper.find('.figure-compacte')
    expect(compacte.exists()).toBe(true)
    expect(compacte.attributes('data-famille')).toBe('scalar')
    expect(compacte.find('.figure-indicateur').attributes('data-clef')).toBe('offre_cyclable')
    expect(wrapper.findAll('.figure-indicateur[data-clef="offre_cyclable"]')).toHaveLength(1)
  })

  it('labels say « à pied ou en transports en commun », NEVER « sans voiture » — the reading is the one exception', async () => {
    const wrapper = await monter('22001')

    const libelles = wrapper.findAll('.figure-indicateur-libelle').map((l) => l.text())
    for (const libelle of libelles) {
      expect(libelle).not.toContain('sans voiture')
    }
    expect(libelles.some((l) => l.includes('à pied ou en transports en commun'))).toBe(true)
    expect(libelles).toContain('Voitures par ménage')
    expect(libelles).toContain('Bornes de recharge pour véhicules électriques')
    // `nb_buildings` QUITTE le payload (issue #368, décision #196) — la
    // « Taille » n'est plus une figure de la fiche
    expect(libelles).not.toContain('Bâtiments résidentiels analysés')
  })

  it('shows a rank-in-context chip per isolation part (a commune reads its EPCI rank)', async () => {
    const wrapper = await monter('22001')

    const alimentation = wrapper.find('.figure-indicateur[data-clef="iso_alimentation"]')
    // 22001 : 27e/38 dans son EPCI — iso_alimentation : moins = mieux → glyphe ▼ (#371)
    expect(alimentation.find('.puce-rang').text()).toBe("▼ 27e/38 de l'EPCI")
    const grille = wrapper
      .findAll('.figure-indicateur')
      .filter((f) =>
        ['iso_alimentation', 'iso_sante', 'iso_administration', 'iso_ecole', 'iso_banque'].includes(
          f.attributes('data-clef') ?? '',
        ),
      )
    expect(grille).toHaveLength(5)
    for (const figure of grille) {
      expect(figure.find('.puce-rang').exists()).toBe(true)
    }
  })

  it('renders the multi-detail figures with their own detail labels (voitures ×3, reseaux ×6)', async () => {
    const wrapper = await monter('22001')

    const voitures = wrapper.find('.figure-indicateur[data-clef="voitures_menage"]')
    expect(voitures.text()).toContain('Ménages sans voiture')
    expect(voitures.text()).toContain('Ménages avec 1 voiture')
    expect(voitures.text()).toContain('Ménages avec 2 voitures ou plus')
    const reseaux = wrapper.find('.figure-indicateur[data-clef="reseaux"]')
    expect(reseaux.text()).toContain('Longueur — à pied ou en transports en commun')
    expect(reseaux.text()).toContain('Densité — à vélo')
    expect(reseaux.text()).toContain('Longueur — en voiture')
    // pas de barre segmentée sur des unités incommensurables (km + km/km²)
    expect(reseaux.find('.barre-segmentee').exists()).toBe(false)
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

describe('OngletTheme — the reading slot (the metadata template + the flagship figure)', () => {
  it('renders the reading from the metadata template with the resolved div_loss', async () => {
    const wrapper = await monter('22001')

    const texte = wrapper.find('.lecture-texte')
    expect(texte.exists()).toBe(true)
    expect(texte.text()).toContain('Sans voiture, 38 types de services disparaissent')
    expect(texte.text()).toContain("de l’accès quotidien de Commune A1")
    // the template's link renders as a RouterLink — vers Sources depuis la
    // bascule #410 (Méthodes est retirée, la provenance vit sur /sources)
    const liens = wrapper
      .findAllComponents(RouterLinkStub)
      .map((l) => l.props('to'))
    expect(liens).toContain('/sources')
  })

  it('feeds the reading’s figure the distribution (signature), the median and the same-scale cloud', async () => {
    const wrapper = await monter('22001')

    const graphique = wrapper.findComponent(GraphiqueDistributionMobilite)
    expect(graphique.exists()).toBe(true)
    expect(graphique.props('mediane')).toBe(38)
    expect(graphique.props('medianeVelo')).toBe(38)
    expect(graphique.props('modes')).toEqual({ t: 'à pied ou en transports en commun', b: 'à vélo' })
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

  it('names the comparison under the chart — current territory + clickable container', async () => {
    const wrapper = await monter('22001')

    const contexte = wrapper.find('.lecture-contexte')
    expect(contexte.text()).toContain('Commune A1')
    expect(contexte.text()).toContain('des communes de')
    expect(contexte.find('.lecture-conteneur').text()).toBe('EPCI X')
  })

  it('shows the vélo salience territory’s own row and the shared distribution chart', async () => {
    const wrapper = await monter('22002')

    // the same metadata template reads the row's own div_loss_t (the resolved
    // vélo reading), while both mode marks use the same distribution figure.
    expect(wrapper.find('.lecture-texte').text()).toContain(
      'Sans voiture, 24 types de services disparaissent',
    )
    const graphique = wrapper.findComponent(GraphiqueDistributionMobilite)
    expect(graphique.exists()).toBe(true)
    expect(graphique.props('mediane')).toBe(24)
    expect(graphique.props('medianeVelo')).toBe(13)
  })

  it('renders the reading for the région — the default Story serves the région fiche (ADR-0012)', async () => {
    const wrapper = await monter('53')

    expect(wrapper.find('.lecture-texte').text()).toContain(
      'Sans voiture, 29 types de services disparaissent',
    )
    const graphique = wrapper.findComponent(GraphiqueDistributionMobilite)
    expect(graphique.props('nuage').map((p: { territoire: string }) => p.territoire).sort()).toEqual([
      '22001',
      '22002',
    ])
  })

  it('cites the reading’s own vintage stamp as its source (issue #74)', async () => {
    const wrapper = await monter('22001')

    const source = wrapper.find('.lecture-source')
    expect(source.exists()).toBe(true)
    expect(source.text()).toContain('Source')
    expect(source.text()).toContain('Lusk')
    expect(source.text()).toContain('réf. 28 févr. 2026')
  })
})

describe('OngletTheme — la figure « L’offre cyclable » (issue #232)', () => {
  it("renders the headline « X % de l'infrastructure routière » — computed app-side from the payload rows", async () => {
    // la région 53 : 4 913,233 km ÷ 101 353,736 km ≈ 4,8 % (l'e2e #231)
    const wrapper = await monter('53')

    const figure = wrapper.find('.figure-indicateur[data-clef="offre_cyclable"]')
    expect(figure.exists()).toBe(true)
    expect(figure.find('.valeur-numerique').text()).toBe('4,8 %')
    expect(figure.text()).toContain('de l’infrastructure routière')
  })

  it('renders the protégé vs partagé bars in km / 1 000 hab with their labels', async () => {
    const wrapper = await monter('53')

    const figure = wrapper.find('.figure-indicateur[data-clef="offre_cyclable"]')
    expect(figure.text()).toContain('Protégé')
    expect(figure.text()).toContain('Partagé')
    expect(figure.text()).toContain('0,96')
    expect(figure.text()).toContain('0,47')
    expect(figure.text()).toContain('km / 1 000 hab')
    expect(figure.find('.barre-segmentee').exists()).toBe(true)
    expect(figure.findAll('.barre-segment')).toHaveLength(2)
  })

  it('shows 0 for a commune at 0 km — never an absent figure, never « à venir »', async () => {
    const wrapper = await monter('22001')

    const figure = wrapper.find('.figure-indicateur[data-clef="offre_cyclable"]')
    expect(figure.exists()).toBe(true)
    expect(figure.find('.valeur-numerique').text()).toBe('0 %')
    expect(figure.text()).toContain('de l’infrastructure routière')
    expect(figure.text()).not.toContain('à venir')
  })

  it('keeps its vintage stamp (osm_reseaux) and its per-detail ranks as labels', async () => {
    const wrapper = await monter('22001')

    const figure = wrapper.find('.figure-indicateur[data-clef="offre_cyclable"]')
    expect(figure.find('.estampille-vintage').text()).toContain(
      'OpenStreetMap — réseaux routier/cyclable/piéton',
    )
    expect(figure.findAll('.puce-rang')).toHaveLength(2)
    // offre_cyclable : plus = mieux → glyphe ▲ sur chaque détail (#371)
    expect(figure.findAll('.puce-rang').map((p) => p.text())).toEqual([
      "▲ 20e/38 de l'EPCI",
      "▲ 10e/38 de l'EPCI",
    ])
  })

  it("reads the c network denominator from the SAME territory (la règle « dans l'EPCI : X % »)", async () => {
    // l'EPCI X : 34,2 km ÷ 1 140,338 km ≈ 3 %
    const wrapper = await monter('200000001')

    const figure = wrapper.find('.figure-indicateur[data-clef="offre_cyclable"]')
    expect(figure.find('.valeur-numerique').text()).toBe('3 %')
    expect(figure.text()).toContain('de l’infrastructure routière')
  })
})

describe('OngletTheme — the Mobilité block, honest edge cases', () => {
  it('renders no subgroup content and no reading when the territory has neither figures nor Story', async () => {
    const wrapper = await monter('29002')

    expect(wrapper.findAll('.figure-indicateur')).toHaveLength(0)
    expect(wrapper.find('.sous-groupe-lecture').exists()).toBe(false)
    expect(wrapper.find('.estampille-snapshot').exists()).toBe(true)
  })
})
