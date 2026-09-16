import type { InjectionKey } from 'vue'

import type {
  DistributionAccesBatimentsRow,
  Histoire,
  Indicateur,
  Payload,
  ProfilAccesBpeRow,
  RampeAccesBatimentsRow,
  Territoire,
  TerritoireType,
  Theme,
  ThemeMetadata,
} from './types'
import { THEMES_CANONIQUES } from './types'
import {
  PayloadError,
  validerDistributionAccesBatiments,
  validerHistoires,
  validerIndicateurs,
  validerProfilsAccesBpe,
  validerRampeAccesBatiments,
  validerTerritoires,
  validerThemeMetadata,
} from './validate'

/** One theme's rows, metadata, and auxiliary evidence inside a territory model. */
export interface TerritoryThemeReadModel {
  theme: Theme
  indicators: Indicateur[]
  histories: Histoire[]
  metadata: ThemeMetadata
  /** These three fields are part of the same atomic Mobilité projection. */
  bpeAccess: ProfilAccesBpeRow[] | null
  buildingDistribution: DistributionAccesBatimentsRow[] | null
  accessRamp: RampeAccesBatimentsRow[] | null
  comparisons: Partial<Record<TerritoryComparisonMode, TerritoryComparisonContext>>
  comparisonDirections: Record<string, 'high' | 'low'>
}

export type TerritoryComparisonMode = 'densite' | 'epci' | 'bretagne'

export interface TerritoryComparisonFact {
  key: string
  detail: string | null
  sex: string | null
  dimension: string | null
  origin: 'indicator' | 'derived'
  direction: 'plus-est-mieux' | 'moins-est-mieux'
  rank: { position: number; size: number } | null
  reference: { kind: 'mean' | 'median'; value: number } | null
}

export interface TerritoryComparisonContext {
  mode: TerritoryComparisonMode
  scope: {
    kind: 'communes-epci' | 'communes-bretagne' | 'epcis-bretagne' | 'departements-bretagne'
    label: string
  }
  facts: TerritoryComparisonFact[]
  buildingDistribution: {
    label: string
    totalBuildings: number
    cells: Array<{
      breadthBucket: string
      depthBucket: string
      buildingCount: number
      share: number
    }>
  } | null
  accessRamp: {
    label: string
    totalBuildings: number
    points: Array<{
      mode: 'c' | 'b' | 't'
      quantile: number
      accessibleTypes: number
    }>
  } | null
}

/**
 * Static territory projection (ADR-0031).
 *
 * `territories` is the small identity/navigation slice needed by the existing
 * selectors: the target and its ladder parents, never its comparison peers.
 * Comparison results live in stable mode-keyed projections. More modes and
 * themes can therefore be added without changing the artifact address.
 */
export interface TerritoryReadModel {
  schemaVersion: '1'
  snapshotId: string
  territory: Territoire
  territories: Territoire[]
  themes: Partial<Record<Theme, TerritoryThemeReadModel>>
}

export type ChargerModeleTerritoire = (
  type: TerritoireType,
  territoire: string,
) => Promise<TerritoryReadModel>

export const TERRITORY_READ_MODEL_CHARGER_KEY: InjectionKey<ChargerModeleTerritoire> =
  Symbol('territory-read-model-charger')

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

function componentForPath(value: unknown, file: string, field: string): string {
  const component = nonEmptyString(value, file, field)
  if (!/^[a-z0-9_-]+$/.test(component)) {
    fail(file, `« ${field} » contient des caractères interdits pour une adresse de fichier`)
  }
  return component
}

function validateTheme(
  raw: unknown,
  theme: Theme,
  file: string,
  territories: Territoire[],
  territory: Territoire,
): TerritoryThemeReadModel {
  if (!isObject(raw)) fail(file, `« themes.${theme} » doit être un objet`)
  if (raw.theme !== theme) fail(file, `« themes.${theme}.theme » ne correspond pas à la clé du thème`)

  const metadata = validerThemeMetadata(raw.theme_metadata, file)
  if (metadata.theme !== theme) fail(file, `« themes.${theme}.theme_metadata.theme » ne correspond pas au thème`)

  const indicators = validerIndicateurs(raw.indicateurs, file, territories)
  if (indicators.some((indicator) => indicator.theme !== theme)) {
    fail(file, `« themes.${theme}.indicateurs » contient une ligne hors du thème déclaré`)
  }
  const histories = validerHistoires(raw.histoires, file, territories)
  if (histories.some((history) => history.theme !== theme)) {
    fail(file, `« themes.${theme}.histoires » contient une ligne hors du thème déclaré`)
  }

  // The fields are deliberately validated even when they are null: null is an
  // honest absent projection, while an omitted field would make the artifact
  // incomplete and allow an auxiliary table to arrive later.
  const bpeAccess =
    theme === 'mobilite'
      ? validerProfilsAccesBpe(raw.profils_acces_bpe, file, territories)
      : null
  const targetBuildingDistribution =
    theme === 'mobilite'
      ? validerDistributionAccesBatiments(raw.distribution_acces_batiments, file, territories)
      : null
  const targetAccessRamp =
    theme === 'mobilite'
      ? validerRampeAccesBatiments(raw.rampe_acces_batiments, file, territories)
      : null
  const factSignature = (
    key: string,
    detail: string | null | undefined,
    sex: string | null | undefined,
    dimension: string | null | undefined,
  ) => JSON.stringify([key, detail ?? null, sex ?? null, dimension ?? null])
  const targetFactSignatures = new Set(
    indicators
      .filter((indicator) => indicator.territoire === territory.territoire)
      .map((indicator) => factSignature(
        indicator.key,
        indicator.detail,
        indicator.sex,
        indicator.dimension,
      )),
  )
  const comparisonDirections: Record<string, 'high' | 'low'> = {}
  if (raw.directions_comparaison !== null && raw.directions_comparaison !== undefined) {
    if (Array.isArray(raw.directions_comparaison) && raw.directions_comparaison.length === 0) {
      // jsonlite represents an empty named R list as []; it is the empty map
      // for themes that publish no comparison context.
    } else {
      if (!isObject(raw.directions_comparaison)) {
        fail(file, `« themes.${theme}.directions_comparaison » doit être un objet`)
      }
      for (const [key, direction] of Object.entries(raw.directions_comparaison)) {
        if (direction !== 'high' && direction !== 'low') {
          fail(file, `direction canonique invalide pour « ${key} »`)
        }
        comparisonDirections[key] = direction
      }
    }
  }

  const comparisons: Partial<Record<TerritoryComparisonMode, TerritoryComparisonContext>> = {}
  if (raw.comparaisons !== null && raw.comparaisons !== undefined) {
    if (!isObject(raw.comparaisons)) fail(file, `« themes.${theme}.comparaisons » doit être un objet ou null`)
    const comparisonEntries = Object.entries(raw.comparaisons)
    if (comparisonEntries.length > 0 && Object.keys(comparisonDirections).length === 0) {
      fail(file, `« themes.${theme}.directions_comparaison » est requis avec les comparaisons`)
    }
    for (const [rawMode, rawContext] of comparisonEntries) {
      if (!(['densite', 'epci', 'bretagne'] as const).includes(rawMode as TerritoryComparisonMode)) {
        fail(file, `mode de comparaison inconnu « ${rawMode} »`)
      }
      const mode = rawMode as TerritoryComparisonMode
      if (mode === 'densite') {
        fail(file, 'le mode de comparaison « densite » appartient à #556 et n’est pas publié par ce contrat')
      }
      if (!isObject(rawContext) || !isObject(rawContext.scope)) {
        fail(file, `« themes.${theme}.comparaisons.${mode} » doit porter un scope`)
      }
      const kinds = ['communes-epci', 'communes-bretagne', 'epcis-bretagne', 'departements-bretagne'] as const
      if (!kinds.includes(rawContext.scope.kind as (typeof kinds)[number])) {
        fail(file, `« themes.${theme}.comparaisons.${mode}.scope.kind » est inconnu`)
      }
      const expectedScope = mode === 'epci'
        ? territory.type === 'commune' && territory.epci
          ? 'communes-epci'
          : null
        : mode === 'bretagne'
          ? ({
              commune: 'communes-bretagne',
              epci: 'epcis-bretagne',
              departement: 'departements-bretagne',
              region: null,
            } as const)[territory.type]
          : rawContext.scope.kind
      if (expectedScope === null || rawContext.scope.kind !== expectedScope) {
        fail(file, `scope incompatible pour le mode « ${mode} » et le territoire ${territory.type}`)
      }
      const label = nonEmptyString(rawContext.scope.label, file, `themes.${theme}.comparaisons.${mode}.scope.label`)
      if (!Array.isArray(rawContext.faits)) {
        fail(file, `« themes.${theme}.comparaisons.${mode}.faits » doit être un tableau`)
      }
      const signatures = new Set<string>()
      const facts = rawContext.faits.map((rawFact, index): TerritoryComparisonFact => {
        if (!isObject(rawFact)) fail(file, `comparaison ${mode}, fait ${index + 1} invalide`)
        const key = nonEmptyString(rawFact.key, file, `comparaisons.${mode}.faits[${index}].key`)
        const nullableString = (value: unknown, field: string): string | null => {
          if (value === null || value === undefined) return null
          return nonEmptyString(value, file, field)
        }
        const detail = nullableString(rawFact.detail, `comparaisons.${mode}.faits[${index}].detail`)
        const sex = nullableString(rawFact.sex, `comparaisons.${mode}.faits[${index}].sex`)
        const dimension = nullableString(rawFact.dimension, `comparaisons.${mode}.faits[${index}].dimension`)
        if (rawFact.origin !== 'indicator' && rawFact.origin !== 'derived') {
          fail(file, `origine de comparaison invalide pour « ${key} »`)
        }
        const origin = rawFact.origin
        const signature = factSignature(key, detail, sex, dimension)
        if (signatures.has(signature)) fail(file, `comparaison ${mode} dupliquée pour « ${key} »`)
        signatures.add(signature)
        if (origin === 'indicator' && !targetFactSignatures.has(signature)) {
          fail(file, `fait comparé « ${key} » absent des faits de la cible`)
        }
        if (rawFact.direction !== 'plus-est-mieux' && rawFact.direction !== 'moins-est-mieux') {
          fail(file, `direction de comparaison invalide pour « ${key} »`)
        }
        if (origin === 'indicator') {
          const expectedDirection = comparisonDirections[key]
          const publishedDirection = rawFact.direction === 'plus-est-mieux' ? 'high' : 'low'
          if (expectedDirection === undefined || expectedDirection !== publishedDirection) {
            fail(file, `direction de comparaison incohérente pour « ${key} »`)
          }
        }
        const rankPosition = rawFact.rank_position
        const rankSize = rawFact.rank_size
        const rank = rankPosition === null && rankSize === null
          ? null
          : Number.isInteger(rankPosition) && Number.isInteger(rankSize) &&
              (rankPosition as number) >= 1 && (rankSize as number) >= (rankPosition as number)
            ? { position: rankPosition as number, size: rankSize as number }
            : fail(file, `rang de comparaison invalide pour « ${key} »`)
        const referenceKind = rawFact.reference_kind
        const referenceValue = rawFact.reference_value
        const reference: TerritoryComparisonFact['reference'] = referenceKind === null && referenceValue === null
          ? null
          : (referenceKind === 'mean' || referenceKind === 'median') &&
              typeof referenceValue === 'number' && Number.isFinite(referenceValue)
            ? { kind: referenceKind, value: referenceValue }
            : fail(file, `référence de comparaison invalide pour « ${key} »`)
        return {
          key,
          detail,
          sex,
          dimension,
          origin,
          direction: rawFact.direction,
          rank,
          reference,
        }
      })
      const rawDistribution = rawContext.distribution_batiments
      const buildingDistribution: TerritoryComparisonContext['buildingDistribution'] =
        rawDistribution === null || rawDistribution === undefined
          ? null
          : (() => {
              if (!isObject(rawDistribution) || !Array.isArray(rawDistribution.cells)) {
                fail(file, `distribution bâtiment invalide pour « ${mode} »`)
              }
              const totalBuildings = rawDistribution.total_buildings
              if (!Number.isInteger(totalBuildings) || (totalBuildings as number) < 1) {
                fail(file, `total de bâtiments comparés invalide pour « ${mode} »`)
              }
              const cellSignatures = new Set<string>()
              const cells = rawDistribution.cells.map((rawCell, index) => {
                if (!isObject(rawCell)) fail(file, `cellule comparée ${index + 1} invalide`)
                const breadthBucket = nonEmptyString(rawCell.breadth_bucket, file, 'breadth_bucket')
                const depthBucket = nonEmptyString(rawCell.depth_bucket, file, 'depth_bucket')
                const signature = `${breadthBucket}\r${depthBucket}`
                if (cellSignatures.has(signature)) fail(file, `cellule comparée dupliquée « ${signature} »`)
                cellSignatures.add(signature)
                if (!Number.isInteger(rawCell.building_count) || (rawCell.building_count as number) < 0) {
                  fail(file, `nombre de bâtiments comparés invalide pour la cellule ${index + 1}`)
                }
                if (typeof rawCell.share !== 'number' || rawCell.share < 0 || rawCell.share > 1) {
                  fail(file, `part comparée invalide pour la cellule ${index + 1}`)
                }
                return {
                  breadthBucket,
                  depthBucket,
                  buildingCount: rawCell.building_count as number,
                  share: rawCell.share,
                }
              })
              const targetSignatures = new Set(
                (targetBuildingDistribution ?? [])
                  .filter((row) =>
                    row.territoire === territory.territoire &&
                    row.breadth_bucket !== null &&
                    row.depth_bucket !== null,
                  )
                  .map((row) => `${row.breadth_bucket}\r${row.depth_bucket}`),
              )
              if (
                cells.length !== targetSignatures.size ||
                cells.some((cell) => !targetSignatures.has(`${cell.breadthBucket}\r${cell.depthBucket}`))
              ) {
                fail(file, `distribution comparée « ${mode} » incomplète ou étrangère à la cible`)
              }
              const count = cells.reduce((sum, cell) => sum + cell.buildingCount, 0)
              const share = cells.reduce((sum, cell) => sum + cell.share, 0)
              if (count !== totalBuildings || Math.abs(share - 1) > 1e-12) {
                fail(file, `distribution comparée « ${mode} » incohérente avec son total`)
              }
              return {
                label: nonEmptyString(rawDistribution.label, file, 'distribution_batiments.label'),
                totalBuildings: totalBuildings as number,
                cells,
              }
            })()
      const rawRamp = rawContext.rampe_acces
      const accessRamp: TerritoryComparisonContext['accessRamp'] =
        rawRamp === null || rawRamp === undefined
          ? null
          : (() => {
              if (!isObject(rawRamp) || !Array.isArray(rawRamp.points)) {
                fail(file, `rampe d’accès invalide pour « ${mode} »`)
              }
              const totalBuildings = rawRamp.total_buildings
              if (!Number.isInteger(totalBuildings) || (totalBuildings as number) < 1) {
                fail(file, `total de bâtiments de la rampe invalide pour « ${mode} »`)
              }
              const pointSignatures = new Set<string>()
              const points = rawRamp.points.map((rawPoint, index) => {
                if (!isObject(rawPoint) || !['c', 'b', 't'].includes(String(rawPoint.mode))) {
                  fail(file, `point de rampe ${index + 1} invalide`)
                }
                if (typeof rawPoint.quantile !== 'number' || rawPoint.quantile < 0 || rawPoint.quantile > 1) {
                  fail(file, `quantile de rampe ${index + 1} invalide`)
                }
                if (typeof rawPoint.accessible_types !== 'number' || !Number.isFinite(rawPoint.accessible_types)) {
                  fail(file, `valeur de rampe ${index + 1} invalide`)
                }
                const signature = `${rawPoint.mode}\r${rawPoint.quantile}`
                if (pointSignatures.has(signature)) fail(file, `point de rampe dupliqué « ${signature} »`)
                pointSignatures.add(signature)
                return {
                  mode: rawPoint.mode as 'c' | 'b' | 't',
                  quantile: rawPoint.quantile,
                  accessibleTypes: rawPoint.accessible_types,
                }
              })
              const targetSignatures = new Set(
                (targetAccessRamp ?? [])
                  .filter((row) =>
                    row.territoire === territory.territoire && row.quantile !== null,
                  )
                  .map((row) => `${row.mode}\r${row.quantile}`),
              )
              if (
                points.length !== targetSignatures.size ||
                points.some((point) => !targetSignatures.has(`${point.mode}\r${point.quantile}`))
              ) {
                fail(file, `rampe comparée « ${mode} » incomplète ou étrangère à la cible`)
              }
              for (const curveMode of ['c', 'b', 't'] as const) {
                const curve = points
                  .filter((point) => point.mode === curveMode)
                  .sort((left, right) => left.quantile - right.quantile)
                if (curve.some((point, index) =>
                  index > 0 && point.accessibleTypes < curve[index - 1]!.accessibleTypes,
                )) {
                  fail(file, `rampe comparée « ${mode} » non monotone pour le mode « ${curveMode} »`)
                }
              }
              return {
                label: nonEmptyString(rawRamp.label, file, 'rampe_acces.label'),
                totalBuildings: totalBuildings as number,
                points,
              }
            })()
      comparisons[mode] = {
        mode,
        scope: { kind: rawContext.scope.kind as TerritoryComparisonContext['scope']['kind'], label },
        facts,
        buildingDistribution,
        accessRamp,
      }
    }
  }

  return {
    theme,
    indicators,
    histories,
    metadata,
    bpeAccess,
    buildingDistribution: targetBuildingDistribution,
    accessRamp: targetAccessRamp,
    comparisons,
    comparisonDirections,
  }
}

/** Validate one atomic territory artifact before it crosses into the app. */
export function validerModeleTerritoire(
  raw: unknown,
  file: string,
  expected?: { type: TerritoireType; territoire: string },
  options: { requireAllThemes?: boolean } = {},
): TerritoryReadModel {
  if (!isObject(raw)) fail(file, 'le modèle de territoire doit être un objet')
  if (raw.schema_version !== '1') fail(file, '« schema_version » inconnue')
  const snapshotId = nonEmptyString(raw.snapshot_id, file, 'snapshot_id')

  if (!Array.isArray(raw.territoires)) fail(file, '« territoires » doit être un tableau')
  const territories = validerTerritoires(raw.territoires, file)
  if (!isObject(raw.territory)) fail(file, '« territory » doit être un objet')
  const territoryCode = nonEmptyString(raw.territory.territoire, file, 'territory.territoire')
  const territory = territories.find((candidate) => candidate.territoire === territoryCode)
  if (!territory) fail(file, `territoire déclaré « ${territoryCode} » absent du contexte`)

  if (
    raw.territory.type !== territory.type ||
    raw.territory.nom !== territory.nom ||
    raw.territory.departement !== territory.departement ||
    raw.territory.epci !== territory.epci
  ) {
    fail(file, `« territory » ne correspond pas à sa ligne de référence « ${territoryCode} »`)
  }
  if (expected && (territory.type !== expected.type || territory.territoire !== expected.territoire)) {
    fail(file, `le territoire déclaré ne correspond pas à la route ${expected.type}/${expected.territoire}`)
  }

  if (!isObject(raw.themes)) fail(file, '« themes » doit être un objet')
  const rawThemes = raw.themes
  const themeEntries = Object.entries(rawThemes)
  if (themeEntries.length === 0) fail(file, '« themes » doit porter au moins un thème publié')
  if (options.requireAllThemes) {
    const missingThemes = THEMES_CANONIQUES.filter((theme) => !(theme in rawThemes))
    if (missingThemes.length > 0) {
      fail(file, `thèmes manquants dans l’artefact complet : ${missingThemes.join(', ')}`)
    }
  }
  const themes: Partial<Record<Theme, TerritoryThemeReadModel>> = {}
  for (const [key, value] of themeEntries) {
    if (!(THEMES_CANONIQUES as readonly string[]).includes(key)) {
      fail(file, `thème inconnu « ${key} » dans « themes »`)
    }
    themes[key as Theme] = validateTheme(value, key as Theme, file, territories, territory)
  }

  return {
    schemaVersion: '1',
    snapshotId,
    territory,
    territories,
    themes,
  }
}

/** Adapt the validated envelope to the existing payload-selector seam. */
export function payloadDepuisModeleTerritoire(model: TerritoryReadModel): Payload {
  const themes = Object.values(model.themes).filter(
    (theme): theme is TerritoryThemeReadModel => theme !== undefined,
  )
  const mobilite = model.themes.mobilite

  return {
    territoires: model.territories,
    indicateurs: themes.flatMap((theme) => theme.indicators),
    histoires: themes.flatMap((theme) => theme.histories),
    apercu: null,
    runReport: null,
    vintages: null,
    programmes: null,
    profilsAccesBpe: mobilite?.bpeAccess ?? null,
    distributionAccesBatiments: mobilite?.buildingDistribution ?? null,
    rampeAccesBatiments: mobilite?.accessRamp ?? null,
    themeMetadata: Object.fromEntries(themes.map((theme) => [theme.theme, theme.metadata])),
  }
}

/** Load one complete territory model without opening the legacy global tables. */
export const chargerModeleTerritoire: ChargerModeleTerritoire = async (type, territoire) => {
  const requestedFile = `territoires/${String(type)}/${String(territoire)}.json`
  const typePath = componentForPath(type, requestedFile, 'type')
  const territoryPath = componentForPath(territoire, requestedFile, 'territoire')
  const file = `territoires/${typePath}/${territoryPath}.json`
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
  return validerModeleTerritoire(raw, file, { type, territoire }, { requireAllThemes: true })
}
