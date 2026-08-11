import { describe, expect, it } from 'vitest'

import { couchesDuTheme } from '../carte/coucheModel'
import type { EntreeCouches } from '../carte/coucheModel'
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
  metadonneesThemesFixtures,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import type { Indicateur, Payload, Theme } from '../payload/types'

/**
 * The carte's layer model (ADR-0019 — « la Carte, miroir de la fiche », issue
 * #315, parent #308): given the payload, the complete grouped layer list per
 * theme — every number a fiche renders is a layer. The layer model reads the
 * SHARED CONTRACT (theme_<theme>.json + indicateurs_<theme>.json +
 * histoires_<theme>.json), never a carte-side spec:
 *
 * - the story scalars lead — the READING PARAMS the theme metadata declares
 *   (subgroups[].reading.params), filtered to the numeric scalar fields of the
 *   resolved histoires rows (one number per territory). The FIRST declared
 *   scalar is the theme's default layer (the α rule of ADR-0019, re-read from
 *   the metadata — « default layers match declared subgroup primaries »); the
 *   remaining scalars group under their subgroup's label (the fiche's subgroup
 *   heading, never a carte-side « La Story » label);
 * - the fiche's indicator figures follow in the metadata's indicator_keys
 *   order; a scalar key (detail === null) is one layer, a multi-detail key
 *   (structure_age, DPE, mix…) is ONE expandable entry with a layer per
 *   detail;
 * - series (conso_enaf, prix_m2) and distribution signatures (the dens_* /
 *   dec_* bins) are excluded — a choropleth needs one value per territory
 *   (ADR-0019).
 *
 * Labels come from the fiche's own vocabulary (NOMS_INDICATEURS — shared with
 * the fiche, never carte-only), the metadata subgroup labels for the story
 * groups, and the key itself as the honest fallback. Every layer carries its
 * metadata provenance (sousGroupe — the subgroup that owns the scalar;
 * storyKey for the story scalars). A payload assembled WITHOUT the metadata
 * seam has no story layers and no default — the carte mirrors what the
 * contract declares, nothing invented.
 */

function payloadAvec(indicateurs: Indicateur[], histoires: Payload['histoires'], theme: Theme): Payload {
  return {
    territoires: territoiresFixture,
    indicateurs,
    histoires,
    apercu: null,
    runReport: null,
    vintages: vintagesFixture,
    programmes: null,
    themeMetadata: { [theme]: metadonneesThemesFixtures[theme] },
  }
}

/** The distinct detail layers of a groupe entry (their clefs — the detail value on detail layers). */
function detailsDu(groupe: unknown): string[] {
  const g = groupe as { type: 'groupe'; groupe: { couches: { clef: string; detail: string | null }[] } }
  return g.groupe.couches.map((c) => c.detail ?? c.clef)
}

/** La clef d'une entrée « couche » — ces specs ne testent que le modèle de
 *  thème (couchesDuTheme), jamais les couches programmes (#282). */
function clefDe(entree: EntreeCouches): string {
  if (entree.type !== 'couche') throw new Error('entrée couche attendue')
  const couche = entree.couche
  if (couche.source === 'membre' || couche.source === 'subvention') {
    throw new Error('couche programmes inattendue')
  }
  return couche.clef
}

describe('couchesDuTheme — Démographie (fixture)', () => {
  const payload = payloadAvec(indicateursDemographieFixture, histoiresDemographieFixture, 'demographie')

  it('leads with the declared story scalars — the default is the FIRST reading param (taux_solde_naturel)', () => {
    const couches = couchesDuTheme(payload, 'demographie')

    expect(couches.coucheParDefaut?.clef).toBe('taux_solde_naturel')
    expect(couches.coucheParDefaut?.parDefaut).toBe(true)
    expect(couches.coucheParDefaut?.source).toBe('histoire')
    expect(couches.entrees[0]).toMatchObject({
      type: 'couche',
      couche: { clef: 'taux_solde_naturel', source: 'histoire', parDefaut: true },
    })
    // the story siblings group under the SUBGROUP's label (the fiche's heading,
    // never a carte-side « La Story »)
    expect(couches.entrees[1]).toMatchObject({ type: 'groupe' })
    expect(detailsDu(couches.entrees[1])).toEqual(['taux_solde_migratoire'])
  })

  it('then lists the fiche’s indicator figures in the metadata indicator_keys order, multi-detail keys grouped', () => {
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

  it('carries the metadata provenance on every layer — sousGroupe + storyKey for the story scalars', () => {
    const couches = couchesDuTheme(payload, 'demographie')

    expect(couches.coucheParDefaut).toMatchObject({
      sousGroupe: 'etat-et-dynamique',
      storyKey: 'trajectoire-demographique',
    })
    const groupe = couches.entrees[1] as { type: 'groupe'; groupe: { couches: { sousGroupe: string | null; storyKey: string | null }[] } }
    expect(groupe.groupe.couches[0]).toMatchObject({
      sousGroupe: 'etat-et-dynamique',
      storyKey: 'trajectoire-demographique',
    })
    // an indicator layer carries its owning subgroup, no story
    expect(couches.entrees[2]).toMatchObject({
      couche: { sousGroupe: 'etat-et-dynamique', storyKey: null },
    })
  })
})

describe('couchesDuTheme — Mobilité (fixture)', () => {
  const payload = payloadAvec(indicateursMobiliteFixture, histoiresMobiliteFixture, 'mobilite')

  it('default = div_loss_t (the first declared param); the declared sibling pct_iso_full_t grouped', () => {
    const couches = couchesDuTheme(payload, 'mobilite')

    expect(couches.coucheParDefaut?.clef).toBe('div_loss_t')
    expect(couches.entrees[0]).toMatchObject({ type: 'couche', couche: { clef: 'div_loss_t' } })
    expect(couches.entrees[1]).toMatchObject({ type: 'groupe' })
    expect(detailsDu(couches.entrees[1])).toEqual(['pct_iso_full_t'])
  })

  it('the story group wears the metadata subgroup label — L’accès aux services, never « La Story »', () => {
    const couches = couchesDuTheme(payload, 'mobilite')

    const groupe = couches.entrees[1] as { type: 'groupe'; groupe: { libelle: string } }
    expect(groupe.groupe.libelle).toBe('L’accès aux services')
  })

  it('excludes the distribution signatures (dens_*/dec_*) — never layers', () => {
    const couches = couchesDuTheme(payload, 'mobilite')

    const clefs = couches.entrees.flatMap((e) =>
      e.type === 'couche' ? [clefDe(e)] : detailsDu(e),
    )
    expect(clefs).not.toContain('dens_1')
    expect(clefs).not.toContain('dec_1')
    expect(clefs).not.toContain('dens_min')
  })

  it('lists the fiche’s figures in the metadata indicator_keys order with the multi-detail keys grouped', () => {
    const couches = couchesDuTheme(payload, 'mobilite')

    const apresStory = couches.entrees.slice(2).map((e) =>
      e.type === 'couche' ? clefDe(e) : `groupe:${detailsDu(e).join('|')}`,
    )
    expect(apresStory).toEqual([
      'nb_buildings',
      'groupe:deux_plus|sans_voiture',
      'groupe:b_densite|b_longueur|c_densite|c_longueur|t_densite|t_longueur',
      'offre_tc',
      'bornes_recharge',
      'places_stationnement_velo_1000',
      'groupe:protege_longueur|protege_km_1000|partage_longueur|partage_km_1000|total_longueur',
      'iso_alimentation',
      'iso_sante',
      'iso_administration',
      'iso_ecole',
      'iso_banque',
    ])
  })

  it('wears the fiche’s detail labels for the voitures_menage group', () => {
    const couches = couchesDuTheme(payload, 'mobilite')
    const voitures = couches.entrees[2 + 1] as { type: 'groupe'; groupe: { couches: { libelle: string }[] } }
    expect(voitures.groupe.couches.map((c) => c.libelle)).toEqual([
      'Ménages avec 2 voitures ou plus',
      'Ménages sans voiture',
    ])
  })
})

describe('couchesDuTheme — Milieux (fixture)', () => {
  const payload = payloadAvec(indicateursMilieuxFixture, histoiresMilieuxFixture, 'milieux')

  it('default = delta_population (the first declared numeric param); the trajectory grouped', () => {
    const couches = couchesDuTheme(payload, 'milieux')

    expect(couches.coucheParDefaut?.clef).toBe('delta_population')
    expect(couches.entrees[0]).toMatchObject({
      type: 'couche',
      couche: { clef: 'delta_population', source: 'histoire', parDefaut: true },
    })
    expect(detailsDu(couches.entrees[1])).toEqual(['trajectoire_artif_par_habitant'])
  })

  it('excludes the conso_enaf series — a choropleth needs one value per territory', () => {
    const couches = couchesDuTheme(payload, 'milieux')

    const clefs = couches.entrees.flatMap((e) =>
      e.type === 'couche' ? [clefDe(e)] : detailsDu(e),
    )
    expect(clefs).not.toContain('conso_enaf_annuel')
    expect(clefs).not.toContain('2011')
  })

  it('the artif states that are NOT declared reading params are not layers (the metadata is the contract)', () => {
    const couches = couchesDuTheme(payload, 'milieux')

    const clefs = couches.entrees.flatMap((e) =>
      e.type === 'couche' ? [clefDe(e)] : detailsDu(e),
    )
    expect(clefs).not.toContain('artif_m2_par_habitant')
    expect(clefs).not.toContain('artif_m3_par_habitant')
  })

  it('groups the artif_par_habitant state (the multi-detail figure) under one entry', () => {
    const couches = couchesDuTheme(payload, 'milieux')

    const groupe = couches.entrees[2] as { type: 'groupe'; groupe: { libelle: string; couches: { clef: string; detail: string | null }[] } }
    expect(groupe.groupe.libelle).toBe('Intensité état')
    expect(groupe.groupe.couches.map((c) => c.detail ?? c.clef)).toEqual(['2021', '2025', '2024', 'M2', 'M3'])
  })
})

describe('couchesDuTheme — Économie (fixture)', () => {
  const payload = payloadAvec(indicateursEconomieFixture, histoiresEconomieFixture, 'economie')

  it('has NO map default — the reading params are the folded top-5 template keys, never numeric row fields', () => {
    const couches = couchesDuTheme(payload, 'economie')

    expect(couches.coucheParDefaut).toBeNull()
  })

  it('lists the three block figures in the metadata indicator_keys order', () => {
    const couches = couchesDuTheme(payload, 'economie')

    expect(couches.entrees.map((e) => (e.type === 'couche' ? clefDe(e) : ''))).toEqual([
      'effectifs_salaries',
      'chomage',
      'eco_activites',
    ])
    expect(couches.entrees[0]).toMatchObject({
      couche: { libelle: 'Effectifs salariés (lieu de travail)' },
    })
  })
})

describe('couchesDuTheme — the default layer per theme (ADR-0019 α rule, re-read from the metadata)', () => {
  it('is the FIRST declared numeric reading param for every theme with one', () => {
    const cas: { theme: Theme; payload: Payload; defaut: string | null }[] = [
      { theme: 'demographie', payload: payloadAvec(indicateursDemographieFixture, histoiresDemographieFixture, 'demographie'), defaut: 'taux_solde_naturel' },
      { theme: 'mobilite', payload: payloadAvec(indicateursMobiliteFixture, histoiresMobiliteFixture, 'mobilite'), defaut: 'div_loss_t' },
      { theme: 'habitat', payload: payloadAvec(indicateursHabitatFixture, histoiresHabitatFixture, 'habitat'), defaut: 'part_passoires' },
      { theme: 'milieux', payload: payloadAvec(indicateursMilieuxFixture, histoiresMilieuxFixture, 'milieux'), defaut: 'delta_population' },
      { theme: 'economie', payload: payloadAvec(indicateursEconomieFixture, histoiresEconomieFixture, 'economie'), defaut: null },
    ]
    for (const { theme, payload, defaut } of cas) {
      expect(couchesDuTheme(payload, theme).coucheParDefaut?.clef ?? null, theme).toBe(defaut)
    }
  })

  it('a theme whose payload carries no histoire row has no story layers and no default', () => {
    const sansHistoires = payloadAvec(indicateursDemographieFixture, [], 'demographie')
    const couches = couchesDuTheme(sansHistoires, 'demographie')

    expect(couches.coucheParDefaut).toBeNull()
    expect(couches.entrees[0]).toMatchObject({ type: 'couche', couche: { clef: 'densite' } })
  })
})

describe('couchesDuTheme — sans le seam des métadonnées (un payload fusionné, pré-seam)', () => {
  const sansMetadonnees: Payload = {
    territoires: territoiresFixture,
    indicateurs: indicateursDemographieFixture,
    histoires: histoiresDemographieFixture,
    apercu: null,
    runReport: null,
    vintages: vintagesFixture,
    programmes: null,
  }

  it('has no story layers and no default — the carte mirrors what the contract declares, nothing invented', () => {
    const couches = couchesDuTheme(sansMetadonnees, 'demographie')

    expect(couches.coucheParDefaut).toBeNull()
    // les figures d'indicateurs restent (elles vivent dans le payload) ; les
    // scalaires de Story, eux, ne sont pas déclarés — jamais inventés
    const clefs = couches.entrees.flatMap((e) =>
      e.type === 'couche' ? [clefDe(e)] : detailsDu(e),
    )
    expect(clefs[0]).toBe('densite')
    expect(clefs).not.toContain('taux_solde_naturel')
    expect(clefs).not.toContain('taux_solde_migratoire')
  })

  it('indicator layers carry no provenance (null) — the metadata is absent, honest', () => {
    const couches = couchesDuTheme(sansMetadonnees, 'demographie')

    const densite = couches.entrees[0]
    expect(densite).toMatchObject({ couche: { sousGroupe: null, storyKey: null } })
  })
})
