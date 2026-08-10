import { describe, expect, it } from 'vitest'

import { couchesDuTheme } from '../carte/coucheModel'
import {
  histoiresDemographieFixture,
  histoiresEconomieFixture,
  histoiresHabitatFixture,
  histoiresMilieuxFixture,
  histoiresMobiliteFixture,
  indicateursDemographieFixture,
  indicateursEconomieFixture,
  indicateursHabitatFixture,
  indicateursMilieuxFixture,
  indicateursMobiliteFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import type { Indicateur, Payload, Theme } from '../payload/types'

/**
 * The carte's layer model (ADR-0019 — « la Carte, miroir de la fiche »): given
 * the payload, the complete grouped layer list per theme — every number a fiche
 * renders is a layer. The story scalars lead (the declaration, in contract
 * order — the default layer is the FIRST scalar), then the fiche's indicator
 * figures in ORDRE_INDICATEURS order; multi-detail keys (structure_age, DPE,
 * mix…) group under ONE expandable entry with a layer per detail. Series
 * (conso_enaf, prix_m2) and distribution signatures (the dens_* / dec_* bins)
 * are excluded — a choropleth needs one value per territory. Labels come from
 * the fiche's
 * NOMS_INDICATEURS (fallback: the key — never a carte-side list).
 */

function payloadAvec(indicateurs: Indicateur[], histoires: Payload['histoires']): Payload {
  return {
    territoires: territoiresFixture,
    indicateurs,
    histoires,
    apercu: null,
    runReport: null,
    vintages: vintagesFixture,
    programmes: null,
  }
}

/** The distinct detail layers of a groupe entry (their clefs — the detail value on detail layers). */
function detailsDu(groupe: unknown): string[] {
  const g = groupe as { type: 'groupe'; groupe: { couches: { clef: string; detail: string | null }[] } }
  return g.groupe.couches.map((c) => c.detail ?? c.clef)
}

describe('couchesDuTheme — Démographie (fixture)', () => {
  const payload = payloadAvec(indicateursDemographieFixture, histoiresDemographieFixture)

  it('leads with the story scalars in contract order — the default is taux_solde_naturel', () => {
    const couches = couchesDuTheme(payload, 'demographie')

    expect(couches.coucheParDefaut?.clef).toBe('taux_solde_naturel')
    expect(couches.coucheParDefaut?.parDefaut).toBe(true)
    expect(couches.coucheParDefaut?.source).toBe('histoire')
    expect(couches.entrees[0]).toMatchObject({
      type: 'couche',
      couche: { clef: 'taux_solde_naturel', source: 'histoire', parDefaut: true },
    })
    // the story siblings group under ONE expandable entry (ADR-0019)
    expect(couches.entrees[1]).toMatchObject({ type: 'groupe' })
    expect(detailsDu(couches.entrees[1])).toEqual(['taux_solde_migratoire'])
  })

  it('then lists the fiche’s indicator figures in ORDRE_INDICATEURS order, multi-detail keys grouped', () => {
    const couches = couchesDuTheme(payload, 'demographie')

    const apresStory = couches.entrees.slice(2)
    expect(apresStory[0]).toMatchObject({
      type: 'couche',
      couche: { clef: 'densite', source: 'indicateur', parDefaut: false },
    })
    // structure_age — the multi-detail key grouped under one expandable entry
    expect(apresStory[1]).toMatchObject({ type: 'groupe' })
    expect(detailsDu(apresStory[1])).toEqual([
      '<15', '15-24', '25-39', '40-54', '55-64', '65-79', '80+',
    ])
    expect(apresStory[2]).toMatchObject({ type: 'couche', couche: { clef: 'evolution_1968' } })
    expect(apresStory[3]).toMatchObject({ type: 'couche', couche: { clef: 'taille_menages' } })
  })

  it('labels come from the fiche’s NOMS_INDICATEURS — fallback to the key, never invented', () => {
    const couches = couchesDuTheme(payload, 'demographie')

    expect(couches.entrees[2]).toMatchObject({ couche: { libelle: 'Densité de population' } })
    // the story scalar has no label in NOMS_INDICATEURS → the key itself
    expect(couches.entrees[0]).toMatchObject({ couche: { libelle: 'taux_solde_naturel' } })
    // the structure_age tranches wear the fiche’s tranche labels
    const groupe = couches.entrees[3] as { type: 'groupe'; groupe: { couches: { libelle: string }[] } }
    expect(groupe.groupe.couches[0].libelle).toBe('Moins de 15 ans')
    expect(groupe.groupe.couches[6].libelle).toBe('80 ans et plus')
  })
})

describe('couchesDuTheme — Mobilité (fixture)', () => {
  const payload = payloadAvec(indicateursMobiliteFixture, histoiresMobiliteFixture)

  it('default = div_loss_t; the story-pool siblings (div_loss_b, delta) grouped', () => {
    const couches = couchesDuTheme(payload, 'mobilite')

    expect(couches.coucheParDefaut?.clef).toBe('div_loss_t')
    expect(couches.entrees[0]).toMatchObject({ type: 'couche', couche: { clef: 'div_loss_t' } })
    expect(couches.entrees[1]).toMatchObject({ type: 'groupe' })
    expect(detailsDu(couches.entrees[1])).toEqual(['div_loss_b', 'delta'])
  })

  it('excludes the distribution signatures (dens_*/dec_*) — never layers', () => {
    const couches = couchesDuTheme(payload, 'mobilite')

    const clefs = couches.entrees.flatMap((e) =>
      e.type === 'couche' ? [e.couche.clef] : detailsDu(e),
    )
    expect(clefs).not.toContain('dens_1')
    expect(clefs).not.toContain('dec_1')
    expect(clefs).not.toContain('dens_min')
    expect(clefs).not.toContain('pct_iso_full_t')
  })

  it('lists the fiche’s figures in ORDRE_INDICATEURS order with the multi-detail keys grouped', () => {
    const couches = couchesDuTheme(payload, 'mobilite')

    const apresStory = couches.entrees.slice(2).map((e) =>
      e.type === 'couche' ? e.couche.clef : `groupe:${detailsDu(e).join('|')}`,
    )
    expect(apresStory).toEqual([
      'nb_buildings',
      'iso_alimentation',
      'iso_sante',
      'iso_administration',
      'iso_ecole',
      'iso_banque',
      'groupe:deux_plus|sans_voiture',
      'groupe:b_densite|b_longueur|c_densite|c_longueur|t_densite|t_longueur',
      'offre_tc',
      'bornes_recharge',
      'places_stationnement_velo_1000',
      'groupe:protege_longueur|protege_km_1000|partage_longueur|partage_km_1000|total_longueur',
    ])
  })

  it('wears the fiche’s detail labels for the voitures_menage group', () => {
    const couches = couchesDuTheme(payload, 'mobilite')
    const voitures = couches.entrees[2 + 6] as { type: 'groupe'; groupe: { couches: { libelle: string }[] } }
    expect(voitures.groupe.couches.map((c) => c.libelle)).toEqual([
      'Ménages avec 2 voitures ou plus',
      'Ménages sans voiture',
    ])
  })
})

describe('couchesDuTheme — Milieux (fixture)', () => {
  const payload = payloadAvec(indicateursMilieuxFixture, histoiresMilieuxFixture)

  it('default = the first artif scalar (artif_m2_par_habitant); the artif siblings grouped', () => {
    const couches = couchesDuTheme(payload, 'milieux')

    expect(couches.coucheParDefaut?.clef).toBe('artif_m2_par_habitant')
    expect(couches.entrees[0]).toMatchObject({
      type: 'couche',
      couche: { clef: 'artif_m2_par_habitant', source: 'histoire', parDefaut: true },
    })
    expect(detailsDu(couches.entrees[1])).toEqual([
      'artif_m3_par_habitant',
      'trajectoire_artif_par_habitant',
    ])
  })

  it('excludes the conso_enaf series — a choropleth needs one value per territory', () => {
    const couches = couchesDuTheme(payload, 'milieux')

    const clefs = couches.entrees.flatMap((e) =>
      e.type === 'couche' ? [e.couche.clef] : detailsDu(e),
    )
    expect(clefs).not.toContain('conso_enaf_annuel')
    expect(clefs).not.toContain('2011')
  })

  it('groups the artif_par_habitant state (the multi-detail figure) under one entry', () => {
    const couches = couchesDuTheme(payload, 'milieux')

    const groupe = couches.entrees[2] as { type: 'groupe'; groupe: { libelle: string; couches: { clef: string; detail: string | null }[] } }
    expect(groupe.groupe.libelle).toBe('Intensité état')
    expect(groupe.groupe.couches.map((c) => c.detail ?? c.clef)).toEqual(['2021', '2025', '2024', 'M2', 'M3'])
  })
})

describe('couchesDuTheme — Économie (fixture)', () => {
  const payload = payloadAvec(indicateursEconomieFixture, histoiresEconomieFixture)

  it('has NO map default — the theme has no story scalar today (ADR-0019)', () => {
    const couches = couchesDuTheme(payload, 'economie')

    expect(couches.coucheParDefaut).toBeNull()
  })

  it('lists the three block figures in the contract order', () => {
    const couches = couchesDuTheme(payload, 'economie')

    expect(couches.entrees.map((e) => (e.type === 'couche' ? e.couche.clef : ''))).toEqual([
      'effectifs_salaries',
      'chomage',
      'eco_activites',
    ])
    expect(couches.entrees[0]).toMatchObject({
      couche: { libelle: 'Effectifs salariés (lieu de travail)' },
    })
  })
})

describe('couchesDuTheme — Habitat (the real payload shape)', () => {
  // The shared habitat fixture predates the current payload shape (part_passoires
  // scalar, prix_m2 series, mix + DPE multi-detail) — this local fixture mirrors
  // public/data/indicateurs_habitat.json field for field.
  const indicateursHabitat: Indicateur[] = [
    { territoire: '22001', type: 'commune', theme: 'habitat', key: 'mix_logements', detail: 'principales', value: 0.9, unit: '%', rang_epci: 0.5, rang_dep: 0.5, rang_reg: 0.75, vintage_source: 'INSEE — Logements (dossier complet)', vintage_version: '2023', vintage_date_reference: '2023-01-01', vintage_date_publication: '2026-06-30' },
    { territoire: '22001', type: 'commune', theme: 'habitat', key: 'mix_logements', detail: 'secondaires', value: 0.07, unit: '%', rang_epci: 0.5, rang_dep: 0.5, rang_reg: 0.75, vintage_source: 'INSEE — Logements (dossier complet)', vintage_version: '2023', vintage_date_reference: '2023-01-01', vintage_date_publication: '2026-06-30' },
    { territoire: '22001', type: 'commune', theme: 'habitat', key: 'mix_logements', detail: 'vacants', value: 0.03, unit: '%', rang_epci: 0.5, rang_dep: 0.5, rang_reg: 0.75, vintage_source: 'INSEE — Logements (dossier complet)', vintage_version: '2023', vintage_date_reference: '2023-01-01', vintage_date_publication: '2026-06-30' },
    // prix_m2 — la médiane poolée (detail null) ET ses millésimes : la SÉRIE, exclue
    { territoire: '22001', type: 'commune', theme: 'habitat', key: 'prix_m2', detail: null, value: 2450, unit: '€/m²', rang_epci: 0.5, rang_dep: 0.5, rang_reg: 0.75, vintage_source: 'DVF', vintage_version: '2025', vintage_date_reference: '2025-01-01', vintage_date_publication: '2026-06-30' },
    { territoire: '22001', type: 'commune', theme: 'habitat', key: 'prix_m2', detail: '2021', value: 2100, unit: '€/m²', rang_epci: 0.5, rang_dep: 0.5, rang_reg: 0.75, vintage_source: 'DVF', vintage_version: '2025', vintage_date_reference: '2025-01-01', vintage_date_publication: '2026-06-30' },
    { territoire: '22001', type: 'commune', theme: 'habitat', key: 'prix_m2', detail: '2023', value: 2400, unit: '€/m²', rang_epci: 0.5, rang_dep: 0.5, rang_reg: 0.75, vintage_source: 'DVF', vintage_version: '2025', vintage_date_reference: '2025-01-01', vintage_date_publication: '2026-06-30' },
    // part_passoires — scalar dans les DEUX tables (indicateurs + histoires) : UNE seule couche
    { territoire: '22001', type: 'commune', theme: 'habitat', key: 'part_passoires', detail: null, value: 0.13, unit: '%', rang_epci: 0.4, rang_dep: 0.4, rang_reg: 0.6, vintage_source: 'ADEME — DPE', vintage_version: '2024', vintage_date_reference: '2024-01-01', vintage_date_publication: '2026-06-30' },
    // distribution_dpe — la répartition A→G, la clé multi-détail du contrat
    { territoire: '22001', type: 'commune', theme: 'habitat', key: 'distribution_dpe', detail: 'A', value: 0.05, unit: '%', rang_epci: 0.5, rang_dep: 0.5, rang_reg: 0.75, vintage_source: 'ADEME — DPE', vintage_version: '2024', vintage_date_reference: '2024-01-01', vintage_date_publication: '2026-06-30' },
    { territoire: '22001', type: 'commune', theme: 'habitat', key: 'distribution_dpe', detail: 'B', value: 0.1, unit: '%', rang_epci: 0.5, rang_dep: 0.5, rang_reg: 0.75, vintage_source: 'ADEME — DPE', vintage_version: '2024', vintage_date_reference: '2024-01-01', vintage_date_publication: '2026-06-30' },
    { territoire: '22001', type: 'commune', theme: 'habitat', key: 'distribution_dpe', detail: 'C', value: 0.15, unit: '%', rang_epci: 0.5, rang_dep: 0.5, rang_reg: 0.75, vintage_source: 'ADEME — DPE', vintage_version: '2024', vintage_date_reference: '2024-01-01', vintage_date_publication: '2026-06-30' },
    { territoire: '22001', type: 'commune', theme: 'habitat', key: 'distribution_dpe', detail: 'D', value: 0.2, unit: '%', rang_epci: 0.5, rang_dep: 0.5, rang_reg: 0.75, vintage_source: 'ADEME — DPE', vintage_version: '2024', vintage_date_reference: '2024-01-01', vintage_date_publication: '2026-06-30' },
    { territoire: '22001', type: 'commune', theme: 'habitat', key: 'distribution_dpe', detail: 'E', value: 0.2, unit: '%', rang_epci: 0.5, rang_dep: 0.5, rang_reg: 0.75, vintage_source: 'ADEME — DPE', vintage_version: '2024', vintage_date_reference: '2024-01-01', vintage_date_publication: '2026-06-30' },
    { territoire: '22001', type: 'commune', theme: 'habitat', key: 'distribution_dpe', detail: 'F', value: 0.15, unit: '%', rang_epci: 0.5, rang_dep: 0.5, rang_reg: 0.75, vintage_source: 'ADEME — DPE', vintage_version: '2024', vintage_date_reference: '2024-01-01', vintage_date_publication: '2026-06-30' },
    { territoire: '22001', type: 'commune', theme: 'habitat', key: 'distribution_dpe', detail: 'G', value: 0.15, unit: '%', rang_epci: 0.5, rang_dep: 0.5, rang_reg: 0.75, vintage_source: 'ADEME — DPE', vintage_version: '2024', vintage_date_reference: '2024-01-01', vintage_date_publication: '2026-06-30' },
  ]
  const payload = payloadAvec(indicateursHabitat, histoiresHabitatFixture)

  it('default = part_passoires (the story scalar), deduplicated with the indicateur scalar', () => {
    const couches = couchesDuTheme(payload, 'habitat')

    expect(couches.coucheParDefaut?.clef).toBe('part_passoires')
    expect(couches.coucheParDefaut?.source).toBe('indicateur')
    expect(couches.coucheParDefaut?.parDefaut).toBe(true)
    // une seule couche part_passoires dans la liste
    const clefs = couches.entrees.flatMap((e) =>
      e.type === 'couche' ? [e.couche.clef] : detailsDu(e),
    )
    expect(clefs.filter((c) => c === 'part_passoires')).toHaveLength(1)
  })

  it('excludes the prix_m2 series entirely — headline AND vintages', () => {
    const couches = couchesDuTheme(payload, 'habitat')

    const clefs = couches.entrees.flatMap((e) =>
      e.type === 'couche' ? [e.couche.clef] : detailsDu(e),
    )
    expect(clefs).not.toContain('prix_m2')
    expect(clefs).not.toContain('2021')
  })

  it('groups the mix_logements and distribution_dpe multi-detail keys', () => {
    const couches = couchesDuTheme(payload, 'habitat')

    const groupes = couches.entrees.filter((e) => e.type === 'groupe')
    expect(detailsDu(groupes[0])).toEqual(['principales', 'secondaires', 'vacants'])
    expect(detailsDu(groupes[1])).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G'])
  })

  it('falls back to the key for habitat labels (NOMS_INDICATEURS.habitat is the #200 gap)', () => {
    const couches = couchesDuTheme(payload, 'habitat')

    expect(couches.coucheParDefaut?.libelle).toBe('part_passoires')
  })
})

describe('couchesDuTheme — the default layer per theme (ADR-0019 α rule)', () => {
  it('is the first story scalar in contract order for every theme with one', () => {
    const cas: { theme: Theme; payload: Payload; defaut: string | null }[] = [
      { theme: 'demographie', payload: payloadAvec(indicateursDemographieFixture, histoiresDemographieFixture), defaut: 'taux_solde_naturel' },
      { theme: 'mobilite', payload: payloadAvec(indicateursMobiliteFixture, histoiresMobiliteFixture), defaut: 'div_loss_t' },
      { theme: 'habitat', payload: payloadAvec(indicateursHabitatFixture, histoiresHabitatFixture), defaut: 'part_passoires' },
      { theme: 'milieux', payload: payloadAvec(indicateursMilieuxFixture, histoiresMilieuxFixture), defaut: 'artif_m2_par_habitant' },
      { theme: 'economie', payload: payloadAvec(indicateursEconomieFixture, histoiresEconomieFixture), defaut: null },
    ]
    for (const { theme, payload, defaut } of cas) {
      expect(couchesDuTheme(payload, theme).coucheParDefaut?.clef ?? null, theme).toBe(defaut)
    }
  })

  it('a theme whose payload carries no histoire row has no story layers and no default', () => {
    const sansHistoires = payloadAvec(indicateursDemographieFixture, [])
    const couches = couchesDuTheme(sansHistoires, 'demographie')

    expect(couches.coucheParDefaut).toBeNull()
    expect(couches.entrees[0]).toMatchObject({ type: 'couche', couche: { clef: 'densite' } })
  })
})
