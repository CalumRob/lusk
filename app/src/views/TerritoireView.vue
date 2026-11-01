<script setup lang="ts">
/**
 * La fiche d'identité — the shell (site-map.md §Fiche + layouts.md §2).
 *
 * Since #408 the shell's payload-driven tab bar opens on « Programmes et
 * subventions » — the SIXTH theme, first and selected by default — then the
 * all five other canonical themes; there is NO Aperçu tab anymore (the
 * #400 verdict: its identity anchors disappear completely, the fiche goes
 * from its identity/title controls straight into the first theme block). The
 * ?theme= URL state selects a tab; absent or invalid falls back to the
 * programmes default. The page bg wears the selected theme's -wash. The breadcrumb + H1 with the
 * territory's real name (trouverTerritoire), the type chip and the context
 * switcher form the fiche header.
 *
 * #868 — bootstrap lean : l'identité validée et la navigation viennent de la
 * référence territoire compacte générée (`/data/territoires.json`, une seule
 * lecture atomique) — jamais du modèle de lecture par territoire. Tous les
 * numériques du thème actif viennent de l'API sémantique (acquisition par
 * thème, #627/#851) : aucun repli statique, aucun fan-out par indicateur.
 * Le runtime statique (`VITE_THEME_ACQUISITION_API='0'`) est retiré ; le
 * retour arrière est la release précédente / récupération manuelle.
 *
 * States: skeleton while the reference loads; typed PayloadError with a Retry
 * button (ui-elements.md §Loading/empty/error — never a raw error string);
 * honest empty state when the territory (or its type) is unknown.
 */
import { AlertCircle, ChevronRight, SearchX } from 'lucide-vue-next'
import { computed, inject, ref, toRaw, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import BlocProgrammes from '@/components/fiche/BlocProgrammes.vue'
import ContexteSwitcher from '@/components/fiche/ContexteSwitcher.vue'
import FiligraneFiche from '@/components/fiche/FiligraneFiche.vue'
import OngletTheme from '@/components/fiche/OngletTheme.vue'
import ThemeTabs from '@/components/ThemeTabs.vue'
import ProductionMobilite from '@/fiche/mobilite/ProductionMobilite.vue'
import { fetchAedarAggregates } from '@/fiche/content/aedarApiClient'
import { AEDAR_EQUIPMENT_EXPLORER_INITIAL_TYPEQU } from '@/fiche/content/aedarAccessSection'
import { AEDAR_CORE_MEASURE_KEYS, AEDAR_EXPLORER_DETAIL_MEASURE_KEYS } from '@/fiche/content/aedarTimeRampFacts'
import type { AedarFetchResult, AedarTerritoryType } from '@/fiche/content/aedarApiClient'
import { cahierPaginationFor } from '@/fiche/prototype/cahierPagination'
import {
  PARAM_COMPARAISON,
  contextesDepuisReference,
  optionsContexteComparaison,
  resoudreContexteComparaison,
  territoireReferencePourComparaison,
} from '@/fiche/comparisonContext'
import { resolveMobiliteThemeContent } from '@/fiche/content/themeContent'
import { applyThemeComparisonApiFacts, clearThemeComparisonApiFacts, mobilityFactsFromThemeApi } from '@/fiche/content/mobilityThemeApiFacts'
import { acquireThemeComparison, acquireThemeFacts, cleSelectionComparaison, ThemeAcquisitionCache, THEMES_ACQUISITION_API } from '@/payload/themeAcquisition'
import { histoiresDemographieNuage, histoiresMilieuxDuNuage, lignesAvecComparaisonApi, semanticComparisonForTheme,
  themeFactsRowsFromSemantic, validerReponseComparaisonTheme } from '@/payload/themeFactsAdapter'
import type { ThemeSelectionMember } from '@/payload/themeAcquisition'
import type { ThemeContent } from '@/fiche/content/themeContent'
import type { SelectedTrajectoryComparison, TerritoryFacts } from '@/fiche/content/territoryFacts'
import { echelleContexte } from '@/fiche/echelleContexte'
import { LIENS_LISTES, NOMS_TYPES, idOnglet, idPanneau } from '@/fiche/onglets'
import type { SlugOnglet } from '@/fiche/onglets'
import { THEMES_CANONIQUES } from '@/payload/types'
import type { Histoire, Indicateur, Payload, Territoire, Theme, ThemeMetadata } from '@/payload/types'
import { chargerMetadonneesTheme, THEME_METADATA_CHARGER_KEY } from '@/payload/themeCatalogue'
import { useTerritoryReference } from '@/payload/territoryReference'

const route = useRoute()
const router = useRouter()

/** Le thème DÉFAUT de la fiche (#408) : « Programmes et subventions », le
 *  sixième thème du contrat canonique, présenté en premier et sélectionné par
 *  défaut — il remplace l'Aperçu retiré. */
const THEME_DEFAUT: Theme = 'programmes'

const typeRoute = computed(() => String(route.params.type))
const idRoute = computed(() => String(route.params.id))
/** The theme selection is independent of both identity and its optional catalogue. */
const selection = computed<Theme | null>(() => {
  const demande = route.query.theme
  if (typeof demande === 'string' && (THEMES_CANONIQUES as readonly string[]).includes(demande)) {
    return demande as Theme
  }
  return THEME_DEFAUT
})
/** #868 : bootstrap lean — la référence compacte générée fournit l'identité
 *  validée et les identités de navigation/jointure ; aucun modèle par territoire. */
const referenceTerritoire = useTerritoryReference(typeRoute, idRoute, computed(() => true))
const chargerCatalogueTheme = inject(THEME_METADATA_CHARGER_KEY, chargerMetadonneesTheme)
const catalogueThemeAcquis = ref<{ type: string; id: string; theme: Theme; metadata: ThemeMetadata } | null>(null)
const statutCatalogueTheme = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const retryCatalogueTheme = ref(0)
let sequenceCatalogueTheme = 0

/** Les contextes de comparaison dérivés de la référence validée — jamais
 *  d’une projection précalculée du modèle retiré. */
const contextesComparaison = computed(() =>
  contextesDepuisReference(referenceTerritoire.territory.value, referenceTerritoire.reference.value ?? []))

const payloadReference = computed<Payload | null>(() => {
  const reference = referenceTerritoire.reference.value
  if (!reference) return null
  const themeMetadata: Partial<Record<Theme, ThemeMetadata>> = {}
  const acquired = catalogueThemeAcquis.value
  if (acquired && acquired.type === typeRoute.value && acquired.id === idRoute.value &&
      acquired.theme === selection.value) {
    themeMetadata[acquired.theme] = acquired.metadata
  }
  return {
    territoires: [...reference],
    territoryMetadata: null,
    indicateurs: [],
    histoires: [],
    apercu: null,
    runReport: null,
    vintages: null,
    programmes: null,
    profilsAccesBpe: null,
    distributionAccesBatiments: null,
    rampeAccesBatiments: null,
    themeMetadata,
  }
})

/**
 * Acquisition par thème (#627/#851, seul mode depuis #868) : la référence
 * fournit l'identité ; le POST faits du thème actif fournit TOUS ses
 * numériques (aucune ligne statique ne rend), puis le registre entier se
 * réchauffe en arrière-plan (décision propriétaire 2026-10-07).
 */
const productionMobilite = computed(() => selection.value === 'mobilite')
const aedarData = ref<AedarFetchResult | null>(null)
const aedarStatus = ref<'loading' | 'ready' | 'error'>('loading')
const aedarReferenceData = ref<AedarFetchResult | null>(null)
const aedarReferenceStatus = ref<'unavailable' | 'loading' | 'ready' | 'error'>('unavailable')
const retryAedarCount = ref(0)
function retryAedar(): void { retryAedarCount.value++ }
watch([productionMobilite, typeRoute, idRoute, retryAedarCount], async ([active, type, id], _old, onCleanup) => {
  if (!active || !['commune','epci','departement','region'].includes(type)) { aedarData.value = null; aedarStatus.value = 'loading'; return }
  let cancelled = false; onCleanup(() => { cancelled = true }); aedarStatus.value = 'loading'; aedarData.value = null
  const identity = { type: type as AedarTerritoryType, id }
  const result = await fetchAedarAggregates(identity.type, id, { measures: AEDAR_CORE_MEASURE_KEYS })
  if (!cancelled) { aedarData.value = result; aedarStatus.value = result.status === 'ready' ? 'ready' : 'error' }
  if (result.status === 'ready') {
    const detail = await fetchAedarAggregates(identity.type, id,
      { typequ: [AEDAR_EQUIPMENT_EXPLORER_INITIAL_TYPEQU], measures: AEDAR_EXPLORER_DETAIL_MEASURE_KEYS,
        expectedContentVersion: result.contentVersion, expectedReferenceContentVersion: result.referenceContentVersion })
    if (!cancelled && detail.status === 'ready' && aedarData.value?.status === 'ready'
      && aedarData.value.contentVersion === detail.contentVersion
      && aedarData.value.referenceContentVersion === detail.referenceContentVersion) {
      const detailFact = detail.facts[0]
      aedarData.value = { ...aedarData.value, facts: aedarData.value.facts.map((fact) => fact.typequ === AEDAR_EQUIPMENT_EXPLORER_INITIAL_TYPEQU && detailFact
        ? { ...fact, measures: { ...fact.measures, ...detailFact.measures } } : fact) }
    }
  }
}, { immediate: true })
/** Depuis #868 tous les thèmes canoniques sont acquis par l'API — il n'y a
 *  plus de garde de chemin migré : le catalogue du thème sélectionné n'est
 *  qu'un enrichissement d'explications, jamais une porte sur les faits API. */
const statutMetadataPourAffichage = computed<'loading' | 'ready' | 'error'>(() =>
  statutCatalogueTheme.value === 'error' ? 'error'
    : statutCatalogueTheme.value === 'ready' ? 'ready' : 'loading',
)
function retryExplicationTheme(): void { retryCatalogueTheme.value++ }

/** The selected theme's catalogue enriches explanations only; it never gates API facts. */
watch([() => referenceTerritoire.reference.value, selection, typeRoute, idRoute, retryCatalogueTheme],
  async ([reference, theme, type, id], _old, onCleanup) => {
    const request = ++sequenceCatalogueTheme
    let cancelled = false
    onCleanup(() => { cancelled = true })
    const cible = referenceTerritoire.territory.value
    if (theme === null || !reference || !cible || cible.type !== type || cible.territoire !== id) {
      statutCatalogueTheme.value = 'idle'
      return
    }
    statutCatalogueTheme.value = 'loading'
    try {
      const metadata = await chargerCatalogueTheme(theme)
      if (cancelled || request !== sequenceCatalogueTheme || reference !== referenceTerritoire.reference.value ||
          theme !== selection.value || type !== typeRoute.value || id !== idRoute.value) return
      if (metadata.theme !== theme) throw new Error(`Catalogue ${metadata.theme} inattendu pour ${theme}`)
      catalogueThemeAcquis.value = { type, id, theme, metadata }
      statutCatalogueTheme.value = 'ready'
    } catch {
      if (!cancelled && request === sequenceCatalogueTheme && reference === referenceTerritoire.reference.value &&
          theme === selection.value && type === typeRoute.value && id === idRoute.value) {
        statutCatalogueTheme.value = 'error'
      }
    }
  }, { immediate: true })
const cacheAcquisition = new ThemeAcquisitionCache(
  (theme, key) => acquireThemeFacts(key!.type, key!.id, theme),
  (selection, theme, key) => acquireThemeComparison(key!.type, key!.id, theme, selection),
)
const faitsThemeRows = ref<Indicateur[] | null>(null)
const histoiresThemeRows = ref<Histoire[] | null>(null)
const preuvesThemeIndisponibles = ref(false)
const histoiresNuageDemographie = ref<Histoire[]>([])
const histoiresNuageMilieux = ref<Histoire[]>([])
const statutAcquisition = ref<'loading' | 'ready' | 'error'>('loading')
const statutComparaison = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const retryAcquisition = ref(0)
const retryThemeComparaison = ref(0)
let sequenceAcquisition = 0
let sequenceComparaison = 0
let cleFaitsPrets: string | null = null

const payloadPourRendu = computed<Payload | null>(() => {
  const payload = payloadReference.value
  if (!payload) return null
  const theme = selection.value
  if (!theme) return payload
  // #868 — chemin natif unique : les numériques du thème actif viennent de la
  // seule réponse de faits API. Pendant le chargement ou l'échec, AUCUNE ligne
  // numérique statique ne rend (pas de repli statique — le runtime statique est
  // retiré). La référence complète tient déjà les identités des pairs de
  // comparaison (nuage Milieux, jointures), aucune fusion de cohorte n'est
  // nécessaire.
  const indicateurs = faitsThemeRows.value ?? []
  const histoires = [
    ...(histoiresThemeRows.value ?? []),
    ...(theme === 'demographie' ? histoiresNuageDemographie.value : []),
    ...(theme === 'milieux' ? histoiresNuageMilieux.value : []),
  ]
  return { ...payload, indicateurs, histoires }
})
const erreurFiche = referenceTerritoire.erreur
const chargementFiche = referenceTerritoire.chargement
const rechargerFiche = referenceTerritoire.recharger


const territoire = computed(() => referenceTerritoire.territory.value)

const typeValide = computed(
  () => territoire.value !== null && String(route.params.type) === territoire.value.type,
)

/**
 * A comparison query carries a mode, not a peer list. The validated reference
 * resolves that mode against the destination commune's own published density
 * class and EPCI, so navigation never reuses the previous commune's cohort.
 */
const resolutionComparaison = computed(() => {
  if (!referenceTerritoire.reference.value || !territoire.value) return null
  return resoudreContexteComparaison({
    territoire: territoire.value,
    demande: route.query[PARAM_COMPARAISON],
    contextes: contextesComparaison.value,
  })
})

function libellePorteeSemantic(comparison: unknown, target: Territoire): string | null {
  if (typeof comparison !== 'object' || comparison === null || Array.isArray(comparison)) return null
  const data = comparison as Record<string, unknown>
  if (typeof data.scope !== 'object' || data.scope === null || Array.isArray(data.scope)) return null
  const scope = data.scope as Record<string, unknown>
  const contexts = contextesComparaison.value
  if (scope.kind === 'density_class' && scope.territory_type === target.type &&
      scope.density_class_code === target.classe_densite_code) {
    return contexts.densite?.scope.label ?? null
  }
  if (scope.kind === 'same_level' && scope.territory_type === target.type) {
    return contexts.bretagne?.scope.label ?? null
  }
  if (scope.kind !== 'explicit_selection' || !Array.isArray(data.selection)) return null
  const selected = data.selection as unknown[]
  const territories = referenceTerritoire.reference.value ?? []
  if (target.type === 'commune' && selected.length === 1) {
    const identity = selected[0]
    if (typeof identity === 'object' && identity !== null && !Array.isArray(identity)) {
      const actual = identity as Record<string, unknown>
      for (const mode of ['epci', 'bretagne'] as const) {
        const reference = territoireReferencePourComparaison({ territoire: target, mode, territoires: territories })
        if (reference && actual.territory_type === reference.type && actual.territory_id === reference.id) {
          return contexts[mode]?.scope.label ?? null
        }
      }
    }
  }
  const candidates = [
    ['epci', target.type === 'commune' && target.epci
      ? territories.filter((item) => item.type === 'commune' && item.epci === target.epci) : []],
    ['bretagne', territories.filter((item) => item.type === target.type)],
  ] as const
  for (const [mode, members] of candidates) {
    const expected = members.map((item) => ({ territory_type: item.type, territory_id: item.territoire }))
    if (expected.length === selected.length && expected.every((member, index) => {
      const actual = selected[index]
      return typeof actual === 'object' && actual !== null && !Array.isArray(actual) &&
        (actual as Record<string, unknown>).territory_type === member.territory_type &&
        (actual as Record<string, unknown>).territory_id === member.territory_id
    })) return contexts[mode]?.scope.label ?? null
  }
  return null
}

const optionsComparaison = computed(() => optionsContexteComparaison({
  territoire: territoire.value,
  contextes: contextesComparaison.value,
}))

/**
 * The AEDAR comparison lines read the same aggregates on a single
 * published reference territory (EPCI or région Bretagne) — never a cohort.
 * A density-class comparison has no single-territory reference and the
 * comparison stays honestly unavailable.
 */
const aedarReferenceTerritoire = computed(() => territoireReferencePourComparaison({
  territoire: territoire.value,
  mode: resolutionComparaison.value?.mode ?? null,
  territoires: referenceTerritoire.reference.value ?? [],
}))
const aedarReferenceKey = computed(() => {
  const reference = aedarReferenceTerritoire.value
  return reference ? `${reference.type}/${reference.id}` : ''
})
watch([productionMobilite, aedarReferenceKey, retryAedarCount], async ([active, key], _old, onCleanup) => {
  if (!active || !key) { aedarReferenceData.value = null; aedarReferenceStatus.value = 'unavailable'; return }
  let cancelled = false; onCleanup(() => { cancelled = true })
  aedarReferenceStatus.value = 'loading'; aedarReferenceData.value = null
  const [type, id] = key.split('/')
  const result = await fetchAedarAggregates(type as AedarTerritoryType, id, { measures: AEDAR_CORE_MEASURE_KEYS })
  if (!cancelled) { aedarReferenceData.value = result; aedarReferenceStatus.value = result.status === 'ready' ? 'ready' : 'error' }
}, { immediate: true })

/**
 * L'identité franchit seule la frontière atomique de la référence validée
 * (#868) : une erreur compte comme « prête » afin de remplacer le squelette
 * par l'état d'erreur typé.
 */
const identitePret = computed(
  () => (payloadPourRendu.value?.territoires.length ?? 0) > 0 || erreurFiche.value !== null,
)

const nomTerritoire = computed(() => territoire.value?.nom ?? '')
const nomType = computed(() => (territoire.value ? NOMS_TYPES[territoire.value.type] : ''))
const listeLien = computed(() =>
  territoire.value ? LIENS_LISTES[territoire.value.type] ?? null : null,
)

/**
 * The territory endpoint is an all-theme contract. Tabs are therefore stable
 * and selectable immediately; the selected panel waits for the one atomic
 * response instead of appearing theme by theme.
 */
const ongletsFiche: readonly Theme[] = [
  THEME_DEFAUT,
  ...THEMES_CANONIQUES.filter((theme) => theme !== THEME_DEFAUT),
]


/** Le thème actif est prioritaire ; après son acquisition — réussie ou non —
 * les autres thèmes du registre se réchauffent en arrière-plan. Le rendu ne
 * lit que l'actif. */
watch([() => referenceTerritoire.reference.value, selection, () => idRoute.value, retryAcquisition],
  async ([reference, theme, code], _old, onCleanup) => {
    if (!theme || !reference || !typeValide.value) {
      faitsThemeRows.value = null
      histoiresThemeRows.value = null
      preuvesThemeIndisponibles.value = false
      histoiresNuageDemographie.value = []
      histoiresNuageMilieux.value = []
      statutAcquisition.value = 'loading'
      statutComparaison.value = 'idle'
      cleFaitsPrets = null
      return
    }
    // Mobilité shares the facts cache, but its production cahier owns its
    // rendered status and retries. Keep the cache warm without mutating the
    // generic theme renderer state.
    if (theme === 'mobilite') {
      const request = ++sequenceAcquisition
      let cancelled = false
      onCleanup(() => { cancelled = true })
      try { await cacheAcquisition.get(typeRoute.value, code, 'mobilite') } catch { /* dedicated cahier reports failure */ }
      if (cancelled || request !== sequenceAcquisition) return
      for (const autreTheme of THEMES_ACQUISITION_API) {
        if (autreTheme !== 'mobilite') void cacheAcquisition.get(typeRoute.value, code, autreTheme).catch(() => {})
      }
      return
    }
    // Revisite déjà acquise (même territoire, même thème) : les faits restent,
    // aucune requête — le cache détient l'entrée, le rendu ne clignote pas.
    const themeActif = theme as Theme
    if (statutAcquisition.value === 'ready' && cleFaitsPrets === `${typeRoute.value}/${code}/${themeActif}`) return
    const request = ++sequenceAcquisition
    let cancelled = false
    onCleanup(() => { cancelled = true })
    faitsThemeRows.value = null
    histoiresThemeRows.value = null
    preuvesThemeIndisponibles.value = false
    histoiresNuageDemographie.value = []
    histoiresNuageMilieux.value = []
    statutAcquisition.value = 'loading'
    statutComparaison.value = 'idle'
    try {
      const acquired = await cacheAcquisition.get(typeRoute.value, code, themeActif)
      if (cancelled || request !== sequenceAcquisition) return
      const target = reference.find((item) => item.territoire === code)
      if (!target || target.type !== typeRoute.value) throw new Error('Territoire focal absent')
      const rows = themeFactsRowsFromSemantic(themeActif, acquired.focal, { territoire: code, type: target.type }, {
        epci: target.epci, region: reference.find((item) => item.type === 'region')?.territoire ?? null,
      }, payloadReference.value?.themeMetadata?.[themeActif])
       const comparison = semanticComparisonForTheme(acquired.comparisons.get('omitted'), {
         target: { territoire: code, type: target.type, classe_densite_code: target.classe_densite_code },
         territories: [...reference],
        }, acquired.focal.resource_reads)
        const comparisonScopeLabel = libellePorteeSemantic(comparison, target)
        faitsThemeRows.value = lignesAvecComparaisonApi(rows.indicateurs,
          comparisonScopeLabel === null ? null : comparison, comparisonScopeLabel)
      histoiresThemeRows.value = rows.histoires
      preuvesThemeIndisponibles.value = Boolean(rows.unavailableReadings?.length || acquired.focal.named_reference_error)
       histoiresNuageDemographie.value = themeActif === 'demographie'
         ? histoiresDemographieNuage(comparison) : []
       histoiresNuageMilieux.value = themeActif === 'milieux'
         ? histoiresMilieuxDuNuage(comparison) : []
       statutAcquisition.value = 'ready'
       statutComparaison.value = acquired.focal.comparison_error || acquired.focal.cohort_error || comparison?.reading_cloud_error
         ? 'error' : 'ready'
      cleFaitsPrets = `${typeRoute.value}/${code}/${themeActif}`
    } catch {
      if (!cancelled && request === sequenceAcquisition) {
        faitsThemeRows.value = null
        histoiresThemeRows.value = null
        statutAcquisition.value = 'error'
      }
    }
    // Réchauffage d'arrière-plan (décision propriétaire 2026-10-07) : le thème
    // actif garde la priorité — sa requête est déjà partie — puis tout le
    // registre se réchauffe pour ce territoire, SANS jamais toucher l'état de
    // rendu des thèmes inactifs. Il part aussi quand l'acquisition active
    // échoue : l'onglet défaillant expose SA propre erreur réessayable à sa
    // visite, jamais les autres. Mobilité reste au prototype E tant que
    // celui-ci en est propriétaire. Le cache isole les entrées par
    // (territoire, thème) : une réponse tardive d'un ancien territoire ne peut
    // se fondre nulle part ailleurs que dans sa propre clé.
    if (!cancelled && request === sequenceAcquisition) {
      for (const autreTheme of THEMES_ACQUISITION_API) {
        if (autreTheme === themeActif) continue
        void cacheAcquisition.get(typeRoute.value, code, autreTheme).catch(() => {})
      }
    }
  }, { immediate: true })

/** Comparison-only reads retain focal facts. The producer's fixed default is
 * cached with the paired focal read; explicit scopes acquire only comparisons. */
watch([() => referenceTerritoire.reference.value, selection, () => idRoute.value,
  () => resolutionComparaison.value?.mode, statutAcquisition, retryThemeComparaison],
  async ([reference, theme, code, mode], _old, onCleanup) => {
    if (theme === 'mobilite' || statutAcquisition.value !== 'ready' || !reference || !typeValide.value || !theme) {
      statutComparaison.value = 'idle'
      return
    }
    const target = reference.find((item) => item.territoire === code)
    if (!target || target.type !== typeRoute.value) { statutComparaison.value = 'idle'; return }
    const themeActif = theme as Theme
    const selectionMembres: readonly ThemeSelectionMember[] | null | undefined = target.type !== 'commune' ||
      mode === 'densite' || mode === null || mode === undefined
      ? undefined
      : mode === 'epci' || mode === 'bretagne'
        ? (() => {
          const refTerritoire = territoireReferencePourComparaison({ territoire: target, mode,
            territoires: reference })
          return refTerritoire ? [{ territory_type: refTerritoire.type, territory_id: refTerritoire.id }] : null
        })()
        : null
    const request = ++sequenceComparaison
    let cancelled = false
    onCleanup(() => { cancelled = true })
    statutComparaison.value = 'loading'
    faitsThemeRows.value = faitsThemeRows.value
      ? lignesAvecComparaisonApi(faitsThemeRows.value, null, null) : null
    // Pendant le chargement de la nouvelle sélection, le nuage de l'ancienne
    // ne rend pas (le flux E Mobilité nettoie de même avant la requête).
    if (themeActif === 'milieux') histoiresNuageMilieux.value = []
    if (themeActif === 'demographie') histoiresNuageDemographie.value = []
    if (selectionMembres === null) {
      // Un périmètre nommé sans identité parente résolue est indisponible,
      // jamais une sélection vide ni le contexte fixe par défaut.
      statutComparaison.value = 'error'
      return
    }
    try {
      const acquired = await cacheAcquisition.select(typeRoute.value, code, themeActif, selectionMembres)
      if (cancelled || request !== sequenceComparaison) return
      const nativeComparison = acquired.comparisons.get(cleSelectionComparaison(selectionMembres))
      validerReponseComparaisonTheme(themeActif, nativeComparison, selectionMembres,
        { type: target.type, id: target.territoire })
      const comparison = semanticComparisonForTheme(nativeComparison, {
        target: { territoire: code, type: target.type, classe_densite_code: target.classe_densite_code },
        territories: [...reference],
      }, acquired.focal.resource_reads)
      if (themeActif === 'demographie') {
        histoiresNuageDemographie.value = histoiresDemographieNuage(comparison)
      }
        if (themeActif === 'milieux') histoiresNuageMilieux.value = histoiresMilieuxDuNuage(comparison)
        const comparisonScopeLabel = libellePorteeSemantic(comparison, target)
        faitsThemeRows.value = lignesAvecComparaisonApi(faitsThemeRows.value ?? [],
          comparisonScopeLabel === null ? null : comparison, comparisonScopeLabel)
       statutComparaison.value = nativeComparison?.cohort_error || comparison?.reading_cloud_error ? 'error' : 'ready'
    } catch {
       if (!cancelled && request === sequenceComparaison) {
         faitsThemeRows.value = faitsThemeRows.value?.map(({ comparaisonApi: _rank, ...row }) => row) ?? null
         statutComparaison.value = 'error'
       }
    }
  }, { immediate: true })

function retryAcquisitionTheme(): void {
  if (selection.value) cacheAcquisition.invalidate(typeRoute.value, idRoute.value, selection.value)
  cleFaitsPrets = null
  retryAcquisition.value++
}
function retryThemeComparison(): void { retryThemeComparaison.value++ }


const echelons = computed(() =>
  payloadPourRendu.value ? echelleContexte(payloadPourRendu.value, idRoute.value) : [],
)

/** The active theme's block needs the payload — narrowed together (both are
 *  non-null exactly when a published theme is selected). */
const ongletTheme = computed<{ theme: Theme; payload: Payload } | null>(() =>
  selection.value !== null && payloadPourRendu.value
    ? { theme: selection.value, payload: payloadPourRendu.value }
    : null,
)

const classesFond = computed(() =>
  selection.value ? `fiche--theme-${selection.value}` : '',
)

/**
 * Mobilité's production cahier owns the editorial body whenever its theme is selected.
 */
const mobiliteEditorialeActive = productionMobilite
const statutAccesApi = ref<'loading' | 'ready' | 'error'>('loading')
const buildingStatus = ref<'loading' | 'ready' | 'error'>('loading')
const mobilityFocal = ref<TerritoryFacts | null>(null)
const mobilityComparisonFacts = ref<TerritoryFacts | null>(null)
const mobilityCurveComparison = ref<SelectedTrajectoryComparison | null>(null)
const mobilityComparisonStatus = ref<'loading' | 'ready' | 'error'>('loading')
const retryMobilityFacts = ref(0)
let focalRequestSequence = 0
let comparisonRequestSequence = 0
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
let lastFocalKey: string | null = null
let lastFocalModel: object | null = null
let lastComparisonKey: string | null = null
let lastComparisonModel: object | null = null

watch([productionMobilite, typeRoute, idRoute,
  () => referenceTerritoire.reference.value, retryMobilityFacts], (_values, _oldValues, onCleanup) => {
  if (!productionMobilite.value) return
  const reference = referenceTerritoire.reference.value
  const key = `${typeRoute.value}/${idRoute.value}/${retryMobilityFacts.value}`
  if (reference && lastFocalKey === key && lastFocalModel === reference) return
  const request = ++focalRequestSequence
  statutAccesApi.value = 'loading'
  mobilityFocal.value = null
  mobilityComparisonFacts.value = null
  mobilityCurveComparison.value = null
  mobilityComparisonStatus.value = 'loading'
  buildingStatus.value = 'loading'
  if (!typeValide.value || !reference || !payloadPourRendu.value) {
    lastFocalKey = null
    lastFocalModel = null
    lastComparisonKey = null
    lastComparisonModel = null
    return
  }
  lastFocalKey = key
  lastFocalModel = reference
  const controller = new AbortController()
  let settled = false
  onCleanup(() => {
    controller.abort()
    if (!settled) { lastFocalKey = null; lastFocalModel = null }
  })
  const code = idRoute.value
  void cacheAcquisition.get(typeRoute.value, code, 'mobilite').then((acquired) => {
    const data = acquired.focal
    if (request !== focalRequestSequence || !payloadPourRendu.value || !isRecord(data)) return
    const presentation = toRaw(payloadPourRendu.value)
    const target = presentation.territoires.find((territory) => territory.territoire === code)
    const initialContext = target?.type === 'commune'
      ? contextesComparaison.value.densite
      : resolutionComparaison.value?.contexte ?? undefined
    let combined = mobilityFactsFromThemeApi(presentation, code, data)
    const initialComparison = acquired.comparisons.get('omitted')
    combined = initialComparison
      ? applyThemeComparisonApiFacts(combined, initialComparison, initialContext)
      : clearThemeComparisonApiFacts(combined)
    mobilityFocal.value = combined
    mobilityComparisonFacts.value = combined
    mobilityCurveComparison.value = combined.mobility.selectedTrajectoryComparison ?? null
    mobilityComparisonStatus.value = data.comparison_error ? 'error' : 'ready'
    statutAccesApi.value = 'ready'
    buildingStatus.value = 'ready'
    settled = true
  }).catch(() => {
    settled = true
    if (request === focalRequestSequence) {
      statutAccesApi.value = 'error'
      buildingStatus.value = 'error'
      mobilityComparisonStatus.value = 'error'
    }
  })
}, { immediate: true })

watch([productionMobilite, typeRoute, idRoute, () => resolutionComparaison.value?.mode,
  mobilityFocal, () => referenceTerritoire.reference.value, retryThemeComparaison],
  (_values, _oldValues, onCleanup) => {
    if (!productionMobilite.value || !mobilityFocal.value || !payloadPourRendu.value) return
    const reference = referenceTerritoire.reference.value
    const requestKey = `${typeRoute.value}/${idRoute.value}/${resolutionComparaison.value?.mode ?? ''}/${retryThemeComparaison.value}`
    if (lastComparisonKey === requestKey && lastComparisonModel === reference) return
    const request = ++comparisonRequestSequence
    const controller = new AbortController()
    let settled = false
    onCleanup(() => {
      controller.abort()
      if (!settled) lastComparisonKey = null
    })
    const target = payloadPourRendu.value.territoires.find((territory) => territory.territoire === idRoute.value)
    const mode = resolutionComparaison.value?.mode
    const context = resolutionComparaison.value?.contexte ?? undefined
    const cohort = reference ?? undefined
    if (!target || (target.type === 'commune' && mode !== 'densite' && !cohort)) {
      mobilityComparisonStatus.value = 'error'
      mobilityComparisonFacts.value = clearThemeComparisonApiFacts(mobilityFocal.value)
      mobilityCurveComparison.value = null
      lastComparisonKey = requestKey
      lastComparisonModel = reference
      return
    }
    const selection = target.type !== 'commune' || mode === 'densite' || mode == null ? undefined : mode === 'bretagne'
      ? (cohort ?? []).filter((item) => item.type === 'commune')
        .map((item) => ({ territory_type: item.type, territory_id: item.territoire }))
      : mode === 'epci' && target?.epci
        ? (cohort ?? []).filter((item) => item.type === 'commune' && item.epci === target.epci)
          .map((item) => ({ territory_type: item.type, territory_id: item.territoire }))
        : []
    const explicitSelection = selection
    lastComparisonKey = requestKey
    lastComparisonModel = reference
    mobilityComparisonFacts.value = clearThemeComparisonApiFacts(mobilityFocal.value)
    mobilityCurveComparison.value = null
    mobilityComparisonStatus.value = 'loading'
    void cacheAcquisition.select(typeRoute.value, idRoute.value, 'mobilite', explicitSelection).then((acquired) => {
      if (request !== comparisonRequestSequence || controller.signal.aborted || !mobilityFocal.value) return
      const data = acquired.comparisons.get(cleSelectionComparaison(explicitSelection))
      validerReponseComparaisonTheme('mobilite', data, explicitSelection,
        { type: target.type, id: target.territoire })
      const updated = applyThemeComparisonApiFacts(mobilityFocal.value, data, context, explicitSelection)
       mobilityComparisonFacts.value = updated
       mobilityCurveComparison.value = updated.mobility.selectedTrajectoryComparison ?? null
      mobilityComparisonStatus.value = 'ready'
      settled = true
    }).catch(() => {
      settled = true
       if (request === comparisonRequestSequence && !controller.signal.aborted) {
         lastComparisonKey = null
         mobilityComparisonFacts.value = clearThemeComparisonApiFacts(mobilityFocal.value!)
         mobilityCurveComparison.value = null
        mobilityComparisonStatus.value = 'error'
      }
    })
  }, { immediate: true })

function rechargerMobilityFacts(): void {
  cacheAcquisition.invalidate(typeRoute.value, idRoute.value, 'mobilite')
  retryMobilityFacts.value += 1
  // Mobilité facts are consumed by both the shared theme acquisition state
  // and the production cahier; retry both consumers through the same cache.
  retryAcquisition.value += 1
}
const contenuMobilite = computed<ThemeContent | null>(() => {
  if (
    !productionMobilite.value ||
    chargementFiche.value ||
    !payloadPourRendu.value ||
    !typeValide.value
  ) return null
  const baseFacts = mobilityFocal.value
    ? mobilityComparisonFacts.value ?? clearThemeComparisonApiFacts(mobilityFocal.value)
    : mobilityFactsFromThemeApi(
      toRaw(payloadPourRendu.value), idRoute.value, null, resolutionComparaison.value?.contexte ?? undefined,
    )
  if (!baseFacts) return null
  const facts = { ...baseFacts, mobility: { ...baseFacts.mobility, selectedTrajectoryComparison: mobilityCurveComparison.value } }
  return resolveMobiliteThemeContent(facts, payloadPourRendu.value.themeMetadata?.mobilite)
})
const paginationCahier = computed(() =>
  payloadPourRendu.value && contenuMobilite.value
    ? cahierPaginationFor(payloadPourRendu.value, contenuMobilite.value, mobiliteEditorialeActive.value)
    : null,
)
function choisirOnglet(slug: SlugOnglet): void {
  // La fiche n'émet que des slugs de thème (pas de pseudo-onglet depuis
  // #408) — la garde garde la jointure de type pour les autres shells.
  if (slug === null || !(THEMES_CANONIQUES as readonly string[]).includes(slug)) return
  // Preserve the comparison context and unrelated query state.
  router.replace({ query: { ...route.query, theme: slug } })
}

watch(
  () => route.query.variant,
  (variant) => {
    if (variant === undefined) return
    const query = { ...route.query }
    delete query.variant
    router.replace({ query })
  },
  { immediate: true },
)

watch(
  () => route.query.theme,
  (theme) => {
    if (theme !== undefined &&
        (typeof theme !== 'string' || !(THEMES_CANONIQUES as readonly string[]).includes(theme))) {
      const query = { ...route.query }
      delete query.theme
      router.replace({ query })
    }
  },
  { immediate: true },
)

watch(
  resolutionComparaison,
  (resolution) => {
    if (!resolution?.canonicaliser) return
    const query = { ...route.query }
    delete query[PARAM_COMPARAISON]
    delete query.variant
    router.replace({ query })
  },
  { immediate: true },
)

</script>

<template>
  <section
    class="fiche"
    :class="[classesFond, { 'fiche--mobilite-editoriale': productionMobilite, 'presentation-editorial': mobiliteEditorialeActive }]"
    :aria-busy="chargementFiche ? 'true' : 'false'"
  >
    <div class="fiche-en-tete-surface">
      <div class="fiche-en-tete">
      <div
        v-if="!identitePret"
        class="fiche-chargement"
        role="status"
        aria-label="Chargement de la fiche"
      >
        <div class="squelette squelette--fil" />
        <div class="squelette squelette--titre" />
        <div class="squelette squelette--ligne" />
      </div>

      <div v-else-if="erreurFiche" class="etat-erreur">
        <AppIcon :icone="AlertCircle" :taille="28" class="etat-icone" />
        <p class="etat-texte">Impossible de charger les données de la fiche.</p>
        <button type="button" class="bouton-reessayer" @click="rechargerFiche">Réessayer</button>
      </div>

      <div v-else-if="!typeValide" class="etat-vide">
        <AppIcon :icone="SearchX" :taille="28" class="etat-icone" />
        <p class="etat-texte">Territoire introuvable.</p>
        <RouterLink class="etat-action" to="/communes">Explorer les fiches</RouterLink>
      </div>

      <template v-else>
        <nav class="fil-ariane" aria-label="Fil d’ariane">
          <RouterLink to="/">Accueil</RouterLink>
          <AppIcon :icone="ChevronRight" :taille="14" class="fil-ariane-separateur" />
          <RouterLink
            v-if="listeLien"
            :to="listeLien.chemin"
            aria-current="page"
          >{{ listeLien.nom }}</RouterLink>
          <span v-else aria-current="page">Région</span>
        </nav>

        <div class="fiche-identite">
          <div class="fiche-titre">
            <h1>{{ nomTerritoire }}</h1>
          </div>
          <div class="fiche-actions">
            <span class="puce-type">{{ nomType }}</span>
            <ContexteSwitcher :echelons="echelons" />
          </div>
        </div>
      </template>
      </div>
      <ThemeTabs
        :themes="ongletsFiche"
        :selected="selection"
        masquer-onglet-initial
        @select="choisirOnglet"
      />
    </div>

    <template v-if="typeValide && !erreurFiche">
      <!-- #627/#868 : le thème actif échoue fermé — jamais de repli sur les
           numériques statiques (runtime retiré) ; chaque échec reste réessayable. -->
      <div
        v-if="selection !== 'mobilite' && statutAcquisition === 'error'"
        class="etat-erreur"
        role="alert"
      >
        <p>Les indicateurs de ce thème ne sont pas disponibles.</p>
        <button type="button" @click="retryAcquisitionTheme">Réessayer</button>
      </div>
      <div
        v-else-if="statutComparaison === 'error' ||
          (productionMobilite && mobilityFocal && mobilityComparisonStatus === 'error')"
        class="etat-erreur"
        role="alert"
      >
        <p>Les comparaisons de ce thème ne sont pas disponibles.</p>
        <button type="button" @click="retryThemeComparison">Réessayer</button>
      </div>
      <div v-if="selection !== 'mobilite' && statutAcquisition === 'ready' && preuvesThemeIndisponibles"
        class="etat-erreur" role="alert">
        <p>Les lectures de ce thème ne sont pas disponibles.</p>
        <button type="button" @click="retryAcquisitionTheme">Réessayer</button>
      </div>
      <div class="fiche-corps">
        <!-- Le contenu attend la référence validée de la fiche (#868) : aucun
             panneau ne prétend avoir ses données pendant que la réponse pend. -->
        <div
          v-if="chargementFiche"
          class="fiche-chargement-contenu"
          role="status"
          aria-label="Chargement du contenu de la fiche"
        >
          <div class="squelette squelette--ligne" />
          <div class="squelette squelette--ligne" />
          <div class="squelette squelette--ligne" />
          <div class="squelette squelette--ligne" />
        </div>
        <!-- Le filigrane (DESIGN.md §7) : dessinable n'importe où dans la zone
             d'onglet (entre le sous-en-tête et le pied de page), re-tiré à
             chaque changement d'onglet (remount via :key), figé pour la durée
             du montage. -->
        <template v-else>
          <FiligraneFiche v-if="selection" :key="selection" :theme="selection" />
          <div
            v-if="selection"
            class="fiche-contenu"
            role="tabpanel"
            :id="idPanneau(selection)"
            :aria-labelledby="idOnglet(selection)"
          >
            <!-- The production cahier owns Mobilité's editorial body and AEDAR evidence. -->
            <ProductionMobilite v-if="productionMobilite && contenuMobilite && paginationCahier"
              :content="contenuMobilite" :pagination="paginationCahier" :comparison-options="optionsComparaison"
              :access-status="statutAccesApi" :retry-access="rechargerMobilityFacts"
              :building-status="buildingStatus" :retry-building="rechargerMobilityFacts"
              :aedar-data="aedarData" :aedar-status="aedarStatus" :retry-aedar="retryAedar"
              :aedar-reference-territoire="aedarReferenceTerritoire" :aedar-reference-data="aedarReferenceData"
              :aedar-reference-status="aedarReferenceStatus" />
            <!-- #408 : le premier onglet (et le défaut) est le sixième thème —
                 sa présentation propre (badges à trois voix, ventilation
                 pliée) lit SA paire hermétique ; les autres thèmes passent
                 par la boucle partagée des sous-groupes. -->
            <BlocProgrammes
              v-else-if="selection === 'programmes' && payloadPourRendu"
              :payload="payloadPourRendu"
              :territoire="idRoute"
              :metadata-status="statutMetadataPourAffichage"
              :retry-metadata="retryExplicationTheme"
            />
            <OngletTheme
              v-else-if="ongletTheme"
              :theme="ongletTheme.theme"
              :payload="ongletTheme.payload"
              :territoire="idRoute"
              :metadata-status="statutMetadataPourAffichage"
              :retry-metadata="retryExplicationTheme"
            />
          </div>
        </template>
      </div>
    </template>

  </section>
</template>

<style scoped>
.fiche {
  flex: 1;
  background: var(--surface-secondary);
  transition: background-color 300ms ease-in-out;
}

.fiche--theme-mobilite {
  background: var(--theme-mobilite-wash);
}

.fiche--theme-demographie {
  background: var(--theme-demographie-wash);
}

.fiche--theme-habitat {
  background: var(--theme-habitat-wash);
}

.fiche--theme-economie {
  background: var(--theme-economie-wash);
}

/* #408 : le sixième thème — l'onglet premier et par défaut de la fiche. */
.fiche--theme-programmes {
  background: var(--theme-programmes-wash);
}

.fiche-en-tete {
  width: 100%;
  max-width: var(--content-max-width);
  margin-inline: auto;
  padding: var(--space-8) var(--grid-margin-mobile) var(--space-6);
}

.fiche-en-tete-surface {
  background: var(--surface-primary);
}

.fil-ariane {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-6);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-tertiary);
}

.fil-ariane a {
  color: var(--text-secondary);
}

.fil-ariane [aria-current='page'] {
  color: var(--text-primary);
}

.fil-ariane-separateur {
  color: var(--text-tertiary);
}

.fiche-identite {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
  text-align: center;
}

.fiche-titre {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--space-3) var(--space-4);
}

.fiche-titre h1 {
  margin: 0;
  font: var(--text-h1);
  letter-spacing: var(--text-h1-tracking);
}

.fiche-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--space-3) var(--space-4);
}

.puce-type {
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  background: var(--surface-tertiary);
  color: var(--text-secondary);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  text-transform: uppercase;
}

.fiche-chargement {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-8) 0;
}

.fiche-chargement-contenu {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: var(--content-max-width);
  margin-inline: auto;
  padding: var(--space-8) var(--grid-margin-mobile) var(--space-12);
}

.squelette--fil {
  width: 40%;
  height: 0.875rem;
}

.squelette--titre {
  width: 60%;
  height: 2.25rem;
}

.squelette--ligne {
  width: 100%;
  height: 1rem;
}

.etat-erreur,
.etat-vide {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-16) var(--space-6);
  text-align: center;
}

.etat-icone {
  color: var(--text-tertiary);
}

.etat-texte {
  margin: 0;
  color: var(--text-secondary);
  font: var(--text-body-lg);
}

.etat-action {
  font: var(--text-body-sm);
  font-weight: 600;
}

.bouton-reessayer {
  height: 36px;
  padding: 0 var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-primary);
  color: var(--text-primary);
  font: var(--text-body-sm);
  font-weight: 600;
  box-shadow: var(--shadow-subtle);
  cursor: pointer;
}

.bouton-reessayer:hover {
  background: var(--surface-tertiary);
  border-color: var(--brand-500);
}

.fiche-corps {
  position: relative;
  isolation: isolate;
  width: 100%;
}

.fiche-contenu {
  width: 100%;
  max-width: var(--content-max-width);
  margin-inline: auto;
  padding: var(--space-6) var(--grid-margin-mobile) var(--space-12);
}

.fiche--mobilite-editoriale .fiche-contenu {
  max-width: 1640px;
}

</style>
