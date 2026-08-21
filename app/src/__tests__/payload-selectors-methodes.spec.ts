import { describe, expect, it } from 'vitest'

import { SOURCES_METHODES } from '../methodes/sources'
import {
  apercuAvecNAFixture,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import { sourcesMethodes } from '../payload/selectors'
import type { Payload, Vintage } from '../payload/types'

/**
 * La jointure Méthodes — le registre (faits éditoriaux) × la table vintages
 * (faits de fraîcheur), jointe par id de source (docs/themes/README.md §The
 * Méthodes contract), rendue à la granularité jeu de données (ADR-0022) : un
 * en-tête par jeu (nom, éditeur, URL, thèmes), ses lignes vintage imbriquées
 * (libellé éditorial + fraîcheur). Sélecteurs purs au seam du payload :
 * groupement, règle de repli honnête (une fraîcheur de publication partagée
 * se replie sur l'en-tête — DVF ; des faits distincts restent des lignes —
 * OCS-GE), dégradation (source sans ligne vintages en direct), vintages
 * absents (404). L'union est le contrat — le registre est la liste des jeux,
 * la fraîcheur vit dans vintages.json.
 */

function payloadAvec(vintages: Payload['vintages']): Payload {
  return {
    territoires: territoiresFixture,
    indicateurs: indicateursDemographieFixture,
    histoires: histoiresDemographieFixture,
    apercu: apercuAvecNAFixture,
    runReport: null,
    vintages,
    programmes: null,
  }
}

/** Les 20 lignes vintages DVF (issue #160) — la publication unique : date_publication + licence identiques. */
function vintagesDvf(): Vintage[] {
  const annees = [2021, 2022, 2023, 2024, 2025]
  const deps = ['22', '29', '35', '56']
  return annees.flatMap((annee) =>
    deps.map((dep) => ({
      id: `dvf_${annee}_dep${dep}`,
      source: 'Etalab — DVF géolocalisées',
      version: String(annee),
      licence: 'lov2',
      date_reference: `${annee}-12-31`,
      date_publication: '2026-05-18',
    })),
  )
}

/** Les lignes vintages OCS-GE — des dates de publication DISTINCTES (les millésimes par département, un patch). */
function vintagesOcsGe(): Vintage[] {
  return [
    {
      id: 'ocsge_artificialisation_22_2021',
      source: 'IGN — OCS GE « surfaces artificialisées » v2.0 (Nouvelle Génération)',
      version: '2021',
      licence: 'lov2',
      date_reference: '2021-01-01',
      date_publication: '2025-09-12',
    },
    {
      id: 'ocsge_artificialisation_22_2025',
      source: 'IGN — OCS GE « surfaces artificialisées » v2.0 (Nouvelle Génération)',
      version: '2025',
      licence: 'lov2',
      date_reference: '2025-01-01',
      date_publication: '2026-07-03',
    },
    {
      id: 'ocsge_patch_correctif_22',
      source: 'IGN — OCS GE « patch correctif » (Nouvelle Génération)',
      version: '2021',
      licence: 'lov2',
      date_reference: '2021-01-01',
      date_publication: '2026-07-03',
    },
  ]
}

describe('sourcesMethodes — la granularité jeu de données (ADR-0022)', () => {
  it('groupe les 58 lignes du registre en 26 jeux de données, dans l\u2019ordre du registre', () => {
    const { jeux } = sourcesMethodes(payloadAvec(vintagesFixture))

    const attendus = [
      ...new Set(Object.entries(SOURCES_METHODES).map(([id, source]) => source.dataset ?? id)),
    ]
    expect(jeux.map((j) => j.id)).toEqual(attendus)
    // osm_reseaux porte le stationnement ; BPE ajoute un seul jeu.
    expect(jeux.length).toBe(25)
  })

  it('porte les faits éditoriaux du jeu sur l\u2019en-tête (nom, éditeur, URL, thèmes)', () => {
    const { jeux } = sourcesMethodes(payloadAvec(vintagesFixture))

    const serie = jeux.find((j) => j.id === 'serie_historique')
    expect(serie).toMatchObject({
      nom: 'INSEE — Série historique du recensement',
      editeur: 'INSEE',
      url: 'https://www.data.gouv.fr/datasets/serie-historique-du-recensement-de-la-population',
      themes: ['demographie', 'milieux'],
    })
  })

  it('joint les faits de fraîcheur en direct depuis la table vintages', () => {
    const { jeux } = sourcesMethodes(payloadAvec(vintagesFixture))

    const serie = jeux.find((j) => j.id === 'serie_historique')
    expect(serie?.replie).toBe(true)
    expect(serie).toMatchObject({
      version: '2023',
      licence: 'Licence Ouverte 2.0',
      dateReference: '1 janvier 2023',
      datePublication: '30 juin 2026',
    })
  })

  it('porte le libellé éditorial sur la ligne vintage (le nouveau champ du registre, ADR-0022)', () => {
    const { jeux } = sourcesMethodes(payloadAvec(vintagesFixture))

    const serie = jeux.find((j) => j.id === 'serie_historique')
    expect(serie?.vintages).toHaveLength(1)
    expect(serie?.vintages[0]).toMatchObject({
      id: 'serie_historique',
      libelle: 'Millésime 2023',
      version: '2023',
    })
  })

  it('joint la source mobilite_snapshot avec sa licence ODbL et ses deux dates (issue #151)', () => {
    const { jeux } = sourcesMethodes(payloadAvec(vintagesFixture))

    const snapshot = jeux.find((j) => j.id === 'mobilite_snapshot')
    expect(snapshot).toMatchObject({
      version: '2026-02',
      licence: 'ODbL — © OpenStreetMap contributors',
      dateReference: '28 février 2026',
      datePublication: '6 août 2026',
    })
  })
})

describe('sourcesMethodes — le repli honnête (ADR-0022)', () => {
  it('replie le jeu DVF sur son en-tête — 20 vintages, une publication unique, l\u2019étendue des millésimes', () => {
    const { jeux } = sourcesMethodes(payloadAvec(vintagesDvf()))

    const dvf = jeux.find((j) => j.id === 'dvf')
    expect(dvf).toBeDefined()
    expect(dvf?.replie).toBe(true)
    expect(dvf?.vintages).toHaveLength(20)
    // l'en-tête porte la fenêtre des millésimes (jamais 20 lignes identiques)
    expect(dvf?.version).toBe('2021 – 2025')
    expect(dvf?.dateReference).toBe('31 décembre 2021 – 31 décembre 2025')
    expect(dvf?.datePublication).toBe('18 mai 2026')
    expect(dvf?.licence).toBe('Licence Ouverte 2.0')
  })

  it('garde les lignes OCS-GE visibles — les millésimes (et les patchs) portent des faits distincts', () => {
    const { jeux } = sourcesMethodes(payloadAvec(vintagesOcsGe()))

    // UN seul jeu OCS-GE — les 8 archives d'état ET les 3 patchs correctifs
    // (la relecture #361 : le patch est une ligne du même jeu, jamais un second en-tête)
    const ocsge = jeux.find((j) => j.id === 'ocsge_artificialisation')
    expect(ocsge).toBeDefined()
    expect(jeux.filter((j) => j.nom.startsWith('IGN — OCS GE')).map((j) => j.id)).toEqual([
      'ocsge_artificialisation',
    ])
    expect(ocsge?.replie).toBe(false)
    // l'en-tête du jeu déplié ne porte aucune fraîcheur — les lignes la portent
    expect(ocsge?.version).toBeNull()
    expect(ocsge?.datePublication).toBeNull()
    expect(ocsge?.licence).toBeNull()
    // les 11 lignes du registre (8 états + 3 patchs) restent des lignes — celles
    // sans vintage en direct dégradent gracieusement (fraîcheur nulle), jamais une
    // date inventée
    expect(ocsge?.vintages).toHaveLength(11)
    expect(ocsge?.vintages[0]).toMatchObject({
      id: 'ocsge_artificialisation_22_2021',
      libelle: 'Millésime 2021 · Côtes-d\u2019Armor (22)',
      version: '2021',
      dateReference: '1 janvier 2021',
      datePublication: '12 septembre 2025',
    })
    expect(ocsge?.vintages[1]).toMatchObject({
      id: 'ocsge_artificialisation_22_2025',
      libelle: 'Millésime 2025 · Côtes-d\u2019Armor (22)',
      datePublication: '3 juillet 2026',
    })
    expect(ocsge?.vintages[6]).toMatchObject({
      id: 'ocsge_artificialisation_56_2022',
      version: null,
      datePublication: null,
    })
    // le premier patch est la 9e ligne du jeu, avec son libellé dédié et sa fraîcheur
    expect(ocsge?.vintages[8]).toMatchObject({
      id: 'ocsge_patch_correctif_22',
      libelle: 'Patch correctif — Côtes-d\u2019Armor (22), millésime corrigé 2021',
      datePublication: '3 juillet 2026',
    })
  })
})

describe('sourcesMethodes — la dégradation gracieuse', () => {
  it('une source sans ligne vintages en direct rend ses faits éditoriaux, jamais des dates inventées', () => {
    // logements est dans le registre mais absent des vintages de ce payload
    const vintages = vintagesFixture.filter((v) => v.id !== 'logements')
    const { jeux } = sourcesMethodes(payloadAvec(vintages))

    const logements = jeux.find((j) => j.id === 'logements')
    expect(logements).toMatchObject({
      nom: 'INSEE — Logements (dossier complet)',
      editeur: 'INSEE',
    })
    expect(logements?.vintages[0]).toMatchObject({
      version: null,
      licence: null,
      dateReference: null,
      datePublication: null,
    })
  })

  it('une date de publication null (base roulante) reste null — jamais complétée', () => {
    // l'id epci porte date_publication null dans la fixture (pas encore mise en ligne)
    const { jeux } = sourcesMethodes(payloadAvec(vintagesFixture))

    const epci = jeux.find((j) => j.id === 'epci')
    expect(epci?.datePublication).toBeNull()
    expect(epci?.dateReference).toBe('1 janvier 2025')
  })
})

describe('sourcesMethodes — vintages absents (404)', () => {
  it('signale l\u2019absence et rend un jeu honnête par source — la page ne casse pas', () => {
    const { jeux, vintagesAbsents } = sourcesMethodes(payloadAvec(null))

    expect(vintagesAbsents).toBe(true)
    // les aires OSM partagent l’identité osm_reseaux ; seul BPE ajoute un jeu
    expect(jeux.length).toBe(25)
    for (const jeu of jeux) {
      expect(jeu.replie).toBe(true)
      expect(jeu.vintages[0].version).toBeNull()
      expect(jeu.vintages[0].licence).toBeNull()
      expect(jeu.vintages[0].dateReference).toBeNull()
      expect(jeu.vintages[0].datePublication).toBeNull()
      expect(jeu.editeur.length).toBeGreaterThan(0)
    }
  })
})
