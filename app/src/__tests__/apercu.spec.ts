import { describe, expect, it } from 'vitest'

import {
  LIEN_SUBVENTIONS,
  NOMS_PROGRAMMES,
  formaterMontant,
  formaterValeurApercu,
  libelleApercu,
  libelleBadge,
  libelleProgramme,
  nomProgramme,
  phraseVoix,
} from '../fiche/apercu'
import type { Programme } from '../fiche/apercu'
import { apercuFixture } from '../payload/fixtures'
import type { ApercuRow } from '../payload/types'
import type { BadgeProgramme } from '../payload/selectors'

/**
 * The Aperçu tab's display vocabulary (app/src/fiche/apercu.ts) — the French
 * labels and the number formatting that turns the pipeline's apercu rows into
 * the figures the tab renders (CONTEXT.md §Aperçu). The pipeline stores
 * percentages as fractions in [0,1] (unit « % », value 0.15 = 15 %) — the
 * formatter's job is to say 15, never 0,15. Labels match the pipeline's own
 * declared libellés (theme_demographie.R §APERCU_DEMOGRAPHIE).
 */

const ligne = (key: string, value: number, unit: string): ApercuRow => ({
  territoire: '22001',
  type: 'commune',
  key,
  value,
  unit,
})

describe('formaterValeurApercu — the basic-stat figures', () => {
  it('formats a population with the French thousand separator', () => {
    expect(formaterValeurApercu(ligne('population', 2000, 'hab.'))).toBe('2\u202F000 hab.')
  })

  it('keeps the unit on the figure', () => {
    expect(formaterValeurApercu(ligne('densite', 200, 'hab/km²'))).toBe('200 hab/km²')
  })

  it('reads percentages as fractions: 0.15 → « 15 % »', () => {
    expect(formaterValeurApercu(ligne('part_65_plus', 0.15, '%'))).toBe('15 %')
  })

  it('rounds non-integer figures to a readable whole number', () => {
    expect(formaterValeurApercu(ligne('densite', 133.33333333333334, 'hab/km²'))).toBe(
      '133 hab/km²',
    )
  })

  it('renders an empty string for a null value — never a phantom figure', () => {
    expect(formaterValeurApercu({ ...ligne('part_65_plus', 0.15, '%'), value: null })).toBe('')
  })

  it('rounds a fractional percentage to the nearest whole per cent', () => {
    expect(formaterValeurApercu(ligne('part_65_plus', 0.19285714285714287, '%'))).toBe('19 %')
  })

  it('formats the fixture rows the R contract locked (population 22001 = 2000)', () => {
    const population = apercuFixture.find(
      (r) => r.territoire === '22001' && r.key === 'population',
    )
    expect(population).toBeDefined()
    expect(formaterValeurApercu(population!)).toBe('2\u202F000 hab.')
  })
})

describe('libelleApercu — the French label registry', () => {
  it('labels the pipeline keys with the pipeline’s own declared labels', () => {
    expect(libelleApercu('population')).toBe('Population')
    expect(libelleApercu('densite')).toBe('Densité de population')
    expect(libelleApercu('part_65_plus')).toBe('Part des 65 ans et plus')
  })

  it('falls back to the raw key for an undeclared key — never a blank label', () => {
    expect(libelleApercu('cle_inconnue')).toBe('cle_inconnue')
  })
})

describe('Programme — the programmes & financements element (CONTEXT.md)', () => {
  it('expands a programme to « sigle — nom » for its accessible name', () => {
    const acv: Programme = { sigle: 'ACV', nom: 'Action Cœur de Ville' }
    expect(libelleProgramme(acv)).toBe('ACV — Action Cœur de Ville')
  })

  it('keeps a programme without a distinct sigle as itself', () => {
    const programme: Programme = { sigle: "Territoires d'industrie", nom: "Territoires d'industrie" }
    expect(libelleProgramme(programme)).toBe("Territoires d'industrie")
  })

  it('points the Région subventions link at the Région Bretagne aides portal', () => {
    expect(LIEN_SUBVENTIONS.href).toBe('https://www.bretagne.bzh/aides/')
    expect(LIEN_SUBVENTIONS.libelle).toBe('Subventions de la Région Bretagne')
  })
})

describe('NOMS_PROGRAMMES — la vocabulaire des badges reste dans l’app (PRD #162)', () => {
  it('déplie chaque sigle vers son nom français complet', () => {
    expect(NOMS_PROGRAMMES.ACV).toBe('Action Cœur de Ville')
    expect(NOMS_PROGRAMMES.PVD).toBe('Petites Villes de Demain')
    expect(NOMS_PROGRAMMES.CRTE).toBe('Contrat de Relance et de Transition Écologique')
    expect(NOMS_PROGRAMMES.ORT).toBe('Opération de revitalisation de territoire')
  })

  it('garde le programme sans acronyme comme lui-même — « Territoires d’industrie »', () => {
    expect(nomProgramme("Territoires d'industrie")).toBe("Territoires d'industrie")
  })

  it('couvre EXACTEMENT les cinq sigles du contrat payload', () => {
    expect(Object.keys(NOMS_PROGRAMMES).sort()).toEqual([
      'ACV',
      'CRTE',
      'ORT',
      'PVD',
      "Territoires d'industrie",
    ])
  })
})

describe('phraseVoix — le verbe honnête de chaque ancrage (PRD #162-13)', () => {
  const badge = (voix: BadgeProgramme['voix'], sigle: BadgeProgramme['sigle'], noms: string[]): BadgeProgramme =>
    ({ sigle, voix, noms, conventionValantOrt: false, vintage: 'x' })

  it('la commune est lauréate de son label', () => {
    expect(phraseVoix(badge('laureate', 'ACV', []))).toBe('Commune lauréate du programme')
  })

  it('le territoire est couvert par le contrat — commune par son EPCI, EPCI par son contrat', () => {
    expect(phraseVoix(badge('couverte', 'CRTE', []))).toBe('Territoire couvert par le contrat')
  })

  it('l’EPCI porte le programme sur ses communes labellisées (le pluriel suit la liste)', () => {
    expect(phraseVoix(badge('porte', 'ACV', ['Lorient']))).toBe('Porte le programme sur 1 commune')
    expect(phraseVoix(badge('porte', 'PVD', ['Hennebont', 'Languidic', 'Plouay']))).toBe(
      'Porte le programme sur 3 communes',
    )
  })

  it('le département/région compte les contrats, les labels et l’ORT avec leurs pluriels', () => {
    expect(phraseVoix(badge('compte', 'CRTE', ['EPCI X']))).toBe('Compte 1 contrat signé')
    expect(phraseVoix(badge('compte', "Territoires d'industrie", ['EPCI X', 'EPCI Z']))).toBe(
      'Compte 2 contrats signés',
    )
    expect(phraseVoix(badge('compte', 'PVD', ['Hennebont']))).toBe('Compte 1 commune lauréate')
    expect(phraseVoix(badge('compte', 'ORT', ['Commune B', 'Commune F']))).toBe(
      'Compte 2 communes en périmètre ORT',
    )
  })

  it('le badge-outil ORT lit le périmètre de la convention signée', () => {
    expect(phraseVoix(badge('ort', 'ORT', []))).toBe(
      "Dans le périmètre d'une convention ORT signée",
    )
  })
})

describe('libelleBadge — l’expansion accessible complète d’un badge', () => {
  it('compose sigle — nom · voix · liste nommée · rider', () => {
    const acv: BadgeProgramme = {
      sigle: 'ACV',
      voix: 'laureate',
      noms: [],
      conventionValantOrt: true,
      vintage: 'x',
    }
    expect(libelleBadge(acv)).toBe(
      'ACV — Action Cœur de Ville · Commune lauréate du programme · convention valant ORT',
    )
  })

  it('nomme la liste COMPLÈTE dans l’expansion — jamais tronquée pour l’accessibilité', () => {
    const crte: BadgeProgramme = {
      sigle: 'CRTE',
      voix: 'compte',
      noms: ['EPCI X', 'EPCI Z'],
      conventionValantOrt: false,
      vintage: 'x',
    }
    expect(libelleBadge(crte)).toBe(
      'CRTE — Contrat de Relance et de Transition Écologique · Compte 2 contrats signés : EPCI X, EPCI Z',
    )
  })

  it('n’ajoute ni liste ni rider quand ils n’existent pas', () => {
    const ort: BadgeProgramme = {
      sigle: 'ORT',
      voix: 'ort',
      noms: [],
      conventionValantOrt: false,
      vintage: 'x',
    }
    expect(libelleBadge(ort)).toBe(
      "ORT — Opération de revitalisation de territoire · Dans le périmètre d'une convention ORT signée",
    )
  })
})

describe('formaterMontant — les figures de subventions en euros', () => {
  it('formate un montant avec le séparateur de milliers français sous le seuil du million', () => {
    expect(formaterMontant(30000)).toBe('30\u202F000 €')
    expect(formaterMontant(999999)).toBe('999\u202F999 €')
  })

  it('bascule en millions au seuil des 1 000 000 € — « X,XX M€ », deux décimales (issue #305)', () => {
    expect(formaterMontant(1000000)).toBe('1,00 M€')
    expect(formaterMontant(7725740)).toBe('7,73 M€')
  })

  it('arrondit le million au centime près', () => {
    expect(formaterMontant(1999999)).toBe('2,00 M€')
    expect(formaterMontant(1234567)).toBe('1,23 M€')
  })
})
