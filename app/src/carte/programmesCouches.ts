/**
 * Le modèle de couches de l'onglet « Programmes & financements » de la carte
 * (ADR-0019 #282) — la carte, miroir de la fiche, appliquée au payload
 * programmes (ADR-0013). Level-native : les couches d'adhésion (highlight
 * catégoriel in/out) n'existent qu'à leur niveau d'ancrage — ACV · PVD · ORT
 * à la commune, CRTE · Territoires d'industrie · ORT à l'EPCI — AUCUNE au
 * département (pas de lignes là-bas : l'absence honnête, jamais inventée) ;
 * la couche subventions (le total € par territoire, somme des lignes
 * d'agrégat) existe à TOUS les niveaux. L'ordre des sigles est l'ordre
 * canonique du contrat (SIGLES_PROGRAMMES), jamais une liste carte-side.
 */

import type { NiveauMasque } from '../geo/types'
import type { Payload, SigleProgramme, TerritoireType } from '../payload/types'
import { SIGLES_PROGRAMMES } from '../payload/types'

/** Une couche de l'onglet programmes — le source discriminate le paint
 *  (catégoriel in/out pour « membre », choroplèthe pour « subvention »). */
export type CoucheProgramme =
  | { source: 'membre'; sigle: SigleProgramme; libelle: string; niveau: NiveauMasque }
  | { source: 'subvention'; libelle: string }

/** L'ancrage des lignes d'adhésion d'un niveau de masque (ADR-0013) :
 *  communes → lignes communales, EPCIs → lignes EPCI, départements → null
 *  (aucune ligne d'adhésion à ce niveau — l'absence honnête). */
export function typeAdhesionDuNiveau(niveau: NiveauMasque): 'commune' | 'epci' | null {
  if (niveau === 'communes') return 'commune'
  if (niveau === 'epcis') return 'epci'
  return null
}

/** Le type des lignes d'agrégat de subventions d'un niveau de masque — les
 *  agrégats existent à chaque niveau (la région n'a pas de masque sur la
 *  carte : ses lignes ne sont pas rendues, pas inventées). */
export function typeSubventionsDuNiveau(niveau: NiveauMasque): TerritoireType {
  if (niveau === 'communes') return 'commune'
  if (niveau === 'epcis') return 'epci'
  return 'departement'
}

/**
 * Les sigles d'adhésion qui ont des lignes à un niveau (l'ordre canonique du
 * contrat filtré par la présence — jamais un sigle mort). Vide au département.
 */
export function siglesMembresDuNiveau(payload: Payload, niveau: NiveauMasque): SigleProgramme[] {
  const type = typeAdhesionDuNiveau(niveau)
  if (!type) return []
  const presents = new Set<SigleProgramme>()
  for (const membre of payload.programmes?.membres ?? []) {
    if (membre.type === type) presents.add(membre.sigle)
  }
  return SIGLES_PROGRAMMES.filter((sigle) => presents.has(sigle))
}

function subventionsPresentes(payload: Payload, niveau: NiveauMasque): boolean {
  const type = typeSubventionsDuNiveau(niveau)
  return (payload.programmes?.subventions ?? []).some((ligne) => ligne.type === type)
}

/**
 * Le jeu de couches de l'onglet à un niveau : les couches d'adhésion du
 * niveau (chaque sigle est UNE couche — on choisit le sigle, les territoires
 * couverts s'allument) puis la couche subventions (le total €, à tous les
 * niveaux). Une couche n'est proposée que si le payload porte ses lignes.
 */
export function couchesProgrammes(payload: Payload, niveau: NiveauMasque): CoucheProgramme[] {
  const couches: CoucheProgramme[] = []
  for (const sigle of siglesMembresDuNiveau(payload, niveau)) {
    couches.push({ source: 'membre', sigle, libelle: sigle, niveau })
  }
  if (subventionsPresentes(payload, niveau)) {
    couches.push({ source: 'subvention', libelle: 'Subventions totales' })
  }
  return couches
}

/**
 * La couche par défaut de l'onglet : les subventions (le total € existe à
 * chaque niveau — l'ancre « à tous les niveaux » de l'onglet), sinon la
 * première couche d'adhésion du niveau, sinon null (pas de programmes).
 */
export function coucheParDefautProgrammes(
  payload: Payload,
  niveau: NiveauMasque,
): CoucheProgramme | null {
  const couches = couchesProgrammes(payload, niveau)
  return couches.find((couche) => couche.source === 'subvention') ?? couches[0] ?? null
}
