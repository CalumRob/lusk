import { describe, expect, it } from 'vitest'

import { sousGroupesFiche } from '@/fiche/content/ficheGrammar'
import {
  chapitreDemande,
  chapitreDemandeDepuisAncre,
  chapitreNumeriqueParDefaut,
  chapitresDemandes,
} from '@/fiche/content/demandInventory'
import type { SemanticReadItem, SemanticResourceDeclaration } from '@/payload/semanticResourceClient'
import { groupSemanticItems, SEMANTIC_MAX_BATCH_ITEMS } from '@/payload/semanticResourceClient'
import type { Theme } from '@/payload/types'
import { nativeResources } from './helpers/semanticApiFixtures'

/**
 * #986 — the page-2 critical demand is measured from the producer catalogue and
 * the app grammar, not from a hardcoded item list. These assertions are the
 * packing proof required before promising "<= 3 semantic POSTs for page 2".
 */

/** Commune-level declarations only: a chapter's demand is level-scoped. */
function communeDeclarations(theme: Theme): SemanticResourceDeclaration[] {
  return (nativeResources(theme) as unknown as SemanticResourceDeclaration[])
    .filter((declaration) => declaration.allowed_levels.includes('commune'))
}

const TARGET = { kind: 'territory' as const, type: 'commune' as const, id: '35238' }
const SELECTED: SemanticReadItem['intent'] = { kind: 'selected_comparison', members: [
  { type: 'commune', id: '35238' }, { type: 'commune', id: '35240' }] }

/**
 * The demand the mobilite page-2 path asks for: one facts item per numeric
 * indicator the chapter displays, plus one comparison item per *displayed*
 * comparison point. The producer vocabulary decides the declared points; the
 * app content decides which are drawn (the #954/#960 declared detail points).
 */
const DISPLAYED_DETAIL_POINTS: Readonly<Record<string, readonly string[]>> = {
  reseaux_par_habitant: ['t_km_1000', 'b_km_1000', 'c_km_1000'],
  reseaux: ['t_longueur', 'b_longueur', 'c_longueur'],
  offre_cyclable: ['protege_longueur', 'partage_longueur', 'protege_km_1000', 'partage_km_1000'],
}

function chapterDemandItems(theme: Theme, chapterKey: string,
  intent: SemanticReadItem['intent']): SemanticReadItem[] {
  const chapter = chapitreDemande(theme, chapterKey, communeDeclarations(theme))!
  // Production walks the catalogue, not the grammar: the declaration order
  // decides the batch composition, so the packing proof uses the same order.
  const demanded = communeDeclarations(theme)
    .filter((declaration) => chapter.indicators.includes(declaration.indicator_id))
  return demanded.flatMap((declaration) => {
    const indicator = declaration.indicator_id
    if (declaration.target_kinds.includes('named_reference')) {
      return [{ resource: indicator, target: { kind: 'named_reference' as const, id: declaration.target_ids![0]! },
        intent: { kind: 'facts' as const } }]
    }
    const items: SemanticReadItem[] = [{ resource: indicator, target: TARGET, intent: { kind: 'facts' } }]
    const declared = declaration.axis_values?.find(([axis]) => axis === 'detail')?.[1] ?? []
    const points: Array<string | null> = DISPLAYED_DETAIL_POINTS[indicator]
      ? [...DISPLAYED_DETAIL_POINTS[indicator]!] : [null]
    for (const point of points) {
      if (point !== null && !declared.includes(point)) continue
      items.push({ resource: indicator, target: TARGET, intent,
        ...(point === null ? {} : { coordinates: { detail: [point] } }) })
    }
    return items
  })
}

describe('demand inventory — Mobilite page 2', () => {
  it('divides the producer indicators across the three app chapters without losing one', () => {
    const chapters = chapitresDemandes('mobilite', communeDeclarations('mobilite'))
    expect(chapters.map((chapter) => chapter.key)).toEqual(
      sousGroupesFiche('mobilite').map((subgroup) => subgroup.key))
    expect(chapters[0]!.indicators).toEqual([])
    expect([...chapters[1]!.indicators]).toEqual([
      'reseaux', 'reseaux_par_habitant', 'surface_reseaux_routiers', 'places_stationnement_velo_1000',
      'places_stationnement_voiture_1000', 'stationnement_velo_par_voiture', 'offre_cyclable',
      'voitures_menage', 'bornes_recharge', 'bornes_ev_par_station_service',
      // unclaimed by the grammar, drawn by the paired parking/refuelling figure
      'bornes_recharge_1000', 'stations_service', 'stations_service_1000',
    ])
    expect([...chapters[2]!.indicators]).toEqual([
      'offre_tc', 'raccordement_tc', 'raccordement_courbe', 'raccordement_reference',
    ])
    expect(chapters[2]!.namedReferences).toEqual(['raccordement_reference'])
    expect(chapters[1]!.namedReferences).toEqual([])
  })

  it('names the page-2 numeric chapter as the default chapter of the theme', () => {
    expect(chapitreNumeriqueParDefaut('mobilite', communeDeclarations('mobilite'))?.key)
      .toBe('partage-de-lespace-public')
  })

  it('resolves the requested chapter from the route anchor, without inventing one', () => {
    expect(chapitreDemandeDepuisAncre('mobilite', '#figure-partage-de-lespace-public'))
      .toBe('partage-de-lespace-public')
    expect(chapitreDemandeDepuisAncre('mobilite', '#figure-offre-transports-commun'))
      .toBe('offre-transports-commun')
    // #1008 — the spine's page-1 anchor is the special `figure-lecture`.
    expect(chapitreDemandeDepuisAncre('mobilite', '#figure-lecture'))
      .toBe('acces-aux-services')
    expect(chapitreDemandeDepuisAncre('mobilite', '#figure-sources')).toBeUndefined()
    expect(chapitreDemandeDepuisAncre('mobilite', '')).toBeUndefined()
  })

  it('packs the real page-2 demand into the promised batch budget (33 items, 3 POSTs)', () => {
    const items = chapterDemandItems('mobilite', 'partage-de-lespace-public', SELECTED)
    const facts = items.filter((item) => item.intent.kind === 'facts')
    const comparisons = items.filter((item) => item.intent.kind !== 'facts')
    expect(facts).toHaveLength(13)
    expect(comparisons).toHaveLength(20)
    expect(items).toHaveLength(33)
    expect(new Set(items.map((item) => JSON.stringify(item))).size).toBe(33)

    const batches = groupSemanticItems(items)
    expect(batches).toHaveLength(3)
    expect(Math.ceil(items.length / SEMANTIC_MAX_BATCH_ITEMS)).toBe(3)
    expect(batches.every((batch) => batch.length <= SEMANTIC_MAX_BATCH_ITEMS)).toBe(true)
    // Every related group stays whole: each resource keeps all of its items in
    // one batch, so facts and their declared comparisons never split.
    for (const batch of batches) {
      const resources = new Set(batch.map((item) => item.resource))
      for (const resource of resources) {
        expect(batch.filter((item) => item.resource === resource))
          .toHaveLength(items.filter((item) => item.resource === resource).length)
      }
    }
    expect(batches.map((batch) => batch.length)).toEqual([11, 12, 10])
  })

  it('keeps the page-3 chapter inside one batch (4 resources, 6 numeric items + 1 named reference)', () => {
    const items = chapterDemandItems('mobilite', 'offre-transports-commun', SELECTED)
    expect(new Set(items.map((item) => item.resource)).size).toBe(4)
    expect(items.filter((item) => item.target.kind === 'territory')).toHaveLength(6)
    expect(items).toHaveLength(7)
    expect(groupSemanticItems(items)).toHaveLength(1)
  })
})
