/**
 * Shared fixtures for the Cahier export-capture seam (#1021).
 *
 * Builds the nine currently registered sections from the production content
 * builders, so the capture tests exercise the real renderer registry, real
 * evidence models and the real mounted owners rather than a second section list.
 */
import type { ControleComparaison, SelectionComparaison } from '@/fiche/comparisonContext'
import { aedarPrototypeSections } from '@/fiche/content/aedarAccessSection'
import type { AedarTerritorySummary } from '@/fiche/content/aedarApiClient'
import { AEDAR_AGGREGATE_READING_MEASURES } from '@/fiche/content/aedarTimeRampFacts'
import { buildMobiliteRaccordementSection, buildMobiliteShareSection } from '@/fiche/content/mobiliteSections'
import { resolveMobiliteThemeContent } from '@/fiche/content/themeContent'
import type { ContentSection, ThemeContent } from '@/fiche/content/themeContent'
import { territoryFactsFor } from '@/fiche/content/territoryFacts'
import {
  histoiresMobiliteFixture,
  indicateursMobiliteFixture,
  indicateursRaccordementFixture,
  metadonneesMobiliteRaccordementFixture,
  metadonneesThemesFixtures,
  territoiresFixture,
  vintagesFixture,
} from '@/payload/fixtures'
import type { Payload } from '@/payload/types'

const basePayload: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursMobiliteFixture,
  histoires: histoiresMobiliteFixture,
  runReport: null,
  vintages: vintagesFixture,
  programmes: null,
  themeMetadata: { mobilite: metadonneesThemesFixtures.mobilite },
}

const page3Payload: Payload = {
  ...basePayload,
  indicateurs: indicateursRaccordementFixture,
  themeMetadata: { mobilite: metadonneesMobiliteRaccordementFixture },
}

const aedarSource = {
  source_id: 'aedar_bretagne',
  vintage_id: 'test',
  source_url: 'https://example.test/aedar',
  licence: 'Licence Ouverte',
  attribution: 'AEDAR',
  reference_date: '2026-01-01',
  publication_date: '2026-09-30',
}

function aedarSummary(): AedarTerritorySummary {
  return {
    territory: { territory_type: 'commune', territory_id: '22001' },
    summaryContentVersion: 'summary',
    aedarContentVersion: 'facts',
    referenceContentVersion: 'reference',
    readings: Object.keys(AEDAR_AGGREGATE_READING_MEASURES).map((measure) => ({
      measure,
      value: 5,
      status: 'available',
      n_typequ: 1,
      n_addresses: 100,
      n_observed: 100,
      coverage_status: 'covered',
      statistic: 'direct',
      ...aedarSource,
    })),
    provenance: { contentVersion: 'facts', sources: [aedarSource] },
  }
}

function aedarDetail() {
  return {
    status: 'ready' as const,
    contentVersion: 'facts',
    referenceContentVersion: 'reference',
    provenance: aedarSummary().provenance,
    facts: [{
      territory_id: '22001',
      territory_type: 'commune' as const,
      typequ: 'B207',
      typequ_label: 'Équipement test',
      identity: {},
      n_addresses: 100,
      n_observed: 100,
      coverage_status: 'covered',
      measures: {},
      ...aedarSource,
    }, {
      territory_id: '22001',
      territory_type: 'commune' as const,
      typequ: 'B202',
      typequ_label: 'Équipement bis',
      identity: {},
      n_addresses: 80,
      n_observed: 80,
      coverage_status: 'covered',
      measures: {},
      ...aedarSource,
    }],
  }
}

export interface CahierExportFixture {
  readonly content: ThemeContent
  readonly control: ControleComparaison
  readonly sections: readonly ContentSection[]
}

function aedarSections(territory: ThemeContent['territory']): ContentSection[] {
  return aedarPrototypeSections(aedarSummary(), aedarDetail(), territory, {
    lossMapMetadata: { status: 'loading', legend: null },
  }) as ContentSection[]
}

/**
 * The nine sections currently rendered by the Cahier: five AEDAR compositions
 * and the four Mobilité delegate kinds across three units.
 */
export function cahierExportFixture(options: {
  selection?: SelectionComparaison
  focal?: ControleComparaison['focal']
} = {}): CahierExportFixture {
  const facts = territoryFactsFor(basePayload, '22001')
  if (!facts) throw new Error('Mobilité fixture facts missing')
  const content = resolveMobiliteThemeContent(facts, metadonneesThemesFixtures.mobilite)
  const page3Facts = territoryFactsFor(page3Payload, '22001')
  if (!page3Facts) throw new Error('Page 3 fixture facts missing')
  // Fixture-only served comparison: the producer-owned counts are placed here,
  // never computed. They let the mounted curve expose its real comparison layer.
  page3Facts.mobility.selectedTrajectoryComparison = {
    statistic: 'mean',
    scope: { kind: 'communes-bretagne', label: 'communes bretonnes' },
    selectedMemberCount: 3,
    eligibleCount: 2,
    modelZeroReasonCounts: {},
    sourceLineage: [],
    points: page3Facts.mobility.indicators.filter((fact) => fact.key === 'raccordement_courbe'),
  }
  // Producer-declared numeric axis of the published 11-point grid (fixture data).
  const curveAxis = [
    ['t0000', 0], ['t0015', 15], ['t0030', 30], ['t0045', 45], ['t0060', 60], ['t0090', 90],
    ['t0120', 120], ['t0180', 180], ['t0240', 240], ['t0300', 300], ['t0360', 360],
  ] as const
  page3Facts.mobility.trajectoryContract = {
    axisKind: 'duration_minute',
    axisValues: curveAxis.map(([detail]) => detail),
    axisNumericValues: curveAxis.map(([, minutes]) => minutes),
    comparisonPoint: 't0090',
    comparisonStatistic: 'mean',
    comparisonScope: 'selected_group',
  }
  const page3 = [
    buildMobiliteShareSection(page3Facts, metadonneesMobiliteRaccordementFixture),
    buildMobiliteRaccordementSection(page3Facts, metadonneesMobiliteRaccordementFixture),
  ] as const
  const units = [
    { ...content.units[0]!, introduction: [], sections: aedarSections(content.territory) },
    content.units[1]!,
    { ...content.units[2]!, sections: page3 },
  ] as unknown as ThemeContent['units']
  const themed: ThemeContent = { ...content, units }
  const focal = options.focal ?? territoiresFixture[0]!
  const control: ControleComparaison = {
    focal,
    territoires: territoiresFixture,
    selection: options.selection ?? { etat: 'defaut' },
    libelleActif: 'Groupe de test',
    presetDefaut: focal.type === 'commune' && focal.epci ? 'epci' : 'bretagne',
    presets: [],
    choisir: () => {},
  }
  const sections = units.flatMap((unit) => unit.sections as readonly ContentSection[])
  return { content: themed, control, sections }
}

export function sectionOf(content: ThemeContent, key: ContentSection['key']): ContentSection {
  const section = content.units
    .flatMap((unit) => unit.sections as readonly ContentSection[])
    .find((candidate) => candidate.key === key)
  if (!section) throw new Error(`Section ${key} missing from the fixture`)
  return section
}

/** EPCI focal control for the cross-border Bretagne scope check. */
export function epciControl(): ControleComparaison {
  const epci = territoiresFixture.find((candidate) => candidate.type === 'epci')
  if (!epci) throw new Error('EPCI fixture missing')
  return {
    focal: epci,
    territoires: territoiresFixture,
    selection: { etat: 'preset', preset: 'bretagne' },
    libelleActif: 'EPCI du périmètre de comparaison',
    presetDefaut: 'bretagne',
    presets: [],
    choisir: () => {},
  }
}

export function communeMembers(): { territory_type: 'commune'; territory_id: string }[] {
  return territoiresFixture
    .filter((candidate) => candidate.type === 'commune')
    .slice(0, 3)
    .map((candidate) => ({ territory_type: 'commune' as const, territory_id: candidate.territoire }))
}
