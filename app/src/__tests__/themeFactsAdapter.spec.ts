import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import FigureTrajectoire from '../components/fiche/FigureTrajectoire.vue'
import { THEMES_METHODES } from '../methodes/indicateurs'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { histoiresDemographieNuage, histoiresMilieuxDuNuage, lignesAvecComparaisonApi, semanticComparisonForTheme,
  themeFactsEnvelopeFromSemantic, themeFactsRowsFromApi, themeFactsRowsFromSemantic, validerReponseComparaisonTheme } from '../payload/themeFactsAdapter'
import { projectRaccordementSemanticReads } from '../payload/raccordementSemanticProjection'
import type { ThemeSelectionMember } from '../payload/themeAcquisition'
import { semanticPublicationsCompatible } from '../payload/themeAcquisition'
import { programmesPourTerritoire } from '../payload/selectors'
import { nativeReadFixture, nativeResources } from './helpers/semanticApiFixtures'
import type { SemanticResourceDeclaration } from '../payload/semanticResourceClient'
import { territoiresFixture } from '../payload/fixtures'
import type { Payload } from '../payload/types'

const cible = { territoire: '35238', type: 'commune' as const }

function faitsHabitat(champs: Record<string, unknown> = {}) {
  return {
    contract: 'theme-facts-v1', complete_theme: false, theme_id: 'habitat',
    territory: { territory_id: '35238', name: 'Saint-Jacques', territory_type: 'commune' },
    content_version: 'habitat-scalar-v1', reference_content_version: 'territories-v1',
    profile_content_version: 'habitat-profile-v1',
    indicator_metadata: [], named_reference_evidence: [],
    indicators: [], readings: [],
    ...champs,
  }
}

function faitsMilieux(champs: Record<string, unknown> = {}) {
  return { ...faitsHabitat(), theme_id: 'milieux', ...champs }
}

const sources = () => [{
  source_id: 'habitat_api', name: 'Source API habitat', vintage_id: 'api-v1', version: 'api-v1',
  reference_date: null, publication_date: null,
}]

describe('themeFactsAdapter — le contrat theme-facts-v1 en lignes de fiche (#627)', () => {
  it('attache uniquement les rangs disponibles de la comparaison API sans modifier les valeurs focales', () => {
    const row = { territoire: '35238', type: 'commune' as const, theme: 'habitat' as const, key: 'part_passoires', detail: null,
      vintage_source: '', vintage_version: '', vintage_date_reference: null, vintage_date_publication: null,
      value: 0.2, unit: '%', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null }
    const result = lignesAvecComparaisonApi([row], { results: [{ indicator_id: 'part_passoires', status: 'available', direction: 'low', rank: 3, rank_size: 14 }], profile_comparisons: [] }, 'Densité')
    expect(result[0]).toMatchObject({ value: 0.2, rang_epci: null, comparaisonApi: { rang: 3, taille: 14, portee: 'Densité' } })
    expect(lignesAvecComparaisonApi([row], { results: [{ indicator_id: 'part_passoires', status: 'unavailable', direction: 'low', rank: null, rank_size: null }], profile_comparisons: [] }, null)[0]?.comparaisonApi).toBeUndefined()
    expect(lignesAvecComparaisonApi([row], null, null)[0]?.comparaisonApi).toBeUndefined()
    expect(() => lignesAvecComparaisonApi([row], { results: {}, profile_comparisons: [] }, null)).toThrow()
    expect(() => lignesAvecComparaisonApi([row], { results: [{ indicator_id: 'part_passoires',
      status: 'available', direction: 'up', rank: 1, rank_size: 2 }], profile_comparisons: [] }, null)).toThrow(/direction/i)
    expect(() => lignesAvecComparaisonApi([row], { results: [{ indicator_id: 'part_passoires',
      status: 'pending', direction: 'low', rank: 1, rank_size: 2 }], profile_comparisons: [] }, null)).toThrow(/statut/i)
  })

  it('attaches an ordered-series comparison only to its producer-declared comparison axis', () => {
    const rows = ['2024', '2025'].map((axis) => ({ territoire: cible.territoire, type: 'commune' as const,
      theme: 'programmes' as const, key: 'subventions_annuelles', detail: null, dimension: axis,
      value: axis === '2024' ? 100 : 200, unit: '€', vintage_source: 'Source', vintage_version: 'v1',
      vintage_date_reference: '2025-01-01', vintage_date_publication: null,
      rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null }))
    const result = lignesAvecComparaisonApi(rows, { results: [{ indicator_id: 'subventions_annuelles',
      source_facet: '2025', status: 'available', direction: 'high', rank: 2, rank_size: 14 }], profile_comparisons: [] }, 'Densité')
    expect(result.find((row) => row.dimension === '2024')?.comparaisonApi).toBeUndefined()
    expect(result.find((row) => row.dimension === '2025')?.comparaisonApi).toEqual({ rang: 2, taille: 14,
      portee: 'Densité', direction: 'high' })
  })

  it('refuses comparison direction, status, facet, or scope that contradict the producer contract', () => {
    const declaration = nativeResources('habitat').find((resource) => resource.resource_id === 'prix_m2')!
    const response = (patch: Record<string, unknown> = {}) => ({ theme_id: 'habitat', comparison_reads: [{
      resource: 'prix_m2', declaration, shapes: declaration.shapes, data: {
        contract: 'indicator-comparison-v1', indicator_id: 'prix_m2', shape: 'scalar',
        content_version: 'scalar-v1', reference_content_version: 'territories-v1',
        target: { kind: 'territory', type: 'commune', id: cible.territoire }, selection: null,
        scope: { kind: 'density_class', territory_type: 'commune', density_class_code: 'D1', member_count: 2 },
        result: { indicator_id: 'prix_m2', source_facet: 'prix_m2', status: 'available',
          direction: 'low', rank: 1, rank_size: 2 },
        ...patch,
      },
    }] })
    const targetAttendu = { type: cible.type, id: cible.territoire }

    expect(() => validerReponseComparaisonTheme('habitat', response({ result: {
      indicator_id: 'prix_m2', source_facet: 'prix_m2', status: 'available',
      direction: 'high', rank: 1, rank_size: 2,
    } }), undefined, targetAttendu)).toThrow(/direction/i)
    expect(() => validerReponseComparaisonTheme('habitat', response({ result: {
      indicator_id: 'prix_m2', source_facet: 'prix_m2', status: 'measured',
      direction: 'low', rank: 1, rank_size: 2,
    } }), undefined, targetAttendu)).toThrow(/statut|status/i)
    expect(() => validerReponseComparaisonTheme('habitat', response({ result: {
      indicator_id: 'prix_m2', source_facet: '2025', status: 'available',
      direction: 'low', rank: 1, rank_size: 2,
    } }), undefined, targetAttendu)).toThrow(/facette/i)
    expect(() => validerReponseComparaisonTheme('habitat', response({
      scope: { kind: 'invented_scope', member_count: 2 },
    }), undefined, targetAttendu)).toThrow(/portée|scope/i)
    expect(() => validerReponseComparaisonTheme('habitat', response({ scope: null }), undefined, targetAttendu))
      .toThrow(/portée|scope/i)
    const requestedMixed = [
      { territory_type: 'epci' as const, territory_id: 'synthetic-epci-1' },
      { territory_type: 'commune' as const, territory_id: 'synthetic-commune-1' },
    ]
    const explicitResponse = (selected: typeof requestedMixed, resolvedCount: number, scopeCount = resolvedCount) => {
      const available = resolvedCount >= 2
      const eligibleCount = available ? resolvedCount - 1 : resolvedCount
      const body = response({ selection: selected.map(({ territory_type, territory_id }) =>
        ({ territory_type, territory_id })),
      scope: { kind: 'explicit_selection', member_count: scopeCount },
      result: { indicator_id: 'prix_m2', source_facet: 'prix_m2', status: available ? 'available' : 'unavailable',
        reason: available ? null : resolvedCount === 0 ? 'no_selected_comparable_values' : 'fewer_than_two_comparable_values',
        direction: 'low', selected_member_count: resolvedCount, eligible_count: eligibleCount,
        missing_count: resolvedCount - eligibleCount, rank: available ? 2 : null,
        rank_size: available ? eligibleCount : null } }) as Record<string, any>
      body.selection = selected.map((member) => ({ ...member }))
      return body
    }
    const resolvedMixed = explicitResponse(requestedMixed, 3)
    expect(() => validerReponseComparaisonTheme('habitat', resolvedMixed, requestedMixed, targetAttendu)).not.toThrow()
    expect(semanticComparisonForTheme(resolvedMixed, { target: { territoire: cible.territoire, type: cible.type } }))
      .toMatchObject({ scope: { kind: 'explicit_selection', member_count: 3 },
        results: [{ selected_member_count: 3, rank_size: 2 }] })
    for (const malformedScope of [-1, 1.5, 2]) {
      expect(() => validerReponseComparaisonTheme('habitat', explicitResponse(requestedMixed, 3, malformedScope),
        requestedMixed, targetAttendu)).toThrow(/portée|scope/i)
    }
    const duplicateMixed = [requestedMixed[0]!, requestedMixed[0]!]
    expect(() => validerReponseComparaisonTheme('habitat', explicitResponse(duplicateMixed, 3), duplicateMixed,
      targetAttendu)).toThrow(/portée|scope/i)
    const wrongEcho = explicitResponse(requestedMixed, 3)
    wrongEcho.selection[1]!.territory_id = 'another-commune'
    expect(() => validerReponseComparaisonTheme('habitat', wrongEcho, requestedMixed, targetAttendu))
      .toThrow(/sélection/i)
    const wrongDataEcho = explicitResponse(requestedMixed, 3)
    wrongDataEcho.comparison_reads[0]!.data.selection[1]!.territory_id = 'another-commune'
    expect(() => validerReponseComparaisonTheme('habitat', wrongDataEcho, requestedMixed, targetAttendu))
      .toThrow(/sélection/i)
    const invalidResolvedCount = explicitResponse(requestedMixed, 3)
    invalidResolvedCount.comparison_reads[0]!.data.result.selected_member_count = -1
    expect(() => validerReponseComparaisonTheme('habitat', invalidResolvedCount, requestedMixed, targetAttendu))
      .toThrow(/portée|scope/i)
    const singleton = [{ territory_type: 'commune' as const, territory_id: 'synthetic-commune-1' }]
    expect(() => validerReponseComparaisonTheme('habitat', explicitResponse(singleton, 1), singleton,
      targetAttendu)).not.toThrow()
    expect(() => validerReponseComparaisonTheme('habitat', explicitResponse(singleton, 0), singleton,
      targetAttendu)).toThrow(/portée|scope/i)
    expect(() => validerReponseComparaisonTheme('habitat', explicitResponse([], 0), [], targetAttendu)).not.toThrow()
    const resolvedWithoutMeasuredComparables = explicitResponse(requestedMixed, 2)
    Object.assign(resolvedWithoutMeasuredComparables.comparison_reads[0]!.data.result, {
      status: 'unavailable', reason: 'no_selected_comparable_values', eligible_count: 0,
      missing_count: 2, rank: null, rank_size: null,
    })
    expect(() => validerReponseComparaisonTheme('habitat', resolvedWithoutMeasuredComparables,
      requestedMixed, targetAttendu)).not.toThrow()
    expect(() => semanticComparisonForTheme(response({
      selection: [{ territory_type: 'commune', territory_id: '1' },
        { territory_type: 'commune', territory_id: '2' }],
      scope: { kind: 'explicit_selection', member_count: 1 },
    }), { target: { territoire: cible.territoire, type: cible.type } })).toThrow(/portée|scope/i)
    const curve = nativeResources('mobilite').find((resource) => resource.resource_id === 'raccordement_courbe')!
    const regionTarget = { type: 'region' as const, id: '53' }
    const focalCurve = nativeReadFixture({ target: { kind: 'territory', ...regionTarget },
      intent: { kind: 'facts' } }, curve)
    const focalCurveRead = { resource: curve.resource_id, declaration: curve, shapes: curve.shapes, data: focalCurve }
    const regionComparison = (resultPatch: Record<string, unknown> = {}, targetId = regionTarget.id) => ({ theme_id: 'mobilite',
      comparison_reads: [{ resource: curve.resource_id, declaration: curve, shapes: curve.shapes, data: {
        contract: 'indicator-comparison-v1', indicator_id: curve.indicator_id, shape: 'series',
        content_version: focalCurve.content_version, reference_content_version: focalCurve.reference_content_version,
        target: { kind: 'territory', type: regionTarget.type, id: targetId }, selection: null, scope: null,
        result: { indicator_id: curve.indicator_id, source_facet: focalCurve.comparison_point, status: 'unavailable',
          reason: 'unsupported_comparison_contract', direction: curve.direction, selected_member_count: 0,
          eligible_count: 0, missing_count: 0, mean: null, mean_curve: null, comparison_sources: [],
          rank: null, rank_size: null, owned_content_version: focalCurve.content_version, ...resultPatch },
      } }] })
    expect(() => validerReponseComparaisonTheme('mobilite', regionComparison(), undefined, regionTarget)).not.toThrow()
    expect(semanticComparisonForTheme(regionComparison(), undefined, [focalCurveRead], regionTarget))
      .toMatchObject({ results: [{ indicator_id: curve.resource_id, status: 'unavailable', mean: null }],
        scope: null })
    expect(() => validerReponseComparaisonTheme('mobilite', regionComparison({ status: 'available' }), undefined, regionTarget))
      .toThrow(/portée|scope/i)
    expect(() => validerReponseComparaisonTheme('mobilite', regionComparison({}, '54'), undefined, regionTarget))
      .toThrow(/cible|territoire|incompatible/i)
    expect(() => validerReponseComparaisonTheme('mobilite', regionComparison({ owned_content_version: 'stale-series-v0' }),
      undefined, regionTarget)).toThrow(/publication|version|propriét|série/i)
    expect(() => validerReponseComparaisonTheme('mobilite', regionComparison({ indicator_id: 'other-series' }),
      undefined, regionTarget)).toThrow(/identité|indicateur|ressource|facette/i)
    expect(() => semanticComparisonForTheme(regionComparison({}, '54'), undefined,
      [focalCurveRead], regionTarget)).toThrow(/cible|territoire|incompatible/i)
    expect(() => semanticComparisonForTheme(regionComparison({ owned_content_version: 'stale-series-v0' }),
      undefined, [focalCurveRead], regionTarget)).toThrow(/publication|version|propriét|série/i)
    expect(() => semanticComparisonForTheme(regionComparison({ indicator_id: 'other-series' }), undefined,
      [focalCurveRead], regionTarget)).toThrow(/identité|indicateur|ressource|facette/i)
  })

  it('projects native semantic comparison results onto the fiche rank seam without replacing focal values', () => {
    const response = { theme_id: 'habitat', comparison_reads: [{
      resource: 'part_passoires', shapes: ['scalar'], data: {
        resource: 'part_passoires', target: { kind: 'territory', type: 'commune', id: cible.territoire },
        contract: 'indicator-comparison-v1', indicator_id: 'part_passoires', shape: 'scalar',
        content_version: 'scalar-v1', reference_content_version: 'territories-v1', selection: null,
        scope: { kind: 'density_class', territory_type: 'commune', density_class_code: 'D1', member_count: 14 },
        result: { indicator_id: 'part_passoires', source_facet: 'part_passoires',
          status: 'available', direction: 'low', rank: 3, rank_size: 14 },
      },
    }] }
    const target = { type: cible.type, id: cible.territoire }
    validerReponseComparaisonTheme('habitat', response, undefined, target)
    const comparison = semanticComparisonForTheme(response, { target: { territoire: target.id, type: target.type } })
    const row = { territoire: cible.territoire, type: 'commune' as const, theme: 'habitat' as const,
      key: 'part_passoires', detail: null, value: 0.2, unit: '%', vintage_source: '', vintage_version: '',
      vintage_date_reference: null, vintage_date_publication: null, rang_epci: null, rang_epci_n: null,
      rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null }
    expect(lignesAvecComparaisonApi([row], comparison, 'Même classe de densité')[0]).toMatchObject({
      value: 0.2, rang_epci: null, comparaisonApi: { rang: 3, taille: 14, portee: 'Même classe de densité' },
    })
  })

  it('retains valid Milieux cloud points alongside explicit source-absence evidence', () => {
    const members = [{ id: '1', type: 'commune', name: 'Focal' }, { id: '2', type: 'commune', name: 'Absent peer' }]
    const declaration = nativeResources('milieux').find((resource) => resource.resource_id === 'artif_par_habitant')!
    const fact = { groupe: 'artificialisation', source_id: 'population', vintage_id: '2023', status: 'measured',
      periode_pop: '2020', periode_artif: '2021', taux_variation_population: 0.02,
      artif_m2_par_habitant: 10, artif_m3_par_habitant: 12 }
    const absence = { territory_id: '2', territory_type: 'commune', reason: 'source_record_absent',
      source_id: 'conso', vintage_id: '2025', source_snapshot_sha256: 'a'.repeat(64) }
    const response = { theme_id: 'milieux', comparison_reads: [{ resource: 'artif_par_habitant',
      declaration, shapes: declaration.shapes, data: {
      contract: 'indicator-comparison-v1', indicator_id: 'artif_par_habitant', shape: 'series',
      content_version: 'milieux-series-v1', reference_content_version: 'reference-v1',
      target: { kind: 'territory', type: 'commune', id: '1' }, selection: members.map(({ id, type }) =>
        ({ territory_id: id, territory_type: type })),
      result: { indicator_id: 'artif_par_habitant', source_facet: null, status: 'unavailable',
        reason: 'fewer_than_two_comparable_values', direction: declaration.direction,
        selected_member_count: 2, eligible_count: 1, missing_count: 1, rank: null, rank_size: null },
      scope: { kind: 'explicit_selection', member_count: 2 },
    } }], cohort_reads: [{ resource: 'milieux_selected_reading', shapes: ['typed_reading'], data: {
      content_version: 'reading-v1', reference_content_version: 'reference-v1',
      cohort: { territory_type: 'commune', member_count: 2, reference_content_version: 'reference-v1', members },
      territories: [{ territory: members[0], facts: [fact] }, { territory: members[1], facts: [], source_absences: [absence] }],
    } }] }
    const focalReads = [{ resource: 'milieux_selected_reading', shapes: ['typed_reading'], data: {
      content_version: 'reading-v1', reference_content_version: 'reference-v1', facts: [fact],
    } }]
    const comparison = semanticComparisonForTheme(response, { target: { territoire: '1', type: 'commune' } }, focalReads)
    expect(comparison?.reading_cloud).toMatchObject({ status: 'available',
      points: [{ territory: { territory_id: '1' }, artif_m2_par_habitant: 10 }],
      source_absences: [absence] })
    const unexplainedMissing = structuredClone(response)
    delete (unexplainedMissing.cohort_reads[0]!.data.territories[1] as Record<string, unknown>).source_absences
    const unexplained = semanticComparisonForTheme(unexplainedMissing,
      { target: { territoire: '1', type: 'commune' } }, focalReads)
    expect(unexplained?.reading_cloud).toBeUndefined()
    expect(unexplained?.reading_cloud_error).toBe(true)
  })

  it('builds a typed cloud from bounded producer facts only inside the API-resolved density scope', () => {
    const focalReads = [
      { resource: 'demographie_selected_reading', shapes: ['typed_reading'], data: {
        resource: 'demographie_selected_reading', target: { kind: 'territory', type: 'commune', id: '1' },
        content_version: 'reading-v1', reference_content_version: 'reference-v1',
        facts: [{ groupe: 'producer-group', source_id: 'insee', vintage_id: '2023', status: 'measured' }],
      } },
      { resource: 'densite', shapes: ['scalar'], data: {
        resource: 'densite', target: { kind: 'territory', type: 'commune', id: '1' }, value: 42,
      } },
    ]
    const response = { theme_id: 'demographie', selection: undefined,
      comparison_reads: [{ resource: 'densite', shapes: ['scalar'], data: {
        resource: 'densite', target: { kind: 'territory', type: 'commune', id: '1' },
        contract: 'indicator-comparison-v1', indicator_id: 'densite', shape: 'scalar',
        content_version: 'scalar-v1', reference_content_version: 'reference-v1', selection: null,
        scope: { kind: 'density_class', territory_type: 'commune', density_class_code: 'D1', member_count: 2 },
        result: { indicator_id: 'densite', source_facet: 'densite', status: 'available', direction: 'high', rank: 1, rank_size: 2 },
      } }],
      cohort_reads: [{ resource: 'demographie_selected_reading', shapes: ['typed_reading'], data: {
        resource: 'demographie_selected_reading',
        target: { kind: 'territory_cohort', type: 'commune', department_id: null, epci_id: null },
        content_version: 'reading-v1', reference_content_version: 'reference-v1',
        cohort: { territory_type: 'commune', department_id: null, epci_id: null,
          member_count: 3, reference_content_version: 'reference-v1', members: [
            { id: '1', type: 'commune', name: 'Focal' }, { id: '2', type: 'commune', name: 'Peer' },
            { id: '3', type: 'commune', name: 'Other density' },
          ] },
        territories: [
          { territory: { id: '1', type: 'commune', name: 'Focal' }, facts: [{ groupe: 'producer-group', source_id: 'insee', vintage_id: '2023', status: 'measured', periode: '2020', taux_solde_naturel: 1, taux_solde_migratoire: -1 }] },
          { territory: { id: '2', type: 'commune', name: 'Peer' }, facts: [{ groupe: 'producer-group', source_id: 'insee', vintage_id: '2023', status: 'measured', periode: '2020', taux_solde_naturel: 2, taux_solde_migratoire: -2 }] },
          { territory: { id: '3', type: 'commune', name: 'Other density' }, facts: [{ groupe: 'producer-group', source_id: 'insee', vintage_id: '2023', status: 'measured', periode: '2020', taux_solde_naturel: 99, taux_solde_migratoire: 99 }] },
        ],
      } }],
    }
    const comparison = semanticComparisonForTheme(response, { target: {
      territoire: '1', type: 'commune', classe_densite_code: 'D1',
    }, territories: [
      { territoire: '1', type: 'commune', classe_densite_code: 'D1' },
      { territoire: '2', type: 'commune', classe_densite_code: 'D1' },
      { territoire: '3', type: 'commune', classe_densite_code: 'D2' },
    ] }, focalReads)
    expect(comparison?.scope).toMatchObject({ kind: 'density_class', density_class_code: 'D1', member_count: 2 })
    expect(histoiresDemographieNuage(comparison).map(({ territoire, taux_solde_naturel }) => [territoire, taux_solde_naturel]))
      .toEqual([['1', 1], ['2', 2]])

    const withoutSourceIdentity: any = structuredClone(response)
    delete withoutSourceIdentity.cohort_reads[0]!.data.territories[1]!.facts[0]!.source_id
    const incomplete = semanticComparisonForTheme(withoutSourceIdentity, { target: {
      territoire: '1', type: 'commune', classe_densite_code: 'D1',
    }, territories: [
      { territoire: '1', type: 'commune', classe_densite_code: 'D1' },
      { territoire: '2', type: 'commune', classe_densite_code: 'D1' },
      { territoire: '3', type: 'commune', classe_densite_code: 'D2' },
    ] }, focalReads)
    expect(incomplete?.reading_cloud).toBeUndefined()
  })

  it('consumes a native typed fact source and its published descriptor rate unit', () => {
    const source = { source_id: 'insee', vintage_id: '2023', name: 'Published reading source', version: '2023',
      reference_date: null, publication_date: '2026-01-02' }
    const response = { theme_id: 'demographie', resource_reads: [{ resource: 'demographie_selected_reading',
      shapes: ['typed_reading'], data: { resource: 'demographie_selected_reading',
        target: { kind: 'territory', type: 'commune', id: cible.territoire },
        content_version: 'reading-v1', reference_content_version: 'reference-v1',
        descriptor: { descriptor_version: 'reading-v1', rate_unit: '‰/an', source },
        facts: [{ groupe: 'producer-group', story_key: 'trajectoire-demographique',
          salience_reason: 'defaut', status: 'measured', periode: '2020', solde_naturel: 1,
          solde_migratoire: 2, taux_solde_naturel: 0.3, taux_solde_migratoire: -0.2,
          classification: 'balanced', source_id: 'insee', vintage_id: '2023', source }] } }] }
    const adapted = themeFactsRowsFromSemantic('demographie', response, cible)
    expect(adapted.unavailableReadings).toEqual([])
    expect(adapted.histoires).toEqual([expect.objectContaining({
      taux_solde_naturel: 0.3, vintage_source: 'Published reading source', vintage_version: '2023',
      vintage_date_reference: null, vintage_date_publication: '2026-01-02',
    })])
    const inconsistentSource = structuredClone(response)
    inconsistentSource.resource_reads[0]!.data.facts[0]!.source.source_id = 'unrelated-source'
    expect(themeFactsRowsFromSemantic('demographie', inconsistentSource, cible).unavailableReadings)
      .toEqual(['demographie_selected_reading'])
  })

  it('does not borrow a typed-reading source label from an unrelated resource', () => {
    const response = { theme_id: 'demographie', resource_reads: [
      { resource: 'densite', shapes: ['scalar'], data: { resource: 'densite',
        target: { kind: 'territory', type: 'commune', id: cible.territoire },
        value: 20, status: 'measured', unit: 'hab/km²', sources: [{ source_id: 'insee', vintage_id: '2023',
          name: 'Unrelated density provenance', version: '2023', reference_date: null, publication_date: null }] } },
      { resource: 'demographie_selected_reading', shapes: ['typed_reading'], data: { resource: 'demographie_selected_reading',
        target: { kind: 'territory', type: 'commune', id: cible.territoire },
        content_version: 'reading-v1', reference_content_version: 'reference-v1',
        facts: [{ groupe: 'producer-group', story_key: 'trajectoire-demographique',
          salience_reason: 'defaut', status: 'measured', periode: '2020', solde_naturel: 1,
          solde_migratoire: 2, taux_solde_naturel: 0.3, taux_solde_migratoire: -0.2,
          classification: 'balanced', rate_unit: '‰/an', source_id: 'insee', vintage_id: '2023' }] } },
    ] }
    const adapted = themeFactsRowsFromSemantic('demographie', response, cible)
    expect(adapted.histoires).toEqual([])
    expect(adapted.unavailableReadings).toEqual(['demographie_selected_reading'])
  })

  it('marks a typed reading unavailable when its own resource has no source identity or evidence', () => {
    const response = { theme_id: 'demographie', resource_reads: [{ resource: 'demographie_selected_reading',
      shapes: ['typed_reading'], data: { resource: 'demographie_selected_reading',
        target: { kind: 'territory', type: 'commune', id: cible.territoire },
        content_version: 'reading-v1', reference_content_version: 'reference-v1',
        facts: [{ groupe: 'producer-group', story_key: 'trajectoire-demographique', salience_reason: 'defaut',
          status: 'measured', periode: '2020', solde_naturel: 1, solde_migratoire: 2,
          taux_solde_naturel: 0.3, taux_solde_migratoire: -0.2, classification: 'balanced', rate_unit: '‰/an' }] } }] }
    const adapted = themeFactsRowsFromSemantic('demographie', response, cible)
    expect(adapted.histoires).toEqual([])
    expect(adapted.unavailableReadings).toEqual(['demographie_selected_reading'])
  })

  it('projects native scalar, declared-profile cells, and ordered-series points with their own axes and evidence', () => {
    const source = [{ source_id: 'dpe', vintage_id: '2025', source_name: 'DPE source', version: '2025',
      reference_date: '2025-01-01', publication_date: null }]
    const adapted = themeFactsRowsFromSemantic('habitat', { resource_reads: [
      { resource: 'part_passoires', shapes: ['scalar'], data: { resource: 'part_passoires',
        target: { kind: 'territory', type: 'commune', id: cible.territoire },
        indicator_id: 'part_passoires', unit: '%', value: 0.42, status: 'measured', sources: source } },
      { resource: 'distribution_dpe', shapes: ['declared_profile'], data: { resource: 'distribution_dpe',
        target: { kind: 'territory', type: 'commune', id: cible.territoire }, content_version: 'profile-v1',
        descriptor: { indicator_id: 'distribution_dpe', unit: '%', axes: [{ name: 'detail', key: 'A' }] },
        observations: [{ detail: 'A', value: 0.25, status: 'measured', unit: '%', sources: source }] } },
      { resource: 'prix_m2', shapes: ['ordered_series'], data: { resource: 'prix_m2',
        target: { kind: 'territory', type: 'commune', id: cible.territoire }, publication_id: 'series-v1',
        reference_content_version: 'territories-v1', indicator_id: 'prix_m2', axis_kind: 'year',
        axis_values: ['2024', '2025'], axis_numeric_values: [2024, 2025], unit: '€/m²',
        points: [{ axis: '2024', observation_period: '2024', value: 3000, status: 'measured', provenance: source },
          { axis: '2025', observation_period: '2025', value: null, status: 'missing', missing_reason: 'not_published', provenance: source }] } },
    ] }, cible)
    expect(adapted.indicateurs.map((row) => [row.key, row.detail, row.value, row.observation_status])).toEqual([
      ['part_passoires', null, 0.42, 'measured'], ['distribution_dpe', 'A', 0.25, 'measured'],
      ['prix_m2', '2024', 3000, 'measured'], ['prix_m2', '2025', null, 'missing'],
    ])
    expect(adapted.indicateurs.every((row) => row.fact_sources?.[0]?.source === 'DPE source')).toBe(true)
  })

  it('retains the named-reference target and joins its publication to the matching owner series', () => {
    const source = [{ source_id: 'gtfs', vintage_id: '2026', source_name: 'GTFS source', version: '2026',
      reference_date: null, publication_date: null }]
    const response = { resource_reads: [{ resource: 'raccordement_courbe', shapes: ['ordered_series'], data: {
      resource: 'raccordement_courbe', target: { kind: 'territory', type: 'commune', id: cible.territoire },
      dataset_id: 'raccordement_courbe', publication_id: 'series-v1', reference_content_version: 'territories-v1',
      indicator_id: 'raccordement_courbe', unit: '%', axis_kind: 'duration_minute', axis_values: ['0'],
      axis_numeric_values: [0], completeness: 'dense_complete', descriptor_version: 'curve-v1',
      comparison_point: '0', comparison_contract: { statistic: 'mean', scope: 'selected_group' },
      points: [{ axis: '0', observation_period: '2026-01-01', value: 1, status: 'measured', provenance: source }],
      named_references: [],
    } }], named_reference_reads: [{ resource: 'raccordement_reference', shapes: ['named_reference'], data: {
      resource: 'raccordement_reference', target: { kind: 'named_reference', id: 'bretagne-reference' },
      dataset_id: 'raccordement_courbe', publication_id: 'series-v1', reference_content_version: 'territories-v1',
      indicator_id: 'raccordement_reference', unit: '%', reference: { id: 'bretagne-reference', label: 'Bretagne',
        role: 'analytical_reference', statistic: 'mean', required: true },
      points: [{ axis: '0', observation_period: '2026-01-01', value: 2, status: 'measured', provenance: source }],
    } }] }
    const normalized = themeFactsEnvelopeFromSemantic('mobilite', response as any, cible)
    expect(normalized.named_reference_evidence).toEqual([expect.objectContaining({
      indicator_id: 'raccordement_courbe', id: 'bretagne-reference', role: 'analytical_reference',
      points: [expect.objectContaining({ axis: '0', value: 2, provenance: [expect.objectContaining({ source_name: 'GTFS source' })] })],
    })])
    const invalid = structuredClone(response)
    invalid.named_reference_reads[0]!.data.publication_id = 'stale-series-v0'
    expect(() => themeFactsEnvelopeFromSemantic('mobilite', invalid as any, cible)).toThrow(/Dépendance.*incompatible/)
  })

  it('associe les comparaisons de profil à la même facette', () => {
    const row = { territoire: '35238', type: 'commune' as const, theme: 'habitat' as const, key: 'structure_age', detail: 'ancien', sex: 'F' as const,
      vintage_source: '', vintage_version: '', vintage_date_reference: null, vintage_date_publication: null,
      value: 0.4, unit: '%', rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null }
    const comparison = { results: [], profile_comparisons: [{ indicator: 'structure_age', facet: { detail: 'ancien', sex: 'M' }, status: 'available', direction: 'high', rank: 1, rank_size: 10 }] }
    expect(lignesAvecComparaisonApi([row], comparison, null)[0]?.comparaisonApi).toBeUndefined()
  })
  it('projette les adhésions ancrées et les subventions depuis leurs collections/séries sans inventer absence', () => {
    // Trimmed served capture: E:/Temp/opencode/lusk-live-captured/programmes-facts.json;
    // period_detail omits relationships in the live theme-facts-v1 contract.
    const source = [{ source_id: 'src', name: 'Source programmes', version: '2026', reference_date: '2026-01-01', publication_date: null }]
    const rows = themeFactsRowsFromApi('programmes', {
      contract: 'theme-facts-v1', theme_id: 'programmes', territory: { territory_id: '35238', territory_type: 'commune' },
      indicators: [], indicator_metadata: [], named_reference_evidence: [], readings: [],
        collections: [
        { indicator_id: 'programme_membership', kind: 'anchored_membership', unit: 'adhésion', availability: 'observed',
          entries: [
            { detail: 'ACV', rider: 'Aid rider', sources: source },
            { detail: 'PVD', rider: 'convention valant ORT', sources: source },
            { detail: 'Label sans rider', rider: null, sources: source },
            { detail: 'Rider vide', rider: '', sources: source },
          ],
          relationships: [{ detail: 'CRTE', rider: null, sources: source, anchor: { id: '243500139', type: 'epci', name: 'EPCI' }, relation: 'covering_parent' }] },
        { indicator_id: 'grants', kind: 'period_detail', availability: 'observed', unit: '€', entries: [
          { observation_period: '2025', label: 'Mobilité', value: 1234, sources: source },
        ] },
      ],
      owned_series: [{ indicator_id: 'subventions_annuelles', unit: '€', points: [
        // The live owned-series contract names this field `source_name`;
        // collection provenance uses `name`.
        { axis: '2025', value: 5678, status: 'measured', provenance: source.map(({ name, ...item }) => ({ ...item, source_name: name })) },
      ] }],
    }, cible)
    expect(rows.histoires).toEqual([])
    expect(rows.indicateurs.map((row) => [row.territoire, row.key, row.detail, row.dimension, row.value])).toEqual([
      ['35238', 'couverture_programmes', 'ACV', undefined, null],
      ['35238', 'couverture_programmes', 'PVD', undefined, null],
      ['35238', 'couverture_programmes', 'Label sans rider', undefined, null],
      ['35238', 'couverture_programmes', 'Rider vide', undefined, null],
      ['243500139', 'couverture_programmes', 'CRTE', undefined, null],
      ['35238', 'subventions_par_domaine', 'Mobilité', '2025', 1234],
      ['35238', 'subventions_annuelles', null, '2025', 5678],
    ])
    expect(rows.indicateurs.slice(0, 4).map((row) => row.rider))
      .toEqual(['Aid rider', 'convention valant ORT', null, ''])
    expect(rows.indicateurs.slice(0, 5).map((row) => row.unit)).toEqual(Array(5).fill('adhésion'))
    expect(rows.indicateurs[0]!.rider).not.toBe('convention valant ORT')
    expect(rows.indicateurs[0]!.vintage_date_reference).toBe('2026-01-01')
    const absent = themeFactsRowsFromApi('programmes', {
      contract: 'theme-facts-v1', theme_id: 'programmes', territory: { territory_id: '35238', territory_type: 'commune' },
      indicators: [], indicator_metadata: [], named_reference_evidence: [], readings: [],
      collections: [{ indicator_id: 'programme_membership', kind: 'anchored_membership', unit: 'adhésion', availability: 'no_record', entries: [], relationships: [] }],
      owned_series: [],
    }, cible)
    expect(absent.indicateurs).toEqual([])
  })

  it('recognizes only the API ORT rider and its explicit legacy spelling at the badge selector', () => {
    const target = { territoire: '22001', type: 'commune' as const }
    const source = [{ source_id: 'src', name: 'Source programmes', version: '2026',
      reference_date: '2026-01-01', publication_date: null }]
    const badgeFor = (sigle: string, rider: string | null) => {
      const adapted = themeFactsRowsFromApi('programmes', {
        contract: 'theme-facts-v1', theme_id: 'programmes',
        territory: { territory_id: target.territoire, territory_type: target.type },
        indicators: [], indicator_metadata: [], named_reference_evidence: [], readings: [], owned_series: [],
        collections: [{ indicator_id: 'programme_membership', kind: 'anchored_membership', unit: 'adhésion',
          availability: 'observed', entries: [{ detail: sigle, rider, sources: source }], relationships: [] }],
      }, target).indicateurs
      const payload: Payload = { territoires: territoiresFixture, indicateurs: adapted, histoires: [],
        apercu: null, runReport: null, vintages: [], programmes: null }
      return { rawRider: adapted[0]?.rider,
        badge: programmesPourTerritoire(payload, target.territoire).badges.find((item) => item.sigle === sigle) }
    }

    expect(badgeFor('ACV', 'Convention valant ORT')).toMatchObject({ rawRider: 'Convention valant ORT',
      badge: { conventionValantOrt: true } })
    expect(badgeFor('PVD', 'convention valant ORT')).toMatchObject({ rawRider: 'convention valant ORT',
      badge: { conventionValantOrt: true } })
    for (const unrelated of ['Aid rider', null, '']) {
      expect(badgeFor('ACV', unrelated)).toMatchObject({ rawRider: unrelated,
        badge: { conventionValantOrt: false } })
    }
  })

  it('projette le total parent de même année depuis le contexte servi (capture live programmes-facts.json)', () => {
    const provenance = [{ revision_id: 'r1', source_id: 'subventions_scdl', source_name: 'Source subventions', name: 'Source subventions',
      version: '2026-08-05', reference_date: '2026-08-05', publication_date: '2026-08-05' }]
    const response = { contract: 'theme-facts-v1', theme_id: 'programmes', territory: { territory_id: '35238', territory_type: 'commune' },
      indicators: [{ indicator_id: 'subventions_annuelles', value: 71395030.98, status: 'measured', unit: '€', sources: provenance,
        dimensions: { axis: '2025', observation_period: '2025' } }],
      indicator_metadata: [{ indicator_id: 'subventions_annuelles', unit: '€', context: { parent: { id: '243500139', type: 'epci', name: 'Rennes Métropole' },
        points: [{ axis: '2025', observation_period: '2025', value: 91260697.91, status: 'measured', provenance }] } }],
      named_reference_evidence: [], readings: [], collections: [], owned_series: [] }
    const rows = themeFactsRowsFromApi('programmes', response, cible, { epci: '243500139' }).indicateurs
    expect(rows.find((row) => row.territoire === '243500139')).toMatchObject({ type: 'epci', key: 'subventions_annuelles', dimension: '2025', value: 91260697.91, vintage_source: 'Source subventions' })
    const incoherent = themeFactsRowsFromApi('programmes', { ...response, indicator_metadata: [{ ...response.indicator_metadata[0], context: {
      parent: { id: 'other', type: 'epci' }, points: response.indicator_metadata[0]!.context.points } }] }, cible, { epci: '243500139' }).indicateurs
    expect(incoherent.some((row) => row.type === 'epci' && row.key === 'subventions_annuelles')).toBe(false)
  })

  it('échoue fermé sur date de référence absente pour une adhésion', () => {
    expect(() => themeFactsRowsFromApi('programmes', {
      contract: 'theme-facts-v1', theme_id: 'programmes', territory: { territory_id: '35238', territory_type: 'commune' },
      indicators: [], indicator_metadata: [], named_reference_evidence: [], readings: [], owned_series: [],
      collections: [{ indicator_id: 'membership', kind: 'anchored_membership', unit: 'adhésion', availability: 'observed', entries: [
        { detail: 'ACV', rider: null, sources: [{ source_id: 's', name: 'S', version: 'v', reference_date: null, publication_date: null }] },
      ], relationships: [] }],
    }, cible)).toThrow(/Date de référence/)
  })

  it('uses the declared membership unit and rejects a missing or malformed descriptor unit', () => {
    const response = (unit: unknown) => ({
      contract: 'theme-facts-v1', theme_id: 'programmes',
      territory: { territory_id: cible.territoire, territory_type: cible.type },
      indicators: [], indicator_metadata: [], named_reference_evidence: [], readings: [], owned_series: [],
      collections: [{ indicator_id: 'programme_membership', kind: 'anchored_membership', unit,
        availability: 'observed', entries: [{ detail: 'ACV', rider: null, sources: [{ source_id: 's', name: 'S',
          version: 'v', reference_date: '2026-01-01', publication_date: null }] }], relationships: [] }],
    })
    expect(themeFactsRowsFromApi('programmes', response('count'), cible).indicateurs[0]?.unit).toBe('count')
    for (const malformed of [undefined, null, '', '  ', 12]) {
      expect(() => themeFactsRowsFromApi('programmes', response(malformed), cible))
        .toThrow(/unité de collection.*absente ou invalide/i)
    }
  })

  it('mappe la lecture démographique avec provenance et rejette story/salience/taux incohérents', () => {
    const response = { ...faitsHabitat({ theme_id: 'demographie' }), readings: [{
      groupe: 'trajectoire-demographique', story_key: 'trajectoire-demographique', salience_reason: 'defaut',
      periode: '2020', solde_naturel: 1, solde_migratoire: 2, taux_solde_naturel: 0.3, taux_solde_migratoire: -0.2,
      classification: 'balanced', status: 'measured', rate_unit: '‰', provenance: {
        source_id: 's', source_name: 'Insee', source_version: '2026', source_reference_date: null, source_publication_date: null,
      },
    }] }
    const histoire = themeFactsRowsFromApi('demographie', response, cible).histoires[0] as any
    expect([histoire.periode, histoire.taux_solde_naturel, histoire.vintage_source]).toEqual(['2020', 0.3, 'Insee'])
    for (const patch of [{ story_key: 'bad' }, { salience_reason: 'bad' }, { taux_solde_naturel: null }]) {
      expect(() => themeFactsRowsFromApi('demographie', { ...response, readings: [{ ...response.readings[0], ...patch }] }, cible)).toThrow()
    }
  })
  it('ne fabrique aucun point si la comparaison ne déclare pas de cloud', () => {
    expect(histoiresDemographieNuage({ reading_cloud: null })).toEqual([])
    expect(histoiresDemographieNuage({ reading_cloud: { status: 'available', story_key: 'trajectoire-demographique',
      groupe: 'g', points: [{ territory: { territory_id: '1', territory_type: 'commune', name: 'T' },
        periode: null, taux_solde_naturel: null, taux_solde_migratoire: 2 }] } })).toEqual([])
  })
  it('refuse une réponse dont le contrat, le thème ou le territoire ne correspondent pas', () => {
    expect(() => themeFactsRowsFromApi('habitat', { contract: 'autre' }, cible)).toThrow(/contrat|Réponse/i)
    expect(() => themeFactsRowsFromApi('habitat', faitsHabitat({ theme_id: 'milieux' }), cible)).toThrow()
    expect(() => themeFactsRowsFromApi('habitat',
      faitsHabitat({ territory: { territory_id: '22001', territory_type: 'commune' } }), cible)).toThrow(/Territoire/)
    expect(() => themeFactsRowsFromApi('habitat',
      faitsHabitat({ territory: { territory_id: '35238', territory_type: 'epci' } }), cible)).toThrow(/Territoire/)
  })

  it('mappe scalaire, cellule de profil et point de série en lignes du même grain que le modèle', () => {
    const rows = themeFactsRowsFromApi('habitat', faitsHabitat({
      indicators: [
        { indicator_id: 'part_passoires', label: 'part_passoires', unit: '%', value: 0.42, status: 'measured',
          dimensions: {}, sources: sources() },
        { indicator_id: 'distribution_dpe', label: 'distribution_dpe', unit: '%', value: 0.05, status: 'measured',
          dimensions: { detail: 'A' }, sources: sources() },
        { indicator_id: 'prix_m2', label: 'prix_m2', unit: '€/m²', value: 4242, status: 'measured',
          dimensions: { axis: '2025', numeric_axis_value: 2025 }, sources: sources() },
      ],
    }), cible)
    expect(rows.indicateurs.map((row) => [row.key, row.detail, row.value])).toEqual([
      ['part_passoires', null, 0.42],
      ['distribution_dpe', 'A', 0.05],
      ['prix_m2', '2025', 4242],
    ])
    // Les colonnes de rang héritées restent null : le contrat de compatibilité
    // retiré ne se repeuple jamais depuis une portée déclarée différente.
    expect(rows.indicateurs.every((row) => row.rang_epci === null && row.rang_reg === null &&
      row.rang_dep === null && row.rang_epci_n === null)).toBe(true)
    expect(rows.indicateurs.every((row) => row.vintage_source === 'Source API habitat' &&
      row.vintage_version === 'api-v1')).toBe(true)
  })

  it('projects the native DVF pooled scalar facet without promoting it to a top-level series value', () => {
    const resource = nativeResources('habitat').find((item) => item.resource_id === 'prix_m2')!
    const response = nativeReadFixture({ target: { kind: 'territory', type: 'commune', id: '35238' },
      intent: { kind: 'facts' } }, resource)
    expect(response.points).toContainEqual(expect.objectContaining({ axis: '2025' }))
    expect(response).not.toHaveProperty('value')
    expect(response.scalar_facet).toMatchObject({ shape: 'scalar', source_facet: 'prix_m2',
      descriptor: { indicator_id: 'prix_m2', unit: '€/m²' }, observation: { territory_id: '35238' } })
    expect(response.scalar_facet.content_version).not.toBe(response.content_version)

    const declaration = resource as unknown as SemanticResourceDeclaration
    const envelope = themeFactsEnvelopeFromSemantic('habitat', { resource_reads: [{ resource: resource.resource_id,
      shapes: resource.shapes, declaration, data: response }] }, cible)
    expect(envelope.owned_series as unknown[]).toHaveLength(1)
    expect((envelope.indicators as Array<Record<string, unknown>>)
      .find((fact) => fact.indicator_id === 'prix_m2')).toMatchObject({
      indicator_id: 'prix_m2', value: response.scalar_facet.observation.value,
      unit: response.scalar_facet.descriptor.unit,
    })
    const rows = themeFactsRowsFromSemantic('habitat', { resource_reads: [{ resource: resource.resource_id,
      shapes: resource.shapes, declaration, data: response }] }, cible).indicateurs
    expect(rows.find((fact) => fact.key === 'prix_m2' && fact.detail === null)?.value)
      .toBe(response.scalar_facet.observation.value)
    expect(rows.some((fact) => fact.key === 'prix_m2' && fact.detail === '2025' &&
      (fact.observation_status === 'measured' || fact.observation_status === 'missing'))).toBe(true)

    const noFacet = structuredClone(response)
    delete noFacet.scalar_facet
    const withoutFacet = themeFactsEnvelopeFromSemantic('habitat', { resource_reads: [{ resource: resource.resource_id,
      shapes: resource.shapes, declaration, data: noFacet }] }, cible)
    expect((withoutFacet.indicators as Array<Record<string, unknown>>)
      .some((fact) => fact.indicator_id === 'prix_m2')).toBe(false)
    expect(withoutFacet.owned_series).toHaveLength(1)

    const corruptedFacet = structuredClone(response)
    corruptedFacet.scalar_facet.source_facet = '2025'
    expect(() => themeFactsEnvelopeFromSemantic('habitat', { resource_reads: [{ resource: resource.resource_id,
      shapes: resource.shapes, declaration, data: corruptedFacet }] }, cible)).toThrow(/facette scalaire/i)

    const unavailableFacet = structuredClone(response)
    unavailableFacet.scalar_facet.observation = { ...unavailableFacet.scalar_facet.observation,
      status: 'unavailable', value: null, support_count: null, denominator_count: null, sources: [] }
    const unavailableRows = themeFactsRowsFromSemantic('habitat', { resource_reads: [{ resource: resource.resource_id,
      shapes: resource.shapes, declaration, data: unavailableFacet }] }, cible).indicateurs
    expect(unavailableRows.find((fact) => fact.key === 'prix_m2' && fact.detail === null))
      .toMatchObject({ value: null, fact_status: 'unavailable' })
  })

  it('projects the native DVF pooled scalar and rank separately from its annual series facet', () => {
    const nativeResource = nativeResources('habitat').find((resource) => resource.resource_id === 'prix_m2')!
    const apiDirection = nativeResource.direction
    const scalarSources = [{ source_id: 'dvf', name: 'DVF pooled fixture', vintage_id: 'dvf-2026',
      version: '2026', reference_date: '2026-01-01', publication_date: '2026-01-02' }]
    const seriesSources = scalarSources.map(({ name, ...item }) => ({ ...item, source_name: name }))
    const scalarDescriptor = { indicator_id: 'prix_m2', unit: '€/m²', direction: apiDirection, completeness: 'sparse',
      descriptor_version: 'scalar-descriptor-v1' }
    const focal = { resource: 'prix_m2', shapes: ['scalar', 'ordered_series'], data: {
      resource: 'prix_m2', target: { kind: 'territory', type: 'commune', id: cible.territoire },
      dataset_id: 'dvf_prix_m2', theme_id: 'habitat', publication_id: 'series-publication-v1',
      content_version: 'series-publication-v1', reference_content_version: 'reference-v1',
      territory: { id: cible.territoire, type: 'commune' },
      descriptor_version: 'series-descriptor-v1', indicator_id: 'prix_m2', unit: '€/m²',
      label: nativeResource.label, direction: apiDirection,
      axis_kind: 'year', axis_values: ['2024', '2025'], axis_numeric_values: [2024, 2025], comparison_point: '2025',
      points: [
        { axis: '2024', observation_period: '2024', value: 211, status: 'measured', provenance: seriesSources },
        { axis: '2025', observation_period: '2025', value: 230, status: 'measured', provenance: seriesSources },
      ],
      scalar_facet: { shape: 'scalar', source_facet: 'prix_m2', content_version: 'scalar-publication-v1',
        reference_content_version: 'reference-v1', descriptor_version: 'scalar-descriptor-v1',
        descriptor: scalarDescriptor,
        observation: { territory_id: cible.territoire, territory_type: 'commune', status: 'measured',
          value: 700, support_count: 12, denominator_count: 20, sources: scalarSources } },
    } }
    const densityScope = { kind: 'density_class', territory_type: 'commune', density_class_code: 'D1', member_count: 2 }
    const comparison = { theme_id: 'habitat', comparison_reads: [{ resource: 'prix_m2', shapes: focal.shapes,
      data: { resource: 'prix_m2', target: focal.data.target, contract: 'indicator-comparison-v1',
        complete_theme: false, indicator_id: 'prix_m2', theme_id: 'habitat', shape: 'series',
        content_version: 'series-publication-v1',
        reference_content_version: 'reference-v1', selection: null,
        scope: densityScope,
        result: { indicator_id: 'prix_m2', source_facet: '2025', status: 'available', direction: apiDirection,
          unit: '€/m²',
          descriptor_version: 'series-descriptor-v1', rank: 2, rank_size: 2,
          owned_content_version: 'series-publication-v1' },
        scalar_facet: { shape: 'scalar', source_facet: 'prix_m2', content_version: 'scalar-publication-v1',
          reference_content_version: 'reference-v1', descriptor_version: 'scalar-descriptor-v1',
          comparison_content_version: 'scalar-comparison-publication-v1',
          descriptor: scalarDescriptor, selection: null, scope: densityScope,
          result: { indicator_id: 'prix_m2', source_facet: 'prix_m2', status: 'available', direction: apiDirection,
            descriptor_version: 'scalar-descriptor-v1', rank: 1, rank_size: 2 } },
      } }] }

    const reads = [{ ...focal, declaration: nativeResources('habitat').find((item) => item.resource_id === 'prix_m2') }]
    const projected = themeFactsRowsFromSemantic('habitat', { resource_reads: reads } as any, cible).indicateurs
    const pooled = projected.find((row) => row.key === 'prix_m2' && row.detail === null)!
    const annual = projected.find((row) => row.key === 'prix_m2' && row.detail === '2025')!
    expect([pooled.value, pooled.fact_status, pooled.support_count, pooled.denominator_count]).toEqual([
      700, 'measured', 12, 20,
    ])
    expect(annual.value).toBe(230)
    expect(focal.data).not.toHaveProperty('value')

    const semantic = semanticComparisonForTheme(comparison, undefined, reads)
    const ranked = lignesAvecComparaisonApi(projected, semantic, 'Classe publiée')
    expect(ranked.find((row) => row.key === 'prix_m2' && row.detail === null)?.comparaisonApi)
      .toEqual({ rang: 1, taille: 2, portee: 'Classe publiée', direction: apiDirection })
    expect(ranked.find((row) => row.key === 'prix_m2' && row.detail === '2025')?.comparaisonApi)
      .toEqual({ rang: 2, taille: 2, portee: 'Classe publiée', direction: apiDirection })

    const method = THEMES_METHODES.habitat.indicateurs.prix_m2!
    const publishedDirection = method.direction
    method.direction = apiDirection === 'high' ? 'moins-est-mieux' : 'plus-est-mieux'
    try {
      const figure = mount(FigureTrajectoire, { props: {
        clef: 'prix_m2', theme: 'habitat', libelle: 'Prix médian au mètre carré', lignes: ranked,
      } })
      const chip = figure.find('.puce-rang')
      expect(figure.find('.puce-rang-glyphe').text().trim()).toBe('▼')
      expect(chip.attributes('aria-label')).toBe('1er/2 · Classe publiée — moins = mieux')
    } finally {
      method.direction = publishedDirection
    }
    const staticFigure = mount(FigureTrajectoire, { props: {
      clef: 'prix_m2', theme: 'habitat', libelle: 'Prix médian au mètre carré',
      lignes: [{ ...projected.find((row) => row.key === 'prix_m2' && row.detail === null)!, rang_epci: 1, rang_epci_n: 2 }],
    } })
    expect(staticFigure.find('.puce-rang-glyphe').text().trim()).toBe('▼')
    expect(staticFigure.find('.puce-rang').attributes('aria-label')).toBe("1er/2 de l'EPCI — moins = mieux")
    const corruptedComparison: any = structuredClone(comparison)
    corruptedComparison.comparison_reads[0].data.scalar_facet.result.source_facet = '2025'
    expect(() => semanticComparisonForTheme(corruptedComparison, undefined, reads))
      .toThrow(/facette de comparaison scalaire/i)
    const wrongScalarFacetIdentity: any = structuredClone(comparison)
    wrongScalarFacetIdentity.comparison_reads[0].data.scalar_facet.result.indicator_id = 'other-indicator'
    expect(() => semanticComparisonForTheme(wrongScalarFacetIdentity, undefined, reads))
      .toThrow(/facette de comparaison scalaire/i)
    const incorrectAnnualFacet: any = structuredClone(comparison)
    incorrectAnnualFacet.comparison_reads[0].data.result.source_facet = '2024'
    expect(() => semanticComparisonForTheme(incorrectAnnualFacet, undefined, reads)).toThrow(/facette/i)

    const levelIds: Record<string, string> = { commune: cible.territoire, epci: '200067460', departement: '22', region: '53' }
    for (const type of nativeResources('habitat').find((item) => item.resource_id === 'prix_m2')!.allowed_levels) {
      const id = levelIds[type]!
      const target = { kind: 'territory', type, id }
      const focalAtLevel = structuredClone(focal)
      focalAtLevel.data.target = target
      focalAtLevel.data.territory = { ...focalAtLevel.data.territory, id, type }
      focalAtLevel.data.scalar_facet.observation = { ...focalAtLevel.data.scalar_facet.observation,
        territory_id: id, territory_type: type }
      const comparisonAtLevel: any = structuredClone(comparison)
      const scopeAtLevel = type === 'commune' ? densityScope : { kind: 'same_level', territory_type: type, member_count: 2 }
      comparisonAtLevel.comparison_reads[0]!.data.target = target
      comparisonAtLevel.comparison_reads[0]!.data.scope = scopeAtLevel
      comparisonAtLevel.comparison_reads[0]!.data.scalar_facet.scope = scopeAtLevel
      const readsAtLevel = [{ ...focalAtLevel, declaration: reads[0]!.declaration }]
      expect(semanticPublicationsCompatible({ resource_reads: readsAtLevel } as any,
        comparisonAtLevel as any), type).toBe(true)
      const rowsAtLevel = themeFactsRowsFromSemantic('habitat', { resource_reads: readsAtLevel } as any,
        { territoire: id, type: type as any }).indicateurs
      expect(rowsAtLevel.find((row) => row.key === 'prix_m2' && row.detail === null)?.value).toBe(700)
      expect(rowsAtLevel.find((row) => row.key === 'prix_m2' && row.detail === '2025')?.value).toBe(230)
    }
  })

  it('builds an explicitly synthetic 73-axis Mobility curve, selected mean, rank, and named reference from the active producer contract', () => {
    const curve = nativeResources('mobilite').find((resource) => resource.resource_id === 'raccordement_courbe')!
    const reference = nativeResources('mobilite').find((resource) => resource.resource_id === 'raccordement_reference')!
    const target = { kind: 'territory', type: 'commune', id: '22001' }
    const facts = nativeReadFixture({ target, intent: { kind: 'facts' } }, curve)
    const axes = facts.axis_values as string[]
    const numbers = facts.axis_numeric_values as number[]
    const points = facts.points as Array<Record<string, any>>

    expect(facts.synthetic_fixture).toMatchObject({ kind: 'synthetic_test_fixture', publication_parity: false })
    expect(facts.completeness).toBe('dense_complete')
    expect(facts.availability).toBe('complete')
    expect(axes).toHaveLength(73)
    expect(numbers).toEqual(Array.from({ length: 73 }, (_, index) => index * 5))
    expect(points).toHaveLength(73)
    expect(points[18]).toMatchObject({ axis: 't0090', observation_period: '2026-10-21', value: 0.125, status: 'measured' })
    expect(points[18]!.provenance[0]).toMatchObject({
      source_id: curve.sources[0], version: 'national-gtfs-outbound-v1',
      vintage_id: 'national-gtfs-outbound-v1', reference_date: '2026-10-10', publication_date: '2026-10-10',
    })

    const comparison = nativeReadFixture({ target,
      intent: { kind: 'selected_comparison', members: [
        { type: 'commune', id: '22001' }, { type: 'commune', id: '35238' },
      ] } }, curve)
    const result = comparison.result as Record<string, any>
    const meanCurve = result.mean_curve as Record<string, any>
    expect(comparison.synthetic_fixture).toMatchObject({ kind: 'synthetic_test_fixture', publication_parity: false })
    expect(comparison.selection).toEqual([
      { territory_type: 'commune', territory_id: '22001' },
      { territory_type: 'commune', territory_id: '35238' },
    ])
    expect(comparison.scope).toMatchObject({ kind: 'explicit_selection', member_count: 2 })
    expect(result).toMatchObject({ status: 'available', statistic: 'mean', source_facet: 't0090',
      descriptor_version: facts.descriptor_version, selected_member_count: 2, eligible_count: 2,
      rank: 2, rank_size: 2, mean: 0.2 })
    expect(meanCurve.scope).toEqual(comparison.scope)
    expect(meanCurve.points).toHaveLength(73)
    expect(meanCurve.points[18]).toEqual({ axis: 't0090', value: 0.2, status: 'measured' })
    expect(result.comparison_sources[0]).toMatchObject({
      source_id: curve.sources[0], version: 'national-gtfs-outbound-v1',
      reference_date: '2026-10-10', publication_date: '2026-10-10',
    })

    const named = nativeReadFixture({ target: { kind: 'named_reference', id: reference.target_ids[0] },
      intent: { kind: 'facts' } }, reference)
    expect(named).toMatchObject({ target: { kind: 'named_reference', id: reference.target_ids[0] },
      publication_id: facts.publication_id, content_version: facts.content_version,
      reference_content_version: facts.reference_content_version,
      reference: { id: 'bretagne_all_assessed_communes_mean', role: 'analytical_reference',
        statistic: 'mean_all_assessed_communes', required: true },
      availability: 'complete', synthetic_fixture: { publication_parity: false } })
    expect(named).not.toHaveProperty('territory')
    expect(named.points).toHaveLength(73)
    expect(named.points[18]).toMatchObject({ axis: 't0090', value: 0.2, status: 'measured' })
  })

  it('projects only publication-coherent Mobility facts, selected means, and named-reference evidence', () => {
    const curve = nativeResources('mobilite').find((resource) => resource.resource_id === 'raccordement_courbe')!
    const reference = nativeResources('mobilite').find((resource) => resource.resource_id === 'raccordement_reference')!
    const model = JSON.parse(readFileSync(resolve(process.cwd(),
      '../public/data/modeles-lecture/territoires/commune/22001.json'), 'utf8'))
    const target = { ...territoiresFixture.find((territory) => territory.territoire === '22001')!,
      classe_densite_code: model.territory.classe_densite_code,
      classe_densite_libelle_public: model.territory.classe_densite_libelle_public }
    const curveDeclaration = curve as unknown as SemanticResourceDeclaration
    const referenceDeclaration = reference as unknown as SemanticResourceDeclaration
    const facts = nativeReadFixture({ target: { kind: 'territory', type: target.type, id: target.territoire },
      intent: { kind: 'facts' } }, curve)
    const named = nativeReadFixture({ target: { kind: 'named_reference', id: reference.target_ids[0] },
      intent: { kind: 'facts' } }, reference)
    const focal = { resource_reads: [{ resource: curve.resource_id, shapes: curve.shapes,
      declaration: curveDeclaration, data: facts }], named_reference_reads: [{ resource: reference.resource_id,
      shapes: reference.shapes, declaration: referenceDeclaration, data: named }] }
    const response = (data: Record<string, any>, selection?: ThemeSelectionMember[]) => ({ theme_id: 'mobilite',
      ...(selection === undefined ? {} : { selection }), comparison_reads: [{ resource: curve.resource_id,
        shapes: curve.shapes, declaration: curveDeclaration, data }] })
    const defaultData = nativeReadFixture({ target: { kind: 'territory', type: target.type, id: target.territoire },
      intent: { kind: 'fixed_comparison', context: 'default' } }, curve)
    const projected = projectRaccordementSemanticReads(focal, response(defaultData), target, undefined)
    const comparisonAxis = String(facts.comparison_point)
    const comparisonAxisIndex = (facts.axis_values as string[]).indexOf(comparisonAxis)
    expect(projected.facts).toHaveLength((facts.axis_values as string[]).length)
    expect(projected.referenceFacts[comparisonAxisIndex]).toEqual({
      detail: comparisonAxis, value: named.points[comparisonAxisIndex]!.value,
    })
    expect(projected.comparison).toMatchObject({ statistic: 'mean', selectedMemberCount: defaultData.result.selected_member_count,
      valueAtComparisonPoint: defaultData.result.mean, scope: { kind: 'density_class',
        territory_type: 'commune', density_class_code: target.classe_densite_code } })

    const selection: ThemeSelectionMember[] = [
      { territory_type: 'commune', territory_id: '22001' },
      { territory_type: 'commune', territory_id: '35238' },
    ]
    const selectedData = nativeReadFixture({ target: { kind: 'territory', type: target.type, id: target.territoire },
      intent: { kind: 'selected_comparison', members: selection.map(({ territory_type, territory_id }) =>
        ({ type: territory_type, id: territory_id })) } }, curve)
    expect(projectRaccordementSemanticReads(focal, response(selectedData, selection), target, selection)
      .comparison).toMatchObject({ selectedMemberCount: 2, valueAtComparisonPoint: selectedData.result.mean,
        scope: { kind: 'explicit_selection', member_count: 2 } })

    const mixedProvenance = structuredClone(facts)
    mixedProvenance.points[1]!.provenance = [{ ...mixedProvenance.points[1]!.provenance[0],
      revision_hash: 'f'.repeat(64) }]
    const incoherentFocal = { ...focal, resource_reads: [{ resource: curve.resource_id, shapes: curve.shapes,
      declaration: curveDeclaration, data: mixedProvenance }] }
    expect(() => projectRaccordementSemanticReads(incoherentFocal, response(defaultData), target,
      undefined)).toThrow(/provenances/)
  })

  it('projects unavailable native comparisons without discarding valid focal or named-reference facts', () => {
    const curve = nativeResources('mobilite').find((item) => item.resource_id === 'raccordement_courbe')!
    const reference = nativeResources('mobilite').find((item) => item.resource_id === 'raccordement_reference')!
    const curveDeclaration = curve as unknown as SemanticResourceDeclaration
    const referenceDeclaration = reference as unknown as SemanticResourceDeclaration
    const target = { ...territoiresFixture.find((territory) => territory.territoire === '22001')! }
    const facts = nativeReadFixture({ target: { kind: 'territory', type: target.type, id: target.territoire },
      intent: { kind: 'facts' } }, curve)
    const named = nativeReadFixture({ target: { kind: 'named_reference', id: reference.target_ids[0] },
      intent: { kind: 'facts' } }, reference)
    const focal = { resource_reads: [{ resource: curve.resource_id, shapes: curve.shapes,
      declaration: curveDeclaration, data: facts }], named_reference_reads: [{ resource: reference.resource_id,
      shapes: reference.shapes, declaration: referenceDeclaration, data: named }] }
    const response = (data: Record<string, any>, selection?: ThemeSelectionMember[]) => ({ theme_id: 'mobilite',
      ...(selection === undefined ? {} : { selection }), comparison_reads: [{ resource: curve.resource_id,
        shapes: curve.shapes, declaration: curveDeclaration, data }] })

    const emptySelection: ThemeSelectionMember[] = []
    const emptyData = nativeReadFixture({ target: { kind: 'territory', type: target.type, id: target.territoire },
      intent: { kind: 'selected_comparison', members: [] } }, curve)
    const empty = projectRaccordementSemanticReads(focal, response(emptyData, emptySelection), target,
      emptySelection)
    expect(emptyData.selection).toEqual([])
    expect(empty.comparison).toMatchObject({ status: 'unavailable', reason: 'no_selected_comparable_values',
      selectedMemberCount: 0, valueAtComparisonPoint: null, rank: null, rankSize: null, points: [],
      scope: { kind: 'explicit_selection', member_count: 0 } })
    expect(empty.facts).toHaveLength(73)
    expect(empty.referenceFacts).toHaveLength(73)

    const malformed = structuredClone(emptyData)
    malformed.result.mean = 0.2
    expect(() => projectRaccordementSemanticReads(focal, response(malformed, emptySelection), target,
      emptySelection)).toThrow(/comparison|comparaison/i)
  })

  it('refuse une coordonnée de détail non déclarée par les métadonnées du contrat', () => {
    expect(() => themeFactsRowsFromApi('habitat', faitsHabitat({
      indicator_metadata: [{ indicator_id: 'distribution_dpe', axes: [{ name: 'detail', key: 'A' }] }],
      indicators: [
        { indicator_id: 'distribution_dpe', label: 'distribution_dpe', unit: '%', value: 0.05,
          status: 'measured', dimensions: { detail: 'Z' }, sources: sources() },
      ],
    }), cible)).toThrow(/déclarée/)
  })

  it('rend l’absence déclarée honnêtement : statut non mesuré → valeur null, jamais un nombre inventé', () => {
    const rows = themeFactsRowsFromApi('habitat', faitsHabitat({
      indicators: [
        { indicator_id: 'prix_m2', label: 'prix_m2', unit: '€/m²', value: null, status: 'suppressed',
          dimensions: { axis: '2021' }, sources: sources() },
      ],
    }), cible)
    expect(rows.indicateurs[0]!.value).toBeNull()
    expect(rows.indicateurs[0]!.rider).toBe('suppressed')
    expect(rows.indicateurs[0]!.observation_status).toBe('missing')
    expect(() => themeFactsRowsFromApi('habitat', faitsHabitat({
      indicators: [
        { indicator_id: 'part_passoires', label: 'part_passoires', unit: '%', value: null, status: 'measured',
          dimensions: {}, sources: sources() },
      ],
    }), cible)).toThrow(/mesurée absente/)
  })

  it('refuse une provenance absente ou mal formée', () => {
    expect(() => themeFactsRowsFromApi('habitat', faitsHabitat({
      indicators: [
        { indicator_id: 'part_passoires', label: 'part_passoires', unit: '%', value: 0.42, status: 'measured',
          dimensions: {}, sources: [] },
      ],
    }), cible)).toThrow(/Provenance/)
    expect(() => themeFactsRowsFromApi('habitat', faitsHabitat({
      indicators: [
        { indicator_id: 'part_passoires', label: 'part_passoires', unit: '%', value: 0.42, status: 'measured',
          dimensions: {}, sources: [{ source_id: 's', name: 'S', version: '', reference_date: null, publication_date: null }] },
      ],
    }), cible)).toThrow(/Provenance/)
  })

  it('mappe la lecture Habitat typée avec sa provenance, sans jamais inventer les nulls', () => {
    const rows = themeFactsRowsFromApi('habitat', faitsHabitat({
      readings: [{
        groupe: 'etat-energetique-du-parc', story_key: 'etat-energetique-du-parc', salience_reason: 'defaut',
        classification: null, part_passoires: null, part_abc: null, n_dpe: 12,
        status: 'suppressed', source_id: 'habitat_api', vintage_id: 'api-v1',
        provenance: { source_id: 'habitat_api', source_name: 'Source API habitat', vintage_id: 'api-v1',
          source_version: 'api-v1', source_reference_date: null, source_publication_date: null },
      }],
    }), cible)
    const lecture = rows.histoires[0] as unknown as Record<string, unknown>
    expect(lecture.classification).toBeNull()
    expect(lecture.part_passoires).toBeNull()
    expect(lecture.n_dpe).toBe(12)
    expect(lecture.vintage_source).toBe('Source API habitat')
    expect(() => themeFactsRowsFromApi('habitat', faitsHabitat({
      readings: [{
        groupe: 'etat-energetique-du-parc', story_key: 'autre-lecture', salience_reason: 'defaut',
        classification: null, part_passoires: null, part_abc: null, n_dpe: 12,
        status: 'measured', source_id: 'habitat_api', vintage_id: 'api-v1', provenance: {},
      }],
    }), cible)).toThrow(/déclarée/)
    expect(() => themeFactsRowsFromApi('habitat', faitsHabitat({
      readings: [{
        groupe: 'etat-energetique-du-parc', story_key: 'etat-energetique-du-parc', salience_reason: 'defaut',
        classification: null, part_passoires: null, part_abc: null,
        status: 'measured', source_id: 'habitat_api', vintage_id: 'api-v1', provenance: {},
      }],
    }), cible)).toThrow(/Valeurs de lecture/)
  })

  it('refuse les lectures d’un thème non migré plutôt que de les perdre en silence', () => {
    // Mobilité est le seul thème hors du registre migré : sa surface de fiche
    // reste la variante E, intégration côté utilisateur.
    expect(() => themeFactsRowsFromApi('mobilite', {
      contract: 'theme-facts-v1', theme_id: 'mobilite',
      territory: { territory_id: '35238', name: 'Saint-Jacques', territory_type: 'commune' },
      content_version: 'v', reference_content_version: 'r',
      indicator_metadata: [], named_reference_evidence: [], indicators: [],
      readings: [{ groupe: 'g', story_key: 's', salience_reason: 'defaut', status: 'measured' }],
    }, cible)).toThrow(/non migré/)
  })

  it('mappe les bins de distribution Mobilité servis et garde les bins absents à null', () => {
    const reading = { groupe: 'acces-aux-services', story_key: 'vingt-minutes-sans-voiture', salience_reason: 'defaut',
      status: 'measured', div_loss_t: 8, div_loss_b: 5, classification_saillance: null, unit: 'types',
      provenance: { source_id: 'mob', source_name: 'Mobilité', source_version: 'v1', source_reference_date: null, source_publication_date: null } }
    const response = { ...faitsHabitat({ theme_id: 'mobilite', readings: [reading] }), density_distribution: {
      status: 'measured', range: { minimum: 2, maximum: 9, status: 'measured' }, points: [
        { ordinal: 0, density: 0.25, density_status: 'measured', decile: 2, decile_status: 'measured' },
        { ordinal: 1, density: null, density_status: 'not_available', decile: null, decile_status: 'not_available' },
      ] } }
    const mapped = themeFactsRowsFromApi('mobilite', response, cible).histoires[0] as unknown as Record<string, unknown>
    expect(mapped).toMatchObject({ dens_min: 2, dens_max: 9, dens_1: .25, dec_1: 2, dens_2: null, dec_2: null })
    const absent = themeFactsRowsFromApi('mobilite', { ...response, density_distribution: undefined }, cible).histoires[0]
    expect(absent).toMatchObject({ dens_min: null, dens_max: null, dens_1: null })
  })

  it('mappe la lecture Milieux et sa provenance sans convertir les absences en zéros', () => {
    const reading = {
      groupe: 'land', story_key: 'se-densifier-setaler-ou-sen-aller', salience_reason: 'defaut', status: 'measured',
      periode_pop: '2017-2023', periode_artif: '2020-2023', delta_population: 10, taux_variation_population: 1.4,
      artif_m2_par_habitant: 8, artif_m3_par_habitant: 9, trajectoire_artif_par_habitant: 1.125,
      classification: 'up', provenance: { source_id: 'rp', source_name: 'RP fixture', source_version: '2023',
        source_reference_date: null, source_publication_date: null },
    }
    const result = themeFactsRowsFromApi('milieux', faitsMilieux({ readings: [reading] }), cible)
    const row = result.histoires[0] as unknown as Record<string, unknown>
    expect(row.taux_variation_population).toBe(1.4)
    expect(row.classification).toBe('up')
    expect(row.vintage_source).toBe('RP fixture')
    expect(themeFactsRowsFromApi('milieux', faitsMilieux({ readings: [{ ...reading, status: 'unavailable',
      periode_pop: null, periode_artif: null, taux_variation_population: null, artif_m2_par_habitant: null,
      artif_m3_par_habitant: null, trajectoire_artif_par_habitant: null, classification: null }] }), cible)
      .histoires[0]).toMatchObject({ periode_artif: null, taux_variation_population: null,
        artif_m2_par_habitant: null, artif_m3_par_habitant: null, classification: null })
    expect(() => themeFactsRowsFromApi('milieux', faitsMilieux({ readings: [{ ...reading, story_key: 'wrong' }] }), cible)).toThrow(/non déclarée/)
    expect(() => themeFactsRowsFromApi('milieux', faitsMilieux({ readings: [{ ...reading, salience_reason: 'invented' }] }), cible)).toThrow(/non déclarée/)
  })

  it('projette uniquement les points du reading cloud dont toutes les coordonnées sont valides', () => {
    const points = histoiresMilieuxDuNuage({ reading_cloud: { status: 'available', groupe: 'land', points: [
      { territory: { territory_id: '35001', territory_type: 'commune' }, periode_pop: '2017-2023',
        periode_artif: '2020-2023', taux_variation_population: 0.8,
        artif_m2_par_habitant: 7, artif_m3_par_habitant: 8 },
      { territory: { territory_id: '35002', territory_type: 'commune' }, periode_pop: null,
        periode_artif: null, taux_variation_population: null,
        artif_m2_par_habitant: 6, artif_m3_par_habitant: 7 },
    ] } })
    expect(points).toHaveLength(1)
    expect(points[0]).toMatchObject({ territoire: '35001', taux_variation_population: 0.8,
      artif_m2_par_habitant: 7, artif_m3_par_habitant: 8 })
  })

  it('valide l’écho de sélection d’une réponse de comparaison dans l’ordre du demandeur', () => {
    const attendue: ThemeSelectionMember[] = [
      { territory_type: 'epci', territory_id: '200000001' },
      { territory_type: 'commune', territory_id: '35238' },
    ]
    const comparaison = (selection: unknown) => ({
      contract: 'theme-comparison-v1', theme_id: 'habitat',
      content_version: 'habitat-scalar-v1', reference_content_version: 'territories-v1',
      selection, results: [], profile_comparisons: [],
    })
    expect(() => validerReponseComparaisonTheme('habitat', comparaison(attendue), attendue)).not.toThrow()
    expect(() => validerReponseComparaisonTheme('habitat', comparaison([]), attendue)).toThrow(/sélection/)
    expect(() => validerReponseComparaisonTheme('habitat',
      comparaison([...attendue].reverse()), attendue)).toThrow(/sélection/)
    expect(() => validerReponseComparaisonTheme('habitat', comparaison(attendue), [])).toThrow(/sélection/)
    expect(() => validerReponseComparaisonTheme('milieux', comparaison(attendue), attendue)).toThrow(/comparaison/)
  })
})
