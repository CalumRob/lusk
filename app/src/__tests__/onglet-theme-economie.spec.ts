import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'

import { describe, expect, it } from 'vitest'

import OngletTheme from '../components/fiche/OngletTheme.vue'
import {
  apercuAvecNAFixture,
  histoiresEconomieFixture,
  indicateursEconomieFixture,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import type { Histoire, Payload } from '../payload/types'

/**
 * OngletTheme — the Économie block (issue #121, forme reshapée): the overline
 * (-strong) → the 3 indicator figures in contract order (taille · santé ·
 * verdure, issue #120 — never a LQ figure: the LQ IS the Story) → the Story
 * angle (serif one-liner + the list of the top-5 specialisations with
 * labels/LQ/n; the région reads its top-5 by presence, n + part du parc) →
 * "comment lire" + the Story's own vintage (issue #74) + Méthodes link.
 * Consumes the payload selectors — never raw JSON.
 */

const payloadEconomie: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursEconomieFixture,
  histoires: histoiresEconomieFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture,
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

describe('OngletTheme — the Économie block (3 indicateurs)', () => {
  it('renders the theme overline and the 3 indicator figures in contract order', async () => {
    const wrapper = await monter('22001')

    expect(wrapper.find('.onglet-theme-overline').text()).toBe('Économie')
    const figures = wrapper.findAll('.figure-indicateur').map((f) => f.attributes('data-clef'))
    expect(figures).toEqual(['effectifs_salaries', 'chomage', 'eco_activites'])
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
    expect(effectifs.find('.puce-rang').text()).toBe("P24 de l'EPCI")
  })
})

describe('OngletTheme — the Économie Story angle (la Story, jamais un indicateur)', () => {
  it('renders the serif one-liner and the top-5 specialisations list for a commune', async () => {
    const wrapper = await monter('22001')

    const uneLigne = wrapper.find('.angle-story-une-ligne')
    expect(uneLigne.exists()).toBe(true)
    expect(uneLigne.text()).toBe(
      'Commune A1 se distingue par Élevage de volailles, Commerce de gros (commerce interentreprises) ' +
        "d'animaux vivants et Captage, traitement et distribution d'eau.",
    )
    expect(wrapper.find('.angle-story-titre').text()).toBe('Ce que la commune abrite')

    const lignes = wrapper.findAll('.specialisation')
    expect(lignes).toHaveLength(5)
    expect(lignes[0].text()).toContain('Élevage de volailles')
    expect(lignes[0].text()).toContain('LQ 23,7')
    expect(lignes[0].text()).toContain('12 établissements')
  })

  it('shows the Story’s own vintage under the list (issue #74)', async () => {
    const wrapper = await monter('22001')

    const source = wrapper.find('.angle-story-source')
    expect(source.exists()).toBe(true)
    expect(source.text()).toContain('data.bretagne.bzh')
    expect(source.text()).toContain('réf. 31 mars 2026')
  })

  it('gives an EPCI its top-5 Story with the type-adapted title', async () => {
    const wrapper = await monter('200000001')

    expect(wrapper.find('.angle-story-titre').text()).toBe('Ce que l’EPCI abrite')
    const lignes = wrapper.findAll('.specialisation')
    expect(lignes).toHaveLength(5)
    expect(lignes[0].text()).toContain('Production de sel')
    expect(lignes[0].text()).toContain('LQ 35,7')
  })

  it('gives the région (53) its presence Story — n + part du parc, no LQ', async () => {
    const wrapper = await monter('53')

    expect(wrapper.find('.angle-story-titre').text()).toBe('Ce que la Bretagne abrite')
    expect(wrapper.find('.angle-story-une-ligne').text()).toBe(
      'La Bretagne abrite surtout Location de terrains et d\'autres biens immobiliers, ' +
        'Location de logements et Autres organisations fonctionnant par adhésion volontaire.',
    )
    const lignes = wrapper.findAll('.specialisation')
    expect(lignes).toHaveLength(5)
    expect(lignes[0].text()).toContain('124 881 établissements')
    expect(lignes[0].text()).toContain('16,5 % du parc breton')
    expect(lignes[0].text()).not.toContain('LQ')
  })

  it('renders "comment lire", the Méthodes link, and keeps the indicators', async () => {
    const wrapper = await monter('22001')

    expect(wrapper.find('.angle-story-comment-lire').text()).toContain('Comment lire')
    expect(wrapper.find('.angle-story-comment-lire').text()).toContain('quotient de localisation')
    expect(wrapper.find('.angle-story-methodes').text()).toBe('Méthodes')
    expect(wrapper.findAll('.figure-indicateur')).toHaveLength(3)
  })
})

describe('OngletTheme — honest edge cases', () => {
  it('keeps each theme’s own story: a territory with BOTH stories shows the Démographie one on the Démographie tab', async () => {
    const payloadMixte: Payload = {
      ...payloadEconomie,
      histoires: [
        // 22001 has its demographie trajectoire AND its economie top-5 in the real payload
        {
          territoire: '22001',
          type: 'commune',
          theme: 'demographie',
          story_key: 'trajectoire-demographique',
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
    expect(wrapper.find('.angle-story-une-ligne').text()).toBe(
      'Le territoire attire et se renouvelle.',
    )
    expect(wrapper.find('.liste-specialisations').exists()).toBe(false)
    expect(wrapper.find('.angle-story-titre').text()).toContain('Trajectoire démographique')
  })

  it('renders the 3 indicators but no Story angle for a territory without an Économie Story', async () => {
    const wrapper = await monter('29002', [])

    expect(wrapper.findAll('.figure-indicateur')).toHaveLength(0)
    expect(wrapper.find('.angle-story').exists()).toBe(false)
    expect(wrapper.find('.angle-story-une-ligne').exists()).toBe(false)
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
    // the Story still renders — the LQ reading doesn't depend on the NA indicator
    expect(wrapper.find('.angle-story').exists()).toBe(true)
    expect(wrapper.findAll('.specialisation')).toHaveLength(5)
  })
})
