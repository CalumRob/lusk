import { mount, RouterLinkStub } from '@vue/test-utils'

import { describe, expect, it } from 'vitest'

import ApercuOnglet from '../components/fiche/ApercuOnglet.vue'
import { LIEN_SUBVENTIONS } from '../fiche/apercu'
import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  programmesFixture,
  programmesLadderFixture,
  programmesVideFixture,
  runReportFraisFixture,
  territoiresFixture,
  territoiresLadderFixture,
  vintagesFixture,
} from '../payload/fixtures'
import type { Payload } from '../payload/types'

/**
 * ApercuOnglet — the Aperçu tab (ADR-0007, layouts.md §2): the territory's
 * basic stats rendered through apercuPourTerritoire (NA values skipped by the
 * selector, never a phantom figure) and the Programmes & financements element
 * (issue #181) — rendered from REAL data through the ladder derivation
 * (programmesPourTerritoire, ADR-0013): the three voices (lauréate /
 * couverte / porte / compte / ort), the named lists (full, scrollable), the
 * « convention valant ORT » rider, the vintage stamp on every badge and on
 * the subvention figure, the by-policy-area split on commune fiches and the
 * single annual total elsewhere. Runs on the general brand ramp. Honest empty
 * state when the payload carries no programmes (404 → null) — never « under
 * construction » (principles.md §1).
 */

const payloadDemographie: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: apercuAvecNAFixture,
  runReport: runReportFraisFixture,
  vintages: vintagesFixture,
  programmes: programmesFixture,
}

const payloadEchelle: Payload = {
  ...payloadDemographie,
  territoires: territoiresLadderFixture,
  programmes: programmesLadderFixture,
}

function monter(territoire: string, payload: Payload = payloadDemographie): ReturnType<typeof mount> {
  return mount(ApercuOnglet, {
    props: { payload, territoire },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
}

describe('ApercuOnglet — les statistiques de base', () => {
  it('renders the KPI figures for the territory, in payload order, via the selector', () => {
    const wrapper = monter('22001')

    const valeurs = wrapper.findAll('.kpi-valeur').map((v) => v.text())
    expect(valeurs).toEqual(['2\u202F000 hab.', '200 hab/km²', '15 %'])

    const libelles = wrapper.findAll('.kpi-libelle').map((v) => v.text())
    expect(libelles).toEqual([
      'Population',
      'Densité de population',
      'Part des 65 ans et plus',
    ])
  })

  it('skips NA values — a KPI not computable for the territory never renders', () => {
    // 22002's part_65_plus is null in the fixture (apercuAvecNAFixture)
    const wrapper = monter('22002')

    expect(wrapper.findAll('.kpi-valeur').map((v) => v.text())).toEqual([
      '400 hab.',
      '50 hab/km²',
    ])
    expect(wrapper.text()).not.toContain('Part des 65 ans et plus')
  })

  it('wears the brand ramp class on its figures — the general theme, never a theme ramp', () => {
    const wrapper = monter('22001')

    const figures = wrapper.findAll('.kpi')
    expect(figures.length).toBeGreaterThan(0)
    for (const figure of figures) {
      expect(figure.classes()).toContain('kpi--marque')
    }
  })
})

describe("ApercuOnglet — l'élément Programmes & financements (les données réelles)", () => {
  it('rendre une fiche COMMUNE — le label lauréat, la couverture du contrat de son EPCI, la ventilation des subventions', () => {
    const wrapper = monter('22001')

    const puces = wrapper.findAll('.puce-programme').map((p) => p.text())
    // ACV (lauréate, rider) + CRTE (couverture par EPCI X) — jamais un badge ORT
    expect(puces).toEqual(['ACV', 'CRTE'])
    expect(wrapper.find('.apercu-programmes').text()).not.toContain('Aucun programme référencé.')

    // la voix honnête de chaque badge
    const voix = wrapper.findAll('.programme-voix').map((v) => v.text())
    expect(voix[0]).toBe('Commune lauréate du programme')
    expect(voix[1]).toBe('Territoire couvert par le contrat')

    // la figure de subventions : le total ventilé par domaine
    expect(wrapper.find('.subvention-total').text()).toContain('45\u202F000 €')
    const axes = wrapper.findAll('.subvention-axe').map((a) => a.text())
    expect(axes).toEqual([
      '30\u202F000 €Développement économique',
      '15\u202F000 €Agriculture',
    ])
  })

  it('l’expansion accessible de chaque badge porte le sigle, le nom, la voix et le rider — « ACV — Action Cœur de Ville »', () => {
    const wrapper = monter('22001')

    const acv = wrapper.findAll('.puce-programme')[0]
    expect(acv.attributes('aria-label')).toBe(
      'ACV — Action Cœur de Ville · Commune lauréate du programme · convention valant ORT',
    )
    const crte = wrapper.findAll('.puce-programme')[1]
    expect(crte.attributes('aria-label')).toBe(
      'CRTE — Contrat de Relance et de Transition Écologique · Territoire couvert par le contrat : EPCI X',
    )
  })

  it('le rider « convention valant ORT » est visible sur la ligne de label — jamais un badge ORT en plus', () => {
    const wrapper = monter('22001')

    expect(wrapper.findAll('.programme-rider').map((r) => r.text())).toEqual(['convention valant ORT'])
    expect(wrapper.findAll('.puce-programme').map((p) => p.text())).not.toContain('ORT')
  })

  it('badge l’ORT d’une commune NON labellisée dans un périmètre signé — jamais pour une commune labellisée', () => {
    const nonLabellisee = monter('29001')
    expect(nonLabellisee.findAll('.puce-programme').map((p) => p.text())).toEqual([
      "Territoires d'industrie",
      'ORT',
    ])

    // 29002 : membre d’un EPCI avec ORT au niveau EPCI, mais hors périmètre
    // communal — la seule couverture est le contrat TI
    const horsPerimetre = monter('29002')
    expect(horsPerimetre.findAll('.puce-programme').map((p) => p.text())).toEqual([
      "Territoires d'industrie",
    ])
  })

  it('rend la fiche EPCI — ses contrats puis le PORTAGE NOMÉ des communes labellisées, liste complète scrollable', () => {
    const wrapper = monter('200000001')

    expect(wrapper.findAll('.puce-programme').map((p) => p.text())).toEqual(['CRTE', 'ACV', 'PVD'])
    const voix = wrapper.findAll('.programme-voix').map((v) => v.text())
    expect(voix[0]).toBe('Territoire couvert par le contrat')
    expect(voix[1]).toBe('Porte le programme sur 1 commune')
    expect(voix[2]).toBe('Porte le programme sur 1 commune')

    // les listes nommées du portage — complètes, jamais tronquées, scrollables
    const listes = wrapper.findAll('.programme-noms')
    expect(listes).toHaveLength(2)
    expect(listes[0].text()).toContain('Commune A1')
    expect(listes[1].text()).toContain('Commune D')
    for (const liste of listes) {
      expect(liste.classes()).toContain('programme-noms--scrollable')
    }
  })

  it('rend la fiche DÉPARTEMENT — la voix qui compte avec les EPCIs et communes nommés, jamais un badge plat', () => {
    const wrapper = monter('22')

    expect(wrapper.findAll('.puce-programme').map((p) => p.text())).toEqual(['CRTE', 'ACV', 'PVD'])
    const voix = wrapper.findAll('.programme-voix').map((v) => v.text())
    expect(voix[0]).toBe('Compte 1 contrat signé')
    expect(voix[1]).toBe('Compte 1 commune lauréate')
    expect(voix[2]).toBe('Compte 1 commune lauréate')

    expect(wrapper.find('.programme-noms').text()).toContain('EPCI X')
    // le total annuel unique + le lien portail — pas de ventilation au niveau agrégat
    expect(wrapper.find('.subvention-total').text()).toContain('300\u202F000 €')
    expect(wrapper.findAll('.subvention-axe')).toHaveLength(0)
  })

  it('rend la fiche RÉGION — le résumé breton avec les listes nommées en entier', () => {
    const wrapper = monter('53')

    expect(wrapper.findAll('.puce-programme').map((p) => p.text())).toEqual([
      'CRTE',
      "Territoires d'industrie",
      'ACV',
      'PVD',
      'ORT',
    ])
    const voix = wrapper.findAll('.programme-voix').map((v) => v.text())
    expect(voix[0]).toBe('Compte 1 contrat signé')
    expect(voix[4]).toBe('Compte 1 commune en périmètre ORT')
    expect(wrapper.find('.subvention-total').text()).toContain('2,00 M€')
  })

  it('un EPCI TRANSVERSAL compte dans les DEUX départements — le même CRTE nommé dans 22 et 29', () => {
    const dep22 = monter('22', payloadEchelle)
    const dep29 = monter('29', payloadEchelle)

    expect(dep22.find('.programme-noms').text()).toContain('EPCI X')
    expect(dep22.find('.programme-noms').text()).toContain('EPCI Z')
    expect(dep29.findAll('.puce-programme').map((p) => p.text())).toContain('CRTE')
    expect(dep29.find('.programme-noms').text()).toContain('EPCI Z')
  })

  it('affiche le top-5 des axes triés par montant décroissant puis le reste derrière la révélation (issue #305)', async () => {
    const wrapper = monter('29003', payloadEchelle)

    // le top-5 d'abord, trié par montant décroissant (le fixture est non trié)
    const axes = wrapper.findAll('.subvention-axe-libelle').map((l) => l.text())
    expect(axes).toEqual([
      'Développement économique',
      'Agriculture',
      'Culture',
      'Sport',
      'Environnement',
    ])
    expect(wrapper.findAll('.subvention-axe')).toHaveLength(5)

    // la révélation du reste — accessible, jamais une liste tronquée
    const bouton = wrapper.find('.subvention-reveler')
    expect(bouton.exists()).toBe(true)
    expect(bouton.attributes('aria-expanded')).toBe('false')
    expect(bouton.text()).toBe('Voir les 2 autres domaines')

    await bouton.trigger('click')

    expect(wrapper.find('.subvention-reveler').attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('.subvention-reveler').text()).toBe('Masquer')
    expect(wrapper.findAll('.subvention-axe').map((a) => a.text())).toEqual([
      '50\u202F000 €Développement économique',
      '40\u202F000 €Agriculture',
      '30\u202F000 €Culture',
      '20\u202F000 €Sport',
      '10\u202F000 €Environnement',
      '6\u202F000 €Enseignement',
      '6\u202F000 €Tourisme',
    ])
  })

  it('n’offre AUCUNE révélation quand la ventilation tient dans le top-5', () => {
    const wrapper = monter('22001')

    expect(wrapper.findAll('.subvention-axe')).toHaveLength(2)
    expect(wrapper.find('.subvention-reveler').exists()).toBe(false)
  })

  it('lit la part de contexte d’une commune — son total dans celui de SON EPCI, une décimale (issue #305)', () => {
    const wrapper = monter('29003', payloadEchelle)

    expect(wrapper.find('.subvention-contexte').text()).toBe('94,2 % du total de l\u0027EPCI')
  })

  it('lit la part de contexte d’un EPCI et d’un département dans le total de la RÉGION — jamais sur la région', () => {
    const epci = monter('200000001')
    expect(epci.find('.subvention-contexte').text()).toBe('2,3 % du total de la région')

    const departement = monter('22')
    expect(departement.find('.subvention-contexte').text()).toBe('15 % du total de la région')

    const region = monter('53')
    expect(region.find('.subvention-contexte').exists()).toBe(false)
  })

  it('garde la part de contexte silencieuse — une commune dont l’EPCI n’a pas de total agrégé', () => {
    // 29001 a une ligne de subvention mais SON EPCI (Y) n’a pas de total agrégé
    const wrapper = monter('29001', payloadEchelle)

    expect(wrapper.find('.subvention-total').exists()).toBe(true)
    expect(wrapper.find('.subvention-contexte').exists()).toBe(false)
  })

  it('lit la provenance d’une fiche agrégée — le lien vers les communes filtrées (issue #305)', () => {
    const epci = monter('200000001')
    const departement = monter('22')
    const region = monter('53')

    const lienEpci = epci.findComponent(RouterLinkStub)
    expect(lienEpci.props('to')).toEqual({ name: 'communes', query: { epci: '200000001' } })
    expect(lienEpci.text()).toBe("communes de l'EPCI")

    const lienDepartement = departement.findComponent(RouterLinkStub)
    expect(lienDepartement.props('to')).toEqual({ name: 'communes', query: { departement: '22' } })
    expect(lienDepartement.text()).toBe('communes du département')

    const lienRegion = region.findComponent(RouterLinkStub)
    expect(lienRegion.props('to')).toEqual({ name: 'communes' })
    expect(lienRegion.text()).toBe('communes de Bretagne')
  })

  it('garde la phrase complète de la provenance — « Somme des subventions attribuées aux … »', () => {
    const wrapper = monter('200000001')

    expect(wrapper.find('.subvention-provenance').text()).toBe(
      'Somme des subventions attribuées aux communes de l\u0027EPCI',
    )
  })

  it('n’affiche AUCUNE provenance sur une fiche communale', () => {
    const wrapper = monter('29003', payloadEchelle)

    expect(wrapper.find('.subvention-provenance').exists()).toBe(false)
    expect(wrapper.findAllComponents(RouterLinkStub)).toHaveLength(0)
  })

  it('chaque badge et la figure de subventions portent leur estampille vintage', () => {
    const wrapper = monter('22001')

    const vintageBadges = wrapper.findAll('.programme-vintage')
    expect(vintageBadges.length).toBeGreaterThan(0)
    expect(vintageBadges[0].text()).toContain('Action cœur de ville')
    expect(wrapper.find('.subvention-vintage').text()).toContain('SCDL')
  })

  it('ne montre aucune figure de subventions inventée — le lien portail reste le drill-down honnête', () => {
    // EPCI Y : des badges (TI + ORT) mais aucune ligne d’agrégat
    const wrapper = monter('200000002')

    expect(wrapper.findAll('.puce-programme')).toHaveLength(2)
    expect(wrapper.find('.subvention-total').exists()).toBe(false)
    expect(wrapper.find('.programmes-lien').exists()).toBe(true)
  })

  it('garde le lien de la Région subventions — le portail officiel des aides', () => {
    const wrapper = monter('22001')

    const lien = wrapper.find('.programmes-lien')
    expect(lien.exists()).toBe(true)
    expect(lien.attributes('href')).toBe(LIEN_SUBVENTIONS.href)
    expect(lien.attributes('target')).toBe('_blank')
    expect(lien.attributes('rel')).toContain('noopener')
    expect(lien.text()).toContain('Subventions de la Région Bretagne')
  })
})

describe("ApercuOnglet — l'état vide honnête (jamais « under construction »)", () => {
  it('montre l’état vide quand le payload programmes est absent (404 → null)', () => {
    const sansProgrammes: Payload = { ...payloadDemographie, programmes: null }
    const wrapper = monter('22001', sansProgrammes)

    expect(wrapper.find('.apercu-programmes').text()).toContain('Programmes & financements')
    expect(wrapper.find('.apercu-programmes').text()).toContain('Aucun programme référencé.')
    expect(wrapper.findAll('.puce-programme')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('À venir')
  })

  it('montre l’état vide quand les tables sont présentes mais sans aucune ligne', () => {
    const vides: Payload = { ...payloadDemographie, programmes: programmesVideFixture }
    const wrapper = monter('22001', vides)

    expect(wrapper.find('.apercu-programmes').text()).toContain('Aucun programme référencé.')
    expect(wrapper.find('.programmes-lien').exists()).toBe(true)
  })

  it('montre un état vide pour un territoire inconnu, et garde la section programmes', () => {
    const wrapper = monter('99999')

    expect(wrapper.find('.apercu-stats').exists()).toBe(false)
    expect(wrapper.text()).toContain('Aucune donnée disponible pour ce territoire.')
    expect(wrapper.findAll('.puce-programme')).toHaveLength(0)
  })

  it('gère un apercu absent (404 → null) — l’état vide honnête, jamais une erreur (issue #122)', () => {
    // Depuis #116 le pipeline ne publie apercu.json que quand un thème a un
    // aperçu — sans le fichier, la table entière est absente : la vue doit
    // rendre l'état vide proprement, pas crasher.
    const sansApercu: Payload = { ...payloadDemographie, apercu: null }
    const wrapper = monter('22001', sansApercu)

    expect(wrapper.find('.apercu-stats').exists()).toBe(false)
    expect(wrapper.text()).toContain('Aucune donnée disponible pour ce territoire.')
    expect(wrapper.find('.apercu-programmes').exists()).toBe(true)
  })
})
