import { flushPromises, mount } from '@vue/test-utils'

import { createMemoryHistory, createRouter } from 'vue-router'

import { describe, expect, it } from 'vitest'

import OngletTheme from '../components/fiche/OngletTheme.vue'
import { passarellesLecture } from '../fiche/explorationHandoff'
import { routes } from '../router'
import {
  histoiresDemographieFixture,
  histoiresEconomieFixture,
  histoiresMilieuxFixture,
  indicateursDemographieFixture,
  indicateursEconomieFixture,
  indicateursMilieuxFixture,
  metadonneesThemesFixtures,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import type { Payload, ThemeMetadata } from '../payload/types'

/**
 * Les passarelles des GRANDES LECTURES (#473) : chaque figure de lecture
 * (GraphiqueSoldes, FigureListeLQ, GraphiqueQuadrantMilieux) offre la main aux
 * Pages d'indicateur PUBLIÉES de ses constituants — l'affordance compacte
 * partagée (#468 : « Explorer », nouvelle fenêtre, vraie ancre), sous la
 * lecture pour ne jamais concurrencer le récit. Les quantités calculées pour
 * la seule lecture (taux de solde, top-N LQ) n'ont AUCUNE page : aucune
 * passarelle, jamais une page inventée (l'audit du ticket #473). La lecture
 * du snapshot Mobilité est retirée avec ses pages (#1048 slice 3).
 */

/** Le clone TYPÉ Milieux enrichi de la seule page « Intensité état » (M2→M3). */
function milieuxAvecPageEtat(): ThemeMetadata {
  const clone = structuredClone(metadonneesThemesFixtures.milieux)
  clone.indicator_pages = {
    artif_par_habitant: {
      indicator: 'artif_par_habitant',
      detail: null,
      label: 'Intensité état',
      definition: 'Surface artificialisée par habitant à chaque État OCS-GE.',
      unit: 'm²/hab',
      calculation: 'État artificialisé divisé par la population du même millésime.',
      direction: 'low',
      caveats: '',
      levels: ['commune', 'epci', 'departement'],
      sources: ['ocsge_artificialisation_22_2025'],
      family: 'trajectory',
      trajectory: { endpoints: ['M2', 'M3'] },
    },
  }
  return clone
}

function payloadPour(theme: 'demographie' | 'milieux' | 'economie', metadata: ThemeMetadata): Payload {
  const parTheme = {
    demographie: {
      indicateurs: indicateursDemographieFixture,
      histoires: histoiresDemographieFixture,
    },
    milieux: {
      indicateurs: indicateursMilieuxFixture,
      histoires: histoiresMilieuxFixture,
    },
    economie: {
      indicateurs: indicateursEconomieFixture,
      histoires: histoiresEconomieFixture,
    },
  }[theme]
  return {
    territoires: territoiresFixture,
    ...parTheme,
    runReport: runReportFraisFixture,
    vintages: vintagesFixture,
    programmes: null,
    themeMetadata: { [theme]: metadata },
  }
}

async function monter(theme: 'demographie' | 'milieux' | 'economie', payload: Payload, territoire: string) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  const wrapper = mount(OngletTheme, {
    props: { theme, payload, territoire },
    global: { plugins: [router] },
  })
  await flushPromises()
  return wrapper
}

// #627 / #1048 slice 3 — the snapshot flagship lecture and its seven legacy
// page handoffs are gone: no reading serves them any more. The passarelles
// machinery keeps its coverage below (Milieux quadrant, no-constituent honesty,
// pure seam).

describe('la passarelle unique du quadrant Milieux (#473)', () => {
  it('offre la page « Intensité état » — les deux états M2/M3 que l’axe y confronte', async () => {
    const wrapper = await monter('milieux', payloadPour('milieux', milieuxAvecPageEtat()), '22001')

    const rangee = wrapper.find('.lecture-passarelles')
    expect(rangee.exists()).toBe(true)
    const ancres = rangee.findAll('a.passarelle-exploration')
    expect(ancres).toHaveLength(1)
    expect(ancres[0]!.attributes('href')).toBe(
      '/indicateurs/milieux/artif_par_habitant?territoire=22001&niveau=commune',
    )
    expect(ancres[0]!.text()).toBe('Intensité état')
    expect(ancres[0]!.attributes('target')).toBe('_blank')
  })
})

describe('l’honnêteté des lectures sans constituant publié (#473)', () => {
  it('GraphiqueSoldes : les taux de solde n’ont pas de page — AUCUNE rangée dans la carte de lecture', async () => {
    const wrapper = await monter('demographie', payloadPour('demographie', structuredClone(metadonneesThemesFixtures.demographie)), '22001')

    expect(wrapper.find('.lecture-texte').exists()).toBe(true) // la lecture rend
    expect(wrapper.find('.lecture-passarelles').exists()).toBe(false)
    // la grille garde SES passarelles (#468) — densite seule page publiée ici
    expect(wrapper.findAll('a.passarelle-exploration')).toHaveLength(1)
    expect(wrapper.findAll('a.passarelle-exploration')[0]!.attributes('href')).toContain('/indicateurs/demographie/densite')
  })

  it('FigureListeLQ : le top-N LQ est un calcul de lecture — AUCUNE rangée, jamais une page inventée', async () => {
    const wrapper = await monter('economie', payloadPour('economie', structuredClone(metadonneesThemesFixtures.economie)), '22001')

    expect(wrapper.find('.liste-lq').exists() || wrapper.find('.sous-groupe-lecture').exists()).toBe(true)
    expect(wrapper.find('.lecture-passarelles').exists()).toBe(false)
    expect(wrapper.findAll('a.passarelle-exploration')).toHaveLength(0)
  })
})

describe('passarellesLecture — le seam pur (#473)', () => {
  it('laisse tomber un constituant SANS page publiée — jamais un lien mort', () => {
    const commune = territoiresFixture.find((t) => t.territoire === '22001')!
    const sansPage = passarellesLecture(structuredClone(metadonneesThemesFixtures.milieux), 'se-densifier-setaler-ou-sen-aller', commune)
    expect(sansPage).toEqual([])

    const avecPage = passarellesLecture(milieuxAvecPageEtat(), 'se-densifier-setaler-ou-sen-aller', commune)
    expect(avecPage.map((p) => p.clef)).toEqual(['artif_par_habitant'])
    expect(avecPage[0]!.libelle).toBe('Intensité état')

    expect(passarellesLecture(metadonneesThemesFixtures.demographie, 'trajectoire-demographique', commune)).toEqual([])
  })

  it('ne fabrique aucune passarelle pour une lecture retirée du contrat', () => {
    const commune = territoiresFixture.find((t) => t.territoire === '22001')!
    expect(passarellesLecture(metadonneesThemesFixtures.mobilite, 'story-retiree', commune)).toEqual([])
  })
})
