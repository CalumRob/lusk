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
  CahierExportPublication,
  CahierSectionCaptureInput,
  CahierCaptureReadiness,
} from '@/fiche/prototype/cahierExportCapture'
import { CAHIER_SECTION_RENDERERS } from '@/fiche/prototype/cahierSectionRenderers'
import { CAHIER_EXPORT_CAPTURE_KEY } from '@/fiche/prototype/cahierExportVenue'
import {
  cahierExportFixture,
  communeMembers,
  epciControl,
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

describe('Cahier export capture — comparison identity (#1021)', () => {
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
    expect(capture.comparison.group?.statisticLabel).toBeTruthy()
    expect(capture.comparison.hasEvidence).toBe(true)
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

  it('captures an explicit empty selection as no group, never a fallback cohort', () => {
    const { content, control } = cahierExportFixture({ selection: { etat: 'vide' } })
    const capture = captureCahierSection(inputFor(sectionOf(content, 'reseaux'), { control }))
    expect(capture.comparison.selection).toMatchObject({ state: 'vide', members: [], memberCount: null })
    expect(capture.comparison.group).toBeNull()
    expect(capture.comparison.absent).toBe('empty-selection')
  })

  it('reports a comparison-ineligible territory without inventing a group', () => {
    const { content } = cahierExportFixture()
    const capture = captureCahierSection(inputFor(sectionOf(content, 'couverture-du-territoire'), {
      control: null,
      comparisonEligible: false,
    }))
    expect(capture.comparison.eligible).toBe(false)
    expect(capture.comparison.selection.known).toBe(false)
    expect(capture.comparison.group).toBeNull()
    expect(capture.comparison.absent).toBe('not-eligible')
  })

  it('keeps the neutral cross-border EPCI wording from the source contract', () => {
    const { content } = cahierExportFixture({ focal: epciControl().focal })
    const control = epciControl()
    const capture = captureCahierSection(inputFor(sectionOf(content, 'reseaux'), { control }))
    expect(capture.comparison.group).toMatchObject({
      preset: 'bretagne',
      level: 'epci',
      names: ['EPCI du périmètre de comparaison'],
      crossBorderNeutral: true,
    })
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
      statisticLabel: 'Moyenne des communes bretonnes',
    })
    const curve = capture.figures.find((figure) => figure.family === 'mobilite-curve')
    if (!curve || curve.family !== 'mobilite-curve') throw new Error('curve figure expected')
    expect(curve.model.comparison?.eligibleCount).toBe(2)
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

  it('normalizes the AEDAR source without dropping its identity or credit', () => {
    const { content } = cahierExportFixture()
    const section = sectionOf(content, 'aedar-access')
    if (section.evidence?.kind !== 'aedar-access') throw new Error('access evidence expected')
    const capture = captureCahierSection(inputFor(section))
    expect(capture.sources).toHaveLength(1)
    expect(capture.sources[0]).toMatchObject({
      label: section.evidence.source?.label,
      version: section.evidence.source?.version,
      url: section.evidence.source?.url,
    })
    expect(capture.sources[0]!.identity).toContain(section.evidence.source!.url)
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

  it('captures the map and legend availability the owners actually publish', () => {
    const { content } = cahierExportFixture()
    const section = sectionOf(content, 'aedar-car-overview')
    const publications: CahierExportPublication[] = [{
      slot: '',
      state: {
        owner: 'map-availability',
        state: {
          maps: [{ id: 'car', label: 'Voiture', declared: true, loaded: true, unavailable: false }],
          legend: 'available',
        },
      },
    }]
    const capture = captureCahierSection(inputFor(section, { publications }))
    expect(capture.capabilities.maps).toMatchObject({
      status: 'available',
      legend: 'available',
      items: [{ id: 'car', label: 'Voiture', declared: true, loaded: true, unavailable: false }],
    })
  })

  it('exposes the shared comparison-control key without importing a second registry', () => {
    expect(CONTROLE_COMPARAISON_KEY).toBeDefined()
    expect(CAHIER_EXPORT_CAPTURE_KEY).toBeDefined()
  })
})
