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
 * programmes default. One atomic territory model resolves every theme block;
 * tab changes never fetch. The page bg wears the selected theme's -wash. The breadcrumb + H1 with the
 * territory's real name (trouverTerritoire), the type chip and the context
 * switcher form the fiche header.
 *
 * States: skeleton while the payload loads; typed PayloadError with a Retry
 * button (ui-elements.md §Loading/empty/error — never a raw error string);
 * honest empty state when the territory (or its type) is unknown.
 */
import { AlertCircle, ChevronRight, SearchX } from 'lucide-vue-next'
import { computed, ref, toRaw, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import BlocProgrammes from '@/components/fiche/BlocProgrammes.vue'
import ContexteSwitcher from '@/components/fiche/ContexteSwitcher.vue'
import FiligraneFiche from '@/components/fiche/FiligraneFiche.vue'
import OngletTheme from '@/components/fiche/OngletTheme.vue'
import ThemeTabs from '@/components/ThemeTabs.vue'
// [PROTOTYPE #499 — JETABLE] le registre des variantes de lecture — dev seul.
import {
  CommutateurPrototype,
  varianteDeUrl,
} from '@/fiche/prototype/variantes'
import { cahierPaginationFor } from '@/fiche/prototype/cahierPagination'
import {
  PARAM_COMPARAISON,
  optionsContexteComparaison,
  resoudreContexteComparaison,
} from '@/fiche/comparisonContext'
import { resolveMobiliteThemeContent } from '@/fiche/content/themeContent'
import { applyThemeComparisonApiFacts, clearThemeComparisonApiFacts, mobilityFactsFromThemeApi } from '@/fiche/content/mobilityThemeApiFacts'
import { applyAccessApiFacts } from '@/fiche/content/accessApiFacts'
import { applyInitialBuildingApiFacts } from '@/fiche/content/initialBuildingApiFacts'
import { applyComparisonOnlyBuildingFacts } from '@/fiche/content/buildingApiFacts'
import { territoryFactsFor } from '@/fiche/content/territoryFacts'
import { chargerCohortesScalaires, indicateursScalairesPourNiveau, pagesScalairesEnregistrees, remplacerFaitsScalaires, scalarCohortEnabled } from '@/payload/scalarCohort'
import { acquireThemeComparison, acquireThemeFacts, cleSelectionComparaison, themeAcquisitionEnabled, ThemeAcquisitionCache } from '@/payload/themeAcquisition'
import { histoiresDemographieNuage, histoiresMilieuxDuNuage, themeFactsRowsFromApi, validerReponseComparaisonTheme } from '@/payload/themeFactsAdapter'
import type { ThemeSelectionMember } from '@/payload/themeAcquisition'
import type { ThemeContent } from '@/fiche/content/themeContent'
import type { ComparisonScopeKind, TerritoryFacts } from '@/fiche/content/territoryFacts'
import { echelleContexte } from '@/fiche/echelleContexte'
import { LIENS_LISTES, NOMS_TYPES, idOnglet, idPanneau } from '@/fiche/onglets'
import type { SlugOnglet } from '@/fiche/onglets'
import { trouverTerritoire } from '@/payload/selectors'
import { THEMES_CANONIQUES } from '@/payload/types'
import type { Histoire, Indicateur, Payload, Theme } from '@/payload/types'
import { useTerritoryReadModel } from '@/payload/useTerritoryReadModel'
import { payloadDepuisModeleTerritoire } from '@/payload/territoryReadModel'

const route = useRoute()
const router = useRouter()

/** Le thème DÉFAUT de la fiche (#408) : « Programmes et subventions », le
 *  sixième thème du contrat canonique, présenté en premier et sélectionné par
 *  défaut — il remplace l'Aperçu retiré. */
const THEME_DEFAUT: Theme = 'programmes'

const typeRoute = computed(() => String(route.params.type))
const idRoute = computed(() => String(route.params.id))
const modeleTerritoire = useTerritoryReadModel(typeRoute, idRoute, computed(() => true))
const payloadModele = computed(() =>
  modeleTerritoire.model.value ? payloadDepuisModeleTerritoire(modeleTerritoire.model.value) : null,
)
const ficheScalaires = ref<import('@/payload/types').Indicateur[] | null>(null)
const ficheScalairesStatus = ref<'loading' | 'ready' | 'error'>('loading')
const ficheScalairesEnregistres = ref<string[]>([])
const ficheScalairesRegistrePresent = ref(false)
const retryFicheScalaires = ref(0)
let sequenceFicheScalaires = 0

/**
 * Acquisition paresseuse par thème derrière `VITE_THEME_ACQUISITION_API` (#627)
 * : le modèle atomique gardé fournit l'identité, les métadonnées et la
 * grammaire de présentation ; le POST faits du thème actif fournit TOUS ses
 * numériques (aucune ligne statique du thème migré ne rend). Un thème hors de
 * `THEMES_ACQUISITION_API` garde le chemin incumbent, drapeau ou pas.
 */
const acquisitionApiActivee = themeAcquisitionEnabled(import.meta.env)
/** Thèmes coupés vers l'acquisition paresseuse (#627) — Mobilité reste hors
 * registre : sa surface de fiche est la variante E, intégration côté utilisateur. */
const THEMES_ACQUISITION_API: readonly Theme[] = ['programmes', 'demographie', 'habitat', 'economie', 'milieux']
/** Le garde du chemin migré — booléen (la branche fausse ne rétrécit rien). */
const themeMigre = (theme: Theme | null): boolean =>
  acquisitionApiActivee && theme !== null && THEMES_ACQUISITION_API.includes(theme)
const cacheAcquisition = new ThemeAcquisitionCache(
  (theme, key) => acquireThemeFacts(key!.type, key!.id, theme),
  (selection, theme, key) => acquireThemeComparison(key!.type, key!.id, theme, selection),
)
const faitsThemeRows = ref<Indicateur[] | null>(null)
const histoiresThemeRows = ref<Histoire[] | null>(null)
const histoiresNuageDemographie = ref<Histoire[]>([])
const histoiresNuageMilieux = ref<Histoire[]>([])
const statutAcquisition = ref<'loading' | 'ready' | 'error'>('loading')
const statutComparaison = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const retryAcquisition = ref(0)
let sequenceAcquisition = 0
let sequenceComparaison = 0
let cleFaitsPrets: string | null = null

const payloadPourRendu = computed<Payload | null>(() => {
  const payload = payloadModele.value
  if (!payload) return null
  if (themeMigre(selection.value)) {
    // Chemin migré : les numériques du thème actif viennent de la seule
    // réponse de faits API — pendant le chargement ou l'échec, AUCUNE ligne
    // numérique statique du thème ne rend (pas de repli statique).
    const theme = selection.value as Theme
    const indicateurs = faitsThemeRows.value === null
      ? payload.indicateurs.filter((row) => row.theme !== theme)
      : [...payload.indicateurs.filter((row) => row.theme !== theme), ...faitsThemeRows.value]
    const histoires = histoiresThemeRows.value === null
      ? payload.histoires.filter((row) => row.theme !== theme)
      : [...payload.histoires.filter((row) => row.theme !== theme), ...histoiresThemeRows.value,
        ...(theme === 'demographie' ? histoiresNuageDemographie.value : []),
        ...(theme === 'milieux' ? histoiresNuageMilieux.value : [])]
    // Les pairs du nuage Milieux ont besoin de leur identité dans le référentiel
    // du payload (le sélecteur résout leurs noms) — jamais d'autres territoires.
    const peerIds = new Set(theme === 'milieux' ? histoiresNuageMilieux.value.map((row) => row.territoire) : [])
    const peers = modeleTerritoire.model.value?.cohortTerritories
      ?.filter((territory) => peerIds.has(territory.territoire)) ?? []
    const territoires = [...payload.territoires, ...peers.filter((peer) =>
      !payload.territoires.some((existing) => existing.territoire === peer.territoire))]
    return { ...payload, territoires, indicateurs, histoires }
  }
  if (!scalarCohortEnabled(import.meta.env)) return payload
  const theme = selection.value
  if (!theme || ficheScalairesStatus.value !== 'ready' || ficheScalaires.value === null) {
    const registered = ficheScalairesStatus.value === 'error' && ficheScalairesRegistrePresent.value &&
      ficheScalairesEnregistres.value.length === 0
      ? payload.indicateurs.filter((row) => row.theme === theme).map((row) => row.key)
      : ficheScalairesEnregistres.value
    return registered.length ? { ...payload, indicateurs: payload.indicateurs.filter((row) => row.theme !== theme || !registered.includes(row.key)) } : payload
  }
  return { ...payload, indicateurs: remplacerFaitsScalaires(payload.indicateurs, ficheScalaires.value, ficheScalairesEnregistres.value) }
})
const erreurFiche = modeleTerritoire.erreur
const chargementFiche = modeleTerritoire.chargement
const rechargerFiche = modeleTerritoire.recharger


const territoire = computed(() =>
  payloadPourRendu.value ? trouverTerritoire(payloadPourRendu.value, idRoute.value) : null,
)

const typeValide = computed(
  () => territoire.value !== null && String(route.params.type) === territoire.value.type,
)

/**
 * A comparison query carries a mode, not a peer list. The loaded territory
 * model resolves that mode against the destination commune's own published
 * projections, so navigation never reuses the previous commune's cohort.
 */
const resolutionComparaison = computed(() => {
  if (!modeleTerritoire.model.value || !territoire.value) return null
  return resoudreContexteComparaison({
    territoire: territoire.value,
    demande: route.query[PARAM_COMPARAISON],
    contextes: modeleTerritoire.model.value.themes.mobilite?.comparisons ?? {},
  })
})

const optionsComparaison = computed(() => optionsContexteComparaison({
  territoire: territoire.value,
  contextes: modeleTerritoire.model.value?.themes.mobilite?.comparisons ?? {},
}))

const scalarCohortScopeKey = computed(() => {
  const scope = resolutionComparaison.value?.contexte?.scope
  if (scope?.kind === 'communes-epci') return `epci:${territoire.value?.epci ?? ''}`
  return `all:${scope?.kind ?? ''}`
})

/**
 * L'identité et le contenu franchissent ensemble la frontière atomique du
 * modèle de territoire. Une erreur compte comme « prête » afin de remplacer
 * le squelette par l'état d'erreur typé.
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

const selection = computed<Theme | null>(() => {
  const demande = route.query.theme
  if (typeof demande === 'string' && (THEMES_CANONIQUES as readonly string[]).includes(demande)) {
    return demande as Theme
  }
  return THEME_DEFAUT
})

watch([() => modeleTerritoire.model.value, selection, () => idRoute.value, retryFicheScalaires, scalarCohortScopeKey],
  async ([model, theme, code, _retry, scopeKey], _old, onCleanup) => {
    const request = ++sequenceFicheScalaires
    ficheScalaires.value = null
    ficheScalairesEnregistres.value = []
    ficheScalairesRegistrePresent.value = false
    ficheScalairesStatus.value = 'loading'
    // Le thème migré n'emprunte jamais le fan-out par indicateur (#627) : sa
    // voie unique est la requête de faits du thème.
    if (!scalarCohortEnabled(import.meta.env) || !model || !theme || themeMigre(theme)) { ficheScalairesStatus.value = 'ready'; return }
    const data = model.themes[theme]
    if (!data) { ficheScalairesStatus.value = 'ready'; return }
    let cancelled = false
    onCleanup(() => { cancelled = true })
    try {
      const focal = model.territories.find((territory) => territory.territoire === code)
      if (!focal) throw new Error('Territoire focal absent')
      if (!('scalar_contracts' in data.metadata)) { ficheScalairesStatus.value = 'ready'; return }
      ficheScalairesRegistrePresent.value = true
      const registered = pagesScalairesEnregistrees(data.metadata,
        indicateursScalairesPourNiveau(data.metadata, focal.type))
      ficheScalairesEnregistres.value = registered
      if (!registered.length) { ficheScalairesStatus.value = 'ready'; return }
      const scope = String(scopeKey).startsWith('epci:') ? { epci: focal.epci ?? undefined } : {}
      const facts = await chargerCohortesScalaires(registered, theme, data.metadata, focal, focal.type,
        model.cohortTerritories ?? model.territories,
        scope)
      if (!cancelled && request === sequenceFicheScalaires) { ficheScalaires.value = facts; ficheScalairesStatus.value = 'ready' }
    } catch {
      if (!cancelled && request === sequenceFicheScalaires) ficheScalairesStatus.value = 'error'
    }
  }, { immediate: true })
function retryScalaires(): void { retryFicheScalaires.value++ }

/** Une acquisition de faits par thème non caché : l'atterrissage et le
 * changement de territoire ou d'onglet vers un thème migré déclenchent UNE
 * requête ; la revisite d'un thème déjà acquis n'en déclenche aucune. */
watch([() => modeleTerritoire.model.value, selection, () => idRoute.value, retryAcquisition],
  async ([model, theme, code], _old, onCleanup) => {
    if (!themeMigre(theme) || !model || !typeValide.value) {
      faitsThemeRows.value = null
      histoiresThemeRows.value = null
      histoiresNuageDemographie.value = []
      histoiresNuageMilieux.value = []
      statutAcquisition.value = 'loading'
      statutComparaison.value = 'idle'
      cleFaitsPrets = null
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
    histoiresNuageDemographie.value = []
    histoiresNuageMilieux.value = []
    statutAcquisition.value = 'loading'
    statutComparaison.value = 'idle'
    try {
      const acquired = await cacheAcquisition.get(typeRoute.value, code, themeActif)
      if (cancelled || request !== sequenceAcquisition) return
      const target = payloadModele.value?.territoires.find((item) => item.territoire === code)
      if (!target || target.type !== typeRoute.value) throw new Error('Territoire focal absent')
      const rows = themeFactsRowsFromApi(themeActif, acquired.focal, { territoire: code, type: target.type })
      faitsThemeRows.value = rows.indicateurs
      histoiresThemeRows.value = rows.histoires
      histoiresNuageDemographie.value = themeActif === 'demographie' && isRecord(acquired.focal.comparison)
        ? histoiresDemographieNuage(acquired.focal.comparison) : []
      histoiresNuageMilieux.value = themeActif === 'milieux' && isRecord(acquired.focal.comparison)
        ? histoiresMilieuxDuNuage(acquired.focal.comparison) : []
      statutAcquisition.value = 'ready'
      cleFaitsPrets = `${typeRoute.value}/${code}/${themeActif}`
    } catch {
      if (!cancelled && request === sequenceAcquisition) {
        faitsThemeRows.value = null
        histoiresThemeRows.value = null
        statutAcquisition.value = 'error'
      }
    }
  }, { immediate: true })

/** Une seule requête comparison-only par changement de sélection : le défaut
 * déclaré (classe de densité d'une commune, pairs de même niveau ailleurs)
 * est déjà servi par la comparaison imbriquée de la réponse de faits ; une
 * sélection explicite (EPCI, Bretagne) acquiert UNE réponse de comparaison et
 * garde les faits focaux. Les tokens incompatibles échouent fermé (le cache
 * rejette la fusion) et restent réessayables. */
watch([() => modeleTerritoire.model.value, selection, () => idRoute.value,
  () => resolutionComparaison.value?.mode, statutAcquisition, retryAcquisition],
  async ([model, theme, code, mode], _old, onCleanup) => {
    if (!themeMigre(theme) || statutAcquisition.value !== 'ready' || !model || !typeValide.value) {
      statutComparaison.value = 'idle'
      return
    }
    const target = payloadModele.value?.territoires.find((item) => item.territoire === code)
    if (!target || target.type !== typeRoute.value) { statutComparaison.value = 'idle'; return }
    // Le mode densité (défaut d'une commune) et les niveaux non communaux
    // gardent la comparaison déclarée déjà acquise avec les faits.
    if (target.type !== 'commune' || mode === 'densite' || mode === null || mode === undefined) {
      statutComparaison.value = 'ready'
      return
    }
    const cohort = model.cohortTerritories
    if (!cohort) { statutComparaison.value = 'error'; return }
    const themeActif = theme as Theme
    const selectionMembres: ThemeSelectionMember[] = mode === 'bretagne'
      ? cohort.filter((item) => item.type === 'commune')
        .map((item) => ({ territory_type: item.type, territory_id: item.territoire }))
      : mode === 'epci' && target.epci
        ? cohort.filter((item) => item.type === 'commune' && item.epci === target.epci)
          .map((item) => ({ territory_type: item.type, territory_id: item.territoire }))
        : []
    const request = ++sequenceComparaison
    let cancelled = false
    onCleanup(() => { cancelled = true })
    statutComparaison.value = 'loading'
    // Pendant le chargement de la nouvelle sélection, le nuage de l'ancienne
    // ne rend pas (le flux E Mobilité nettoie de même avant la requête).
    if (themeActif === 'milieux') histoiresNuageMilieux.value = []
    if (themeActif === 'demographie') histoiresNuageDemographie.value = []
    try {
      const acquired = await cacheAcquisition.select(typeRoute.value, code, themeActif, selectionMembres)
      if (cancelled || request !== sequenceComparaison) return
      validerReponseComparaisonTheme(themeActif,
        acquired.comparisons.get(cleSelectionComparaison(selectionMembres)), selectionMembres)
      if (themeActif === 'demographie') {
        histoiresNuageDemographie.value = histoiresDemographieNuage(
          acquired.comparisons.get(cleSelectionComparaison(selectionMembres)))
      }
      if (themeActif === 'milieux') histoiresNuageMilieux.value = histoiresMilieuxDuNuage(
        acquired.comparisons.get(cleSelectionComparaison(selectionMembres)))
      statutComparaison.value = 'ready'
    } catch {
      if (!cancelled && request === sequenceComparaison) statutComparaison.value = 'error'
    }
  }, { immediate: true })

function retryAcquisitionTheme(): void { retryAcquisition.value++ }


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
 * [PROTOTYPE #499 — JETABLE] La variante de lecture demandée par
 * ?variant=A|B|C|D|E — null hors développement ou sans paramètre valide. Le
 * chargement et l'état restent CI-DESSUS : la variante reçoit le payload
 * déjà réglé et ne fetch jamais. L'onglet « Programmes et subventions »
 * garde SA présentation propre (BlocProgrammes) dans toutes les variantes —
 * le prototype explore les cinq thèmes éditoriaux.
 */
const variante = computed(() => varianteDeUrl(route.query.variant))
const prototypeActif = import.meta.env.DEV
const scalarCohortActif = scalarCohortEnabled(import.meta.env)
/** [PROTOTYPE #531/#552] Cahier variants own the editorial Mobilité surface. */
const prototypeCahierMobilite = computed(
  () => prototypeActif && ['D', 'E'].includes(variante.value?.clef ?? '') && selection.value === 'mobilite',
)
const prototypeAccesApi = computed(() => prototypeCahierMobilite.value && variante.value?.clef === 'E')
const statutAccesApi = ref<'loading' | 'ready' | 'error'>('loading')
const buildingStatus = ref<'loading' | 'ready' | 'error'>('loading')
const mobilityFocal = ref<TerritoryFacts | null>(null)
const mobilityComparisonFacts = ref<TerritoryFacts | null>(null)
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

watch([prototypeAccesApi, typeRoute, idRoute,
  () => modeleTerritoire.model.value, retryMobilityFacts], (_values, _oldValues, onCleanup) => {
  if (!prototypeAccesApi.value) return
  const model = modeleTerritoire.model.value
  const key = `${typeRoute.value}/${idRoute.value}/${retryMobilityFacts.value}`
  if (model && lastFocalKey === key && lastFocalModel === model) return
  const request = ++focalRequestSequence
  statutAccesApi.value = 'loading'
  mobilityFocal.value = null
  mobilityComparisonFacts.value = null
  mobilityComparisonStatus.value = 'loading'
  buildingStatus.value = 'loading'
  if (!typeValide.value || !model || !payloadPourRendu.value) {
    lastFocalKey = null
    lastFocalModel = null
    lastComparisonKey = null
    lastComparisonModel = null
    return
  }
  lastFocalKey = key
  lastFocalModel = model
  const controller = new AbortController()
  let settled = false
  onCleanup(() => {
    controller.abort()
    if (!settled) { lastFocalKey = null; lastFocalModel = null }
  })
  const code = idRoute.value
  void fetch(`/api/territories/${encodeURIComponent(typeRoute.value)}/${encodeURIComponent(code)}/themes/mobilite/facts`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme_id: 'mobilite' }), signal: controller.signal }).then(async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json() as Promise<unknown>
  }).then((data) => {
    if (request !== focalRequestSequence || !payloadPourRendu.value || !isRecord(data)) return
    const presentation = toRaw(payloadPourRendu.value)
    const target = presentation.territoires.find((territory) => territory.territoire === code)
    const initialContext = target?.type === 'commune'
      ? modeleTerritoire.model.value?.themes.mobilite?.comparisons.densite
      : resolutionComparaison.value?.contexte ?? undefined
    let combined = mobilityFactsFromThemeApi(presentation, code, data)
    combined = applyThemeComparisonApiFacts(combined, data.comparison, initialContext)
    const serviceScope = isRecord(data.essential_service_access) && isRecord(data.essential_service_access.scope)
      ? data.essential_service_access.scope : null
    combined = applyAccessApiFacts(combined, data.essential_service_access,
      typeof serviceScope?.kind === 'string' ? serviceScope.kind as ComparisonScopeKind : null,
      typeof serviceScope?.label === 'string' ? serviceScope.label : null)
    const buildingScope = isRecord(data.building_access) && isRecord(data.building_access.scope)
      ? data.building_access.scope : null
    combined = applyInitialBuildingApiFacts(combined, data.building_access,
      typeof buildingScope?.comparison_mode === 'string' ? buildingScope.comparison_mode : null,
      typeof buildingScope?.kind === 'string' ? buildingScope.kind : null,
      initialContext?.scope.label ?? null)
    mobilityFocal.value = combined
    mobilityComparisonFacts.value = combined
    mobilityComparisonStatus.value = 'ready'
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

watch([prototypeAccesApi, typeRoute, idRoute, () => resolutionComparaison.value?.mode,
  mobilityFocal, () => modeleTerritoire.model.value],
  (_values, _oldValues, onCleanup) => {
    if (!prototypeAccesApi.value || !mobilityFocal.value || !payloadPourRendu.value) return
    const model = modeleTerritoire.model.value
    const requestKey = `${typeRoute.value}/${idRoute.value}/${resolutionComparaison.value?.mode ?? ''}`
    if (lastComparisonKey === requestKey && lastComparisonModel === model) return
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
    if ((target?.type === 'commune' && mode === 'densite') || target?.type !== 'commune') {
      lastComparisonKey = requestKey
      lastComparisonModel = model
      mobilityComparisonFacts.value = mobilityFocal.value
      mobilityComparisonStatus.value = 'ready'
      return
    }
    const cohort = modeleTerritoire.model.value?.cohortTerritories
    if (!cohort) {
      mobilityComparisonStatus.value = 'error'
      mobilityComparisonFacts.value = clearThemeComparisonApiFacts(mobilityFocal.value)
      lastComparisonKey = requestKey
      lastComparisonModel = model
      return
    }
    const selection = mode === 'bretagne'
      ? cohort.filter((item) => item.type === 'commune')
        .map((item) => ({ territory_type: item.type, territory_id: item.territoire }))
      : mode === 'epci' && target?.epci
        ? cohort.filter((item) => item.type === 'commune' && item.epci === target.epci)
          .map((item) => ({ territory_type: item.type, territory_id: item.territoire }))
        : []
    const body = { theme_id: 'mobilite', ...(selection === undefined ? {} : { selection }) }
    lastComparisonKey = requestKey
    lastComparisonModel = model
    mobilityComparisonFacts.value = clearThemeComparisonApiFacts(mobilityFocal.value)
    mobilityComparisonStatus.value = 'loading'
    void fetch(`/api/territories/${encodeURIComponent(typeRoute.value)}/${encodeURIComponent(idRoute.value)}/themes/mobilite/comparison`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json() as Promise<unknown>
    }).then((data) => {
      if (request !== comparisonRequestSequence || !isRecord(data)) return
      const expectedSelection = new Set(selection.map((item) => `${item.territory_type}/${item.territory_id}`))
      const returnedSelection = Array.isArray(data.selection) ? data.selection : []
      if (data.contract !== 'theme-comparison-v1' || data.theme_id !== 'mobilite' ||
          returnedSelection.length !== expectedSelection.size ||
          returnedSelection.some((item) => !isRecord(item) ||
            !expectedSelection.has(`${String(item.territory_type)}/${String(item.territory_id)}`))) {
        throw new Error('Réponse de comparaison Mobilité incohérente avec la sélection')
      }
      let updated = applyThemeComparisonApiFacts(mobilityFocal.value!, data, context)
      updated = applyComparisonOnlyBuildingFacts(updated, data.building_access, context?.scope.label ?? null)
      mobilityComparisonFacts.value = updated
      mobilityComparisonStatus.value = 'ready'
      settled = true
    }).catch(() => {
      settled = true
      if (request === comparisonRequestSequence) {
        lastComparisonKey = null
        mobilityComparisonFacts.value = clearThemeComparisonApiFacts(mobilityFocal.value!)
        mobilityComparisonStatus.value = 'error'
      }
    })
  }, { immediate: true })

function rechargerMobilityFacts(): void { retryMobilityFacts.value += 1 }
const contenuMobilite = computed<ThemeContent | null>(() => {
  if (
    !prototypeCahierMobilite.value ||
    chargementFiche.value ||
    !payloadPourRendu.value ||
    !typeValide.value
  ) return null
  const facts = prototypeAccesApi.value
    ? mobilityFocal.value
      ? mobilityComparisonFacts.value ?? clearThemeComparisonApiFacts(mobilityFocal.value)
      : mobilityFactsFromThemeApi(toRaw(payloadPourRendu.value), idRoute.value, null)
    : territoryFactsFor(toRaw(payloadPourRendu.value), idRoute.value,
      resolutionComparaison.value?.contexte ?? undefined)
  if (!facts) return null
  const contentFacts = facts
  return resolveMobiliteThemeContent(contentFacts)
})
const paginationCahier = computed(() =>
  payloadPourRendu.value && contenuMobilite.value
    ? cahierPaginationFor(payloadPourRendu.value, contenuMobilite.value, variante.value?.clef === 'E')
    : null,
)
function choisirOnglet(slug: SlugOnglet): void {
  // La fiche n'émet que des slugs de thème (pas de pseudo-onglet depuis
  // #408) — la garde garde la jointure de type pour les autres shells.
  if (slug === null || !(THEMES_CANONIQUES as readonly string[]).includes(slug)) return
  // Les AUTRES paramètres de requête sont conservés (?variant= du prototype
  // #499 survit au changement d'onglet).
  router.replace({ query: { ...route.query, theme: slug } })
}

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
    router.replace({ query })
  },
  { immediate: true },
)

</script>

<template>
  <section
    class="fiche"
    :class="[classesFond, { 'fiche--prototype': prototypeActif, 'fiche--prototype-d': prototypeCahierMobilite }]"
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
      <div v-if="scalarCohortActif && ficheScalairesStatus === 'error'" class="etat-erreur" role="alert">
        <p>Les indicateurs de ce thème ne sont pas disponibles.</p>
        <button type="button" @click="retryScalaires">Réessayer</button>
      </div>
      <!-- #627 : le thème migré échoue fermé — jamais de repli sur les
           numériques statiques ; chaque échec reste réessayable. -->
      <div
        v-else-if="themeMigre(selection) && statutAcquisition === 'error'"
        class="etat-erreur"
        role="alert"
      >
        <p>Les indicateurs de ce thème ne sont pas disponibles.</p>
        <button type="button" @click="retryAcquisitionTheme">Réessayer</button>
      </div>
      <div
        v-else-if="themeMigre(selection) && statutComparaison === 'error'"
        class="etat-erreur"
        role="alert"
      >
        <p>Les comparaisons de ce thème ne sont pas disponibles.</p>
        <button type="button" @click="retryAcquisitionTheme">Réessayer</button>
      </div>
      <div class="fiche-corps">
        <!-- Le contenu attend l'unique modèle atomique de la fiche : aucun
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
            <!-- [PROTOTYPE #531] D replaces only the Mobilité body; the fiche
                 identity header, theme tabs, background and tabpanel stay owned
                 by this shell. -->
            <component
              :is="variante.composant"
              v-if="prototypeCahierMobilite && contenuMobilite && paginationCahier && variante"
              :content="contenuMobilite"
              :pagination="paginationCahier"
               :comparison-options="variante.clef === 'E' ? optionsComparaison : []"
                 :access-status="variante.clef === 'E' ? statutAccesApi : undefined"
                 :retry-access="rechargerMobilityFacts"
                 :building-status="variante.clef === 'E' ? buildingStatus : undefined"
                 :retry-building="rechargerMobilityFacts"
            />
            <!-- #408 : le premier onglet (et le défaut) est le sixième thème —
                 sa présentation propre (badges à trois voix, ventilation
                 pliée) lit SA paire hermétique ; les autres thèmes passent
                 par la boucle partagée des sous-groupes. -->
            <BlocProgrammes
              v-else-if="selection === 'programmes' && payloadPourRendu"
              :payload="payloadPourRendu"
              :territoire="idRoute"
            />
            <!-- [PROTOTYPE #499] la variante remplace OngletTheme sur les
                 cinq thèmes éditoriaux — même props, zéro fetch propre. -->
            <component
              :is="variante.composant"
              v-else-if="ongletTheme && variante && !['D', 'E'].includes(variante.clef)"
              :theme="ongletTheme.theme"
              :payload="ongletTheme.payload"
              :territoire="idRoute"
            />
            <OngletTheme
              v-else-if="ongletTheme"
              :theme="ongletTheme.theme"
              :payload="ongletTheme.payload"
              :territoire="idRoute"
            />
          </div>
        </template>
      </div>
    </template>

    <!-- [PROTOTYPE #499] le commutateur fixe du bas — dev uniquement. -->
    <CommutateurPrototype v-if="prototypeActif && CommutateurPrototype" />
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

/* [PROTOTYPE #499] la place du commutateur fixe du bas. */
.fiche--prototype {
  padding-bottom: 96px;
}

.fiche--prototype-d .fiche-contenu {
  max-width: 1640px;
}
</style>
