import type {
  Indicateur,
  IndicatorPageMetadata,
  Payload,
  SourceRecord,
  Territoire,
  TerritoireType,
  ThemeMetadata,
  Theme,
} from './types'
import { THEMES_CANONIQUES } from './types'
import { PayloadError, validerIndicateurs } from './validate'
import type { InjectionKey } from 'vue'

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

export type ChargerModeleIndicateur = (
  theme: Theme,
  indicator: string,
  territories: Territoire[],
) => Promise<IndicatorReadModel>

export const INDICATOR_READ_MODEL_CHARGER_KEY: InjectionKey<ChargerModeleIndicateur> =
  Symbol('indicator-read-model-charger')

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

function validatePage(raw: unknown, file: string, indicator: string): IndicatorPageMetadata {
  if (!isObject(raw)) fail(file, '« page » doit être un objet')
  const pageIndicator = nonEmptyString(raw.indicator, file, 'page.indicator')
  if (pageIndicator !== indicator) fail(file, '« page.indicator » ne correspond pas à « indicator »')
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

/** Validate one independently fetched Page d'indicateur read model (ADR-0031). */
export function validerModeleIndicateur(
  raw: unknown,
  file: string,
  territories: Territoire[],
): IndicatorReadModel {
  if (!isObject(raw)) fail(file, "le modèle d'indicateur doit être un objet")
  if (raw.schema_version !== '1') fail(file, '« schema_version » inconnue')
  const snapshotId = nonEmptyString(raw.snapshot_id, file, 'snapshot_id')
  const theme = nonEmptyString(raw.theme, file, 'theme')
  if (!THEMES_CANONIQUES.includes(theme as Theme)) fail(file, `thème inconnu « ${theme} »`)
  const indicator = nonEmptyString(raw.indicator, file, 'indicator')
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

/** Load the static indicator model without opening the legacy global tables. */
export const chargerModeleIndicateur: ChargerModeleIndicateur = async (
  theme,
  indicator,
  territories,
) => {
  const file = `indicateurs/${theme}/${indicator}.json`
  const url = `/data/modeles-lecture/${file}`
  let response: Response
  try {
    response = await fetch(url)
  } catch (cause) {
    throw new PayloadError(
      'fetch',
      file,
      `Impossible de charger ${url} : ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  if (!response.ok) {
    throw new PayloadError('fetch', file, `Réponse HTTP ${response.status} pour ${url}`)
  }
  let raw: unknown
  try {
    raw = await response.json()
  } catch {
    throw new PayloadError('fetch', file, `JSON illisible dans ${url}`)
  }
  return validerModeleIndicateur(raw, file, territories)
}

/** Adapt one indicator model to the legacy page selectors during migration. */
export function payloadDepuisModeleIndicateur(
  model: IndicatorReadModel,
  territories: Territoire[],
): Payload {
  const metadata: ThemeMetadata = {
    theme: model.theme,
    label: model.themeLabel,
    subgroups: [],
    indicator_keys: [model.indicator],
    story_keys: [],
    sources: { [model.indicator]: model.page.sources[0]! },
    source_records: model.sourceRecords,
    indicator_labels: { [model.indicator]: model.page.label },
    detail_labels: { [model.indicator]: model.detailLabels },
    param_labels: {},
    indicator_pages: { [model.indicator]: model.page },
  }
  return {
    territoires: territories,
    indicateurs: model.facts,
    histoires: [],
    apercu: null,
    runReport: null,
    vintages: null,
    programmes: null,
    themeMetadata: { [model.theme]: metadata },
  }
}
