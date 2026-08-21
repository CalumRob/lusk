import { describe, expect, it } from 'vitest'

import { contenuTooltip, formaterValeurApercu, kpisPourPopup } from '../carte/popup'
import type { Couche } from '../carte/coucheModel'
import {
  apercuAvecNAFixture,
  apercuFixture,
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import type { Histoire, Indicateur, Payload } from '../payload/types'

/**
 * The popup's KPI rows (ui-elements.md §Map shell): name + the ACTIVE layer's
 * value + its rank-in-context (ADR-0019 — the popup answers "how does this
 * territory sit on THIS variable", never the theme's KPI wall), then « Voir
 * la fiche ». Ranks live on the indicateurs table only (CONTEXT.md §Rang) :
 * a story-scalar layer (source 'histoire') shows the value without an
 * invented rank. Without a layer (the neutral first load) the Aperçu basics
 * fill the popup. A KPI the payload cannot compute is skipped — never a
 * made-up number. Pure logic; the popup builder renders what this returns.
 */

/** The Démographie densité layer — the previous config's equivalent, as a Couche. */
const coucheDensite: Couche = {
  source: 'indicateur',
  clef: 'densite',
  detail: null,
  libelle: 'Densité de population',
  parDefaut: false,
  sousGroupe: 'trajectoire-demographique',
  storyKey: null,
}

/** The Démographie default layer — the first declared story scalar (ADR-0019 α rule). */
const coucheTauxSoldeNaturel: Couche = {
  source: 'histoire',
  clef: 'taux_solde_naturel',
  detail: null,
  libelle: 'taux_solde_naturel',
  parDefaut: true,
  sousGroupe: 'trajectoire-demographique',
  storyKey: 'trajectoire-demographique',
}

/** The multi-detail layer of a grouped key (ADR-0019). */
const coucheTrancheMoin15: Couche = {
  source: 'indicateur',
  clef: 'structure_age',
  detail: '<15',
  libelle: 'Moins de 15 ans',
  parDefaut: false,
  sousGroupe: 'trajectoire-demographique',
  storyKey: null,
}

function payloadAvecApercu(apercu = apercuFixture): Payload {
  return {
    territoires: territoiresFixture,
    indicateurs: indicateursDemographieFixture,
    histoires: histoiresDemographieFixture,
    apercu,
    runReport: null,
    vintages: vintagesFixture,
    programmes: null,
  }
}

describe('formaterValeurApercu — French display of an Aperçu row', () => {
  it('formats a % unit as a whole number (fraction × 100)', () => {
    expect(formaterValeurApercu({ territoire: '22001', type: 'commune', key: 'part_65_plus', value: 0.15, unit: '%' })).toBe('15')
  })

  it('formats a raw value with thin-space thousands and a comma decimal', () => {
    expect(formaterValeurApercu({ territoire: '22001', type: 'commune', key: 'population', value: 2000, unit: 'hab.' })).toBe('2 000')
    expect(formaterValeurApercu({ territoire: '22001', type: 'commune', key: 'densite', value: 133.333, unit: 'hab/km²' })).toBe('133,33')
  })

  it('returns null for a null value (non calculable)', () => {
    expect(formaterValeurApercu({ territoire: '22001', type: 'commune', key: 'population', value: null, unit: 'hab.' })).toBeNull()
  })
})

describe("kpisPourPopup — the popup's rows (per-layer, ADR-0019)", () => {
  it('leads with the active layer — its value and its rank-in-context, no KPI wall', () => {
    const payload = payloadAvecApercu()
    const kpis = kpisPourPopup(payload, '22001', 'demographie', coucheDensite)

    expect(kpis).toHaveLength(1)
    expect(kpis[0]).toEqual({
      libelle: 'Densité de population',
      valeur: '200',
      unite: 'hab/km²',
      rang: "1er/2 de l'EPCI",
    })
  })

  it('a story scalar deduplicated with the indicateur table (part_passoires) shows its ordinal rank', () => {
    const payload = payloadAvecApercu()
    // la couche que le modèle émet pour un scalaire de Story présent dans les
    // DEUX tables (issue #315) : source 'indicateur' — la jointure riche
    // (valeur + rang + vintage), jamais une couche muette
    const couchePartPassoires: Couche = {
      source: 'indicateur',
      clef: 'part_passoires',
      detail: null,
      libelle: 'part_passoires',
      parDefaut: true,
      sousGroupe: 'etat-energetique-du-parc',
      storyKey: 'etat-energetique-du-parc',
    }
    const payloadHabitat: Payload = {
      ...payload,
      indicateurs: [
        ...indicateursDemographieFixture,
        {
          territoire: '22001',
          type: 'commune',
          theme: 'habitat',
          key: 'part_passoires',
          detail: null,
          value: 0.13,
          unit: '%',
          rang_epci: 2,
          rang_epci_n: 2,
          rang_dep: null,
          rang_dep_n: null,
          rang_reg: null,
          rang_reg_n: null,
          vintage_source: 'ADEME — DPE',
          vintage_version: '2024',
          vintage_date_reference: '2024-01-01',
          vintage_date_publication: '2026-06-30',
        },
      ],
      histoires: [
        ...histoiresDemographieFixture,
        {
          territoire: '22001',
          type: 'commune',
          theme: 'habitat',
          story_key: 'etat-energetique-du-parc',
          groupe: 'etat-energetique-du-parc',
          salience_reason: 'defaut',
          classification: 'parc-performant',
          part_passoires: 0.13,
          part_abc: 0.5,
          n_dpe: 90,
        },
      ],
    }
    const kpis = kpisPourPopup(payloadHabitat, '22001', 'habitat', couchePartPassoires)

    expect(kpis).toHaveLength(1)
    expect(kpis[0]).toEqual({
      libelle: 'part_passoires',
      valeur: '13',
      unite: '%',
      rang: "2e/2 de l'EPCI",
    })
  })

  it('a story-scalar layer shows its value without an invented rank', () => {
    const payload = payloadAvecApercu()
    const kpis = kpisPourPopup(payload, '22001', 'demographie', coucheTauxSoldeNaturel)

    expect(kpis).toHaveLength(1)
    expect(kpis[0]).toEqual({
      libelle: 'taux_solde_naturel',
      valeur: '5,98',
      unite: '',
      rang: null,
    })
  })

  it('reads a grouped detail layer by clef + detail with its own rank (ADR-0019)', () => {
    const payload = payloadAvecApercu()
    const kpis = kpisPourPopup(payload, '22001', 'demographie', coucheTrancheMoin15)

    expect(kpis[0]).toEqual({ libelle: 'Moins de 15 ans', valeur: '30', unite: '%', rang: "1er/2 de l'EPCI" })
  })

  it('aggregates the F+M sex shares of a grouped structure_age detail into one popup value (issue #390 regression)', () => {
    const lignes: Indicateur[] = [
      { territoire: '22001', type: 'commune', theme: 'demographie', key: 'structure_age', detail: '40-54', sex: 'F', value: 0.09, unit: '%', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, vintage_source: 'INSEE', vintage_version: '2023', vintage_date_reference: '2023-01-01', vintage_date_publication: '2026-06-30' },
      { territoire: '22001', type: 'commune', theme: 'demographie', key: 'structure_age', detail: '40-54', sex: 'M', value: 0.06, unit: '%', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, vintage_source: 'INSEE', vintage_version: '2023', vintage_date_reference: '2023-01-01', vintage_date_publication: '2026-06-30' },
    ]
    const payload = { ...payloadAvecApercu(), indicateurs: lignes }
    const couche: Couche = { ...coucheTrancheMoin15, detail: '40-54', libelle: '40 à 54 ans' }

    // issue #390 : la carte reste groupée par key + detail (jamais par sexe) ;
    // les parts F (0.09) et M (0.06) se combinent en 0.15 → '15', le rang
    // partagé (1er/2 de l'EPCI) étant conservé.
    expect(kpisPourPopup(payload, '22001', 'demographie', couche)[0]).toEqual({
      libelle: '40 à 54 ans',
      valeur: '15',
      unite: '%',
      rang: "1er/2 de l'EPCI",
    })
  })

  it('an EPCI row shows its régional rank when it has no EPCI rank (rang_epci null)', () => {
    const payload = payloadAvecApercu()
    const kpis = kpisPourPopup(payload, '200000001', 'demographie', coucheDensite)

    expect(kpis[0]?.rang).toBe('2e/2 de la région')
  })

  it('a layer row with no rank column at all (la région) shows the value without a rank', () => {
    const payload = payloadAvecApercu()
    const kpis = kpisPourPopup(payload, '53', 'demographie', coucheDensite)

    expect(kpis[0]?.valeur).toBe('144,83')
    expect(kpis[0]?.rang).toBeNull()
  })

  it('a layer row whose value is null shows the honest « — », never a made-up number', () => {
    const payload = payloadAvecApercu()
    const coucheTrajectoireArtif: Couche = {
      source: 'histoire',
      clef: 'trajectoire_artif_par_habitant',
      detail: null,
      libelle: 'trajectoire_artif_par_habitant',
      parDefaut: true,
      sousGroupe: 'artificialisation',
      storyKey: 'se-densifier-setaler-ou-sen-aller',
    }
    // le trou NA honnête du Milieux (ADR-0017) : états absents → scalaire null
    const histoireSansEtat: Histoire = {
      territoire: '22001',
      type: 'commune',
      theme: 'milieux',
      story_key: 'se-densifier-setaler-ou-sen-aller',
      groupe: 'artificialisation',
      salience_reason: 'defaut',
      periode_pop: '2017-2023',
      periode_artif: null,
      delta_population: 0,
      taux_variation_population: 0,
      artif_m2: null,
      artif_m3: null,
      artif_m2_par_habitant: null,
      artif_m3_par_habitant: null,
      trajectoire_artif_par_habitant: null,
      classification: null,
    }
    const payloadTrou: Payload = { ...payload, histoires: [histoireSansEtat] }
    const kpis = kpisPourPopup(payloadTrou, '22001', 'milieux', coucheTrajectoireArtif)

    expect(kpis).toHaveLength(1)
    expect(kpis[0]?.valeur).toBe('—')
    expect(kpis[0]?.rang).toBeNull()
  })

  it('without a layer, shows the Aperçu basics without ranks (the neutral-state popup)', () => {
    const payload = payloadAvecApercu()
    const kpis = kpisPourPopup(payload, '29001', null, null)

    expect(kpis.map((k) => k.libelle)).toEqual(['Population', 'Densité', 'Part des 65 ans et plus'])
    expect(kpis.every((k) => k.rang === null)).toBe(true)
  })

  it('skips an NA Aperçu row (value null = non calculable)', () => {
    const payload = payloadAvecApercu(apercuAvecNAFixture)
    const kpis = kpisPourPopup(payload, '22002', null, null)

    expect(kpis.map((k) => k.libelle)).toEqual(['Population', 'Densité'])
    expect(kpis).toHaveLength(2)
  })

  it('a territory with no payload rows gets an honest short popup', () => {
    const payload = payloadAvecApercu()
    const kpis = kpisPourPopup(payload, '99999', 'demographie', coucheDensite)

    expect(kpis).toHaveLength(0)
  })
})

describe('contenuTooltip — the hover tooltip (audit #208 item 57)', () => {
  it('names the territory and shows the active layer value', () => {
    const payload = payloadAvecApercu()
    expect(contenuTooltip(payload, '22001', 'demographie', coucheDensite)).toEqual({
      nom: 'Commune A1',
      valeur: '200',
    })
  })

  it('shows a story scalar for a story layer (source histoire)', () => {
    const payload = payloadAvecApercu()
    expect(contenuTooltip(payload, '22001', 'demographie', coucheTauxSoldeNaturel)).toEqual({
      nom: 'Commune A1',
      valeur: '5,98',
    })
  })

  it('shows the name only without a layer (no theme drives the map)', () => {
    const payload = payloadAvecApercu()
    expect(contenuTooltip(payload, '22001', null, null)).toEqual({ nom: 'Commune A1', valeur: null })
  })

  it('falls back to the territoire code when the payload has no name row', () => {
    const payload = payloadAvecApercu()
    expect(contenuTooltip(payload, '99999', 'demographie', coucheDensite)).toEqual({
      nom: '99999',
      valeur: null,
    })
  })
})
