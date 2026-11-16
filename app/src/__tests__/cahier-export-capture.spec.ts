import { describe, expect, it } from 'vitest'

import { CONTROLE_COMPARAISON_KEY } from '@/fiche/comparisonContext'
import { AEDAR_RAMP_MODE_LABELS, AEDAR_RAMP_MODES } from '@/fiche/content/aedarTimeRampFacts'
import type {
  ContentEvidence,
  ContentSection,
  MobiliteNetworksEvidence,
  AedarRampMode,
} from '@/fiche/content/themeContent'
import {
  CAHIER_EXPORT_MAX_MODES,
  cahierCaptureFamily,
  captureCahierSection,
  projeterRequeteExport,
} from '@/fiche/prototype/cahierExportCapture'
import type {
  CahierAedarCaptureState,
  CahierComparisonLayerCaptureState,
  CahierExportPublication,
  CahierSectionCaptureInput,
  CahierCaptureReadiness,
} from '@/fiche/prototype/cahierExportCapture'
import { CAHIER_SECTION_RENDERERS } from '@/fiche/prototype/cahierSectionRenderers'
import { CAHIER_EXPORT_CAPTURE_KEY } from '@/fiche/prototype/cahierExportVenue'
import {
  cahierExportFixture,
  captureAedarAccessForSource,
  communeMembers,
  epciControl,
  readyLossMetadata,
  sectionOf,
} from './helpers/cahierExportFixtures'

const aedarState: CahierAedarCaptureState = {
  modes: ['car', 'transit', 'bike_lts2'],
  horizonMinutes: 15,
  comparisonVisible: true,
  comparisonEligible: true,
  chapterActive: false,
}

function readinessFor(section: ContentSection): CahierCaptureReadiness {
  return { status: 'ready', reason: 'evidence-ready', availability: section.availability }
}

function inputFor(
  section: ContentSection,
  options: Partial<CahierSectionCaptureInput> = {},
): CahierSectionCaptureInput {
  const fixture = cahierExportFixture()
  return {
    section,
    unit: { key: 'acces-aux-services', label: 'Accès aux services' },
    territory: fixture.content.territory,
    readiness: readinessFor(section),
    comparisonEligible: true,
    comparisonStatus: 'ready',
    comparisonError: null,
    control: fixture.control,
    aedar: aedarState,
    publications: [],
    ...options,
  }
}

function layer(
  slot: string,
  state: Partial<CahierComparisonLayerCaptureState> = {},
): CahierExportPublication {
  return {
    slot,
    state: {
      owner: 'mobilite-comparison-bars',
      state: { toggle: true, referenceAvailable: true, visibleReferenceAvailable: true, displayed: true, ...state },
    },
  }
}

describe('Cahier export capture — closed admission and coherent identity (#1021)', () => {
  it('admits every registered evidence kind through the closed family map', () => {
    const kinds = Object.keys(CAHIER_SECTION_RENDERERS) as ContentEvidence['kind'][]
    const families = new Set(kinds.map((kind) => cahierCaptureFamily(kind)))
    expect(families).toEqual(new Set([
      'aedar-car-overview',
      'aedar-diversity-loss',
      'aedar-ramps',
      'aedar-equipment-profile',
      'aedar-equipment-explorer',
      'mobilite-bars',
      'mobilite-share',
      'mobilite-curve',
    ]))
  })

  it('captures all nine registered sections from their real evidence models', () => {
    const { content, sections } = cahierExportFixture()
    const registeredKinds = new Set(Object.keys(CAHIER_SECTION_RENDERERS))
    const renderedKinds = new Set(sections.map((section) => section.evidence?.kind))
    expect(renderedKinds).toEqual(registeredKinds)

    for (const section of sections) {
      const capture = captureCahierSection(inputFor(section, {
        territory: content.territory,
      }))
      expect(capture.identity.sectionKey).toBe(section.key)
      expect(capture.identity.evidenceKind).toBe(section.evidence?.kind)
      expect(capture.identity.sectionLabel).toBe(section.label)
      expect(capture.identity.territory).toMatchObject({
        type: content.territory.type,
        code: content.territory.code,
        name: content.territory.name,
      })
      expect(capture.readiness).toEqual(readinessFor(section))
      expect(capture.figures.length).toBeGreaterThan(0)
      expect(capture.figures.every((figure) => figure.family === cahierCaptureFamily(section.evidence!.kind)))
        .toBe(true)
      expect(Object.isFrozen(capture)).toBe(true)
      expect(Object.isFrozen(capture.figures)).toBe(true)
    }
  })

  it('captures the paired Mobilité terrain as two independent figures with their own ratio', () => {
    const { content } = cahierExportFixture()
    const section = sectionOf(content, 'stationnement-ravitaillement')
    const capture = captureCahierSection(inputFor(section))
    expect(capture.figures.map((figure) => figure.slot)).toEqual(['stationnement', 'ravitaillement'])
    for (const figure of capture.figures) {
      if (figure.family !== 'mobilite-bars') throw new Error('bars family expected')
      expect(figure.model.ratio).not.toBeNull()
      expect(figure.model.figure.categories.length).toBeGreaterThan(0)
    }
  })

  it('offers only the series the section really lets a reader choose', () => {
    const { content } = cahierExportFixture()
    const access = captureCahierSection(inputFor(sectionOf(content, 'aedar-access')))
    expect(access.capabilities.selectableSeries.map((series) => series.id)).toEqual([...AEDAR_RAMP_MODES])
    expect(access.capabilities.selectableSeries.map((series) => series.label))
      .toEqual(AEDAR_RAMP_MODES.map((mode) => AEDAR_RAMP_MODE_LABELS[mode]))
    expect(access.capabilities.selectedSeries).toEqual(aedarState.modes)

    const explorer = captureCahierSection(inputFor(sectionOf(content, 'aedar-equipment-explorer')))
    expect(explorer.capabilities.selectableSeries).toHaveLength(AEDAR_RAMP_MODES.length)

    // Fixed map panels, waffle categories and Mobilité categories are not PDF mode choices.
    for (const key of ['aedar-car-overview', 'aedar-diversity-loss', 'aedar-equipment-profile',
      'reseaux', 'stationnement-ravitaillement', 'couverture-du-territoire', 'visiter-la-bretagne'] as const) {
      const capture = captureCahierSection(inputFor(sectionOf(content, key)))
      expect(capture.capabilities.selectableSeries).toEqual([])
      expect(capture.capabilities.selectedSeries).toEqual([])
    }
  })
})

describe('Cahier export capture — comparison identity and effective presentation (#1021)', () => {
  it('resolves the preset default with the exact EPCI public name, never a parsed label', () => {
    const { content, control } = cahierExportFixture()
    const epci = control.territoires.find((candidate) => candidate.type === 'epci' && candidate.territoire === control.focal.epci)
    const capture = captureCahierSection(inputFor(sectionOf(content, 'reseaux')))
    expect(capture.comparison.selection).toMatchObject({
      known: true,
      state: 'defaut',
      preset: 'epci',
      defaultPreset: 'epci',
      level: 'commune',
      memberCount: null,
    })
    expect(capture.comparison.group).toMatchObject({
      preset: 'epci',
      level: 'commune',
      names: [epci?.nom],
    })
    expect(capture.comparison.capable).toBe(true)
  })

  it('does not advertise a displayed comparison without an owner observation', () => {
    const { content } = cahierExportFixture()
    const capture = captureCahierSection(inputFor(sectionOf(content, 'reseaux')))
    expect(capture.comparison.display).toEqual({
      state: 'unobserved',
      reason: 'unpublished',
      layers: [],
    })
    expect(capture.comparison.group).not.toBeNull()
  })

  it('reports displayed proof only when the owner publishes a drawn layer', () => {
    const { content } = cahierExportFixture()
    const displayed = captureCahierSection(inputFor(sectionOf(content, 'reseaux'), {
      publications: [layer('bars')],
    }))
    expect(displayed.comparison.display).toEqual({
      state: 'displayed',
      reason: 'shown',
      layers: [{ slot: 'bars', toggle: true, referenceAvailable: true, visibleReferenceAvailable: true, displayed: true }],
    })

    const hidden = captureCahierSection(inputFor(sectionOf(content, 'reseaux'), {
      publications: [layer('bars', { toggle: false, displayed: false })],
    }))
    expect(hidden.comparison.display.state).toBe('not-displayed')
    expect(hidden.comparison.display.reason).toBe('hidden-by-user')

    const missingReference = captureCahierSection(inputFor(sectionOf(content, 'reseaux'), {
      publications: [layer('bars', {
        referenceAvailable: false, visibleReferenceAvailable: false, displayed: false,
      })],
    }))
    expect(missingReference.comparison.display.reason).toBe('no-served-reference')

    const loading = captureCahierSection(inputFor(sectionOf(content, 'reseaux'), {
      comparisonStatus: 'loading',
      publications: [layer('bars', {
        referenceAvailable: false, visibleReferenceAvailable: false, displayed: false,
      })],
    }))
    expect(loading.comparison.display.reason).toBe('loading')

    const unavailable = captureCahierSection(inputFor(sectionOf(content, 'reseaux'), {
      comparisonStatus: 'unavailable',
      publications: [layer('bars', {
        referenceAvailable: false, visibleReferenceAvailable: false, displayed: false,
      })],
    }))
    expect(unavailable.comparison.display.reason).toBe('unavailable')
  })

  it('preserves an owner comparison failure instead of calling it a legitimate absence', () => {
    const { content } = cahierExportFixture()
    const capture = captureCahierSection(inputFor(sectionOf(content, 'aedar-equipment-explorer'), {
      comparisonStatus: 'ready',
      publications: [{
        slot: 'equipment',
        state: {
          owner: 'aedar-equipment-explorer',
          state: {
            typequ: 'B207',
            typequLabel: null,
            selectedDetail: null,
            detailStatus: 'idle',
            comparisonStatus: 'error',
            comparisonError: 'Lecture du groupe impossible',
            comparison: null,
            referenceDetail: null,
          },
        },
      }, layer('comparison', {
        referenceAvailable: false, visibleReferenceAvailable: false, displayed: false,
      })],
    }))
    expect(capture.comparison.status).toBe('error')
    expect(capture.comparison.error).toBe('Lecture du groupe impossible')
    expect(capture.comparison.display.reason).toBe('error')
  })

  it('keeps a failed direct reference read distinct from a legitimate absence', () => {
    const { content } = cahierExportFixture()
    const capture = captureCahierSection(inputFor(sectionOf(content, 'aedar-access'), {
      comparisonStatus: 'ready',
      referenceStatus: 'error',
      publications: [layer('comparison', {
        referenceAvailable: false, visibleReferenceAvailable: false, displayed: false,
      })],
    }))
    expect(capture.comparison.status).toBe('ready')
    expect(capture.comparison.referenceStatus).toBe('error')
    expect(capture.comparison.display.reason).toBe('error')
  })

  it('keeps a ready direct reference distinct from a section that consumes none', () => {
    const { content } = cahierExportFixture()
    const ready = captureCahierSection(inputFor(sectionOf(content, 'aedar-access'), {
      referenceStatus: 'ready',
    }))
    expect(ready.comparison.referenceStatus).toBe('ready')

    const unobserved = captureCahierSection(inputFor(sectionOf(content, 'aedar-access')))
    expect(unobserved.comparison.referenceStatus).toBe('unobserved')

    const networks = captureCahierSection(inputFor(sectionOf(content, 'reseaux')))
    expect(networks.comparison.referenceStatus).toBeNull()
    const profile = captureCahierSection(inputFor(sectionOf(content, 'aedar-equipment-profile')))
    expect(profile.comparison.referenceStatus).toBeNull()
  })

  it('separates available acquired references from the effective hidden subset', () => {
    const { content } = cahierExportFixture()
    const capture = captureCahierSection(inputFor(sectionOf(content, 'aedar-access'), {
      publications: [layer('comparison', {
        referenceAvailable: true, visibleReferenceAvailable: false, displayed: false,
      })],
    }))
    expect(capture.comparison.display.state).toBe('not-displayed')
    expect(capture.comparison.display.reason).toBe('hidden-by-selection')
    expect(capture.comparison.display.layers[0]).toMatchObject({
      referenceAvailable: true,
      visibleReferenceAvailable: false,
      displayed: false,
    })
  })

  it('never advertises displayed comparison for a region or an explicit empty selection', () => {
    const { content, control } = cahierExportFixture({ selection: { etat: 'vide' } })
    const region = captureCahierSection(inputFor(sectionOf(content, 'couverture-du-territoire'), {
      control: null,
      comparisonEligible: false,
      publications: [layer('share')],
    }))
    expect(region.comparison.display.state).toBe('not-displayed')
    expect(region.comparison.display.reason).toBe('not-eligible')

    const empty = captureCahierSection(inputFor(sectionOf(content, 'couverture-du-territoire'), {
      control,
      publications: [layer('share')],
    }))
    expect(empty.comparison.display.state).toBe('not-displayed')
    expect(empty.comparison.display.reason).toBe('empty-selection')
    expect(empty.comparison.group).toBeNull()
    expect(empty.comparison.absent).toBe('empty-selection')
  })

  it('marks a family without a comparative layer as not applicable', () => {
    const { content } = cahierExportFixture()
    const capture = captureCahierSection(inputFor(sectionOf(content, 'aedar-equipment-profile')))
    expect(capture.comparison.capable).toBe(false)
    expect(capture.comparison.display).toEqual({
      state: 'not-applicable',
      reason: 'capability-absent',
      layers: [],
    })
  })

  it('keeps the actually selected members and their exact public names in order', () => {
    const members = communeMembers()
    const { content, control } = cahierExportFixture({ selection: { etat: 'membres', membres: members } })
    const capture = captureCahierSection(inputFor(sectionOf(content, 'aedar-access'), { control }))
    expect(capture.comparison.selection.state).toBe('membres')
    expect(capture.comparison.selection.memberCount).toBe(members.length)
    expect(capture.comparison.selection.members.map((member) => member.id))
      .toEqual(members.map((member) => member.territory_id))
    expect(capture.comparison.selection.members.every((member) => Boolean(member.name))).toBe(true)
    expect(capture.comparison.group?.names).toEqual(capture.comparison.selection.members.map((member) => member.name))
    expect(capture.comparison.group?.scopeKind).toBe('selection')
  })

  it('reports an unresolvable default preset as unresolved, not as an empty selection', () => {
    const { content, control } = cahierExportFixture()
    const focal = { ...control.focal, epci: null }
    const capture = captureCahierSection(inputFor(sectionOf(content, 'reseaux'), {
      control: { ...control, focal, presetDefaut: 'epci' },
    }))
    expect(capture.comparison.selection.state).toBe('defaut')
    expect(capture.comparison.group).toBeNull()
    expect(capture.comparison.absent).toBe('unresolved-selection')
  })

  it('keeps the neutral EPCI/Bretagne wording from the source contract without a transborder flag', () => {
    const { content } = cahierExportFixture({ focal: epciControl().focal })
    const control = epciControl()
    const capture = captureCahierSection(inputFor(sectionOf(content, 'reseaux'), { control }))
    expect(capture.comparison.group).toMatchObject({
      preset: 'bretagne',
      level: 'epci',
      names: ['EPCI du périmètre de comparaison'],
    })
    expect(capture.comparison.group).not.toHaveProperty('crossBorderNeutral')
    expect(capture.comparison.group?.names.join(' ')).not.toMatch(/EPCI bretons/iu)
  })

  it('keeps selected members distinct from producer-served eligible contributors', () => {
    const members = communeMembers()
    const { content, control } = cahierExportFixture({ selection: { etat: 'membres', membres: members } })
    const section = sectionOf(content, 'visiter-la-bretagne')
    if (section.evidence?.kind !== 'mobilite-raccordement') throw new Error('curve evidence expected')
    // Explicit served-comparison fixture (marked): counts are producer-served, never derived.
    const servedComparison = {
      statistic: 'mean' as const,
      scope: { kind: 'communes-bretagne' as const, label: 'communes bretonnes' },
      selectedMemberCount: 3,
      eligibleCount: 2,
      modelZeroReasonCounts: {},
      points: section.evidence.points,
    }
    const variant = {
      ...section,
      evidence: { ...section.evidence, comparison: servedComparison, comparisonLabel: 'Moyenne des communes bretonnes' },
    } as ContentSection
    const capture = captureCahierSection(inputFor(variant, { control }))
    expect(capture.comparison.selection.memberCount).toBe(3)
    expect(capture.comparison.group).toMatchObject({
      selectedMemberCount: 3,
      eligibleContributorCount: 2,
    })
    expect(capture.comparison.statisticLabels).toEqual(['Moyenne des communes bretonnes'])
    const curve = capture.figures.find((figure) => figure.family === 'mobilite-curve')
    if (!curve || curve.family !== 'mobilite-curve') throw new Error('curve figure expected')
    expect(curve.model.comparison?.eligibleCount).toBe(2)
  })

  it('preserves each paired column statistic instead of claiming the first one for both', () => {
    const { content } = cahierExportFixture()
    const section = sectionOf(content, 'stationnement-ravitaillement')
    if (section.evidence?.kind !== 'mobilite-stationnement-ravitaillement') {
      throw new Error('paired evidence expected')
    }
    const labels = ['Médiane des stationnements', 'Moyenne des ravitaillements'] as const
    const evidence = section.evidence!
    const variant = {
      ...section,
      evidence: {
        ...evidence,
        columns: evidence.columns.map((column, index) => ({
          ...column,
          bars: { ...column.bars, comparisonLabel: labels[index]! },
        })) as unknown as typeof evidence.columns,
      },
    } as ContentSection
    const capture = captureCahierSection(inputFor(variant, { publications: [layer('stationnement'), layer('ravitaillement')] }))
    expect(capture.comparison.statisticLabels).toEqual([...labels])
    const stationnement = capture.figures.find((figure) => figure.slot === 'stationnement')
    const ravitaillement = capture.figures.find((figure) => figure.slot === 'ravitaillement')
    if (stationnement?.family !== 'mobilite-bars' || ravitaillement?.family !== 'mobilite-bars') {
      throw new Error('paired bars expected')
    }
    expect(stationnement.model.figure.comparisonLabel).toBe(labels[0])
    expect(ravitaillement.model.figure.comparisonLabel).toBe(labels[1])
    expect(capture.comparison.display.layers.map((entry) => entry.slot)).toEqual(['stationnement', 'ravitaillement'])
  })
})

describe('Cahier export capture — sources and provenance (#1021)', () => {
  it('keeps linked and unlinked sources with distinct provenance identities', () => {
    const { content } = cahierExportFixture()
    const section = sectionOf(content, 'reseaux')
    if (section.evidence?.kind !== 'mobilite-networks') throw new Error('networks evidence expected')
    const evidence: MobiliteNetworksEvidence = section.evidence
    const variant = {
      ...section,
      evidence: {
        ...evidence,
        sources: [
          { id: 'osm', source: 'OpenStreetMap', version: '2026-08', displayVersion: '2026-08',
            referenceDate: '2026-08-05', publicationDate: '2026-08-06', url: 'https://osm.test', licence: 'ODbL' },
          { id: 'osm-alt', source: 'OpenStreetMap', version: '2026-09',
            referenceDate: '2026-09-05', publicationDate: null, url: null, licence: null },
        ],
      },
    } as ContentSection
    const capture = captureCahierSection(inputFor(variant))
    expect(capture.sources).toHaveLength(2)
    expect(capture.sources[0]).toMatchObject({
      id: 'osm', label: 'OpenStreetMap', version: '2026-08', displayVersion: '2026-08',
      url: 'https://osm.test', licence: 'ODbL',
    })
    expect(capture.sources[1]).toMatchObject({ id: 'osm-alt', url: null, licence: null, displayVersion: null })
    expect(capture.sources[0]!.identity).not.toBe(capture.sources[1]!.identity)
  })

  it('carries the native AEDAR provenance identity, licence and clocks', () => {
    const capture = captureCahierSection(inputFor(captureAedarAccessForSource()))
    expect(capture.sources).toHaveLength(1)
    expect(capture.sources[0]).toMatchObject({
      id: 'aedar_bretagne',
      label: 'AEDAR',
      version: 'test',
      url: 'https://example.test/aedar',
      licence: 'Licence Ouverte',
      referenceDate: '2026-01-01',
      publicationDate: '2026-09-30',
    })
    expect(capture.generation).toEqual({ contentVersion: 'facts', referenceContentVersion: 'reference' })
  })

  it('distinguishes native AEDAR records with identical displayed text', () => {
    const first = captureCahierSection(inputFor(captureAedarAccessForSource({
      source_id: 'aedar_a',
      licence: 'Licence A',
      reference_date: '2026-01-01',
      publication_date: '2026-01-02',
    })))
    const second = captureCahierSection(inputFor(captureAedarAccessForSource({
      source_id: 'aedar_b',
      licence: 'Licence B',
      reference_date: '2026-02-01',
      publication_date: '2026-02-02',
    })))
    expect(first.sources[0]!.label).toBe(second.sources[0]!.label)
    expect(first.sources[0]!.version).toBe(second.sources[0]!.version)
    expect(first.sources[0]!.url).toBe(second.sources[0]!.url)
    expect(first.sources[0]!.id).toBe('aedar_a')
    expect(second.sources[0]!.id).toBe('aedar_b')
    expect(first.sources[0]!.licence).not.toBe(second.sources[0]!.licence)
    expect(first.sources[0]!.referenceDate).not.toBe(second.sources[0]!.referenceDate)
    expect(first.sources[0]!.identity).not.toBe(second.sources[0]!.identity)
  })

  it('leaves Mobilité generation tokens explicitly absent rather than inventing one', () => {
    const { content } = cahierExportFixture()
    const capture = captureCahierSection(inputFor(sectionOf(content, 'reseaux')))
    expect(capture.generation).toEqual({ contentVersion: null, referenceContentVersion: null })
  })
})

describe('Cahier export capture — mode projection (#1021)', () => {
  it('projects one to three offered modes without mutating the capture', () => {
    const { content } = cahierExportFixture()
    const capture = captureCahierSection(inputFor(sectionOf(content, 'aedar-access')))
    const snapshot = JSON.stringify(capture)
    const projected = projeterRequeteExport(capture, ['car', 'walk'])
    expect(projected.status).toBe('ready')
    if (projected.status !== 'ready') return
    expect(Object.isFrozen(projected.request)).toBe(true)
    expect(projected.request.modeIds).toEqual(['car', 'walk'])
    expect(projected.request.modes).toEqual([
      { id: 'car', label: AEDAR_RAMP_MODE_LABELS.car },
      { id: 'walk', label: AEDAR_RAMP_MODE_LABELS.walk },
    ])
    expect(projected.request.capture).toBe(capture)
    expect(JSON.stringify(capture)).toBe(snapshot)
  })

  it('rejects zero, too many, unknown and duplicated modes explicitly', () => {
    const { content } = cahierExportFixture()
    const capture = captureCahierSection(inputFor(sectionOf(content, 'aedar-access')))
    expect(projeterRequeteExport(capture, [])).toMatchObject({ status: 'invalid', reason: 'no-modes' })
    expect(projeterRequeteExport(capture, ['car', 'walk', 'transit', 'bike_lts4']))
      .toMatchObject({ status: 'invalid', reason: 'too-many-modes' })
    expect(projeterRequeteExport(capture, ['car', 'boat']))
      .toMatchObject({ status: 'invalid', reason: 'unknown-mode' })
    expect(projeterRequeteExport(capture, ['car', 'car']))
      .toMatchObject({ status: 'invalid', reason: 'duplicate-mode' })
    expect(CAHIER_EXPORT_MAX_MODES).toBe(3)
  })

  it('accepts an empty choice only when the section offers no selectable series', () => {
    const { content } = cahierExportFixture()
    const capture = captureCahierSection(inputFor(sectionOf(content, 'reseaux')))
    const projected = projeterRequeteExport(capture, [])
    expect(projected.status).toBe('ready')
    if (projected.status !== 'ready') return
    expect(projected.request.modes).toEqual([])
    expect(projeterRequeteExport(capture, ['walk'])).toMatchObject({ status: 'invalid', reason: 'unknown-mode' })
  })

  it('keeps an already-produced request independent from later screen selection', () => {
    const { content, control } = cahierExportFixture()
    const capture = captureCahierSection(inputFor(sectionOf(content, 'aedar-access')))
    const projected = projeterRequeteExport(capture, ['car'])
    if (projected.status !== 'ready') throw new Error('projection expected')
    // The fiche control changes after the request was produced.
    const aedar = { ...aedarState, modes: ['car', 'transit', 'bike_lts2'] as AedarRampMode[] }
    const mutableCapture = captureCahierSection(inputFor(sectionOf(content, 'aedar-access'), { aedar }))
    const mutableProjection = projeterRequeteExport(mutableCapture, ['car'])
    if (mutableProjection.status !== 'ready') throw new Error('projection expected')
    control.selection = { etat: 'vide' }
    aedar.modes.splice(0, aedar.modes.length, 'walk')
    expect(mutableProjection.request.capture.comparison.selection.state).toBe('defaut')
    expect(mutableProjection.request.capture.comparison.group).not.toBeNull()
    expect(mutableProjection.request.capture.aedar?.modes).toEqual(['car', 'transit', 'bike_lts2'])
    expect(mutableProjection.request.modeIds).toEqual(['car'])
    expect(projected.request.capture.comparison.selection.state).toBe('defaut')
    expect(projected.request.modeIds).toEqual(['car'])
  })
})

describe('Cahier export capture — readiness and map availability (#1021)', () => {
  it('captures truthful pending, absent and error states without deciding a UI policy', () => {
    const { content } = cahierExportFixture()
    const section = sectionOf(content, 'aedar-access')
    const pending = captureCahierSection(inputFor(section, {
      readiness: { status: 'pending', reason: 'chapter-pending', availability: section.availability },
    }))
    expect(pending.readiness).toMatchObject({ status: 'pending', reason: 'chapter-pending' })
    const error = captureCahierSection(inputFor(section, {
      readiness: { status: 'error', reason: 'chapter-error', availability: 'incomplete' },
    }))
    expect(error.readiness).toMatchObject({ status: 'error', reason: 'chapter-error' })
  })

  it('keeps map and legend state unknown until a map owner publishes an observation', () => {
    const { content } = cahierExportFixture()
    for (const key of ['aedar-car-overview', 'aedar-diversity-loss', 'reseaux'] as const) {
      const capture = captureCahierSection(inputFor(sectionOf(content, key)))
      expect(capture.capabilities.maps).toEqual({ status: 'unknown', legend: 'unknown', items: [] })
    }
    const profile = captureCahierSection(inputFor(sectionOf(content, 'aedar-equipment-profile')))
    expect(profile.capabilities.maps).toEqual({ status: 'none', legend: 'none', items: [] })
  })

  it('derives map status only from owner-observed load state', () => {
    const { content } = cahierExportFixture()
    const section = sectionOf(content, 'aedar-car-overview')
    const publication = (maps: { declared: boolean; loaded: boolean; unavailable: boolean }[]): CahierExportPublication => ({
      slot: '',
      state: {
        owner: 'map-availability',
        state: {
          maps: maps.map((state) => ({ id: 'car', label: 'Voiture', ...state })),
          legend: 'available',
        },
      },
    })
    const pending = captureCahierSection(inputFor(section, {
      publications: [publication([{ declared: true, loaded: false, unavailable: false }])],
    }))
    expect(pending.capabilities.maps).toMatchObject({ status: 'pending', legend: 'available' })

    const loaded = captureCahierSection(inputFor(section, {
      publications: [publication([{ declared: true, loaded: true, unavailable: false }])],
    }))
    expect(loaded.capabilities.maps.status).toBe('available')

    const failed = captureCahierSection(inputFor(section, {
      publications: [publication([{ declared: true, loaded: false, unavailable: true }])],
    }))
    expect(failed.capabilities.maps.status).toBe('unavailable')

    const undeclared = captureCahierSection(inputFor(section, {
      publications: [publication([{ declared: false, loaded: false, unavailable: false }])],
    }))
    expect(undeclared.capabilities.maps.status).toBe('unavailable')
  })

  it('captures the diversity legend the owner actually publishes', () => {
    const { content } = cahierExportFixture({ lossMetadata: readyLossMetadata() })
    const capture = captureCahierSection(inputFor(sectionOf(content, 'aedar-diversity-loss'), {
      publications: [{
        slot: '',
        state: {
          owner: 'map-availability',
          state: { maps: [], legend: 'available' },
        },
      }],
    }))
    expect(capture.capabilities.maps.legend).toBe('available')
  })

  it('exposes the shared comparison-control key without importing a second registry', () => {
    expect(CONTROLE_COMPARAISON_KEY).toBeDefined()
    expect(CAHIER_EXPORT_CAPTURE_KEY).toBeDefined()
  })
})
