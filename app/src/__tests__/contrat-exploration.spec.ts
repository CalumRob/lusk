import { describe, expect, it } from 'vitest'

import {
  NIVEAUX_COMPARABLES,
  PARAM_NIVEAU,
  PARAM_TERRITOIRE,
  PARAM_THEME,
  emporterTerritoire,
  estNiveauComparable,
  lienFiche,
  lireTerritoirePorte,
  routeIndicateur,
} from '../fiche/contratExploration'

/**
 * Le contrat d'exploration (#505) — LA couture unique de la passarelle Fiche
 * d'identité ↔ Page d'indicateur (ADR-0024) : les noms des paramètres de
 * query, l'ensemble des niveaux comparables (la Région ne porte JAMAIS de
 * niveau) et les constructeurs de liens dans les deux sens. Le comportement
 * des quatre sites consommateurs est déjà verrouillé mot pour mot par les
 * specs existantes (exploration-handoff.spec.ts, indicateur-view.spec.ts,
 * contexte-switcher.spec.ts, router.spec.ts) ; celles-ci verrouillent le
 * contrat lui-même — paramètres portés, thème préservé, format canonique.
 */

describe('contratExploration — le vocabulaire de la passarelle', () => {
  it('possède les trois noms de paramètres de query de la couture', () => {
    expect(PARAM_TERRITOIRE).toBe('territoire')
    expect(PARAM_NIVEAU).toBe('niveau')
    expect(PARAM_THEME).toBe('theme')
  })

  it('déclare les niveaux comparables UNE fois, du plus fin au plus large', () => {
    expect([...NIVEAUX_COMPARABLES]).toEqual(['commune', 'epci', 'departement'])
  })

  it('exclut la Région de la comparaison — elle ne porte jamais de niveau', () => {
    expect(estNiveauComparable('region')).toBe(false)
    expect(estNiveauComparable('commune')).toBe(true)
    expect(estNiveauComparable('epci')).toBe(true)
    expect(estNiveauComparable('departement')).toBe(true)
  })

  it('refuse un niveau hors contrat ou non-chaîne', () => {
    expect(estNiveauComparable('bretagne')).toBe(false)
    expect(estNiveauComparable(undefined)).toBe(false)
    expect(estNiveauComparable(null)).toBe(false)
    expect(estNiveauComparable(42)).toBe(false)
    expect(estNiveauComparable(['commune'])).toBe(false)
  })
})

describe('emporterTerritoire — ce que la fiche emporte vers la page', () => {
  it('porte le territoire et son niveau quand il est comparable', () => {
    expect(emporterTerritoire({ territoire: '22001', type: 'commune' })).toEqual({
      territoire: '22001',
      niveau: 'commune',
    })
  })

  it('porte le territoire SEUL pour la Région — la page résout son repli honnête', () => {
    const etat = emporterTerritoire({ territoire: '53', type: 'region' })
    expect(etat).toEqual({ territoire: '53' })
    expect('niveau' in etat).toBe(false)
  })

  it('ne porte rien sans territoire', () => {
    expect(emporterTerritoire(null)).toEqual({})
    expect(emporterTerritoire(undefined)).toEqual({})
  })

  it('écrit territoire avant niveau — l’ordre de sérialisation du href', () => {
    // Le href résolu de la passarelle sérialise ?territoire=…&niveau=… ;
    // l'ordre d'insertion des clés EST le comportement observable.
    expect(Object.keys(emporterTerritoire({ territoire: '22001', type: 'commune' }))).toEqual([
      'territoire',
      'niveau',
    ])
  })
})

describe('routeIndicateur — le constructeur fiche → Page d’indicateur', () => {
  it('construit la route nommée avec le territoire et son niveau explicites', () => {
    expect(routeIndicateur('demographie', 'densite', { territoire: '22001', type: 'commune' })).toEqual({
      name: 'indicateur',
      params: { theme: 'demographie', indicator: 'densite' },
      query: { territoire: '22001', niveau: 'commune' },
    })
  })

  it('construit la route de la Région sans niveau', () => {
    expect(routeIndicateur('demographie', 'densite', { territoire: '53', type: 'region' })).toEqual({
      name: 'indicateur',
      params: { theme: 'demographie', indicator: 'densite' },
      query: { territoire: '53' },
    })
  })

  it('construit une route sans query hors mise en avant', () => {
    expect(routeIndicateur('habitat', 'statut', null)).toEqual({
      name: 'indicateur',
      params: { theme: 'habitat', indicator: 'statut' },
      query: {},
    })
  })
})

describe('lireTerritoirePorte — ce que la page lit de l’URL', () => {
  it('lit le territoire porté et son niveau comparable', () => {
    expect(lireTerritoirePorte({ territoire: '22001', niveau: 'commune' })).toEqual({
      territoire: '22001',
      niveau: 'commune',
    })
  })

  it('conserve le territoire quand le niveau porté est hors contrat', () => {
    expect(lireTerritoirePorte({ territoire: '53', niveau: 'region' })).toEqual({
      territoire: '53',
      niveau: undefined,
    })
  })

  it('rejette des valeurs non-chaînes — jamais un tableau répété ne passe pour une chaîne', () => {
    expect(lireTerritoirePorte({ territoire: ['22001'], niveau: ['commune'] })).toEqual({
      territoire: undefined,
      niveau: undefined,
    })
  })

  it('lit un état vide sans paramètres', () => {
    expect(lireTerritoirePorte({})).toEqual({ territoire: undefined, niveau: undefined })
  })
})

describe('lienFiche — le retour de la page vers la fiche', () => {
  it('construit le chemin canonique de la fiche', () => {
    expect(lienFiche({ territoire: '22001', type: 'commune' })).toBe('/territoire/commune/22001')
  })

  it('préserve le thème actif dans la query — jamais un aller sans retour', () => {
    expect(lienFiche({ territoire: '200000001', type: 'epci' }, 'mobilite')).toBe(
      '/territoire/epci/200000001?theme=mobilite',
    )
    expect(lienFiche({ territoire: '29', type: 'departement' }, 'demographie')).toBe(
      '/territoire/departement/29?theme=demographie',
    )
  })
})
