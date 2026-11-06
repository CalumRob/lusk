/** The standalone map's layer projection: app-owned candidates, API-owned admission. */

import { groupesCouchesCarte } from '../fiche/content/ficheGrammar'
import { LIBELLES_INDICATEURS_APP } from '../fiche/content/libellesAffichage'
import type { SemanticResourceDeclaration } from '../payload/semanticResourceClient'
import type { NativeThemeFactContract, Payload, Theme, ThemeMetadata } from '../payload/types'
import type { CoucheProgramme } from './programmesCouches'

export type SourceCouche = 'indicateur' | 'histoire'

/** One mappable layer — a single value per territory. */
export interface Couche {
  source: SourceCouche
  clef: string
  detail: string | null
  libelle: string
  parDefaut: boolean
  sousGroupe: string | null
  storyKey: string | null
}

export type CoucheCarte = Couche | CoucheProgramme

export interface GroupeCouches {
  libelle: string
  couches: Couche[]
}

export type EntreeCouches =
  | { type: 'couche'; couche: CoucheCarte }
  | { type: 'groupe'; groupe: GroupeCouches }

export interface CouchesTheme {
  theme: Theme
  entrees: EntreeCouches[]
  coucheParDefaut: Couche | null
}

export interface AdmissionCouchesTheme {
  /** Current-level API declarations, already validated by native discovery. */
  declarations: readonly SemanticResourceDeclaration[]
  /** Producer-ordered native axes, where the response shape declares them. */
  axes?: Readonly<Record<string, readonly string[]>>
  /** Validated native descriptors survive even when a sparse cohort has no rows. */
  nativeContracts?: Readonly<Record<string, NativeThemeFactContract>>
  /** Verified label maps only; never used for candidates, eligibility or order. */
  metadata?: ThemeMetadata
}

type ReadingBinding = { declaration: SemanticResourceDeclaration; subgroup: string }

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function declaredGroups(declaration: SemanticResourceDeclaration): readonly string[] {
  return declaration.axis_values?.find(([name]) => name === 'groupe')?.[1] ?? []
}

function readingBindings(declarations: readonly SemanticResourceDeclaration[]): ReadingBinding[] {
  const bindings: ReadingBinding[] = []
  for (const declaration of declarations) {
    if (declaration.shapes.includes('typed_reading')) {
      for (const subgroup of declaredGroups(declaration)) bindings.push({ declaration, subgroup })
    }
  }
  return bindings
}

function nativeResource(declarations: readonly SemanticResourceDeclaration[], theme: Theme, key: string,
  shapes?: readonly string[]): SemanticResourceDeclaration | undefined {
  return declarations.find((declaration) => declaration.theme_id === theme &&
    declaration.resource_id === key && declaration.indicator_id === key &&
    declaration.map_eligible === true && (!shapes || shapes.some((shape) => declaration.shapes.includes(shape))))
}

function labelParam(metadata: ThemeMetadata | undefined, field: string): string {
  // The typed-reading API currently declares parameter identity/fields but not
  // per-field wording; retain its verified producer label until that API seam exists.
  return metadata?.param_labels[field] ?? 'Fait disponible'
}

function labelIndicator(theme: Theme, metadata: ThemeMetadata | undefined,
  declaration: SemanticResourceDeclaration, contract?: NativeThemeFactContract): string {
  return LIBELLES_INDICATEURS_APP[theme]?.[declaration.indicator_id] ??
    contract?.label ?? declaration.label ?? metadata?.indicator_labels[declaration.indicator_id]
}

function labelDetail(metadata: ThemeMetadata | undefined, declaration: SemanticResourceDeclaration,
  contract: NativeThemeFactContract | undefined, key: string): string {
  const declaredLabel = contract?.axes?.find((axis) => axis.name === 'detail' && axis.key === key)?.label
  const native = declaredLabel && declaredLabel !== key ? declaredLabel : undefined
  return native ?? metadata?.detail_labels[declaration.indicator_id]?.[key] ?? 'Valeur disponible'
}

function detailsDe(declaration: SemanticResourceDeclaration,
  admitted: AdmissionCouchesTheme): string[] {
  const native = admitted.nativeContracts?.[declaration.indicator_id]?.axisValues
  const axes = admitted.axes?.[declaration.indicator_id]
  if (native?.length) return [...native]
  if (axes?.length) return [...axes]
  return [...(declaration.axis_values?.find(([name]) => name === 'detail')?.[1] ?? [])]
}

function storyFields(payload: Payload, theme: Theme, groupKey: string, fields: readonly string[],
  bindings: readonly ReadingBinding[]): Array<{ field: string; storyKey: string | null }> {
  const binding = bindings.find((candidate) => candidate.subgroup === groupKey)
  if (!binding) return []
  const admittedFields = new Set(binding.declaration.fields)
  const rows = payload.histoires.filter((row) => row.theme === theme &&
    (row as unknown as Record<string, unknown>).groupe === groupKey)
  // Observation presence is not eligibility. A sparse/unavailable cohort still
  // exposes every bound field; only an actual producer row can supply story_key.
  const storyKey = rows.map((row) => (row as unknown as Record<string, unknown>).story_key).find(isText) ?? null
  const output: Array<{ field: string; storyKey: string | null }> = []
  const seen = new Set<string>()
  for (const field of fields) {
    if (!admittedFields.has(field) || seen.has(field)) continue
    seen.add(field)
    output.push({ field, storyKey })
  }
  return output
}

/** Build layers from fiche candidates intersected with native map declarations. */
export function couchesDuTheme(payload: Payload, theme: Theme, admitted: AdmissionCouchesTheme): CouchesTheme {
  const metadata = admitted.metadata?.theme === theme ? admitted.metadata : undefined
  const groups = groupesCouchesCarte(theme)
  const declarations = admitted.declarations.filter((declaration) => declaration.theme_id === theme)
  const bindings = readingBindings(declarations)
  const declaredStories = groups.flatMap((group) => storyFields(payload, theme, group.key, group.storyFields, bindings)
    .map(({ field, storyKey }) => ({ group, field, storyKey })))

  // The map's default is the first numeric reading field in app grammar order.
  const firstStory = declaredStories[0]
  const nativeIndicators = new Map<string, SemanticResourceDeclaration>()
  for (const group of groups) {
    for (const key of group.resourceKeys) {
      const declaration = nativeResource(declarations, theme, key)
      if (declaration) nativeIndicators.set(key, declaration)
    }
  }

  const defaultStoryLayer: Couche | null = firstStory ? {
    source: nativeIndicators.has(firstStory.field) ? 'indicateur' : 'histoire',
    clef: firstStory.field,
    detail: null,
    libelle: nativeIndicators.has(firstStory.field)
      ? labelIndicator(theme, metadata, nativeIndicators.get(firstStory.field)!, admitted.nativeContracts?.[firstStory.field])
      : labelParam(metadata, firstStory.field),
    parDefaut: true,
    sousGroupe: firstStory.group.key,
    storyKey: firstStory.storyKey,
  } : null

  const entrees: EntreeCouches[] = defaultStoryLayer
    ? [{ type: 'couche', couche: defaultStoryLayer }]
    : []

  for (const group of groups) {
    const fields = storyFields(payload, theme, group.key, group.storyFields, bindings)
      .filter(({ field }) => field !== firstStory?.field)
    if (fields.length) {
      entrees.push({ type: 'groupe', groupe: { libelle: group.label, couches: fields.map(({ field, storyKey }) => {
        const indicator = nativeIndicators.get(field)
        return { source: indicator ? 'indicateur' : 'histoire', clef: field, detail: null,
          libelle: indicator ? labelIndicator(theme, metadata, indicator, admitted.nativeContracts?.[field])
            : labelParam(metadata, field), parDefaut: false,
          sousGroupe: group.key,
          storyKey }
      }) } })
    }
  }

  for (const group of groups) {
    for (const key of group.resourceKeys) {
      const declaration = nativeIndicators.get(key)
      if (!declaration) continue
      if (declaredStories.some((story) => story.field === key)) continue
      const contract = admitted.nativeContracts?.[key]
      const scalar = declaration.shapes.includes('scalar')
      if (scalar) {
        entrees.push({ type: 'couche', couche: { source: 'indicateur', clef: key, detail: null,
          libelle: labelIndicator(theme, metadata, declaration, contract), parDefaut: false,
          sousGroupe: group.key, storyKey: null } })
        continue
      }
      const details = detailsDe(declaration, admitted)
      if (!details.length) continue
      entrees.push({ type: 'groupe', groupe: { libelle: contract?.label ?? declaration.label,
        couches: details.map((detail) => ({ source: 'indicateur', clef: key, detail,
          libelle: labelDetail(metadata, declaration, contract, detail), parDefaut: false,
          sousGroupe: group.key, storyKey: null })) } })
    }
  }

  return { theme, entrees, coucheParDefaut: defaultStoryLayer }
}
