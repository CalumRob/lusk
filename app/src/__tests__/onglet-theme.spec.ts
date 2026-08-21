import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'

import { describe, expect, it } from 'vitest'

import GraphiqueSoldes from '../components/fiche/GraphiqueSoldes.vue'
import OngletTheme from '../components/fiche/OngletTheme.vue'
import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  metadonneesThemesFixtures,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import type { Histoire, Payload } from '../payload/types'

/**
 * OngletTheme — the shared subgroup block (issue #314, parent #308): the
 * overline (the theme's published label) → ONE loop over the metadata
 * subgroups — label + framing, the reading slot (the metadata template with
 * the row's values, the reading's figure and its exhaustive source) and the
 * indicator grid (the compact figure first, then the metadata key order).
 * There is no per-theme branch left: Démographie exercises the shared
 * anatomy with its « Trajectoire démographique » reading and its soldes chart.
 */

const payloadDemographie: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture,
  programmes: null,
  themeMetadata: { demographie: metadonneesThemesFixtures.demographie },
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

describe('OngletTheme — the shared subgroup anatomy (Démographie)', () => {
  it('renders the theme overline from the metadata label', async () => {
    const wrapper = await monter('22001')

    expect(wrapper.find('.onglet-theme-overline').text()).toBe('Démographie')
  })

  it('renders the metadata subgroup — label and framing', async () => {
    const wrapper = await monter('22001')

    const sousGroupe = wrapper.find('.sous-groupe[data-groupe="trajectoire-demographique"]')
    expect(sousGroupe.exists()).toBe(true)
    expect(wrapper.find('.sous-groupe-titre').text()).toBe(
      'État et dynamique de la population',
    )
    expect(wrapper.find('.sous-groupe-cadrage').text()).toContain('sa densité')
  })

  it('renders the indicator grid in the metadata key order — the compact figure first (structure_age → densite → evolution → menages)', async () => {
    const wrapper = await monter('22001')

    const figures = wrapper
      .findAll('.grille-indicateurs .figure-indicateur')
      .map((f) => f.attributes('data-clef'))
    expect(figures).toEqual(['structure_age', 'densite', 'evolution_1968', 'taille_menages'])
  })

  it('renders each figure with its French label and its vintage stamp', async () => {
    const wrapper = await monter('22001')

    expect(wrapper.text()).toContain('Densité de population')
    expect(wrapper.text()).toContain('Évolution de la population depuis 1968')
    expect(wrapper.text()).toContain('Taille moyenne des ménages')
    expect(wrapper.findAll('.estampille-vintage').length).toBe(4)
  })
})

describe('OngletTheme — the reading slot (the metadata template + the row’s values)', () => {
  it('renders the reading template with the resolved params — the payload-owned copy', async () => {
    const wrapper = await monter('22001')

    const texte = wrapper.find('.lecture-texte')
    expect(texte.exists()).toBe(true)
    expect(texte.text()).toContain('Entre 2017-2023')
    expect(texte.text()).toContain('la population de Commune A1')
    expect(texte.text()).toContain('attire et se renouvelle')
    expect(texte.text()).toContain('5,98 par an (naturel)')
    expect(texte.text()).toContain('2,56 (migratoire)')
  })

  it('porte la voix récit (serif) sur la phrase de lecture, jamais la voix corps Manrope', async () => {
    const wrapper = await monter('22001')

    const texte = wrapper.find('.lecture-texte')
    expect(texte.exists()).toBe(true)
    // la classe utilitaire globale .voix-recit pose la famille serif (Newsreader)
    expect(texte.classes()).toContain('voix-recit')
  })

  it('renders the template link node as a RouterLink to the Méthodes anchor', async () => {
    const wrapper = await monter('22001')

    const liens = wrapper
      .findAllComponents(RouterLinkStub)
      .map((l) => l.props('to'))
    expect(liens).toContain('/methodologie#demographie')
  })

  it('changes the reading with the territory — the same template, the row’s own values (vide-meurt)', async () => {
    const wrapper = await monter('29002')

    expect(wrapper.find('.lecture-texte').text()).toContain('se vide et se meurt')
    expect(wrapper.find('.lecture-texte').text()).toContain('-1,04 par an (naturel)')
  })

  it('feeds the reading’s figure (the soldes chart) the two rates, the classification and the same-scale nuage', async () => {
    const wrapper = await monter('22001') // attire-renouvelle, +5,98 / +2,56

    const graphique = wrapper.findComponent(GraphiqueSoldes)
    expect(graphique.exists()).toBe(true)
    expect(graphique.props()).toMatchObject({
      tauxNaturel: 5.982905982905983,
      tauxMigratoire: 2.564102564102564,
      classification: 'attire et se renouvelle',
      nom: 'Commune A1',
    })
    expect(graphique.props('nuage')).toHaveLength(2)
    expect(graphique.props('nuage')).toMatchObject([
      { nom: 'Commune A1', type: 'commune', territoire: '22001' },
      { nom: 'Commune D', type: 'commune', territoire: '22002' },
    ])
  })

  it('names the comparison under the chart — current territory + clickable container', async () => {
    const wrapper = await monter('22001') // commune in EPCI X

    const contexte = wrapper.find('.lecture-contexte')
    expect(contexte.text()).toContain('Commune A1')
    expect(contexte.text()).toContain('des communes de')
    expect(contexte.find('.lecture-conteneur').text()).toBe('EPCI X')
    const lien = wrapper
      .findAllComponents(RouterLinkStub)
      .find((l) => (l.props('to') as { name?: string } | undefined)?.name === 'territoire')
    expect(lien?.props('to')).toEqual({ name: 'territoire', params: { type: 'epci', id: '200000001' } })
  })

  it('cites the exhaustive source from the vintages table', async () => {
    const wrapper = await monter('22001')

    const source = wrapper.find('.lecture-source').text()
    expect(source).toContain('Source')
    expect(source).toContain('Série historique')
    expect(source).toContain('Base des EPCI')
  })
})

describe('OngletTheme — the compact figure and the grid', () => {
  it('renders the compact figure first — the metadata family + indicator (composition/structure_age)', async () => {
    const wrapper = await monter('22001')

    const compacte = wrapper.find('.figure-compacte')
    expect(compacte.exists()).toBe(true)
    expect(compacte.attributes('data-famille')).toBe('composition')
    expect(compacte.find('.figure-indicateur').attributes('data-clef')).toBe('structure_age')
    // the compact figure renders once — never twice in the grid
    expect(wrapper.findAll('.figure-indicateur[data-clef="structure_age"]')).toHaveLength(1)
    expect(wrapper.findAll('.figure-indicateur')).toHaveLength(4)
  })
})

describe('OngletTheme — honest edge cases', () => {
  it('renders the subgroup figures but no reading slot when the territory has no story', async () => {
    const wrapper = await monter('22001', [])

    expect(wrapper.findAll('.figure-indicateur')).toHaveLength(4)
    expect(wrapper.find('.sous-groupe-lecture').exists()).toBe(false)
    expect(wrapper.find('.lecture-texte').exists()).toBe(false)
  })

  it('renders the reading for the région, with the whole region’s communes as cloud', async () => {
    const wrapper = await monter('53') // région → all communes in the cloud

    expect(wrapper.findAll('.figure-indicateur').length).toBeGreaterThan(0)
    expect(wrapper.find('.sous-groupe-lecture').exists()).toBe(true)
    const graphique = wrapper.findComponent(GraphiqueSoldes)
    expect(graphique.exists()).toBe(true)
    expect(graphique.props('nuage')).toHaveLength(4)
  })
})
