import { describe, expect, it } from 'vitest'

import {
  LIEN_SUBVENTIONS,
  NOMS_PROGRAMMES,
  formaterMontant,
  formaterPartContexte,
  libelleBadge,
  libellePartContexte,
  libelleProvenance,
  nomProgramme,
  phraseVoix,
} from '../fiche/programmesAffichage'
import type { BadgeProgramme } from '../payload/selectors'

/**
 * Le vocabulaire d'affichage du thème Programmes et subventions (#408 —
 * fiche/programmesAffichage.ts, l'héritière de l'ancien élément d'Aperçu).
 * Ces épingles unitaires verrouillent les bords de formatage et les formes de
 * voix qui décrivent un comportement VIVANT du bloc : le seuil M€, la part à
 * deux décimales, les pluriels des verbes honnêtes, l'expansion accessible
 * complète d'un badge et le lien portail Région.
 */

function badge(voix: BadgeProgramme['voix'], sigle: BadgeProgramme['sigle'], noms: string[], conventionValantOrt = false): BadgeProgramme {
  return { sigle, voix, noms, conventionValantOrt, vintage: '' }
}

describe('formaterMontant — les figures de subventions en euros', () => {
  it('reste en euros sous le million — séparateur milliers fin, jamais de décimales', () => {
    expect(formaterMontant(30000)).toBe('30\u202F000 €')
    expect(formaterMontant(999999)).toBe('999\u202F999 €')
    expect(formaterMontant(0)).toBe('0 €')
  })

  it('bascule en millions À PARTIR de 1 000 000 € — deux décimales, jamais tronquées (#305)', () => {
    expect(formaterMontant(1_000_000)).toBe('1,00 M€')
    expect(formaterMontant(7_725_740)).toBe('7,73 M€')
    expect(formaterMontant(1_999_999)).toBe('2,00 M€')
    expect(formaterMontant(1_234_567)).toBe('1,23 M€')
  })
})

describe('formaterPartContexte — la part de contexte de la fiche (issue #305)', () => {
  it('rend une fraction [0,1] en « X,YY % » — deux décimales, jamais tronquées', () => {
    expect(formaterPartContexte(0.94186)).toBe('94,19 %')
    expect(formaterPartContexte(1)).toBe('100,00 %')
  })

  it('nomme les cibles possibles de la part', () => {
    expect(libellePartContexte('epci')).toBe("du total de l'EPCI")
    expect(libellePartContexte('region')).toBe('du total de la région')
  })
})

describe('phraseVoix — le verbe honnête de chaque ancrage (PRD #162-13)', () => {
  it('la commune est LAURÉATE de son label ; le contrat COUVRE son territoire', () => {
    expect(phraseVoix(badge('laureate', 'ACV', []))).toBe('Commune lauréate du programme')
    expect(phraseVoix(badge('couverte', 'CRTE', []))).toBe('Territoire couvert par le contrat')
  })

  it('le portage s\u2019accorde au nombre des communes nommées', () => {
    expect(phraseVoix(badge('porte', 'ACV', ['Lorient']))).toBe('Porte le programme sur 1 commune')
    expect(phraseVoix(badge('porte', 'PVD', ['Hennebont', 'Languidic', 'Plouay']))).toBe(
      'Porte le programme sur 3 communes',
    )
  })

  it('l\u2019agrégat COMPTE — les pluriels par sigle, contrats et périmètres compris', () => {
    expect(phraseVoix(badge('compte', 'CRTE', ['EPCI X']))).toBe('Compte 1 contrat signé')
    expect(phraseVoix(badge('compte', "Territoires d'industrie", ['EPCI X', 'EPCI Z']))).toBe(
      'Compte 2 contrats signés',
    )
    expect(phraseVoix(badge('compte', 'PVD', ['Hennebont']))).toBe('Compte 1 commune lauréate')
    expect(phraseVoix(badge('compte', 'ORT', ['Commune B', 'Commune F']))).toBe(
      'Compte 2 communes en périmètre ORT',
    )
  })

  it('le badge-outil ORT lit la convention signée — couvert ou dans le périmètre', () => {
    expect(phraseVoix(badge('ort', 'ORT', ['Commune B']))).toBe(
      'Territoire couvert par une convention ORT signée',
    )
    expect(phraseVoix(badge('ort', 'ORT', []))).toBe(
      "Dans le périmètre d'une convention ORT signée",
    )
  })
})

describe('libelleBadge — l\u2019expansion accessible complète d\u2019un badge', () => {
  it('enchaîne sigle, nom complet, voix, liste nommée et rider « convention valant ORT »', () => {
    const acv = badge('laureate', 'ACV', [], true)
    expect(libelleBadge(acv)).toBe(
      'ACV — Action Cœur de Ville · Commune lauréate du programme · convention valant ORT',
    )

    const crte = badge('couverte', 'CRTE', ['EPCI X'])
    expect(libelleBadge(crte)).toBe(
      'CRTE — Contrat de Relance et de Transition Écologique · '
        + 'Territoire couvert par le contrat : EPCI X',
    )

    const ort = badge('ort', 'ORT', [])
    expect(libelleBadge(ort)).toBe(
      'ORT — Opération de revitalisation de territoire · '
        + "Dans le périmètre d'une convention ORT signée",
    )
  })
})

describe('NOMS_PROGRAMMES — la vocabulaire des badges reste dans l\u2019app (ADR-0013)', () => {
  it('donne à chaque sigle son nom officiel complet', () => {
    expect(nomProgramme('ACV')).toBe('Action Cœur de Ville')
    expect(nomProgramme('PVD')).toBe('Petites Villes de Demain')
    expect(nomProgramme('CRTE')).toBe('Contrat de Relance et de Transition Écologique')
    // le sigle provisoire — le programme est officiellement nommé sans acronyme
    expect(nomProgramme("Territoires d'industrie")).toBe("Territoires d'industrie")
    expect(nomProgramme('ORT')).toBe('Opération de revitalisation de territoire')
    expect(Object.keys(NOMS_PROGRAMMES)).toHaveLength(5)
  })
})

describe('LIEN_SUBVENTIONS — le portail officiel des aides de la Région', () => {
  it('pointe data.bretagne.bzh avec son libellé public', () => {
    expect(LIEN_SUBVENTIONS.href).toBe('https://www.bretagne.bzh/aides/')
    expect(LIEN_SUBVENTIONS.libelle).toBe('Subventions de la Région Bretagne')
  })
})

describe('libelleProvenance — le texte du lien de provenance (issue #305)', () => {
  it('nomme les communes du niveau agrégé', () => {
    expect(libelleProvenance('epci')).toBe("communes de l'EPCI")
    expect(libelleProvenance('departement')).toBe('communes du département')
    expect(libelleProvenance('region')).toBe('communes de Bretagne')
  })
})
