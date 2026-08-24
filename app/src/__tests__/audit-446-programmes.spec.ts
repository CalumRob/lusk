import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { mount, RouterLinkStub } from '@vue/test-utils'
import { beforeAll, describe, expect, it } from 'vitest'

import ApercuOnglet from '../components/fiche/ApercuOnglet.vue'
import { NOMS_PROGRAMMES, libelleBadge } from '../fiche/apercu'
import { VOCABULAIRE_PROGRAMMES } from '../methodes/programmes'
import { chargerPayload } from '../payload/loader'
import { programmesPourTerritoire } from '../payload/selectors'
import type { Payload } from '../payload/types'

/**
 * Audit #446 — noms développés et détail des subventions (l'élément
 * Programmes et subventions). CE FICHIER EST UNE PIÈCE D'AUDIT, pas une
 * spécification produit : il épingle l'état PUBLIÉ (programmes.json commité)
 * et le comportement ACTUEL de la chaîne payload → sélecteur → rendu, sur des
 * exemples répétables de données réelles, pour prouver les constats du
 * rapport docs/audits/2026-08-24-audit-446-programmes-noms-subventions.md :
 *
 *   A — le payload publié : les adhésions portent le SIGLE seul (aucun nom
 *       développé nulle part dans programmes.json) ; le détail des subventions
 *       par domaine n'existe QU'au niveau communal — EPCI/département/région
 *       ne publient qu'un total annuel (contrat ADR-0013/#305).
 *   B — la dérivation en échelle (selectors.programmesPourTerritoire) sur six
 *       exemples réels : commune riche (Lorient), commune PVD seule
 *       (Hennebont), commune non labellisée en périmètre ORT (Lanvallay),
 *       EPCI contrats + portage nommé (Lorient Agglomération), EPCI tout
 *       programme (Dinan Agglomération), états d'absence honnêtes (Aucaleuc,
 *       Pays d'Iroise), l'agrégat départemental (22).
 *   C — le vocabulaire des noms développés vit CÔTÉ APP, en DEUX exemplaires
 *       identiques (fiche/apercu.NOMS_PROGRAMMES et methodes/VOCABULAIRE_
 *       PROGRAMMES) — la couture de duplication documentée au rapport.
 *   D — la couture de rendu : la puce visible porte le sigle SEUL ; le nom
 *       développé n'existe que dans l'aria-label (et sur /methodologie) ;
 *       le détail communal se plie top-5 + révélation, l'EPCI n'affiche que
 *       son total.
 *
 * Les assertions D décrivent le présent : elles BOUGERONT avec le correctif
 * des noms développés et avec la migration sixième thème (#408) — c'est
 * voulu, une pièce d'audit se met à jour quand ce qu'elle audite change.
 */

const dataDir = join(process.cwd(), '..', 'public', 'data')

function chargerPayloadCommite(): Promise<Payload> {
  const fichiers: Record<string, unknown> = {}
  for (const nom of ['territoires.json', 'run-report.json', 'vintages.json', 'programmes.json']) {
    fichiers[nom] = JSON.parse(readFileSync(join(dataDir, nom), 'utf-8'))
  }
  return chargerPayload({
    baseUrl: 'data/',
    fetchImpl: async (url: string) => {
      const nom = url.split('/').pop() ?? url
      if (nom in fichiers) {
        return { ok: true, status: 200, json: async () => fichiers[nom] }
      }
      return {
        ok: false,
        status: 404,
        json: async () => {
          throw new Error('404')
        },
      }
    },
  })
}

let payloadCommite: Payload | null = null

beforeAll(async () => {
  payloadCommite = await chargerPayloadCommite()
})

function obtenir(): Payload {
  if (payloadCommite === null) throw new Error('payload non chargé (beforeAll)')
  return payloadCommite
}

function monter(territoire: string): ReturnType<typeof mount> {
  return mount(ApercuOnglet, {
    props: { payload: obtenir(), territoire },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
}

// ------------------------------------------------------------------
// A — le payload publié (programmes.json commité)
// ------------------------------------------------------------------

describe('audit #446 A — le payload publié', () => {
  it('les adhésions : 253 lignes, ancrées à leur niveau (le sigle seul, jamais un nom)', () => {
    const membres = obtenir().programmes!.membres
    expect(membres).toHaveLength(253)

    const comptes: Record<string, number> = {}
    for (const m of membres) {
      const clef = `${m.sigle}/${m.type}`
      comptes[clef] = (comptes[clef] ?? 0) + 1
    }
    expect(comptes).toEqual({
      'ACV/commune': 11,
      'PVD/commune': 135,
      'CRTE/epci': 58,
      "Territoires d'industrie/epci": 32,
      'ORT/commune': 11,
      'ORT/epci': 6,
    })

    // la ligne d'adhésion porte le sigle et son vintage — AUCUN champ de nom
    for (const m of membres) {
      expect(Object.keys(m).sort()).toEqual([
        'convention_valant_ort',
        'sigle',
        'territoire',
        'type',
        'vintage_date_publication',
        'vintage_date_reference',
        'vintage_source',
        'vintage_version',
      ])
    }
  })

  it('les subventions : 2 444 lignes, année unique 2025', () => {
    const subventions = obtenir().programmes!.subventions
    expect(subventions).toHaveLength(2444)
    expect(new Set(subventions.map((s) => s.annee))).toEqual(new Set([2025]))
  })

  it('le détail par domaine N’EXISTE qu’au niveau communal — les agrégats ne publient qu’un total', () => {
    const subventions = obtenir().programmes!.subventions

    const communales = subventions.filter((s) => s.type === 'commune')
    expect(communales).toHaveLength(2378)
    // chaque ligne communale PORTE un domaine (39 distincts)
    for (const s of communales) expect(s.programme_libl).not.toBeNull()
    expect(new Set(communales.map((s) => s.programme_libl)).size).toBe(39)

    // chaque ligne agrégat (EPCI/département/région) est un TOTAL SANS domaine
    for (const s of subventions.filter((s) => s.type !== 'commune')) {
      expect(s.programme_libl).toBeNull()
    }
    expect(subventions.filter((s) => s.type === 'epci')).toHaveLength(61)
    expect(subventions.filter((s) => s.type === 'departement')).toHaveLength(4)
    expect(subventions.filter((s) => s.type === 'region')).toHaveLength(1)
  })

  it('aucun nom développé de programme n’existe comme TEL dans programmes.json', () => {
    const brut = readFileSync(join(dataDir, 'programmes.json'), 'utf-8')
    // les noms produits vivent côté app (NOMS_PROGRAMMES) — le payload ne
    // porte jamais la forme canonique du nom
    expect(brut).not.toContain('Action Cœur de Ville')
    expect(brut).not.toContain('Petites Villes de Demain')
    expect(brut).not.toContain('Contrat de Relance et de Transition Écologique')
    expect(brut).not.toContain('Opération de revitalisation de territoire')
    // la SEULE trace d'un nom : les estampilles vintage citent le TITRE DU JEU
    // DE DONNÉES source (métadonnée de fraîcheur, pas un nom d'affichage)
    expect(brut).toContain('Programme Action cœur de ville')
    expect(brut).toContain('opérations de revitalisation de territoire')
  })

  it('TROIS communes seulement rendent l’élément vide — l’état « Aucun programme référencé. » est quasi-inatteint (données réelles)', () => {
    const payload = obtenir()
    const vides: string[] = []
    for (const t of payload.territoires) {
      if (t.type !== 'commune') continue
      const rendu = programmesPourTerritoire(payload, t.territoire)
      if (rendu.badges.length === 0 && rendu.subventions === null) vides.push(t.nom)
    }
    // constat d'audit : les trois communes du Pays d'Iroise sans badge propre,
    // sans couverture (l'EPCI ne porte aucun contrat) et sans subvention —
    // partout ailleurs, chaque fiche montre au moins un badge ou un montant
    expect(vides.sort()).toEqual(['Lanildut', 'Plourin', 'Trébabu'])
  })
})

// ------------------------------------------------------------------
// B — la dérivation en échelle sur les exemples répétables
// ------------------------------------------------------------------

describe('audit #446 B — programmesPourTerritoire sur données réelles', () => {
  it('Lorient (56121, commune) — ACV lauréate + rider valant ORT, couverte CRTE + TI, ventilation 33 domaines', () => {
    const rendu = programmesPourTerritoire(obtenir(), '56121')

    expect(rendu.badges.map((b) => b.sigle)).toEqual(['ACV', 'CRTE', "Territoires d'industrie"])
    expect(rendu.badges[0]).toMatchObject({
      voix: 'laureate',
      conventionValantOrt: true,
      noms: [],
    })
    const epciNom = "Communauté d'agglomération Lorient Agglomération"
    expect(rendu.badges[1]).toMatchObject({ sigle: 'CRTE', voix: 'couverte', noms: [epciNom] })

    const sv = rendu.subventions!
    expect(sv.annee).toBe(2025)
    expect(sv.total).toBeCloseTo(14_675_127.59, 2)
    expect(sv.axes).not.toBeNull()
    expect(sv.axes!).toHaveLength(33)
    // tri décroissant — la tête exacte
    expect(sv.axes![0]).toEqual({
      libelle: 'Formations sanitaires et sociales',
      montant: 3_471_660,
    })
    expect(sv.partContexte).toEqual({ part: sv.total / 25_245_637.55, parent: 'epci' })
    expect(sv.provenance).toBeNull()
  })

  it('Hennebont (56083, commune PVD dont la convention vaut ORT) — 13 domaines, rider sur son label', () => {
    const rendu = programmesPourTerritoire(obtenir(), '56083')

    expect(rendu.badges.map((b) => b.sigle)).toEqual(['PVD', 'CRTE', "Territoires d'industrie"])
    // PVD + convention signée → le rider « convention valant ORT » sur SON
    // label, jamais un second badge ORT (le contrat anti double-badge)
    expect(rendu.badges[0].conventionValantOrt).toBe(true)

    const sv = rendu.subventions!
    expect(sv.total).toBeCloseTo(2_339_392.53, 2)
    expect(sv.axes).toHaveLength(13)
    expect(sv.axes![0].libelle).toBe('Contractualisation avec les territoires')
  })

  it('Lanvallay (22118, commune NON labellisée en périmètre ORT signé) — couverture CRTE + TI puis le badge-outil ORT', () => {
    const rendu = programmesPourTerritoire(obtenir(), '22118')

    expect(rendu.badges.map((b) => [b.sigle, b.voix])).toEqual([
      ['CRTE', 'couverte'],
      ["Territoires d'industrie", 'couverte'],
      ['ORT', 'ort'],
    ])
    // une subvention communale existe (1 domaine) — l'état n'est pas vide
    expect(rendu.subventions).not.toBeNull()
  })

  it("Lorient Agglomération (200042174, EPCI) — ses deux contrats + le portage nommé ACV (Lorient) et PVD (Hennebont, Languidic, Plouay), le total SANS ventilation", () => {
    const rendu = programmesPourTerritoire(obtenir(), '200042174')

    expect(rendu.badges.map((b) => [b.sigle, b.voix])).toEqual([
      ['CRTE', 'couverte'],
      ["Territoires d'industrie", 'couverte'],
      ['ACV', 'porte'],
      ['PVD', 'porte'],
    ])
    // le portage nommé : la liste COMPLÈTE des communes labellisées membres
    expect(rendu.badges[2].noms).toEqual(['Lorient'])
    expect(rendu.badges[3].noms).toEqual(['Hennebont', 'Languidic', 'Plouay'])

    const sv = rendu.subventions!
    // le contrat #305 : l'EPCI ne publie qu'un total annuel — axes null
    expect(sv.axes).toBeNull()
    expect(sv.total).toBeCloseTo(25_245_637.55, 2)
    expect(sv.partContexte!.parent).toBe('region')
    expect(sv.provenance).toEqual({ niveau: 'epci', code: '200042174' })
  })

  it('Dinan Agglomération (200068989, EPCI) — contrats + portage PVD (5 communes) + ORT autonome (4 communes nommées)', () => {
    const rendu = programmesPourTerritoire(obtenir(), '200068989')

    expect(rendu.badges.map((b) => b.sigle)).toEqual([
      'CRTE',
      "Territoires d'industrie",
      'PVD',
      'ORT',
    ])
    const pvd = rendu.badges[2]
    expect(pvd.voix).toBe('porte')
    expect(new Set(pvd.noms)).toEqual(
      new Set(['Broons', 'Caulnes', 'Dinan', 'Matignon', 'Plancoët']),
    )
    const ort = rendu.badges[3]
    expect(ort.voix).toBe('ort')
    expect(new Set(ort.noms)).toEqual(new Set(['Lanvallay', 'Quévert', 'Taden', 'Trélivan']))
  })

  it('Aucaleuc (22003, commune sans programme propre ni subvention) — l’absence partielle honnête : seulement la couverture de SON EPCI', () => {
    const rendu = programmesPourTerritoire(obtenir(), '22003')

    // aucun badge propre (ni label, ni ORT) — mais les contrats de Dinan
    // Agglomération couvrent ses communes membres (la voix descendante)
    expect(rendu.badges.map((b) => [b.sigle, b.voix])).toEqual([
      ['CRTE', 'couverte'],
      ["Territoires d'industrie", 'couverte'],
    ])
    expect(rendu.badges.every((b) => b.noms[0] === "Communauté d'agglomération Dinan Agglomération")).toBe(true)
    // et AUCUNE subvention communale — pas de figure inventée
    expect(rendu.subventions).toBeNull()
  })

  it("Le Pays d'Iroise (242900074, EPCI sans contrat propre) — le portage PVD seul (Ploudalmézeau, Saint-Renan) + le total des communes", () => {
    const rendu = programmesPourTerritoire(obtenir(), '242900074')

    // aucune ligne CRTE/TI/ORT ancrée à cet EPCI — mais deux communes PVD,
    // donc le portage nommé remonte sur sa fiche
    expect(rendu.badges.map((b) => [b.sigle, b.voix])).toEqual([['PVD', 'porte']])
    expect(rendu.badges[0].noms).toEqual(['Ploudalmézeau', 'Saint-Renan'])

    expect(rendu.subventions).not.toBeNull()
    expect(rendu.subventions!.axes).toBeNull()
    expect(rendu.subventions!.total).toBeCloseTo(1_033_606.98, 2)
  })

  it("Cap Atlantique (244400610, EPCI sans AUCUN badge) — l'état badges-vide réel : total seul, aucune puce", () => {
    const rendu = programmesPourTerritoire(obtenir(), '244400610')

    // ni contrat propre, ni ORT, ni commune labellisée membre — zéro badge
    expect(rendu.badges).toEqual([])
    expect(rendu.subventions).not.toBeNull()
    expect(rendu.subventions!.axes).toBeNull()
    expect(rendu.subventions!.total).toBeCloseTo(153_350, 2)
  })

  it('Département 22 — l’agrégat compte : 11 CRTE, 7 TI, 2 ACV, 26 PVD, 4 ORT, tous nommés', () => {
    const rendu = programmesPourTerritoire(obtenir(), '22')

    expect(rendu.badges.map((b) => [b.sigle, b.voix])).toEqual([
      ['CRTE', 'compte'],
      ["Territoires d'industrie", 'compte'],
      ['ACV', 'compte'],
      ['PVD', 'compte'],
      ['ORT', 'compte'],
    ])
    expect(rendu.badges.map((b) => b.noms.length)).toEqual([11, 7, 2, 26, 4])
    // le total départemental est un agrégat SANS ventilation
    expect(rendu.subventions!.axes).toBeNull()
  })
})

// ------------------------------------------------------------------
// C — le vocabulaire des noms développés (app-side, en DEUX exemplaires)
// ------------------------------------------------------------------

describe('audit #446 C — le vocabulaire des noms développés', () => {
  it('NOMS_PROGRAMMES couvre exactement les cinq sigles du contrat', () => {
    expect(Object.keys(NOMS_PROGRAMMES).sort()).toEqual(
      [
        'ACV',
        'CRTE',
        'ORT',
        'PVD',
        "Territoires d'industrie",
      ].sort(),
    )
    expect(NOMS_PROGRAMMES.ACV).toBe('Action Cœur de Ville')
    expect(NOMS_PROGRAMMES.PVD).toBe('Petites Villes de Demain')
    expect(NOMS_PROGRAMMES.CRTE).toBe(
      'Contrat de Relance et de Transition Écologique',
    )
    expect(NOMS_PROGRAMMES['Territoires d\'industrie']).toBe("Territoires d'industrie")
    expect(NOMS_PROGRAMMES.ORT).toBe('Opération de revitalisation de territoire')
  })

  it('l’expansion accessible d’un badge porte le nom développé complet', () => {
    const expansion = libelleBadge({
      sigle: 'ACV',
      voix: 'laureate',
      noms: [],
      conventionValantOrt: true,
      vintage: 'x',
    })
    expect(expansion.startsWith('ACV — Action Cœur de Ville · ')).toBe(true)
  })

  it('la DUPLICATION : VOCABULAIRE_PROGRAMMES (Méthodes) est une copie bit à bit de NOMS_PROGRAMMES (fiche)', () => {
    // deux registres indépendants portent le MÊME vocabulaire — un correctif
    // de nom doit atterrir DEUX fois (le rapport propose un registre unique)
    expect(VOCABULAIRE_PROGRAMMES).toEqual(NOMS_PROGRAMMES)
  })
})

// ------------------------------------------------------------------
// D — la couture de rendu (où le nom développé disparaît à l’écran)
// ------------------------------------------------------------------

describe('audit #446 D — le rendu actuel de l’élément (ApercuOnglet)', () => {
  it('la puce VISIBLE porte le sigle SEUL — le nom développé n’existe qu’en aria-label', () => {
    const wrapper = monter('56121')

    const puces = wrapper.findAll('.puce-programme')
    expect(puces.map((p) => p.text())).toEqual(['ACV', 'CRTE', "Territoires d'industrie"])

    // le texte rendu de l'élément ne contient AUCUN nom développé…
    const texteVisible = wrapper.find('.apercu-programmes').text()
    expect(texteVisible).not.toContain('Action Cœur de Ville')
    expect(texteVisible).not.toContain('Contrat de Relance et de Transition Écologique')
    expect(texteVisible).not.toContain('Opération de revitalisation de territoire')

    // …mais l'aria-label SI — le nom n'est accessible qu'aux lecteurs d'écran
    expect(puces[0].attributes('aria-label')).toContain('ACV — Action Cœur de Ville')
    expect(puces[1].attributes('aria-label')).toContain(
      'CRTE — Contrat de Relance et de Transition Écologique',
    )
    // et le title répète le SIGLE (pas le nom) — le survol n'aide pas
    expect(puces[0].attributes('title')).toBe('ACV')
  })

  it('Lorient : le détail communal se plie top-5 + révélation (« Voir les 28 autres domaines »)', async () => {
    const wrapper = monter('56121')

    expect(wrapper.findAll('.subvention-axe').map((a) => a.text())).toHaveLength(5)
    const bouton = wrapper.find('.subvention-reveler')
    expect(bouton.text()).toBe('Voir les 28 autres domaines')

    // la révélation déplie les 33 domaines — le pipeline publie la ventilation
    // COMPLÈTE, le pli est purement un choix d'affichage (issue #305)
    await wrapper.find('.subvention-reveler').trigger('click')
    expect(wrapper.findAll('.subvention-axe').map((a) => a.text())).toHaveLength(33)
    // le bouton bascule en « Masquer » — il reste, il ne disparaît pas
    expect(wrapper.find('.subvention-reveler').text()).toBe('Masquer')
  })

  it("Lorient Agglomération : PAS de liste de domaines — total seul, part de région et provenance", () => {
    const wrapper = monter('200042174')

    expect(wrapper.findAll('.subvention-axe')).toHaveLength(0)
    expect(wrapper.find('.subvention-total').text()).toContain('M€')
    expect(wrapper.find('.subvention-contexte').text()).toContain('% du total de la région')
    expect(wrapper.find('.subvention-provenance').text()).toContain("communes de l'EPCI")
  })

  it("Cap Atlantique : l'état SANS badge rend une liste vide + la figure de subventions — jamais « en construction »", () => {
    const wrapper = monter('244400610')

    // pas de message vide (l'élément porte des subventions) mais la liste de
    // puces existe, VIDE — le DOM d'un état sans badge, constaté sur données
    // réelles (le seul EPCI dans ce cas)
    expect(wrapper.find('.programmes-vide').exists()).toBe(false)
    expect(wrapper.findAll('.programmes-badges li')).toHaveLength(0)
    expect(wrapper.find('.subvention-total').text()).toContain('153\u202f350 €')
  })

  it('Lanildut (29112) : l’état VIDE sur données réelles — « Aucun programme référencé. », aucune figure inventée', () => {
    const wrapper = monter('29112')
    expect(wrapper.find('.programmes-vide').text()).toBe('Aucun programme référencé.')
    expect(wrapper.find('.programme-subventions').exists()).toBe(false)
  })
})
