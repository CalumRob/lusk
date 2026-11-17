/**
 * Shared fixtures for the Cahier export-capture seam (#1021).
 *
 * Builds the nine currently registered sections from the production content
 * builders, so the capture tests exercise the real renderer registry, real
 * evidence models and the real mounted owners rather than a second section list.
 */
import type { ControleComparaison, SelectionComparaison } from '@/fiche/comparisonContext'
import { contexteMembresSelectionnes, contextesDepuisReference } from '@/fiche/comparisonContext'
import { aedarPrototypeSections } from '@/fiche/content/aedarAccessSection'
import type { AedarReferenceEvidence } from '@/fiche/content/aedarAccessSection'
import type { AedarComparisonRequest } from '@/fiche/content/aedarComparisonClient'
import type { AedarTerritorySummary } from '@/fiche/content/aedarApiClient'
import type { AedarDiversityLossMapMetadata } from '@/fiche/content/aedarDiversityLossMaps'
import { AEDAR_AGGREGATE_READING_MEASURES } from '@/fiche/content/aedarTimeRampFacts'
import { buildMobiliteRaccordementSection, buildMobiliteShareSection } from '@/fiche/content/mobiliteSections'
import { resolveMobiliteThemeContent } from '@/fiche/content/themeContent'
import type { ContentSection, ThemeContent } from '@/fiche/content/themeContent'
import { territoryFactsFor } from '@/fiche/content/territoryFacts'
import type { ComparisonScope } from '@/fiche/content/territoryFacts'
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

export interface AedarSourceFixture {
  source_id: string
  vintage_id: string
  source_url: string
  licence: string
  attribution: string
  reference_date: string
  publication_date: string
}

export const aedarProvenanceFixture: AedarSourceFixture = {
  source_id: 'aedar_bretagne',
  vintage_id: 'test',
  source_url: 'https://example.test/aedar',
  licence: 'Licence Ouverte',
  attribution: 'AEDAR',
  reference_date: '2026-01-01',
  publication_date: '2026-09-30',
}

function aedarSummary(source: AedarSourceFixture = aedarProvenanceFixture): AedarTerritorySummary {
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
      ...source,
    })),
    provenance: { contentVersion: 'facts', sources: [source] },
  }
}

function aedarDetail(source: AedarSourceFixture = aedarProvenanceFixture) {
  return {
    status: 'ready' as const,
    contentVersion: 'facts',
    referenceContentVersion: 'reference',
    provenance: aedarSummary(source).provenance,
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
      ...source,
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
      ...source,
    }],
  }
}

export interface CahierExportFixture {
  readonly content: ThemeContent
  readonly control: ControleComparaison
  readonly sections: readonly ContentSection[]
}

export function readyLossMetadata(): AedarDiversityLossMapMetadata {
  return {
    status: 'ready',
    legend: {
      colors: ['#f1f2ec', '#9db7ad', '#3f6f63'],
      tickLabels: ['0', '1', '2+'],
    },
  }
}

function aedarSections(
  territory: ThemeContent['territory'],
  lossMetadata: AedarDiversityLossMapMetadata,
  source: AedarSourceFixture = aedarProvenanceFixture,
  options: { reference?: AedarReferenceEvidence | null; comparisonRequest?: AedarComparisonRequest | null } = {},
): ContentSection[] {
  return aedarPrototypeSections(aedarSummary(source), aedarDetail(source), territory, {
    lossMapMetadata: lossMetadata,
    ...(options.reference ? { reference: options.reference } : {}),
    ...(options.comparisonRequest ? { comparisonRequest: options.comparisonRequest } : {}),
  }) as ContentSection[]
}

/** Ready AEDAR publication fixtures for the production shell (no acquisition). */
export function aedarReadyFixtures(): {
  summary: AedarTerritorySummary
  detail: ReturnType<typeof aedarDetail>
} {
  return { summary: aedarSummary(), detail: aedarDetail() }
}

/** A served reference whose only non-null readings are the car mode. */
function sparseCarReference(): AedarReferenceEvidence {
  const summary = aedarSummary()
  return {
    data: {
      ...summary,
      readings: summary.readings.map((reading) => ({
        ...reading,
        value: reading.measure.startsWith('car')
          || reading.measure === 'meanDiversity'
          || reading.measure === 'meanVolume'
          ? 5 : null,
      })),
    },
    territory: { type: 'epci', id: '200000001' },
    label: 'EPCI test',
  }
}

/** One native AEDAR access section carrying the given producer provenance record. */
export function captureAedarAccessForSource(
  source: Partial<AedarSourceFixture> = {},
): ContentSection {
  const facts = territoryFactsFor(basePayload, '22001')
  if (!facts) throw new Error('Mobilité fixture facts missing')
  const sections = aedarSections(facts.territory, { status: 'loading', legend: null }, {
    ...aedarProvenanceFixture,
    ...source,
  })
  const access = sections.find((section) => section.key === 'aedar-access')
  if (!access) throw new Error('AEDAR access section missing')
  return access
}

/**
 * The nine sections currently rendered by the Cahier: five AEDAR compositions
 * and the four Mobilité delegate kinds across three units.
 */
/** The served trajectory comparison of the fixture, bound to the control's own resolved context. */
function porteeTrajectoire(
  selection: SelectionComparaison,
  focal: ControleComparaison['focal'],
): { scope: ComparisonScope; selectedMemberCount: number; eligibleCount: number } {
  const contextes = contextesDepuisReference(focal, territoiresFixture)
  if (selection.etat === 'membres' && selection.membres.length) {
    const contexte = contexteMembresSelectionnes(selection.membres)
    if (contexte) {
      return {
        scope: contexte.scope,
        selectedMemberCount: selection.membres.length,
        eligibleCount: selection.membres.length,
      }
    }
  }
  const preset = selection.etat === 'preset'
    ? selection.preset
    : (focal.type === 'commune' && focal.epci ? 'epci' : 'bretagne')
  const contexte = preset === 'densite'
    ? contextes.densite
    : preset === 'epci' ? contextes.epci : contextes.bretagne
  const communes = territoiresFixture.filter((candidate) => candidate.type === 'commune')
  const cohorte = preset === 'epci'
    ? communes.filter((candidate) => candidate.epci === focal.epci)
    : preset === 'densite'
      ? communes.filter((candidate) => candidate.classe_densite_code === focal.classe_densite_code)
      : communes
  return {
    scope: (contexte ?? contextes.bretagne!).scope,
    selectedMemberCount: cohorte.length,
    eligibleCount: cohorte.length,
  }
}

export function cahierExportFixture(options: {
  selection?: SelectionComparaison
  focal?: ControleComparaison['focal']
  lossMetadata?: AedarDiversityLossMapMetadata
  aedarReference?: 'sparse-car'
  explorerComparison?: boolean
  curveReference?: 'null'
} = {}): CahierExportFixture {
  const focal = options.focal ?? territoiresFixture[0]!
  const selection = options.selection ?? { etat: 'defaut' }
  const facts = territoryFactsFor(basePayload, '22001')
  if (!facts) throw new Error('Mobilité fixture facts missing')
  const content = resolveMobiliteThemeContent(facts, metadonneesThemesFixtures.mobilite)
  const page3Facts = territoryFactsFor(page3Payload, '22001')
  if (!page3Facts) throw new Error('Page 3 fixture facts missing')
  // Fixture-only served comparison. Its scope and its counts are the ones the
  // comparison control resolves for the SAME selection (production binds both
  // from one context): a preset EPCI never serves a Bretagne mean. The counts
  // are placed here, never computed by the app.
  const portee = porteeTrajectoire(selection, focal)
  page3Facts.mobility.selectedTrajectoryComparison = {
    statistic: 'mean',
    scope: portee.scope,
    selectedMemberCount: portee.selectedMemberCount,
    eligibleCount: portee.eligibleCount,
    modelZeroReasonCounts: {},
    sourceLineage: [],
    points: options.curveReference === 'null'
      ? []
      : page3Facts.mobility.indicators.filter((fact) => fact.key === 'raccordement_courbe'),
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
    {
      ...content.units[0]!,
      introduction: [],
      sections: aedarSections(content.territory, options.lossMetadata ?? { status: 'loading', legend: null },
        aedarProvenanceFixture, {
          reference: options.aedarReference === 'sparse-car' ? sparseCarReference() : null,
          comparisonRequest: options.explorerComparison
            ? {
              intent: { kind: 'fixed_comparison', context: 'same_level' },
              label: 'Moyenne — groupe test',
            } as AedarComparisonRequest
            : null,
        }),
    },
    content.units[1]!,
    { ...content.units[2]!, sections: page3 },
  ] as unknown as ThemeContent['units']
  const themed: ThemeContent = { ...content, units }
  const control: ControleComparaison = {
    focal,
    territoires: territoiresFixture,
    selection,
    libelleActif: 'Groupe de test',
    presetDefaut: focal.type === 'commune' && focal.epci ? 'epci' : 'bretagne',
    presets: [],
    choisir: () => {},
  }
  const sections = units.flatMap((unit) => unit.sections as readonly ContentSection[])
  return { content: themed, control, sections }
}

/** Région content: facts exist, but no peer comparison is eligible (#768). */
export function regionMobiliteContent(): ThemeContent {
  const facts = territoryFactsFor(basePayload, '53')
  if (!facts) throw new Error('Région fixture facts missing')
  return resolveMobiliteThemeContent(facts, metadonneesThemesFixtures.mobilite)
}

export function sectionOf(content: ThemeContent, key: ContentSection['key']): ContentSection {
  const section = content.units
    .flatMap((unit) => unit.sections as readonly ContentSection[])
    .find((candidate) => candidate.key === key)
  if (!section) throw new Error(`Section ${key} missing from the fixture`)
  return section
}

/** EPCI focal control for the Bretagne scope wording check. */
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
