import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'

import { describe, expect, it } from 'vitest'

import BlocProgrammes from '../components/fiche/BlocProgrammes.vue'
import OngletTheme from '../components/fiche/OngletTheme.vue'
import { LIBELLE_HANDOFF, handoffExploration } from '../fiche/explorationHandoff'
import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  indicateursHabitatFixture,
  indicateursProgrammesFixture,
  metadonneesThemesFixtures,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import type { Payload, ThemeMetadata } from '../payload/types'

/**
 * La passarelle « Explorer cet indicateur » (#409) : chaque indicateur de
 * fiche dont la Page d'indicateur est PUBLIÉE porte une passarelle vers sa
 * page, qui emporte le territoire comme état explicite de l'URL (+ son niveau
 * quand il est comparable — la Région est hors comparaison data-first) et
 * laisse la page résoudre SA facette canon. Un indicateur sans page publiée ne
 * porte AUCUNE passarelle — jamais un lien mort vers une page non supportée.
 */

describe('handoffExploration — le seam pur', () => {
  const metadata = metadonneesThemesFixtures.demographie

  it('construit la route de la page publiée avec le territoire et son niveau explicites', () => {
    const commune = territoiresFixture.find((t) => t.territoire === '22001')!
    expect(handoffExploration(metadata, 'densite', commune)).toEqual({
      name: 'indicateur',
      params: { theme: 'demographie', indicator: 'densite' },
      query: { territoire: '22001', niveau: 'commune' },
    })
    const epci = territoiresFixture.find((t) => t.territoire === '200000001')!
    expect(handoffExploration(metadata, 'densite', epci)).toMatchObject({
      query: { territoire: '200000001', niveau: 'epci' },
    })
  })

  it('la Région porte SON territoire sans niveau — la page résout son repli honnêtement', () => {
    const region = territoiresFixture.find((t) => t.type === 'region')!
    expect(handoffExploration(metadata, 'densite', region)).toEqual({
      name: 'indicateur',
      params: { theme: 'demographie', indicator: 'densite' },
      query: { territoire: '53' },
    })
  })

  it('un indicateur SANS page publiée ne porte aucune passarelle — jamais un lien mort', () => {
    // structure_age est un fait de fiche sans Page d'indicateur dans ce canon.
    const commune = territoiresFixture.find((t) => t.territoire === '22001')!
    expect(handoffExploration(metadata, 'structure_age', commune)).toBeNull()
    expect(handoffExploration(undefined, 'structure_age', commune)).toBeNull()
  })
})

/**
 * Le câblage fiche — OngletTheme (les figures compactes ET la grille) et
 * BlocProgrammes (le total annuel du sixième thème). Le clone habitat porte
 * deux pages publiées : distribution_dpe (la figure COMPACTE du sous-groupe,
 * exclue de la grille) et statut (une figure de grille) — mix_logements reste
 * sans page pour exercer l'absence.
 */
const habitatAvecPages: ThemeMetadata = (() => {
  const clone = structuredClone(metadonneesThemesFixtures.habitat)
  clone.indicator_pages = {
    distribution_dpe: {
      indicator: 'distribution_dpe',
      detail: null,
      label: 'Distribution des étiquettes DPE (A à G)',
      definition: 'Répartition des diagnostics par étiquette.',
      unit: '%',
      calculation: 'Part de chaque étiquette.',
      direction: 'low',
      caveats: 'Comparaison par la part de passoires.',
      levels: ['commune', 'epci', 'departement'],
      sources: ['dpe_22'],
      family: 'distribution',
      distribution: { signature: ['A', 'G'] },
    },
    statut: {
      indicator: 'statut',
      detail: null,
      label: 'Statut d’occupation',
      definition: 'Résidences principales par statut d’occupation.',
      unit: '%',
      calculation: 'Parts du parc.',
      direction: 'high',
      caveats: '',
      levels: ['commune', 'epci', 'departement'],
      sources: ['logements'],
      family: 'composition',
      composition: { parts: ['proprietaire'] },
    },
  }
  return clone
})()

function payloadOnglet(): Payload {
  return {
    territoires: territoiresFixture,
    indicateurs: indicateursHabitatFixture,
    histoires: [],
    apercu: null,
    runReport: runReportFraisFixture,
    vintages: vintagesFixture,
    programmes: null,
    themeMetadata: { habitat: habitatAvecPages },
  }
}

describe('le câblage fiche de la passarelle (#409)', () => {
  it('OngletTheme : chaque figure publiée porte « Explorer cet indicateur » avec l’état du territoire — la figure compacte comprise', async () => {
    const wrapper = mount(OngletTheme, {
      props: { theme: 'habitat', payload: payloadOnglet(), territoire: '22001' },
      global: { stubs: { RouterLink: RouterLinkStub } },
    })
    await flushPromises()

    const passarelles = wrapper
      .findAllComponents(RouterLinkStub)
      .filter((lien) => lien.text() === LIBELLE_HANDOFF)
      .map((lien) => lien.props('to'))
    // La figure COMPACTE (distribution_dpe) ET la figure de grille (statut).
    expect(passarelles).toHaveLength(2)
    expect(passarelles).toContainEqual({
      name: 'indicateur',
      params: { theme: 'habitat', indicator: 'distribution_dpe' },
      query: { territoire: '22001', niveau: 'commune' },
    })
    expect(passarelles).toContainEqual({
      name: 'indicateur',
      params: { theme: 'habitat', indicator: 'statut' },
      query: { territoire: '22001', niveau: 'commune' },
    })

    // mix_logements n'a pas de page publiée : AUCUNE passarelle vers lui.
    expect(passarelles.some((lien) => JSON.stringify(lien).includes('mix_logements'))).toBe(false)
  })

  it('BlocProgrammes : le total annuel publié porte la passarelle du sixième thème', () => {
    const wrapper = mount(BlocProgrammes, {
      props: {
        payload: {
          territoires: territoiresFixture,
          indicateurs: indicateursProgrammesFixture,
          histoires: [],
          apercu: null,
          runReport: null,
          vintages: null,
          programmes: null,
          themeMetadata: { programmes: structuredClone(metadonneesThemesFixtures.programmes) },
        },
        territoire: '22001',
      },
      global: {
        stubs: {
          RouterLink: RouterLinkStub,
          AppIcon: { template: '<span />' },
        },
      },
    })

    const passarelles = wrapper
      .findAllComponents(RouterLinkStub)
      .filter((lien) => lien.text() === LIBELLE_HANDOFF)
      .map((lien) => lien.props('to'))
    expect(passarelles).toEqual([
      {
        name: 'indicateur',
        params: { theme: 'programmes', indicator: 'subventions_annuelles' },
        query: { territoire: '22001', niveau: 'commune' },
      },
    ])
    // couverture_programmes / subventions_par_domaine : faits sans page — rien.
    expect(JSON.stringify(passarelles)).not.toContain('couverture')
    expect(JSON.stringify(passarelles)).not.toContain('par_domaine')
  })

  it('l’état sélectif tient : le canon dénographie ne publie QUE densite — une seule passarelle se rend', async () => {
    const wrapper = mount(OngletTheme, {
      props: {
        theme: 'demographie',
        payload: {
          territoires: territoiresFixture,
          indicateurs: indicateursDemographieFixture,
          histoires: histoiresDemographieFixture,
          apercu: apercuAvecNAFixture,
          runReport: runReportFraisFixture,
          vintages: vintagesFixture,
          programmes: null,
          themeMetadata: { demographie: metadonneesThemesFixtures.demographie },
        },
        territoire: '22001',
      },
      global: { stubs: { RouterLink: RouterLinkStub } },
    })
    await flushPromises()

    const passarelles = wrapper
      .findAllComponents(RouterLinkStub)
      .filter((lien) => lien.text() === LIBELLE_HANDOFF)
    // structure_age (la figure compacte) n'a pas de page ; densite seule en a une.
    expect(passarelles).toHaveLength(1)
    expect(JSON.stringify(passarelles[0]!.props('to'))).toContain('densite')
    expect(JSON.stringify(passarelles[0]!.props('to'))).not.toContain('structure_age')
  })
})
