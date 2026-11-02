import type {
  Indicateur,
  IndicatorPageMetadata,
  SourceRecord,
  Territoire,
  TerritoireType,
  Theme,
} from './types'
import { THEMES_CANONIQUES } from './types'
import { PayloadError, validerIndicateurs } from './validate'

/**
 * Artifact schema validators for the generated per-Indicateur read models
 * (ADR-0031). Since #871 the browser no longer selects, fetches or projects
 * these models: route classification is producer-owned (`/api/resources`)
 * and unknown/retired routes render the honest unknown-indicator state.
 * The committed models and manifest remain producer-side publication and
 * recovery assets — these validators keep their schema contract tested.
 */
export interface IndicatorReadModel {
  schemaVersion: '1'
  snapshotId: string
  theme: Theme
  indicator: string
  themeLabel: string
  page: IndicatorPageMetadata
  detailLabels: Record<string, string>
  sourceRecords: Record<string, SourceRecord>
  facts: Indicateur[]
}

/** The generated route index that decides which indicator pages have a model. */
export interface IndicatorReadModelManifest {
  schemaVersion: '1'
  routes: Partial<Record<Theme, string[]>>
}

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(file: string, message: string): never {
  throw new PayloadError('validation', file, `${file} — ${message}`)
}

function nonEmptyString(value: unknown, file: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(file, `« ${field} » doit être une chaîne non vide`)
  }
  return value
}

function stringArray(value: unknown, file: string, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    fail(file, `« ${field} » doit être un tableau de chaînes non vides`)
  }
  return value as string[]
}

/** Validate the generated route index against its published schema — an
 * artifact contract only: since #871 no browser code consults the manifest,
 * so nothing it lists can influence route loading. */
export function validerManifesteModelesLecture(
  raw: unknown,
  file: string,
): IndicatorReadModelManifest {
  if (!isObject(raw)) fail(file, 'le manifeste doit être un objet')
  if (raw.schema_version !== '1') fail(file, '« schema_version » inconnue')
  if (!isObject(raw.routes)) fail(file, '« routes » doit être un objet')

  const routes: Partial<Record<Theme, string[]>> = {}
  for (const [theme, rawIndicators] of Object.entries(raw.routes)) {
    if (!THEMES_CANONIQUES.includes(theme as Theme)) fail(file, `thème inconnu « ${theme} »`)
    const indicators = stringArray(rawIndicators, file, `routes.${theme}`)
    if (new Set(indicators).size !== indicators.length) {
      fail(file, `« routes.${theme} » ne doit pas contenir de doublon`)
    }
    if (indicators.some((indicator) => !/^[a-z0-9_-]+$/.test(indicator))) {
      fail(file, `« routes.${theme} » contient un indicateur impropre à une adresse`)
    }
    routes[theme as Theme] = indicators
  }

  return { schemaVersion: '1', routes }
}

function validatePage(raw: unknown, file: string, indicator: string): IndicatorPageMetadata {
  if (!isObject(raw)) fail(file, '« page » doit être un objet')
  const pageIndicator = nonEmptyString(raw.indicator, file, 'page.indicator')
  if (pageIndicator !== indicator) fail(file, '« page.indicator » ne correspond pas à « indicator »')
  if (raw.read_model !== undefined && typeof raw.read_model !== 'boolean') {
    fail(file, '« page.read_model » doit être booléen')
  }
  const direction = raw.direction
  if (direction !== 'high' && direction !== 'low') {
    fail(file, '« page.direction » doit être high ou low')
  }
  const levels = stringArray(raw.levels, file, 'page.levels')
  const allowedLevels: TerritoireType[] = ['commune', 'epci', 'departement', 'region']
  if (levels.some((level) => !allowedLevels.includes(level as TerritoireType))) {
    fail(file, '« page.levels » porte un niveau inconnu')
  }
  const family = raw.family ?? 'scalar'
  if (family !== 'scalar') {
    fail(file, `la première version du modèle ne prend en charge que la famille scalar, pas « ${String(family)} »`)
  }
  return {
    ...raw,
    family,
    indicator: pageIndicator,
    ...(raw.read_model === undefined ? {} : { read_model: raw.read_model }),
    label: nonEmptyString(raw.label, file, 'page.label'),
    definition: nonEmptyString(raw.definition, file, 'page.definition'),
    unit: nonEmptyString(raw.unit, file, 'page.unit'),
    calculation: nonEmptyString(raw.calculation, file, 'page.calculation'),
    direction,
    caveats: nonEmptyString(raw.caveats, file, 'page.caveats'),
    levels: levels as TerritoireType[],
    sources: stringArray(raw.sources, file, 'page.sources'),
  } as IndicatorPageMetadata
}

function validateSourceRecords(
  raw: unknown,
  file: string,
  sourceIds: string[],
): Record<string, SourceRecord> {
  if (!isObject(raw)) fail(file, '« source_records » doit être un objet')
  const records: Record<string, SourceRecord> = {}
  for (const sourceId of sourceIds) {
    const record = raw[sourceId]
    if (!isObject(record)) fail(file, `source référencée « ${sourceId} » introuvable`)
    for (const field of ['dataset', 'publisher', 'url', 'licence', 'vintage', 'freshness']) {
      nonEmptyString(record[field], file, `source_records.${sourceId}.${field}`)
    }
    records[sourceId] = record as unknown as SourceRecord
  }
  return records
}

/** Validate one generated Page d'indicateur read model (ADR-0031) against its
 * published territorial reference. */
export function validerModeleIndicateur(
  raw: unknown,
  file: string,
  territories: Territoire[],
  expectedRoute?: { theme: Theme; indicator: string },
): IndicatorReadModel {
  if (!isObject(raw)) fail(file, "le modèle d'indicateur doit être un objet")
  if (raw.schema_version !== '1') fail(file, '« schema_version » inconnue')
  const snapshotId = nonEmptyString(raw.snapshot_id, file, 'snapshot_id')
  const theme = nonEmptyString(raw.theme, file, 'theme')
  if (!THEMES_CANONIQUES.includes(theme as Theme)) fail(file, `thème inconnu « ${theme} »`)
  const indicator = nonEmptyString(raw.indicator, file, 'indicator')
  if (expectedRoute && theme !== expectedRoute.theme) {
    fail(file, `« theme » ne correspond pas à la route « ${expectedRoute.theme} »`)
  }
  if (expectedRoute && indicator !== expectedRoute.indicator) {
    fail(file, `« indicator » ne correspond pas à la route « ${expectedRoute.indicator} »`)
  }
  const page = validatePage(raw.page, file, indicator)
  if (!isObject(raw.detail_labels)) fail(file, '« detail_labels » doit être un objet')
  const detailLabels = Object.fromEntries(
    Object.entries(raw.detail_labels).map(([key, label]) => [
      key,
      nonEmptyString(label, file, `detail_labels.${key}`),
    ]),
  )
  const sourceRecords = validateSourceRecords(raw.source_records, file, page.sources)
  const facts = validerIndicateurs(raw.facts, file, territories)
  if (facts.some((fact) => fact.theme !== theme || fact.key !== page.indicator)) {
    fail(file, '« facts » contient une ligne hors de la page déclarée')
  }
  if (facts.some((fact) => !page.levels.includes(fact.type))) {
    fail(file, '« facts » contient un niveau non déclaré par la page')
  }

  return {
    schemaVersion: '1',
    snapshotId,
    theme: theme as Theme,
    indicator,
    themeLabel: nonEmptyString(raw.theme_label, file, 'theme_label'),
    page,
    detailLabels,
    sourceRecords,
    facts,
  }
}
