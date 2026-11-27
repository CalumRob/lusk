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

function nativeResource(declarations: readonly SemanticResourceDeclaration[], theme: Theme, key: string,
  shapes?: readonly string[]): SemanticResourceDeclaration | undefined {
  return declarations.find((declaration) => declaration.theme_id === theme &&
    declaration.resource_id === key && declaration.indicator_id === key &&
    declaration.map_eligible === true && (!shapes || shapes.some((shape) => declaration.shapes.includes(shape))))
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

/** Build layers from fiche candidates intersected with native map declarations. */
export function couchesDuTheme(_payload: Payload, theme: Theme, admitted: AdmissionCouchesTheme): CouchesTheme {
  const metadata = admitted.metadata?.theme === theme ? admitted.metadata : undefined
  const groups = groupesCouchesCarte(theme)
  const declarations = admitted.declarations.filter((declaration) => declaration.theme_id === theme)
  const nativeIndicators = new Map<string, SemanticResourceDeclaration>()
  for (const group of groups) {
    for (const key of group.resourceKeys) {
      const declaration = nativeResource(declarations, theme, key)
      if (declaration) nativeIndicators.set(key, declaration)
    }
  }

  const entrees: EntreeCouches[] = []
  for (const group of groups) {
    for (const key of group.resourceKeys) {
      const declaration = nativeIndicators.get(key)
      if (!declaration) continue
      const contract = admitted.nativeContracts?.[key]
      if (declaration.shapes.includes('scalar')) {
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

  return { theme, entrees, coucheParDefaut: null }
}
