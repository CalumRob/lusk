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
import type { Payload } from '../payload/types'

/**
 * La jointure Méthodes — le registre (faits éditoriaux) × la table vintages
 * (faits de fraîcheur), jointe par id de source (docs/themes/README.md §The
 * Méthodes contract). Sélecteurs purs au seam du payload : registre ×
 * vintages, dégradation (source sans ligne vintages en direct), vintages
 * absents (404). L'union est le contrat — le registre est la liste des lignes,
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
  }
}

describe('sourcesMethodes — la jointure registre × vintages', () => {
  it('liste une ligne par source du registre, dans l\u2019ordre du registre', () => {
    const { lignes, vintagesAbsents } = sourcesMethodes(payloadAvec(vintagesFixture))

    expect(vintagesAbsents).toBe(false)
    expect(lignes.map((l) => l.id)).toEqual(Object.keys(SOURCES_METHODES))
  })

  it('joint les faits de fraîcheur en direct depuis la table vintages', () => {
    const { lignes } = sourcesMethodes(payloadAvec(vintagesFixture))

    const serie = lignes.find((l) => l.id === 'serie_historique')
    expect(serie).toMatchObject({
      nom: 'INSEE — Série historique du recensement',
      editeur: 'INSEE',
      version: '2023',
      licence: 'Licence Ouverte 2.0',
      dateReference: '1 janvier 2023',
      datePublication: '30 juin 2026',
    })
    expect(serie?.themes).toEqual(['demographie'])
  })

  it('porte l\u2019URL éditoriale du jeu de données, jamais une date inventée', () => {
    const { lignes } = sourcesMethodes(payloadAvec(vintagesFixture))

    const serie = lignes.find((l) => l.id === 'serie_historique')
    expect(serie?.url).toBe(
      'https://www.data.gouv.fr/datasets/serie-historique-du-recensement-de-la-population',
    )
  })

  it('joint la source mobilite_snapshot avec sa licence ODbL et ses deux dates (issue #151)', () => {
    const { lignes } = sourcesMethodes(payloadAvec(vintagesFixture))

    const snapshot = lignes.find((l) => l.id === 'mobilite_snapshot')
    expect(snapshot).toMatchObject({
      nom: 'Lusk — analyse d\u2019accessibilité « Vingt minutes sans voiture » (analyse portée, BPE 2024 · OSM 02-2026 · BDNB 2025-07)',
      editeur: 'Lusk',
      url: null,
      version: '2026-02',
      licence: 'Licence ODbL — attribution « © OpenStreetMap contributors »',
      dateReference: '28 février 2026',
      datePublication: '6 août 2026',
    })
    expect(snapshot?.themes).toEqual(['mobilite'])
  })
})

describe('sourcesMethodes — la dégradation gracieuse', () => {
  it('une source sans ligne vintages en direct rend ses faits éditoriaux, jamais des dates inventées', () => {
    // logements est dans le registre mais absent des vintages de ce payload
    const vintages = vintagesFixture.filter((v) => v.id !== 'logements')
    const { lignes } = sourcesMethodes(payloadAvec(vintages))

    const logements = lignes.find((l) => l.id === 'logements')
    expect(logements).toMatchObject({
      nom: 'INSEE — Logements (dossier complet)',
      editeur: 'INSEE',
      version: null,
      licence: null,
      dateReference: null,
      datePublication: null,
    })
  })

  it('une date de référence null (base roulante) reste null — jamais complétée', () => {
    // l'id epci porte date_publication null dans la fixture (pas encore mise en ligne)
    const { lignes } = sourcesMethodes(payloadAvec(vintagesFixture))

    const epci = lignes.find((l) => l.id === 'epci')
    expect(epci?.datePublication).toBeNull()
    expect(epci?.dateReference).toBe('1 janvier 2025')
  })
})

describe('sourcesMethodes — vintages absents (404)', () => {
  it('signale l\u2019absence et rend une ligne honnête par source — la page ne casse pas', () => {
    const { lignes, vintagesAbsents } = sourcesMethodes(payloadAvec(null))

    expect(vintagesAbsents).toBe(true)
    expect(lignes.length).toBe(Object.keys(SOURCES_METHODES).length)
    for (const ligne of lignes) {
      expect(ligne.version).toBeNull()
      expect(ligne.licence).toBeNull()
      expect(ligne.dateReference).toBeNull()
      expect(ligne.datePublication).toBeNull()
      expect(ligne.editeur.length).toBeGreaterThan(0)
    }
  })
})
