import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  contextesDepuisReference,
  cohortLittoralPourFocal,
  libelleSelectionComparaison,
  lireSelectionBrute,
  modePourSelectionServie,
  presetsDisponibles,
  queryTerritoireAvecComparaison,
  resoudreSelectionComparaison,
  serialiserSelection,
  territoireReferencePourComparaison,
} from '@/fiche/comparisonContext'
import type { TerritoryComparisonContext } from '@/fiche/comparisonContext'
import { membresConstructeur } from '@/fiche/selectionBuilder'
import { apiComparisonScopeLabel, comparisonScopeLabel, littoralScopeLabel } from '@/fiche/content/comparisonScopeLabel'
import { GROUPE_COMPARE_LABEL, groupeCompareAria } from '@/fiche/content/comparisonWording'
import { comparisonRank } from '@/fiche/content/comparisonRank'
import { RANK_DISPLAY_MIN_SIZE } from '@/fiche/figureGrammaire'
import type { NumericFact } from '@/fiche/content/territoryFacts'
import { territoiresFixture } from '@/payload/fixtures'
import type { Territoire } from '@/payload/types'

/**
 * #1044 — preset Littoral. The classification is READ from the served compact
 * territory reference (C/NC), never inferred from geography; the two islands
 * are C from the served source and Plouvien is NC from that same source. This
 * file locks the whole app seam: scope wording, symbolic URL persistence,
 * navigation re-resolution, same-status cohort membership, fail-closed
 * behaviour and the unchanged compact figure wording.
 */

const SERVE = JSON.parse(readFileSync(resolve(process.cwd(), 'src/__tests__/fixtures/littoral-reference-served.json'), 'utf8')) as {
  territoires: Territoire[]
}
const cibleServie = (id: string): Territoire => SERVE.territoires.find((t) => t.territoire === id)!

/** A controlled reference whose served C/NC codes give two distinct cohorts. */
const reference: Territoire[] = territoiresFixture.map((t) => ({
  ...t,
  // Keep the C cohort (22001/22002) distinct from focal's EPCI cohort so a
  // served littoral selection cannot be mistaken for the EPCI preset.
  epci: t.territoire === '22002' ? '200000002' : t.epci,
  littoral_code: t.territoire === '22001' || t.territoire === '22002' ? 'C'
    : t.type === 'commune' ? 'NC' : null,
}))
const focalC = reference.find((t) => t.territoire === '22001')!
const focalNC = reference.find((t) => t.territoire === '29001')!

const contextes = (focal: Territoire) => contextesDepuisReference(focal, reference)
const resoudre = (focal: Territoire, demande: unknown) => resoudreSelectionComparaison({
  territoire: focal,
  demande,
  contextes: contextes(focal),
  territoires: reference,
})

describe('served C/NC identity — single source of truth for the littoral preset', () => {
  it('a C focal resolves the C cohort; an NC focal resolves the disjoint NC cohort', () => {
    const c = cohortLittoralPourFocal(focalC, reference)!
    const nc = cohortLittoralPourFocal(focalNC, reference)!
    expect(c.map((m) => m.territory_id)).toEqual(['22001', '22002'])
    expect(nc.map((m) => m.territory_id)).toEqual(['29001', '29002'])
    expect(c.every((m) => m.territory_type === 'commune')).toBe(true)
    // No cross-status membership, and the focal is always in its own cohort.
    expect(c.some((m) => nc.includes(m))).toBe(false)
    expect(c.some((m) => m.territory_id === focalC.territoire)).toBe(true)
    expect(nc.some((m) => m.territory_id === focalNC.territoire)).toBe(true)
  })

  it('both islands are C and Plouvien is NC straight from the served reference', () => {
    // Île-de-Sein 29083 and Île-Molène 29084 are C in the served source; the
    // fixture carries 29083 and 29209 — the app reads codes, never a coastline.
    expect(contextesDepuisReference(cibleServie('29083'), SERVE.territoires).littoral?.scope.label)
      .toBe('communes littorales bretonnes')
    expect(contextesDepuisReference(cibleServie('29209'), SERVE.territoires).littoral?.scope.label)
      .toBe('communes non littorales bretonnes')
    expect(littoralScopeLabel('C')).toBe('communes littorales bretonnes')
    expect(littoralScopeLabel('NC')).toBe('communes non littorales bretonnes')
  })

  it('the two islands join the C cohort from their served code — no exception, no inference', () => {
    // 29084 is added exactly as the producer publishes it (C); the app never
    // derives that status and never applies an island rule of its own.
    const iles: Territoire[] = [
      ...SERVE.territoires,
      { territoire: '29084', type: 'commune', nom: 'Île-Molène', departement: '29', epci: null,
        littoral_code: 'C', littoral_classement_source: 'Mer' },
    ]
    const c = cohortLittoralPourFocal(cibleServie('29083'), iles)!
    expect(c.map((m) => m.territory_id)).toContain('29083')
    expect(c.map((m) => m.territory_id)).toContain('29084')
    expect(c.map((m) => m.territory_id)).not.toContain('29209')
  })

  it('a missing served classification fails closed — no NC-by-omission, no coastal guess', () => {
    expect(cohortLittoralPourFocal({ ...focalC, littoral_code: null }, reference)).toBeNull()
    expect(contextesDepuisReference({ ...focalC, littoral_code: null }, reference).littoral).toBeUndefined()
    expect(littoralScopeLabel(null)).toBeNull()
    expect(littoralScopeLabel(undefined)).toBeNull()
  })

  it('unsupported territorial levels never get a littoral context or preset', () => {
    for (const level of ['epci', 'departement', 'region'] as const) {
      const t = reference.find((x) => x.type === level)!
      expect(cohortLittoralPourFocal(t, reference)).toBeNull()
      expect(contextesDepuisReference(t, reference).littoral).toBeUndefined()
      expect(presetsDisponibles({ territoire: t, contextes: contextes(t), territoires: reference }).map((p) => p.preset))
        .not.toContain('littoral')
    }
  })
})

describe('the preset is offered, named and carried symbolically in the URL', () => {
  it('the menu offers Littoral only when its scope really resolves for the focal', () => {
    const options = presetsDisponibles({ territoire: focalC, contextes: contextes(focalC), territoires: reference })
    const littoral = options.find((p) => p.preset === 'littoral')!
    // No density class is published on this controlled reference, so only the
    // three resolvable presets are offered — littoral never replaces them.
    expect(options.map((p) => p.preset)).toEqual(['epci', 'bretagne', 'littoral'])
    expect(littoral.label).toBe('communes littorales bretonnes')
    // No preset is offered when the focal has no published class (honest menu).
    const sansClasse: Territoire = { ...focalC, littoral_code: null }
    expect(presetsDisponibles({ territoire: sansClasse,
      contextes: contextesDepuisReference(sansClasse, reference), territoires: reference })
      .map((p) => p.preset)).not.toContain('littoral')
  })

  it('the parameter carries the symbolic token, not an expanded member list', () => {
    expect(lireSelectionBrute('littoral')).toEqual({ etat: 'preset', preset: 'littoral' })
    expect(serialiserSelection({ etat: 'preset', preset: 'littoral' })).toBe('littoral')
    const resolution = resoudre(focalNC, 'littoral')
    expect(resolution.selection).toEqual({ etat: 'preset', preset: 'littoral' })
    expect(serialiserSelection(resolution.selection)).toBe('littoral')
  })

  it('preserves the symbolic preset across territory navigation and re-resolves for the new focal', () => {
    const url = queryTerritoireAvecComparaison({ comparaison: 'littoral', variant: 'E' }, 'mobilite')
    expect(url).toEqual({ theme: 'mobilite', comparaison: 'littoral' })
    const apres = resoudre(focalNC, url.comparaison)
    expect(apres.preset).toBe('littoral')
    expect(apres.membres?.map((m) => m.territory_id)).toEqual(['29001', '29002'])
    expect(libelleSelectionComparaison(apres)).toBe('communes non littorales bretonnes')
  })

  it('a named unresolved littoral preset stays unavailable — no regional substitution', () => {
    const sansClasse: Territoire = { ...focalC, littoral_code: null }
    const resolution = resoudreSelectionComparaison({
      territoire: sansClasse,
      demande: 'littoral',
      contextes: contextesDepuisReference(sansClasse, reference),
      territoires: reference,
    })
    // null members = named, retryable unavailability — never the default or
    // the Bretagne cohort, and the URL keeps the requested token.
    expect(resolution.membres).toBeNull()
    expect(resolution.preset).toBe('littoral')
    expect(resolution.canonicaliser).toBe(false)
    expect(resolution.contexte).toBeNull()
    expect(serialiserSelection(resolution.selection)).toBe('littoral')
  })
})

describe('the symbol drives the same-status cohort through every acquisition consumer', () => {
  it('membresPourPreset and the typed-member builder agree on the exact C/NC cohort', () => {
    const resolution = resoudre(focalC, 'littoral')
    expect(resolution.membres?.map((m) => m.territory_id)).toEqual(['22001', '22002'])
    const construits = membresConstructeur(resolution.selection, focalC, reference)
    expect(construits.map((m) => m.territory_id)).toEqual(['22001', '22002'])
    // A communal cohort needs no single-territory reference (AEDAR summary
    // lines use the pooled fixed context instead, never a region fallback).
    expect(territoireReferencePourComparaison({ territoire: focalC, mode: 'littoral', territoires: reference }))
      .toBeNull()
  })

  it('the scope kind is dedicated and the public group label is never repeated in figures', () => {
    const ctx: TerritoryComparisonContext = contextes(focalC).littoral!
    expect(ctx.scope.kind).toBe('communes-littoral')
    expect(comparisonScopeLabel('communes-littoral', ctx.scope.label, null)).toBe('communes littorales bretonnes')
    expect(comparisonScopeLabel('communes-littoral', null, null)).toBeNull()
    // The compact figure label stays fixed; the resolved scope lives only in
    // the accessible name.
    expect(GROUPE_COMPARE_LABEL).toBe('Groupe comparé')
    expect(groupeCompareAria('12 %', '1er/263', ctx.scope.label))
      .toBe('Groupe comparé : communes littorales bretonnes : 12 %, rang 1er/263')
    expect(groupeCompareAria('12 %')).not.toMatch(/littoral/i)
  })

  it('accepts a returned same-status cohort as littoral, but rejects wrong class/members/scope', () => {
    const echoC = cohortLittoralPourFocal(focalC, reference)!
    expect(modePourSelectionServie(echoC, focalC, reference)).toBe('littoral')
    expect(modePourSelectionServie(cohortLittoralPourFocal(focalNC, reference)!, focalNC, reference)).toBe('littoral')
    // A partial cohort, a foreign-status cohort and a whole-Bretagne set must
    // never be relabelled littoral (the acquisition seam already fails them).
    expect(modePourSelectionServie([{ territory_type: 'commune', territory_id: '29001' }], focalC, reference)).toBeNull()
    expect(modePourSelectionServie(cohortLittoralPourFocal(focalNC, reference)!, focalC, reference)).toBeNull()
    expect(modePourSelectionServie(reference.filter((t) => t.type === 'commune')
      .map((t) => ({ territory_type: 'commune', territory_id: t.territoire })), focalC, reference)).toBe('bretagne')
    // An unclassified focal has no littoral cohort to compare against.
    expect(modePourSelectionServie(echoC, { ...focalC, littoral_code: null }, reference)).not.toBe('littoral')
  })

  it('adds no default and leaves existing presets and rank display rules untouched', () => {
    // Absent parameter still resolves the level-native default, never littoral.
    expect(resoudre(focalC, undefined).preset).toBe('epci')
    expect(resoudre(reference.find((t) => t.type === 'epci')!, undefined).preset).toBe('bretagne')
    // Tie/singleton presentation stays the shared formatter's job, unchanged.
    expect(RANK_DISPLAY_MIN_SIZE).toBe(2)
    const rang = (size: number, ties: number) => ({
      key: 'x', value: 1, unit: '', detail: null, direction: 'high' as const,
      comparison: { direction: 'high' as const, scope: { kind: 'communes-littoral', label: 'communes littorales bretonnes' },
        rank: { position: 1, size, ties }, reference: { kind: 'median' as const, value: 4 } },
    } as unknown as NumericFact)
    expect(comparisonRank(rang(263, 3))?.phrase).toMatch(/Médiane des communes littorales bretonnes/)
    expect(comparisonRank(rang(1, 1))).toBeNull() // singleton still hidden
  })

  it('a served littoral scope label is accepted only for the focal’s own served class', () => {
    expect(apiComparisonScopeLabel({ kind: 'littoral', group_id: 'C', territory_type: 'commune' }, focalC, 'x'))
      .toBe('communes littorales bretonnes')
    // Wrong class, wrong level, or an unknown group fail closed.
    expect(apiComparisonScopeLabel({ kind: 'littoral', group_id: 'NC', territory_type: 'commune' }, focalC, 'x'))
      .toBeNull()
    expect(apiComparisonScopeLabel({ kind: 'littoral', group_id: 'C', territory_type: 'epci' }, focalC, 'x'))
      .toBeNull()
    expect(apiComparisonScopeLabel({ kind: 'littoral', territory_type: 'commune' }, focalC, 'x')).toBeNull()
    // The published producer label still wins when present.
    expect(apiComparisonScopeLabel({ kind: 'littoral', group_id: 'C', label: 'Cohorte publiée' }, focalC, 'x'))
      .toBe('Cohorte publiée')
  })
})
