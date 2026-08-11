import { describe, expect, it } from 'vitest'

import { couchesDuTheme } from '../carte/coucheModel'
import type { EntreeCouches } from '../carte/coucheModel'
import {
  histoiresHabitatFixture,
  metadonneesThemesFixtures,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import type { Indicateur, Payload } from '../payload/types'

/**
 * couchesDuTheme — Habitat, with a local fixture mirroring the real payload
 * shape (public/data/indicateurs_habitat.json field for field) : part_passoires
 * scalar in BOTH tables, the prix_m2 series, the mix_logements + distribution_dpe
 * multi-detail keys. Split from couche-model.spec.ts — its own describe owns the
 * local fixture (the shared habitat fixture predates the current payload shape).
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
    themeMetadata: { habitat: metadonneesThemesFixtures.habitat },
  }
}

/** The distinct detail layers of a groupe entry (their clefs — the detail value on detail layers). */
function detailsDu(groupe: unknown): string[] {
  const g = groupe as { type: 'groupe'; groupe: { couches: { clef: string; detail: string | null }[] } }
  return g.groupe.couches.map((c) => c.detail ?? c.clef)
}

/** La clef d'une entrée « couche » — la couche programmes n'apparaît jamais ici. */
function clefDe(entree: EntreeCouches): string {
  if (entree.type !== 'couche') throw new Error('entrée couche attendue')
  const couche = entree.couche
  if (couche.source === 'membre' || couche.source === 'subvention') {
    throw new Error('couche programmes inattendue')
  }
  return couche.clef
}

/** The local fixture mirroring public/data/indicateurs_habitat.json field for field. */
const indicateursHabitat: Indicateur[] = [
  { territoire: '22001', type: 'commune', theme: 'habitat', key: 'mix_logements', detail: 'principales', value: 0.9, unit: '%', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, vintage_source: 'INSEE — Logements (dossier complet)', vintage_version: '2023', vintage_date_reference: '2023-01-01', vintage_date_publication: '2026-06-30' },
  { territoire: '22001', type: 'commune', theme: 'habitat', key: 'mix_logements', detail: 'secondaires', value: 0.07, unit: '%', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, vintage_source: 'INSEE — Logements (dossier complet)', vintage_version: '2023', vintage_date_reference: '2023-01-01', vintage_date_publication: '2026-06-30' },
  { territoire: '22001', type: 'commune', theme: 'habitat', key: 'mix_logements', detail: 'vacants', value: 0.03, unit: '%', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, vintage_source: 'INSEE — Logements (dossier complet)', vintage_version: '2023', vintage_date_reference: '2023-01-01', vintage_date_publication: '2026-06-30' },
  // prix_m2 — la médiane poolée (detail null) ET ses millésimes : la SÉRIE, exclue
  { territoire: '22001', type: 'commune', theme: 'habitat', key: 'prix_m2', detail: null, value: 2450, unit: '€/m²', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, vintage_source: 'DVF', vintage_version: '2025', vintage_date_reference: '2025-01-01', vintage_date_publication: '2026-06-30' },
  { territoire: '22001', type: 'commune', theme: 'habitat', key: 'prix_m2', detail: '2021', value: 2100, unit: '€/m²', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, vintage_source: 'DVF', vintage_version: '2025', vintage_date_reference: '2025-01-01', vintage_date_publication: '2026-06-30' },
  { territoire: '22001', type: 'commune', theme: 'habitat', key: 'prix_m2', detail: '2023', value: 2400, unit: '€/m²', rang_epci: 1, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, vintage_source: 'DVF', vintage_version: '2025', vintage_date_reference: '2025-01-01', vintage_date_publication: '2026-06-30' },
  // part_passoires — scalar dans les DEUX tables (indicateurs + histoires) : UNE seule couche
  { territoire: '22001', type: 'commune', theme: 'habitat', key: 'part_passoires', detail: null, value: 0.13, unit: '%', rang_epci: 2, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, vintage_source: 'ADEME — DPE', vintage_version: '2024', vintage_date_reference: '2024-01-01', vintage_date_publication: '2026-06-30' },
  // distribution_dpe — la répartition A→G, la clé multi-détail du contrat
  { territoire: '22001', type: 'commune', theme: 'habitat', key: 'distribution_dpe', detail: 'A', value: 0.05, unit: '%', rang_epci: 2, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, vintage_source: 'ADEME — DPE', vintage_version: '2024', vintage_date_reference: '2024-01-01', vintage_date_publication: '2026-06-30' },
  { territoire: '22001', type: 'commune', theme: 'habitat', key: 'distribution_dpe', detail: 'B', value: 0.1, unit: '%', rang_epci: 2, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, vintage_source: 'ADEME — DPE', vintage_version: '2024', vintage_date_reference: '2024-01-01', vintage_date_publication: '2026-06-30' },
  { territoire: '22001', type: 'commune', theme: 'habitat', key: 'distribution_dpe', detail: 'C', value: 0.15, unit: '%', rang_epci: 2, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, vintage_source: 'ADEME — DPE', vintage_version: '2024', vintage_date_reference: '2024-01-01', vintage_date_publication: '2026-06-30' },
  { territoire: '22001', type: 'commune', theme: 'habitat', key: 'distribution_dpe', detail: 'D', value: 0.2, unit: '%', rang_epci: 2, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, vintage_source: 'ADEME — DPE', vintage_version: '2024', vintage_date_reference: '2024-01-01', vintage_date_publication: '2026-06-30' },
  { territoire: '22001', type: 'commune', theme: 'habitat', key: 'distribution_dpe', detail: 'E', value: 0.2, unit: '%', rang_epci: 2, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, vintage_source: 'ADEME — DPE', vintage_version: '2024', vintage_date_reference: '2024-01-01', vintage_date_publication: '2026-06-30' },
  { territoire: '22001', type: 'commune', theme: 'habitat', key: 'distribution_dpe', detail: 'F', value: 0.15, unit: '%', rang_epci: 2, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, vintage_source: 'ADEME — DPE', vintage_version: '2024', vintage_date_reference: '2024-01-01', vintage_date_publication: '2026-06-30' },
  { territoire: '22001', type: 'commune', theme: 'habitat', key: 'distribution_dpe', detail: 'G', value: 0.15, unit: '%', rang_epci: 2, rang_epci_n: 2, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null, vintage_source: 'ADEME — DPE', vintage_version: '2024', vintage_date_reference: '2024-01-01', vintage_date_publication: '2026-06-30' },
]

describe('couchesDuTheme — Habitat (the real payload shape)', () => {
  const payload = payloadAvec(indicateursHabitat, histoiresHabitatFixture)

  it('default = part_passoires (the declared param), deduplicated with the indicateur scalar — its popup keeps the ordinal rank', () => {
    const couches = couchesDuTheme(payload, 'habitat')

    expect(couches.coucheParDefaut?.clef).toBe('part_passoires')
    expect(couches.coucheParDefaut?.source).toBe('indicateur')
    expect(couches.coucheParDefaut?.parDefaut).toBe(true)
    // une seule couche part_passoires dans la liste
    const clefs = couches.entrees.flatMap((e) =>
      e.type === 'couche' ? [clefDe(e)] : detailsDu(e),
    )
    expect(clefs.filter((c) => c === 'part_passoires')).toHaveLength(1)
  })

  it('the remaining declared params (part_abc, n_dpe) become story sidebar layers under the subgroup label', () => {
    const couches = couchesDuTheme(payload, 'habitat')

    expect(couches.entrees[1]).toMatchObject({ type: 'groupe' })
    const groupe = couches.entrees[1] as { type: 'groupe'; groupe: { libelle: string; couches: { source: string; clef: string }[] } }
    expect(groupe.groupe.libelle).toBe('L’état du parc')
    expect(groupe.groupe.couches.map((c) => c.clef)).toEqual(['part_abc', 'n_dpe'])
    expect(groupe.groupe.couches.every((c) => c.source === 'histoire')).toBe(true)
  })

  it('excludes the prix_m2 series entirely — headline AND vintages', () => {
    const couches = couchesDuTheme(payload, 'habitat')

    const clefs = couches.entrees.flatMap((e) =>
      e.type === 'couche' ? [clefDe(e)] : detailsDu(e),
    )
    expect(clefs).not.toContain('prix_m2')
    expect(clefs).not.toContain('2021')
  })

  it('groups the mix_logements and distribution_dpe multi-detail keys', () => {
    const couches = couchesDuTheme(payload, 'habitat')

    // les groupes d'indicateurs multi-détails suivent le groupe de la Story
    const groupes = couches.entrees.filter((e) => e.type === 'groupe').slice(1)
    expect(detailsDu(groupes[0])).toEqual(['principales', 'secondaires', 'vacants'])
    expect(detailsDu(groupes[1])).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G'])
  })

  it('labels the default from the metadata\u2019s indicator_labels — the #200 gap is closed, never a raw key', () => {
    const couches = couchesDuTheme(payload, 'habitat')

    expect(couches.coucheParDefaut?.libelle).toBe('Part de passoires thermiques')
  })
})
