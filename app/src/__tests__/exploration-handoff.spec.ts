import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'

import { createMemoryHistory, createRouter } from 'vue-router'

import { describe, expect, it } from 'vitest'

import BlocProgrammes from '../components/fiche/BlocProgrammes.vue'
import OngletTheme from '../components/fiche/OngletTheme.vue'
import { LIBELLE_HANDOFF, handoffExploration } from '../fiche/explorationHandoff'
import { routes } from '../router'
import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  indicateursHabitatFixture,
  indicateursProgrammesFixture,
  metadonneesHabitatAvecPagesFixture,
  metadonneesThemesFixtures,
  runReportFraisFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import type { Payload } from '../payload/types'

/**
 * La passarelle « Explorer » (#409 ; le libellé compact est #468) : chaque
 * indicateur de fiche dont la Page d'indicateur est PUBLIÉE porte une
 * passarelle vers sa page, qui emporte le territoire comme état explicite de
 * l'URL (+ son niveau quand il est comparable — la Région est hors comparaison
 * data-first) et laisse la page résoudre SA facette canon. Un indicateur sans
 * page publiée ne porte AUCUNE passarelle — jamais un lien mort vers une page
 * non supportée.
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
const habitatAvecPages = metadonneesHabitatAvecPagesFixture(['distribution_dpe', 'statut'])

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

function payloadProgrammes(): Payload {
  return {
    territoires: territoiresFixture,
    indicateurs: indicateursProgrammesFixture,
    histoires: [],
    apercu: null,
    runReport: null,
    vintages: null,
    programmes: null,
    themeMetadata: { programmes: structuredClone(metadonneesThemesFixtures.programmes) },
  }
}

/**
 * La fenêtre et l'ancre (#468) : le handoff change l'axe du visiteur — chaque
 * passarelle s'ouvre dans une NOUVELLE FENÊTRE (target="_blank" + le rel du
 * precedent du repo, noopener noreferrer) depuis une VRAIE ancre routée : le
 * href résolu porte exactement l'état d'aujourd'hui (territoire/niveau/thème),
 * le milieu-clic et le long-press restent natifs — jamais un gestionnaire JS.
 * Le libellé est la microcopie compacte « Explorer », identique sur chaque
 * site de handoff.
 */
describe('la fenêtre et l’ancre de la passarelle (#468)', () => {
  it('OngletTheme : figure compacte ET figure de grille rendent la même ancre nouvelle fenêtre avec le href résolu', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(
      OngletTheme,
      {
        props: { theme: 'habitat', payload: payloadOnglet(), territoire: '22001' },
        global: { plugins: [router] },
      },
    )
    await flushPromises()

    const ancres = wrapper.findAll('a.passarelle-exploration')
    expect(ancres).toHaveLength(2)

    for (const ancre of ancres) {
      expect(ancre.text()).toBe(LIBELLE_HANDOFF)
      // La microcopie compacte (#468) — jamais la prose lourde d'avant.
      expect(ancre.text()).toBe('Explorer')
      expect(ancre.attributes('target')).toBe('_blank')
      const rel = (ancre.attributes('rel') ?? '').split(' ')
      expect(rel).toContain('noopener')
      expect(rel).toContain('noreferrer')
    }

    // Le vrai href routé, l'état identique à aujourd'hui (territoire + niveau).
    const hrefs = ancres.map((ancre) => ancre.attributes('href'))
    expect(hrefs).toContain('/indicateurs/habitat/distribution_dpe?territoire=22001&niveau=commune')
    expect(hrefs).toContain('/indicateurs/habitat/statut?territoire=22001&niveau=commune')
  })

  it('BlocProgrammes : le total annuel porte la même ancre nouvelle fenêtre avec le href résolu', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(BlocProgrammes, {
      props: { payload: payloadProgrammes(), territoire: '22001' },
      global: { plugins: [router] },
    })

    const ancres = wrapper.findAll('a.passarelle-exploration')
    expect(ancres).toHaveLength(1)

    const ancre = ancres[0]!
    expect(ancre.text()).toBe('Explorer')
    expect(ancre.attributes('target')).toBe('_blank')
    const rel = (ancre.attributes('rel') ?? '').split(' ')
    expect(rel).toContain('noopener')
    expect(rel).toContain('noreferrer')
    expect(ancre.attributes('href')).toBe(
      '/indicateurs/programmes/subventions_annuelles?territoire=22001&niveau=commune',
    )

    // L'autre lien du bloc (le portail Région) reste une ancre externe honnête
    // — la passarelle n'a pas absorbé sa cible.
    const portail = wrapper.find('a.programmes-lien')
    expect(portail.attributes('target')).toBe('_blank')
    expect(portail.attributes('href')).not.toContain('/indicateurs/')
  })
})

describe('le câblage fiche de la passarelle (#409)', () => {
  it('OngletTheme : chaque figure publiée porte « Explorer » avec l’état du territoire — la figure compacte comprise', async () => {
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
      props: { payload: payloadProgrammes(), territoire: '22001' },
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
