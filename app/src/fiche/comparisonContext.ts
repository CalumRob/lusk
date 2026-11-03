import type { TerritoryComparisonContext, TerritoryComparisonMode } from '@/payload/territoryReadModel'
import type { Territoire, TerritoireType } from '@/payload/types'
import type { LocationQuery } from 'vue-router'
import { COMPARISON_MODE_DESCRIPTIONS } from '@/fiche/content/comparisonWording'
import { comparisonScopeLabel } from '@/fiche/content/comparisonScopeLabel'

// The comparison vocabulary is shared with the published per-territory
// artifact's contract (payload/territoryReadModel.ts — producer-side only
// since #868); type-only re-export, no runtime dependency on the model.
export type { TerritoryComparisonContext, TerritoryComparisonFact, TerritoryComparisonMode } from '@/payload/territoryReadModel'

export const PARAM_COMPARAISON = 'comparaison'

/**
 * #860 (spec #768) — le paramètre `?comparaison=` porte la SÉLECTION de
 * comparaison, pas un mode figé :
 *
 *  - ABSENT        → le contexte par défaut niveau-natif (ADR-0021) : les
 *                    communes de l’EPCI d’une commune (communes bretonnes
 *                    quand elle n’en a pas), le même niveau Bretagne pour un
 *                    EPCI/département, aucune comparaison pour la Région ;
 *  - `?comparaison=` (chaîne vide) → sélection explicitement VIDE : aucune
 *                    comparaison (jamais un groupe Bretagne implicite) ;
 *  - `?comparaison=epci|bretagne|densite` → un PRESET (les mêmes jetons
 *                    d’URL que les anciens modes ; la classe de densité perd
 *                    seulement son statut de défaut silencieux) ;
 *  - `?comparaison=commune:22001,commune:22002` → des MEMBRES TAPÉS, même
 *                    niveau que le territoire de la fiche en v1 (le contrat
 *                    reste mixed-level-légal, CONTEXT.md ; l’UI l’étage).
 *
 * La sélection est partageable (sérialisation canonique) et l’acquisition
 * passe par les membres tapés (`selected_comparison`), jamais par une
 * colonne de rang statique retirée (#892).
 */

/** Les presets de la Sélection — les mêmes jetons d’URL que les anciens modes. */
export const PRESETS_COMPARAISON = ['epci', 'bretagne', 'densite'] as const
export type PresetComparaison = (typeof PRESETS_COMPARAISON)[number]

/** Un membre tapé de la sélection — même forme que le contrat sémantique. */
export interface MembreSelection {
  territory_type: TerritoireType
  territory_id: string
}

export type SelectionComparaison =
  | { etat: 'defaut' }
  | { etat: 'vide' }
  | { etat: 'preset'; preset: PresetComparaison }
  | { etat: 'membres'; membres: readonly MembreSelection[] }

/** #868 — since the static runtime retirement the per-territory model no longer
 * feeds the fiche: comparison contexts are derived from the validated
 * territory reference (producer-published names and density labels), while the
 * comparison meaning and evidence come from the native API contracts.
 */

/**
 * The comparison contexts a territory can select, derived from the validated
 * reference alone (#868): the density-class label is the commune's published
 * public label, the EPCI scope names its reference EPCI, and the Bretagne
 * scopes keep their canonical labels. No numerical fact is reconstructed here
 * — `facts` stays empty and all evidence comes from the native API reads.
 */
export function contextesDepuisReference(
  territoire: Territoire | null,
  territoires: readonly Territoire[],
): Partial<Record<TerritoryComparisonMode, TerritoryComparisonContext>> {
  if (!territoire) return {}
  const contextes: Partial<Record<TerritoryComparisonMode, TerritoryComparisonContext>> = {}
  const vide = (): Pick<TerritoryComparisonContext, 'facts' | 'buildingDistribution' | 'accessRamp'> =>
    ({ facts: [], buildingDistribution: null, accessRamp: null })

  if (territoire.type === 'commune') {
    const labelDensite = territoire.classe_densite_libelle_public ?? territoire.classe_densite_libelle_insee ?? null
    if (labelDensite) {
      contextes.densite = { mode: 'densite', scope: { kind: 'communes-densite', label: labelDensite }, ...vide() }
    }
    if (territoire.epci) {
      const epci = territoires.find((candidate) => candidate.type === 'epci' && candidate.territoire === territoire.epci)
      const labelEpci = comparisonScopeLabel('communes-epci', null, epci?.nom ?? null)
      if (labelEpci) {
        contextes.epci = { mode: 'epci', scope: { kind: 'communes-epci', label: labelEpci }, ...vide() }
      }
    }
    const labelBretagne = comparisonScopeLabel('communes-bretagne', null, null)
    if (labelBretagne) {
      contextes.bretagne = { mode: 'bretagne', scope: { kind: 'communes-bretagne', label: labelBretagne }, ...vide() }
    }
    return contextes
  }
  if (territoire.type === 'epci' || territoire.type === 'departement') {
    const kind = territoire.type === 'epci' ? 'epcis-bretagne' : 'departements-bretagne'
    const label = comparisonScopeLabel(kind, null, null)
    if (label) {
      contextes.bretagne = { mode: 'bretagne', scope: { kind, label }, ...vide() }
    }
  }
  return contextes
}

/** Sérialise une sélection en sa valeur d’URL canonique (undefined = absent = défaut). */
export function serialiserSelection(selection: SelectionComparaison): string | undefined {
  switch (selection.etat) {
    case 'defaut': return undefined
    case 'vide': return ''
    case 'preset': return selection.preset
    case 'membres':
      return selection.membres.map((membre) => `${membre.territory_type}:${membre.territory_id}`).join(',')
  }
}

const TYPES_TERRITOIRE: readonly TerritoireType[] = ['commune', 'epci', 'departement', 'region']

function membresBruts(raw: string): MembreSelection[] | null {
  const membres: MembreSelection[] = []
  for (const entry of raw.split(',')) {
    const sep = entry.indexOf(':')
    if (sep <= 0) return null
    const type = entry.slice(0, sep)
    const id = entry.slice(sep + 1)
    if (!id || id.includes(':') || !(TYPES_TERRITOIRE as readonly string[]).includes(type)) return null
    membres.push({ territory_type: type as TerritoireType, territory_id: id })
  }
  return membres
}

/**
 * Lit la valeur brute de la query : `undefined` → défaut, chaîne vide → vide
 * explicite, jeton de preset, ou liste de membres tapés. Toute autre forme
 * (tableau d’un paramètre répété, jeton inconnu sans syntaxe membre) → null.
 */
export function lireSelectionBrute(demande: unknown): SelectionComparaison | null {
  if (demande === undefined) return { etat: 'defaut' }
  if (typeof demande !== 'string') return null
  if (demande === '') return { etat: 'vide' }
  if ((PRESETS_COMPARAISON as readonly string[]).includes(demande)) {
    return { etat: 'preset', preset: demande as PresetComparaison }
  }
  const membres = membresBruts(demande)
  return membres ? { etat: 'membres', membres } : null
}

export interface ResolutionSelectionComparaison {
  selection: SelectionComparaison
  /**
   * Membres tapés de la passe de comparaison : `undefined` = le défaut déclaré
   * du producteur (servi niché dans la réponse de faits), `null` = sélection
   * nommée mais non résoluble (échec fermé, réessayable), `[]` = aucune
   * comparaison, sinon la liste explicite envoyée en `selected_comparison`.
   */
  membres: readonly MembreSelection[] | null | undefined
  /** Contexte résolu (libellé de portée) — null quand aucune comparaison. */
  contexte: TerritoryComparisonContext | null
  /** Preset effectif (explicite, ou résolu depuis le défaut niveau-natif). */
  preset: PresetComparaison | null
  /** L’URL doit être réécrite vers la sérialisation canonique de la sélection. */
  canonicaliser: boolean
}

/** Le preset du contexte par défaut niveau-natif d’un territoire (ADR-0021). */
function presetDefaut(territoire: Territoire): PresetComparaison {
  if (territoire.type === 'commune' && territoire.epci) return 'epci'
  return 'bretagne'
}

function presetApplicable(preset: PresetComparaison, territoire: Territoire): boolean {
  if (territoire.type === 'commune') return preset !== 'epci' || Boolean(territoire.epci)
  return preset === 'bretagne'
}

/**
 * Résout les membres tapés d’un preset : une référence territoriale unique quand
 * elle existe (EPCI / région — le producteur résout la cohorte à la maille
 * requise), la cohorte communale de la classe de densité sinon, le défaut
 * déclaré (`undefined`) pour les niveaux EPCI/département. `null` = la
 * référence nommée est absente du référentiel : échec fermé.
 */
function membresPourPreset(
  preset: PresetComparaison,
  territoire: Territoire,
  territoires: readonly Territoire[],
): readonly MembreSelection[] | null | undefined {
  if (territoire.type === 'epci' || territoire.type === 'departement') return undefined
  if (territoire.type !== 'commune') return undefined
  if (preset === 'epci') {
    const epci = territoire.epci
      ? territoires.find((candidate) => candidate.type === 'epci' && candidate.territoire === territoire.epci)
      : undefined
    return epci ? [{ territory_type: 'epci', territory_id: epci.territoire }] : null
  }
  if (preset === 'bretagne') {
    const region = territoires.find((candidate) => candidate.type === 'region')
    return region ? [{ territory_type: 'region', territory_id: region.territoire }] : null
  }
  const code = territoire.classe_densite_code
  if (!code) return null
  const membres = territoires
    .filter((candidate) => candidate.type === 'commune' && candidate.classe_densite_code === code)
    .map((candidate) => ({ territory_type: candidate.type as 'commune', territory_id: candidate.territoire }))
  return membres.length ? membres : null
}

/** Valide des membres tapés : présents dans la référence, même niveau, sans doublon. */
function validerMembres(
  membres: readonly MembreSelection[],
  territoire: Territoire,
  territoires: readonly Territoire[],
): { retenus: MembreSelection[]; invalides: boolean } {
  const retenus: MembreSelection[] = []
  const vus = new Set<string>()
  let invalides = false
  for (const membre of membres) {
    const existe = territoires.some(
      (candidate) => candidate.type === membre.territory_type && candidate.territoire === membre.territory_id,
    )
    const cle = `${membre.territory_type}:${membre.territory_id}`
    if (!existe || membre.territory_type !== territoire.type || vus.has(cle)) {
      invalides = true
      continue
    }
    vus.add(cle)
    retenus.push(membre)
  }
  return { retenus, invalides }
}

/**
 * Résout la Sélection de comparaison de la fiche depuis l’URL et la référence
 * validée. Le défaut est niveau-natif (jamais la densité).
 *
 * Loi du glossaire (CONTEXT.md « Sélection de comparaison », clarification
 * 2026-10-02) : « An explicitly empty selection means no comparison, not a
 * request to restore that default » — une INTENTION explicite (preset non
 * applicable au niveau, ou liste de membres dont aucun ne survit à la
 * validation) qui ne peut pas être honorée résout en sélection VIDE explicite
 * (`etat: 'vide'`, `membres: []`, aucune comparaison) avec l’URL canonisée vers
 * `?comparaison=` — JAMAIS vers le contexte par défaut. Seule une valeur
 * illisible (hors contrat de parse) retombe sur le défaut (paramètre retiré).
 * Une sélection nommée dont l’identité de référence manque échoue fermé
 * (`membres: null`, réessayable) sans retirer le paramètre.
 */
export function resoudreSelectionComparaison(options: {
  territoire: Territoire | null
  demande: unknown
  contextes: Partial<Record<TerritoryComparisonMode, TerritoryComparisonContext>>
  territoires: readonly Territoire[]
}): ResolutionSelectionComparaison {
  const { territoire, demande, contextes, territoires } = options
  const lu = lireSelectionBrute(demande)

  if (!territoire || territoire.type === 'region') {
    return {
      selection: { etat: 'defaut' },
      membres: undefined,
      contexte: null,
      preset: null,
      canonicaliser: demande !== undefined,
    }
  }

  const appliquerDefaut = (canonicaliser: boolean): ResolutionSelectionComparaison => {
    const preset = presetDefaut(territoire)
    return {
      selection: { etat: 'defaut' },
      membres: membresPourPreset(preset, territoire, territoires),
      contexte: contextes[preset] ?? null,
      preset,
      canonicaliser,
    }
  }

  /** Intention explicite non honorable → vide explicite canonique (loi du glossaire). */
  const appliquerVide = (): ResolutionSelectionComparaison => ({
    selection: { etat: 'vide' },
    membres: [],
    contexte: null,
    preset: null,
    canonicaliser: true,
  })

  if (lu === null || lu.etat === 'defaut') return appliquerDefaut(lu === null)
  if (lu.etat === 'vide') {
    return { selection: lu, membres: [], contexte: null, preset: null, canonicaliser: false }
  }
  if (lu.etat === 'preset') {
    if (!presetApplicable(lu.preset, territoire)) return appliquerVide()
    if (territoire.type !== 'commune') {
      // Même niveau Bretagne : le défaut déclaré du producteur sert ce preset.
      return {
        selection: lu,
        membres: undefined,
        contexte: contextes.bretagne ?? null,
        preset: lu.preset,
        canonicaliser: false,
      }
    }
    return {
      selection: lu,
      membres: membresPourPreset(lu.preset, territoire, territoires),
      contexte: contextes[lu.preset] ?? null,
      preset: lu.preset,
      canonicaliser: false,
    }
  }
  const { retenus, invalides } = validerMembres(lu.membres, territoire, territoires)
  if (!retenus.length) return appliquerVide()
  return {
    selection: { etat: 'membres', membres: retenus },
    membres: retenus,
    contexte: null,
    preset: null,
    canonicaliser: invalides,
  }
}

export interface PresetComparaisonOption {
  preset: PresetComparaison
  label: string
  description: string | null
}

/**
 * Les presets du menu rapide du contrôle d’en-tête (#860) : une commune propose
 * « communes de son EPCI · communes de Bretagne · communes de sa classe de
 * densité », un EPCI/département seulement le même niveau Bretagne, la Région
 * aucun (pas de contrôle de comparaison).
 *
 * Règle d’honnêteté du menu : un preset n’est proposé que s’il RÉSOLT réellement
 * pour le territoire courant — contexte publié ET membres résolubles
 * (`membresPourPreset` ≠ null). Aucune option offerte ne peut donc mener à un
 * cul-de-sac (ex. preset EPCI quand l’EPCI n’est pas dans la référence chargée).
 */
export function presetsDisponibles(options: {
  territoire: Territoire | null
  contextes: Partial<Record<TerritoryComparisonMode, TerritoryComparisonContext>>
  territoires: readonly Territoire[]
}): readonly PresetComparaisonOption[] {
  const { territoire, contextes, territoires } = options
  if (!territoire || territoire.type === 'region') return []
  const candidats: PresetComparaison[] = territoire.type === 'commune'
    ? ['epci', 'bretagne', 'densite']
    : ['bretagne']
  const liste: PresetComparaisonOption[] = []
  for (const preset of candidats) {
    const contexte = contextes[preset]
    if (!contexte) continue
    // Un preset dont la résolution de membres échoue (null) n'est jamais offert.
    if (membresPourPreset(preset, territoire, territoires) === null) continue
    liste.push({
      preset,
      label: contexte.scope.label,
      description: preset === 'densite' ? COMPARISON_MODE_DESCRIPTIONS.densite ?? null : null,
    })
  }
  return liste
}

const MOTS_TYPE: Record<TerritoireType, [string, string]> = {
  commune: ['commune', 'communes'],
  epci: ['EPCI', 'EPCI'],
  departement: ['département', 'départements'],
  region: ['région', 'régions'],
}

/** Libellé compact d’une sélection de membres tapés (« 3 communes », « 2 territoires »). */
export function libelleMembres(membres: readonly MembreSelection[]): string {
  if (!membres.length) return 'Aucune comparaison'
  const types = [...new Set(membres.map((membre) => membre.territory_type))]
  if (types.length === 1) {
    const [singulier, pluriel] = MOTS_TYPE[types[0]!]
    return `${membres.length} ${membres.length > 1 ? pluriel : singulier}`
  }
  return `${membres.length} territoires`
}

/** Libellé de la portée active pour la puce d’en-tête (défaut/preset/vide/membres). */
export function libelleSelectionComparaison(resolution: ResolutionSelectionComparaison): string | null {
  const { selection, contexte } = resolution
  if (selection.etat === 'vide') return 'Aucune comparaison'
  if (selection.etat === 'membres') return libelleMembres(selection.membres)
  return contexte?.scope.label ?? null
}

/**
 * Développe des membres tapés en cohorte communale (voie Mobilité) : un membre
 * EPCI/département/région se résout en ses communes à la maille requise, les
 * communes passent telles quelles ; résultat trié et dédupliqué.
 */
export function developperMembresCommunes(
  membres: readonly MembreSelection[],
  territoires: readonly Territoire[],
): MembreSelection[] {
  const communes = territoires.filter((candidate) => candidate.type === 'commune')
  const ids = new Set<string>()
  for (const membre of membres) {
    if (membre.territory_type === 'commune') {
      ids.add(membre.territory_id)
    } else if (membre.territory_type === 'epci') {
      for (const commune of communes) if (commune.epci === membre.territory_id) ids.add(commune.territoire)
    } else if (membre.territory_type === 'departement') {
      for (const commune of communes) if (commune.departement === membre.territory_id) ids.add(commune.territoire)
    } else {
      for (const commune of communes) ids.add(commune.territoire)
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b))
    .map((id) => ({ territory_type: 'commune' as const, territory_id: id }))
}

/** Keep the selected comparison scope when a graph opens another territory. */
export function queryTerritoireAvecComparaison(query: LocationQuery, theme: string): LocationQuery {
  return typeof query[PARAM_COMPARAISON] === 'string'
    ? { theme, [PARAM_COMPARAISON]: query[PARAM_COMPARAISON] }
    : { theme }
}

export interface TerritoireReferenceComparaison {
  type: TerritoireType
  id: string
  nom: string
}

/**
 * Resolve the single published reference territory behind a comparison preset.
 * AEDAR aggregates declare territories, never cohorts: 'epci' selects the
 * commune's EPCI and 'bretagne' the region, while a density-class cohort has
 * no single-territory reference and stays honestly unavailable. EPCI and
 * département levels keep the fixed Bretagne universe; the région has none.
 */
export function territoireReferencePourComparaison(options: {
  territoire: Territoire | null
  mode: PresetComparaison | null
  territoires: readonly Territoire[]
}): TerritoireReferenceComparaison | null {
  const { territoire, mode, territoires } = options
  if (!territoire) return null
  if (territoire.type === 'region') return null
  const referenceRegion = (): TerritoireReferenceComparaison | null => {
    const region = territoires.find((candidate) => candidate.type === 'region')
    return region ? { type: 'region', id: region.territoire, nom: region.nom } : null
  }
  if (territoire.type === 'commune') {
    if (mode === 'epci') {
      const epci = territoire.epci
        ? territoires.find((candidate) => candidate.type === 'epci' && candidate.territoire === territoire.epci)
        : undefined
      return epci ? { type: 'epci', id: epci.territoire, nom: epci.nom } : null
    }
    if (mode === 'bretagne') return referenceRegion()
    return null
  }
  return referenceRegion()
}
