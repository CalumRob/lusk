import { describe, expect, it } from 'vitest'

import { groupesCouchesCarte } from '../fiche/content/ficheGrammar'
import { THEMES_CANONIQUES } from '../payload/types'
import { nativeResources } from './helpers/semanticApiFixtures'
import { PRODUCER_THEME_METADATA } from './helpers/producerThemeMetadata'

describe('groupement éditorial des couches carte', () => {
  it('projette l’ordre des lectures et indicateurs depuis la grammaire partagée', () => {
    expect(groupesCouchesCarte('mobilite')).toEqual([
      { key: 'acces-aux-services', label: 'L’accès aux services', storyFields: [], resourceKeys: [] },
      {
        key: 'partage-de-lespace-public',
        label: 'Le partage de l’espace public',
        storyFields: [],
        resourceKeys: [
          'reseaux', 'reseaux_par_habitant', 'surface_reseaux_routiers', 'places_stationnement_velo_1000',
          'places_stationnement_voiture_1000', 'stationnement_velo_par_voiture', 'offre_cyclable',
        ],
      },
      {
        key: 'motorisation', label: 'La motorisation', storyFields: [],
        resourceKeys: ['voitures_menage', 'bornes_recharge', 'bornes_ev_par_station_service'],
      },
      {
        key: 'offre-transports-commun', label: 'L’offre de transports en commun', storyFields: [],
        resourceKeys: ['offre_tc', 'raccordement_tc', 'raccordement_courbe', 'raccordement_reference'],
      },
    ])
  })

  it('retains declared reading-field order and subgroup labels without resolving values', () => {
    expect(groupesCouchesCarte('demographie')).toEqual([
      {
        key: 'etat-de-la-population',
        label: 'État de la population',
        storyFields: [],
        resourceKeys: ['densite', 'structure_age', 'taille_menages'],
      },
      {
        key: 'trajectoire-demographique',
        label: 'Trajectoire démographique',
        storyFields: ['taux_solde_naturel', 'taux_solde_migratoire'],
        resourceKeys: ['evolution_1968'],
      },
    ])
  })

  it('binds resource-key ordering to current API discovery without declaring map eligibility', () => {
    for (const theme of THEMES_CANONIQUES) {
      const discoveryIds = new Set(nativeResources(theme).map((resource) => resource.resource_id))
      for (const group of groupesCouchesCarte(theme)) {
        for (const key of group.resourceKeys) expect(discoveryIds.has(key), `${theme}/${key}`).toBe(true)
      }
    }

    const mobilityGroups = groupesCouchesCarte('mobilite')
    expect(JSON.stringify(mobilityGroups)).not.toMatch(/map_layers|availability|eligible|status/i)
    expect(PRODUCER_THEME_METADATA.mobilite.map_layers.raccordement_courbe).toBe(false)
    expect(mobilityGroups.flatMap((group) => group.resourceKeys)).toContain('raccordement_courbe')
  })
})
