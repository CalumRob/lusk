import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'

import { describe, expect, it } from 'vitest'

import OngletTheme from '../components/fiche/OngletTheme.vue'
import {
  apercuAvecNAFixture,
  histoiresEconomieFixture,
  indicateursEconomieFixture,
  metadonneesThemesFixtures,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import type { Histoire, Payload } from '../payload/types'

/**
 * OngletTheme — the Économie block through the SHARED subgroup anatomy
 * (issue #314): the metadata's TWO subgroups in order — « Santé et taille du
 * tissu productif » (the specialisation reading + the effectifs compact
 * figure + chômage) then « La structure verte » (the eco-activités figure).
 * The LQ is the Story, never a block indicator: the reading comes from the
 * metadata template resolved on the folded top-5 row; the région reads its
 * presence sentence in structure-verte. Consumes the payload selectors —
 * never raw JSON.
 */

const payloadEconomie: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursEconomieFixture,
  histoires: histoiresEconomieFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture,
  programmes: null,
  themeMetadata: { economie: metadonneesThemesFixtures.economie },
}

async function monter(territoire: string, histoires: Histoire[] = histoiresEconomieFixture) {
  const wrapper = mount(OngletTheme, {
    props: {
      theme: 'economie',
      payload: { ...payloadEconomie, histoires },
      territoire,
    },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
  await flushPromises()
  return wrapper
}

describe('OngletTheme — the two metadata subgroups (3 indicateurs)', () => {
  it('renders the theme overline from the metadata label and the subgroups in metadata order', async () => {
    const wrapper = await monter('22001')

    expect(wrapper.find('.onglet-theme-overline').text()).toBe('Économie/Emploi')
    const titres = wrapper.findAll('.sous-groupe-titre').map((t) => t.text())
    expect(titres).toEqual(['Santé et taille du tissu productif', 'La structure verte'])
  })

  it('renders the 3 indicator figures — the compact figures first in each subgroup, then the grid', async () => {
    const wrapper = await monter('22001')

    const figures = wrapper
      .findAll('.grille-indicateurs .figure-indicateur')
      .map((f) => f.attributes('data-clef'))
    expect(figures).toEqual(['effectifs_salaries', 'chomage', 'eco_activites'])
    expect(wrapper.findAll('.figure-compacte')).toHaveLength(2)
    expect(
      wrapper.findAll('.figure-compacte').map((f) => f.attributes('data-famille')),
    ).toEqual(['scalar', 'scalar'])
  })

  it('renders the 3 French labels and a vintage stamp per figure', async () => {
    const wrapper = await monter('22001')

    expect(wrapper.text()).toContain('Effectifs salariés (lieu de travail)')
    expect(wrapper.text()).toContain('Chômage (population active)')
    expect(wrapper.text()).toContain('Part des éco-activités')
    expect(wrapper.findAll('.estampille-vintage').length).toBe(3)
  })

  it('carries the real reshaped payload values (31 salariés · 7 % · 54 %)', async () => {
    const wrapper = await monter('22001')

    const effectifs = wrapper.find('.figure-indicateur[data-clef="effectifs_salaries"]')
    expect(effectifs.text()).toContain('31')
    expect(effectifs.text()).toContain('salariés')
    expect(wrapper.find('.figure-indicateur[data-clef="chomage"]').text()).toContain('7')
    expect(wrapper.find('.figure-indicateur[data-clef="eco_activites"]').text()).toContain('54')
  })

  it('shows the rank-in-context chip (a commune reads its EPCI rank)', async () => {
    const wrapper = await monter('22001')

    const effectifs = wrapper.find('.figure-indicateur[data-clef="effectifs_salaries"]')
    // effectifs_salaries : plus = mieux → glyphe ▲ (issue #371)
    expect(effectifs.find('.puce-rang').text()).toBe("▲ 29e/38 de l'EPCI")
  })
})

describe('OngletTheme — the reading slot (la Story, jamais un indicateur)', () => {
  it('renders the specialisation reading from the metadata template, resolved on the top-5 row', async () => {
    const wrapper = await monter('22001')

    const texte = wrapper.find('.sous-groupe[data-groupe="sante-et-taille"] .lecture-texte')
    expect(texte.exists()).toBe(true)
    expect(texte.text()).toBe(
      'La commune se spécialise dans Élevage de volailles (rang 1 du top 5). Sources',
    )
    // the template's link renders as a RouterLink — vers Sources depuis la
    // bascule #410 (Méthodes est retirée, la provenance vit sur /sources)
    const liens = wrapper
      .findAllComponents(RouterLinkStub)
      .map((l) => l.props('to'))
    expect(liens).toContain('/sources')
  })

  it('shows the reading’s own vintage under the sentence (issue #74)', async () => {
    const wrapper = await monter('22001')

    const source = wrapper.find('.sous-groupe[data-groupe="sante-et-taille"] .lecture-source')
    expect(source.exists()).toBe(true)
    expect(source.text()).toContain('data.bretagne.bzh')
    expect(source.text()).toContain('réf. 31 mars 2026')
  })

  it('keeps the indicator-only second subgroup silent for a commune', async () => {
    const wrapper = await monter('22001')

    expect(wrapper.find('.sous-groupe[data-groupe="structure-verte"] .sous-groupe-lecture').exists()).toBe(false)
  })

  it('keeps the region silent too — the retired regional reading is not rendered', async () => {
    const wrapper = await monter('53')

    expect(
      wrapper.find('.sous-groupe[data-groupe="sante-et-taille"] .sous-groupe-lecture').exists(),
    ).toBe(false)
    expect(
      wrapper.find('.sous-groupe[data-groupe="structure-verte"] .sous-groupe-lecture').exists(),
    ).toBe(false)
  })
})

describe('OngletTheme — honest edge cases', () => {
  it('keeps each theme’s own reading: the demographie tab reads its own (territoire, groupe) row', async () => {
    const payloadMixte: Payload = {
      ...payloadEconomie,
      themeMetadata: {
        economie: metadonneesThemesFixtures.economie,
        demographie: metadonneesThemesFixtures.demographie,
      },
      histoires: [
        // 22001 has its demographie trajectoire AND its economie top-5 in the real payload
        {
          territoire: '22001',
          type: 'commune',
          theme: 'demographie',
          story_key: 'trajectoire-demographique',
          groupe: 'trajectoire-demographique',
          salience_reason: 'defaut',
          periode: '2017-2023',
          solde_naturel: 70,
          solde_migratoire: 30,
          taux_solde_naturel: 5.982905982905983,
          taux_solde_migratoire: 2.564102564102564,
          classification: 'attire-renouvelle',
        },
        ...histoiresEconomieFixture,
      ],
    }
    const wrapper = mount(OngletTheme, {
      props: { theme: 'demographie', payload: payloadMixte, territoire: '22001' },
      global: { stubs: { RouterLink: RouterLinkStub } },
    })
    await flushPromises()

    // the demographie block reads its own reading, never the economie top-5
    const texte = wrapper.find('.lecture-texte')
    expect(texte.text()).toContain('la population de Commune A1')
    expect(texte.text()).toContain('attire et se renouvelle')
    expect(wrapper.text()).not.toContain('se spécialise dans')
  })

  it('renders the 3 figures but no reading slot for a territory without an Économie Story', async () => {
    const wrapper = await monter('29002', [])

    expect(wrapper.findAll('.figure-indicateur')).toHaveLength(0)
    expect(wrapper.find('.sous-groupe-lecture').exists()).toBe(false)
    expect(wrapper.find('.lecture-texte').exists()).toBe(false)
  })

  it('displays NA values cleanly — a null indicator shows "—", never breaks the block', async () => {
    const avecNA = indicateursEconomieFixture.map((ligne) =>
      ligne.territoire === '22001' && ligne.key === 'chomage'
        ? { ...ligne, value: null, rang_epci: null, rang_dep: null, rang_reg: null }
        : ligne,
    )
    const wrapper = mount(OngletTheme, {
      props: {
        theme: 'economie',
        payload: { ...payloadEconomie, indicateurs: avecNA },
        territoire: '22001',
      },
      global: { stubs: { RouterLink: RouterLinkStub } },
    })
    await flushPromises()

    const chomage = wrapper.find('.figure-indicateur[data-clef="chomage"]')
    expect(chomage.find('.valeur-numerique').text()).toBe('—')
    expect(chomage.find('.puce-rang').exists()).toBe(false)
    // the reading still renders — the LQ reading doesn't depend on the NA indicator
    expect(wrapper.find('.sous-groupe[data-groupe="sante-et-taille"] .lecture-texte').exists()).toBe(true)
  })
})
