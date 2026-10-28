<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PAYLOAD_CHARGER_KEY, usePayload } from '@/payload/usePayload'
import type { Fichier } from '@/payload/loader'
import { chargerManifesteModelesLecture, chargerModeleIndicateur, INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY, INDICATOR_READ_MODEL_CHARGER_KEY, payloadDepuisModeleIndicateur } from '@/payload/indicatorReadModel'
import type { IndicatorReadModel } from '@/payload/indicatorReadModel'
import { modeleComposition, modeleExploration, modeleEnsembleComparaison, modeleProfil, modeleRelation, modeleSignature, modeleTrajectoire, payloadPourCarte } from '@/indicateurs/explorationModel'
import type { OrdreExploration, TriExploration } from '@/indicateurs/explorationModel'
import MapExplorer from '@/components/carte/MapExplorer.vue'
import { PARAM_NIVEAU, PARAM_TERRITOIRE, estNiveauComparable, lireTerritoirePorte } from '@/fiche/contratExploration'
import { useGeometrie } from '@/geo/useGeometrie'
import type { NiveauMasque } from '@/geo/types'
import type { Couche } from '@/carte/coucheModel'
import { THEMES_CANONIQUES } from '@/payload/types'
import type { Theme } from '@/payload/types'
import { themeStyle } from '@/indicateurs/themeTokens'
import { formaterRang, formaterValeur } from '@/payload/selectors'
import { sourceRecords } from '@/payload/selectors'
import { ancreSource, datasetDeSource } from '@/methodes/sources'
import RepereFamilyOutlet from '@/components/indicateurs/RepereFamilyOutlet.vue'
import NoteContexteIndicateur from '@/components/indicateurs/NoteContexteIndicateur.vue'
import { dispatchIndicatorFamily } from '@/indicateurs/familySeam'
import { fusionnerFacette, queryCanonique, resoudreEtatUrl, resoudreNiveau } from '@/indicateurs/etatUrl'
import { PayloadError, validerThemeMetadata } from '@/payload/validate'
import { semanticComparisonScopeLabel } from '@/fiche/content/comparisonScopeLabel'
import { orderedSeriesAdapterFor, orderedSeriesFacts, type OrderedSeriesRead } from '@/payload/orderedSeriesAdapter'
import { chargerCohorteScalaire, chargerCohortePageScalaire, chargerComparaisonsScalaires,
  chargerFaitFocalPageScalaire, choisirFocalCohorte, indicateursScalairesEnregistres, pagesScalairesEnregistrees,
  scalarCohortEnabled, validerEnregistrementScalaires } from '@/payload/scalarCohort'
import type { ScalarComparisonEvidence, ScalarComparisonRequest } from '@/payload/scalarCohort'
import type { Indicateur, IndicatorPageMetadata, NativeThemeFactContract, Payload, SourceVintageRecord, Territoire, TerritoireType, ThemeMetadata } from '@/payload/types'
import { ThemeAcquisitionCache, acquireThemeComparison, acquireThemeFacts, cleSelectionComparaison } from '@/payload/themeAcquisition'
import { adapterPageProfilDeclare, chargerCohorteProfilDeclare, chargerComparaisonProfilDeclare, chargerCohorteScalaireLiee, chargerFaitFocalProfilDeclare } from '@/payload/profileAcquisition'
import type { DeclaredProfileDescriptor, ProfileComparison, ProfilePageBinding, ProfilePublicationIdentity, ProfileTarget } from '@/payload/profileAcquisition'
import { chargerCatalogueRessources } from '@/payload/semanticResourceClient'
import type { SemanticResourceDeclaration } from '@/payload/semanticResourceClient'
import { acquireOrderedSeriesSemantic } from '@/payload/seriesSemanticAcquisition'
import { projectRaccordementSemanticComparison, projectRaccordementSemanticFocal } from '@/payload/raccordementSemanticProjection'
import type { RaccordementSemanticProjection } from '@/payload/raccordementSemanticProjection'

const JOURS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

function dateLongue(iso: string, avecJour = true): string {
  const date = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(date.getTime())
    ? iso
    : `${avecJour ? `${JOURS_FR[date.getUTCDay()]} ` : ''}${date.getUTCDate()} ${MOIS_FR[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

const route = useRoute(); const router = useRouter(); const recherche = ref('')
// La lecture du niveau mémorisé reste une fine couture d'effet de bord (#508) :
// elle se fait au montage, puis l'applier de persistance la tient à jour. Les
// fonctions pures reçoivent cette valeur ; aucun computed ne lit localStorage.
const niveauMemorise = ref<string | undefined>(localStorage.getItem('lusk:niveau-indicateur') ?? undefined)
// L'état que la page REÇOIT de la passarelle (#505) — les deux paramètres
// portés, lus et validés UNE fois par le contrat d'exploration.
const porte = computed(() => lireTerritoirePorte(route.query))
// Keep route watches on the normalized primitive values. `porte` is a fresh
// object for every query update (including view-only changes); watching its
// identity would repeat fact and comparison reads when revisiting a tab.
const territoirePorte = computed(() => porte.value.territoire)
const niveauPorte = computed(() => porte.value.niveau)
const departementPorte = computed(() => route.query.departement)
const epciPorte = computed(() => route.query.epci)
const theme = computed(() => String(route.params.theme)); const indicator = computed(() => String(route.params.indicator))
const pageScalaireApiActive = ref(false)
const seriesPageApiActive = ref(false)
const seriesHasScalarFacet = ref(false)
const metadataSeriesApi = ref<ThemeMetadata | null>(null)
const catalogueResourcesApi = ref<SemanticResourceDeclaration[] | null>(null)
const orderedSeriesAdapter = computed(() => {
  const declaration = catalogueResourcesApi.value?.find((resource) => resource.resource_id === indicator.value)
  const adapter = orderedSeriesAdapterFor(theme.value, indicator.value, declaration)
  if (!adapter) return null
  const page = metadataSeriesApi.value?.indicator_pages?.[indicator.value] ?? payloadLegacy.value.themeMetadata?.[theme.value as keyof typeof payloadLegacy.value.themeMetadata]
    ?.indicator_pages?.[indicator.value] as { series_dataset_id?: string; series_publication?: 'legacy' | 'owned' } | undefined
  // Metadata selects ownership; absence during loading is not a legacy binding.
  if (!page) return null
  const datasetId = page?.series_dataset_id
  const publicationMode = page?.series_publication
  const enabled = seriesPageApiActive.value || adapter.indicator === 'raccordement_courbe'
  return enabled ? { ...adapter, datasetId, publicationMode } : null
})
const raccordementApiActive = computed(() => orderedSeriesAdapter.value?.indicator === 'raccordement_courbe')
const themeValide = computed(() => (THEMES_CANONIQUES as readonly string[]).includes(theme.value))
const selectedTheme = theme.value as Theme
const scalaireApiAuMontage = scalarCohortEnabled(import.meta.env as Record<string, string | undefined>)
const payloadChargerInjecte = inject(PAYLOAD_CHARGER_KEY, null)
const manifesteChargerInjecte = inject(INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY, null)
const modeleChargerInjecte = inject(INDICATOR_READ_MODEL_CHARGER_KEY, null)
const attendrePage = ref<Fichier[]>(['territoires'])
const demarrerPage = ref<Fichier[]>(['territoires'])
const { payload: payloadLegacy, erreur: erreurLegacy, chargement: chargementLegacy } = usePayload({
  attendre: attendrePage,
  demarrer: demarrerPage,
})
const erreurManifesteModeles = ref<PayloadError | null>(null)
const chargementManifesteModeles = ref(false)
const routeModeleIndicateur = ref(false)
const chargerManifeste = manifesteChargerInjecte ?? chargerManifesteModelesLecture
const profileDiscoveryComplete = ref(false)
const profileMode = ref(false)
const profileBootstrapLoading = ref(true)
const profileBootstrapError = ref<PayloadError | null>(null)
const metadataProfilRoute = ref<ThemeMetadata | null>(null)
const catalogueProfil = ref<SemanticResourceDeclaration[]>([])
const catalogueScalaireApi = ref<SemanticResourceDeclaration[]>([])
const declarationProfil = ref<SemanticResourceDeclaration | null>(null)
const descriptorProfil = ref<DeclaredProfileDescriptor | null>(null)
const identityProfil = ref<ProfilePublicationIdentity | null>(null)
const targetProfil = ref<ProfileTarget | null>(null)
const liaisonScalaireProfil = ref<SemanticResourceDeclaration | undefined>(undefined)
const bindingProfil = ref<ProfilePageBinding | null>(null)
const profileMembers = ref<string[]>([])
const profileFacts = ref<Indicateur[]>([])
const profileFocalFacts = ref<Indicateur[]>([])
const profileFactsError = ref<PayloadError | null>(null)
const profileFactsLoading = ref(false)
const profileFocalError = ref<PayloadError | null>(null)
const profileFocalLoading = ref(false)
const profileScalarFacts = ref<Indicateur[]>([])
const profileScalarError = ref<PayloadError | null>(null)
const profileScalarLoading = ref(false)
const profileComparison = ref<ProfileComparison | null>(null)
const profileComparisonTarget = ref<string | null>(null)
const profileComparisonError = ref(false)
const profileComparisonLoading = ref(false)
const retryProfileFacts = ref(0)
const retryProfileBootstrap = ref(0)
const retryProfileComparison = ref(0)
const retryProfileScalar = ref(0)
let profileDiscoverySequence = 0
let profileFactsSequence = 0
let profileFocalSequence = 0
let profileComparisonSequence = 0
let profileScalarSequence = 0
let profileFactsRequestKey = ''
let profileFocalRequestKey = ''
let profileComparisonRequestKey = ''
let profileScalarRequestKey = ''
const utiliseManifeste = computed(() => profileDiscoveryComplete.value && !profileMode.value &&
  !seriesPageApiActive.value && !scalaireApiAuMontage && (manifesteChargerInjecte !== null || payloadChargerInjecte === null))
const utiliseModeleIndicateur = computed(() => !profileMode.value && utiliseManifeste.value && routeModeleIndicateur.value)
const modeleIndicateur = ref<IndicatorReadModel | null>(null)
const erreurModeleIndicateur = ref<PayloadError | null>(null)
const chargementModeleIndicateur = ref(false)
let modeleIndicateurDemarre = false
const chargerModele = modeleChargerInjecte ?? chargerModeleIndicateur
function profileCatalogueBinding(resources: SemanticResourceDeclaration[], currentTheme: string,
  currentIndicator: string) {
  const candidates = resources.filter((resource) => resource.resource_id === currentIndicator &&
    resource.shapes.includes('declared_profile'))
  const declaration = candidates.find((resource) => resource.theme_id === currentTheme &&
    resource.indicator_id === currentIndicator)
  return { declaration, incompatible: candidates.length > 0 && declaration === undefined }
}

async function loadRouteThemeMetadata(currentTheme: string): Promise<ThemeMetadata> {
  const file = `theme_${currentTheme}`
  const path = `/data/${file}.json`
  let raw: unknown
  if (payloadChargerInjecte) {
    try { raw = await payloadChargerInjecte(file as Fichier) }
    catch (cause) { throw new PayloadError('fetch', file, `Métadonnées ${currentTheme} indisponibles : ${cause instanceof Error ? cause.message : String(cause)}`) }
    if (raw === null || raw === undefined) throw new PayloadError('fetch', file, `Métadonnées ${currentTheme} indisponibles.`)
  } else {
    let response: Response
    try { response = await fetch(path) }
    catch (cause) { throw new PayloadError('fetch', file, `Métadonnées ${currentTheme} indisponibles : ${cause instanceof Error ? cause.message : String(cause)}`) }
    if (!response.ok) throw new PayloadError('fetch', file, `Métadonnées ${currentTheme} indisponibles (HTTP ${response.status}).`)
    try { raw = await response.json() }
    catch { throw new PayloadError('validation', file, `Métadonnées ${currentTheme} illisibles.`) }
  }
  const metadata = payloadChargerInjecte ? raw as ThemeMetadata : validerThemeMetadata(raw, file)
  if (metadata.theme !== currentTheme) throw new PayloadError('validation', file, 'Métadonnées du thème incompatibles avec la route.')
  const profileContracts = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).profile_contracts : undefined
  return { ...metadata, ...(profileContracts === undefined ? {} : { profile_contracts: profileContracts }) } as ThemeMetadata
}

function fichiersLegacy(currentTheme: string): Fichier[] {
  return ['territoires', `indicateurs_${currentTheme}`, `theme_${currentTheme}`] as Fichier[]
}

async function resolveProfileRoute(currentTheme: string, currentIndicator: string): Promise<void> {
  const sequence = ++profileDiscoverySequence
  profileFactsRequestKey = ''
  profileComparisonRequestKey = ''
  profileScalarRequestKey = ''
  profileMode.value = false
  profileDiscoveryComplete.value = false
  pageScalaireApiActive.value = false
  seriesPageApiActive.value = false
  seriesHasScalarFacet.value = false
  catalogueResourcesApi.value = null
  metadataSeriesApi.value = null
  profileBootstrapLoading.value = true
  profileBootstrapError.value = null
  metadataProfilRoute.value = null
  catalogueProfil.value = []
  catalogueScalaireApi.value = []
  declarationProfil.value = null
  descriptorProfil.value = null
  identityProfil.value = null
  targetProfil.value = null
  liaisonScalaireProfil.value = undefined
  bindingProfil.value = null
  profileFacts.value = []
  profileFocalFacts.value = []
  profileFactsError.value = null
  profileFactsLoading.value = false
  profileFocalError.value = null
  profileFocalLoading.value = false
  profileScalarFacts.value = []
  profileScalarError.value = null
  profileScalarLoading.value = false
  profileMembers.value = []
  profileComparison.value = null
  profileComparisonError.value = false
  profileComparisonLoading.value = false
  profileComparisonTarget.value = null
  routeModeleIndicateur.value = false
  modeleIndicateur.value = null
  erreurModeleIndicateur.value = null
  modeleIndicateurDemarre = false
  chargementManifesteModeles.value = false
  erreurManifesteModeles.value = null
  const validTheme = (THEMES_CANONIQUES as readonly string[]).includes(currentTheme)
  attendrePage.value = ['territoires']
  demarrerPage.value = ['territoires']

  if (!validTheme) {
    profileDiscoveryComplete.value = true
    profileBootstrapLoading.value = false
    return
  }

  let resources: SemanticResourceDeclaration[]
  try { resources = await chargerCatalogueRessources() }
  catch (cause) {
    if (sequence !== profileDiscoverySequence) return
    profileBootstrapError.value = cause instanceof PayloadError ? cause
      : new PayloadError('fetch', '/api/resources', 'Le catalogue sémantique est indisponible.')
    profileDiscoveryComplete.value = true
    profileBootstrapLoading.value = false
    return
  }
  if (sequence !== profileDiscoverySequence) return
  catalogueResourcesApi.value = resources

  // The producer catalogue is the first authority for every indicator-page
  // route. Presentation metadata and static/model readers are considered only
  // after this shared classification succeeds.
  const binding = profileCatalogueBinding(resources, currentTheme, currentIndicator)
  if (binding.incompatible) {
    profileMode.value = true
    catalogueProfil.value = resources
    profileBootstrapError.value = new PayloadError('validation', currentIndicator,
      'La déclaration du profil ne correspond pas à la route disponible.')
    profileDiscoveryComplete.value = true
    profileBootstrapLoading.value = false
    return
  }

  if (binding.declaration) {
    let loadedMetadata: ThemeMetadata
    try { loadedMetadata = await loadRouteThemeMetadata(currentTheme) }
    catch (cause) {
      if (sequence !== profileDiscoverySequence) return
      profileBootstrapError.value = cause instanceof PayloadError ? cause
        : new PayloadError('fetch', `theme_${currentTheme}.json`, 'Les métadonnées de cette page sont indisponibles.')
      profileDiscoveryComplete.value = true
      profileBootstrapLoading.value = false
      return
    }
    if (sequence !== profileDiscoverySequence) return
    profileMode.value = true
    catalogueProfil.value = resources
    metadataProfilRoute.value = loadedMetadata
    const page = loadedMetadata.indicator_pages?.[currentIndicator]
    const pageFamily = page?.family
    const retainedProfileFamily = pageFamily === 'composition' || pageFamily === 'distribution' ||
      pageFamily === 'list' || pageFamily === 'pyramid'
    if (!page || !retainedProfileFamily) {
      profileBootstrapError.value = new PayloadError('validation', currentIndicator,
        'Le profil déclaré ne dispose pas d’une présentation locale prise en charge.')
      profileDiscoveryComplete.value = true
      profileBootstrapLoading.value = false
      return
    }
    declarationProfil.value = binding.declaration
    profileDiscoveryComplete.value = true
    profileBootstrapLoading.value = false
    return
  }

  // Ordered-series pages use the same producer-first route classification as
  // scalar/profile pages. Their static theme file remains editorial only.
  const seriesResource = resources.find((resource) => resource.resource_id === currentIndicator &&
    resource.indicator_id === currentIndicator && resource.theme_id === currentTheme &&
    resource.shapes.includes('ordered_series') && resource.target_kinds.includes('territory_cohort') &&
    resource.intents.includes('facts'))
  const seriesAdapter = orderedSeriesAdapterFor(currentTheme, currentIndicator, seriesResource)
  if (seriesResource && seriesAdapter && currentIndicator !== 'raccordement_courbe') {
    let loadedMetadata: ThemeMetadata
    try { loadedMetadata = await loadRouteThemeMetadata(currentTheme) }
    catch (cause) {
      if (sequence !== profileDiscoverySequence) return
      profileBootstrapError.value = cause instanceof PayloadError ? cause
        : new PayloadError('fetch', `theme_${currentTheme}.json`, 'Les métadonnées de cette page sont indisponibles.')
      profileDiscoveryComplete.value = true
      profileBootstrapLoading.value = false
      return
    }
    if (sequence !== profileDiscoverySequence) return
    const page = loadedMetadata.indicator_pages?.[currentIndicator]
    if (!page || !['trajectory', 'scalar'].includes(page.family)) {
      profileBootstrapError.value = new PayloadError('validation', currentIndicator,
        'La série déclarée ne dispose pas d’une présentation locale prise en charge.')
      profileDiscoveryComplete.value = true
      profileBootstrapLoading.value = false
      return
    }
    metadataSeriesApi.value = loadedMetadata
    seriesPageApiActive.value = true
    seriesHasScalarFacet.value = seriesResource.shapes.includes('scalar')
    profileDiscoveryComplete.value = true
    profileBootstrapLoading.value = false
    return
  }

  // Ordinary scalar pages are selected from the producer/API/page-grammar
  // intersection before a manifest or legacy numeric reader can claim them.
  // Dual-shape scalar/series pages (notably prix_m2) remain on their owner path.
  const scalarResource = resources.find((resource) => resource.resource_id === currentIndicator &&
    resource.indicator_id === currentIndicator && resource.theme_id === currentTheme &&
    resource.shapes.length === 1 && resource.shapes[0] === 'scalar' &&
    resource.target_kinds.includes('territory_cohort') && resource.intents.includes('facts'))
  if (scalarResource) {
    catalogueScalaireApi.value = resources
    let loadedMetadata: ThemeMetadata
    try { loadedMetadata = await chargerMetadataScalaireApi(currentTheme) }
    catch (cause) {
      if (sequence !== profileDiscoverySequence) return
      profileBootstrapError.value = cause instanceof PayloadError ? cause
        : new PayloadError('fetch', `theme_${currentTheme}.json`, 'Les métadonnées de cette page sont indisponibles.')
      profileDiscoveryComplete.value = true
      profileBootstrapLoading.value = false
      return
    }
    if (sequence !== profileDiscoverySequence) return
    const registered = indicateursScalairesEnregistres(loadedMetadata)
    const scalarPages = pagesScalairesEnregistrees(loadedMetadata, registered)
    validerEnregistrementScalaires(loadedMetadata, scalarPages)
    const page = loadedMetadata.indicator_pages?.[currentIndicator]
    if (scalarPages.includes(currentIndicator) && page?.family === 'scalar' &&
        page.levels.some((level) => scalarResource.allowed_levels.includes(level))) {
      metadataScalaireApi.value = loadedMetadata
      indicateursScalairesCourants.value = scalarPages
      pageScalaireApiActive.value = true
      profileDiscoveryComplete.value = true
      profileBootstrapLoading.value = false
      return
    }
  }

  // The route is now confirmed not to be profile- or ordinary-scalar-owned.
  // Its existing opt-in scalar, ordered-series, manifest/model, or legacy path remains intact.
  if (scalaireApiAuMontage) {
    profileDiscoveryComplete.value = true
    profileBootstrapLoading.value = false
    return
  }

  const canUseManifest = manifesteChargerInjecte !== null || payloadChargerInjecte === null
  if (canUseManifest) {
    chargementManifesteModeles.value = true
    try {
      const manifest = await chargerManifeste()
      if (sequence !== profileDiscoverySequence) return
      routeModeleIndicateur.value = manifest.routes[currentTheme as Theme]?.includes(currentIndicator) ?? false
    } catch (cause) {
      if (sequence !== profileDiscoverySequence) return
      erreurManifesteModeles.value = cause instanceof PayloadError
        ? cause : new PayloadError('fetch', 'modeles-lecture/manifest.json', 'Impossible de charger le manifeste des modèles.')
    } finally {
      if (sequence === profileDiscoverySequence) chargementManifesteModeles.value = false
    }
  }

  profileDiscoveryComplete.value = true
  profileBootstrapLoading.value = false
  if (!routeModeleIndicateur.value) {
    const legacy = fichiersLegacy(currentTheme)
    attendrePage.value = legacy
    demarrerPage.value = [...legacy, 'territoires-metadata']
  }
}

watch(() => [theme.value, indicator.value, retryProfileBootstrap.value] as const,
  ([currentTheme, currentIndicator]) => { void resolveProfileRoute(currentTheme, currentIndicator) },
  { immediate: true })

const scalaireApiOptionnelle = computed(() => scalarCohortEnabled(import.meta.env as Record<string, string | undefined>))
const indicateursScalairesCourants = ref<string[]>([])
const scalaireApi = computed(() => !profileMode.value && metadataScalaireApi.value?.theme === theme.value &&
  ((pageScalaireApiActive.value && indicateursScalairesCourants.value.includes(indicator.value)) ||
    (scalaireApiOptionnelle.value && indicateursScalairesCourants.value.includes(indicator.value))))
const metadataScalaireApi = ref<ThemeMetadata | null>(null)
const faitsScalaireApi = ref<Indicateur[]>([])
const erreurScalaireApi = ref<PayloadError | null>(null)
const chargementScalaireApi = ref(false)
const retryScalaireApi = ref(0)
const identiteScalairePage = ref<{ contentVersion: string; referenceContentVersion: string;
  descriptorVersion?: string; comparisonFacet?: string } | null>(null)
const contratScalairePageNatif = ref<NativeThemeFactContract | null>(null)
const faitsScalairePagePrets = ref(false)
const generationFaitsScalairePage = ref(0)
const comparaisonScalairePage = ref<ScalarComparisonEvidence | null>(null)
const erreurComparaisonScalairePage = ref(false)
const chargementComparaisonScalairePage = ref(false)
const retryComparaisonScalairePage = ref(0)
const erreurScalaireFocalApi = ref(false)
const focalScalaireApiAbsent = ref(false)
const chargementScalaireFocalApi = ref(false)
let sequenceScalaireApi = 0
let cleRequeteScalaireApi = ''
async function chargerMetadataScalaireApi(currentTheme: string): Promise<ThemeMetadata> {
  const file = `theme_${currentTheme}.json`
  const response = await fetch(`/data/${file}`)
  if (!response.ok) throw new PayloadError('fetch', file, `Métadonnées ${currentTheme} indisponibles (HTTP ${response.status}).`)
  let raw: unknown
  try { raw = await response.json() }
  catch { throw new PayloadError('validation', file, `Métadonnées ${currentTheme} illisibles.`) }
  const registered = indicateursScalairesEnregistres(raw)
  const metadata = validerThemeMetadata(raw, file)
  if (metadata.theme !== currentTheme) throw new PayloadError('validation', file, 'Métadonnées du thème incompatibles.')
  const unbound = registered.filter((id) => {
    const page = metadata.indicator_pages?.[id]
    return !page || page.indicator !== id
  })
  if (unbound.length) throw new PayloadError('validation', file,
    `Contrat scalaire sans page déclarée : ${unbound.join(', ')}.`)
  // A scalar contract may also serve a page's scalar headline (e.g. prix_m2)
  // while the page itself is a trajectory. Only scalar-family pages use the
  // scalar cohort reader; their other contract remains on its declared path.
  const registeredPages = pagesScalairesEnregistrees(metadata, registered)
  validerEnregistrementScalaires(metadata, registeredPages)
  indicateursScalairesCourants.value = registeredPages
  return metadata
}
function requeteComparaisonPageScalaire(territories: Territoire[], focal: Territoire, level: TerritoireType,
  department: string | undefined, epci: string | undefined, label: string): ScalarComparisonRequest | null {
  if (level === 'region' || focal.type !== level) return null
  const members = territories.filter((territory) => territory.type === level &&
    (level !== 'commune' || ((!department || territory.departement === department) &&
      (!epci || territory.epci === epci))))
  if (level === 'commune') return { kind: 'selected',
    members: members.map((member) => ({ type: 'commune', id: member.territoire })),
    scope: { kind: 'explicit_selection', territoryType: 'commune', memberCount: members.length, label } }
  return { kind: 'fixed', scope: { kind: 'same_level', territoryType: level,
    memberCount: members.length, label } }
}

function membresComparaisonPageScalaire(territories: Territoire[], request: ScalarComparisonRequest): Territoire[] {
  if (request.kind === 'selected') {
    const refs = new Map(territories.map((territory) => [`${territory.type}\u0000${territory.territoire}`, territory]))
    return request.members.flatMap((member) => {
      const territory = refs.get(`${member.type}\u0000${member.id}`)
      return territory ? [territory] : []
    })
  }
  return territories.filter((territory) => territory.type === request.scope.territoryType &&
    (request.scope.kind !== 'density_class' || territory.classe_densite_code === request.scope.densityClassCode))
}

watch(() => [profileDiscoveryComplete.value, profileMode.value, scalaireApi.value, pageScalaireApiActive.value,
  theme.value, indicator.value, territoirePorte.value,
  niveauPorte.value, departementPorte.value, epciPorte.value,
  payloadLegacy.value.territoires.length, retryScalaireApi.value] as const,
async ([discovered, isProfile, active, ordinaryPage, currentTheme, currentIndicator, selectedId, routeLevel,
  department, epci, territoryCount]) => {
  if (!discovered || isProfile) return
  const key = JSON.stringify([active, ordinaryPage, currentTheme, currentIndicator, selectedId, routeLevel,
    department, epci, territoryCount, retryScalaireApi.value])
  if (active && key === cleRequeteScalaireApi) return
  cleRequeteScalaireApi = key
  const sequence = ++sequenceScalaireApi
  faitsScalaireApi.value = []; erreurScalaireApi.value = null
  erreurScalaireFocalApi.value = false
  focalScalaireApiAbsent.value = false
  chargementScalaireFocalApi.value = false
  identiteScalairePage.value = null
  contratScalairePageNatif.value = null
  faitsScalairePagePrets.value = false
  comparaisonScalairePage.value = null
  erreurComparaisonScalairePage.value = false
  chargementComparaisonScalairePage.value = false
  if (!active || !territoryCount) return
  chargementScalaireApi.value = true
  try {
    if (!metadataScalaireApi.value || metadataScalaireApi.value.theme !== currentTheme) metadataScalaireApi.value = await chargerMetadataScalaireApi(currentTheme)
    if (sequence !== sequenceScalaireApi) return
    if (!indicateursScalairesCourants.value.includes(currentIndicator)) {
      const legacyFiles = ['territoires', `indicateurs_${currentTheme}`, `theme_${currentTheme}`] as Fichier[]
      attendrePage.value = legacyFiles
      demarrerPage.value = legacyFiles
      chargementScalaireApi.value = false
      return
    }
    const page = metadataScalaireApi.value.indicator_pages?.[currentIndicator]
    if (!page || page.indicator !== currentIndicator || page.family && page.family !== 'scalar') {
      throw new PayloadError('validation', 'theme_economie.json', 'Cette page ne déclare pas un indicateur scalaire compatible.')
    }
    const normalized = resoudreEtatUrl({ query: route.query, territoires: payloadLegacy.value.territoires,
      niveauxPublies: page.levels, niveauMemorise: niveauMemorise.value })
    const level = normalized.niveau ?? resoudreNiveau(routeLevel, niveauMemorise.value, page.levels)
    const dept = level === 'commune' ? normalized.scopeValide?.departement : undefined
    const codeEpci = level === 'commune' ? normalized.scopeValide?.epci : undefined
    const selectedFocal = payloadLegacy.value.territoires.find((territory) =>
      territory.territoire === selectedId && territory.type === level)
    const focal = selectedFocal ?? choisirFocalCohorte(payloadLegacy.value.territoires, level, selectedId,
      level === 'commune' ? { department: dept, epci: codeEpci } : {})
    const scope = level === 'commune' ? { department: dept, epci: codeEpci } : {}
    if (ordinaryPage) {
      const result = await chargerCohortePageScalaire(currentIndicator, currentTheme as Theme,
        metadataScalaireApi.value, focal, level, payloadLegacy.value.territoires, scope,
        catalogueScalaireApi.value)
      if (sequence === sequenceScalaireApi) {
        faitsScalaireApi.value = result.facts
        identiteScalairePage.value = result.identity
        contratScalairePageNatif.value = result.contract
        faitsScalairePagePrets.value = true
        generationFaitsScalairePage.value++
        chargementScalaireApi.value = false
      }
      const focalOutsideCohort = Boolean(focal && focal.type === level &&
        ((scope.department && focal.departement !== scope.department) ||
          (scope.epci && focal.epci !== scope.epci)))
      if (focalOutsideCohort && focal) {
        chargementScalaireFocalApi.value = true
        try {
          const focalFact = await chargerFaitFocalPageScalaire(result.declaration, currentIndicator,
            currentTheme as Theme, metadataScalaireApi.value, focal, payloadLegacy.value.territoires,
            result.identity, result.contract)
          if (sequence === sequenceScalaireApi) {
            faitsScalaireApi.value = focalFact ? [...result.facts, focalFact] : result.facts
            focalScalaireApiAbsent.value = focalFact === null
          }
        } catch {
          if (sequence === sequenceScalaireApi) erreurScalaireFocalApi.value = true
        } finally {
          if (sequence === sequenceScalaireApi) chargementScalaireFocalApi.value = false
        }
      }
      return
    }
    if (!focal) throw new PayloadError('validation', currentIndicator, 'Aucun territoire admissible dans ce périmètre.')
    const rows = await chargerCohorteScalaire(currentIndicator, currentTheme as Theme, page, focal, level,
      payloadLegacy.value.territoires, scope)
    if (sequence === sequenceScalaireApi) faitsScalaireApi.value = rows
  } catch (cause) {
    if (sequence === sequenceScalaireApi) erreurScalaireApi.value = cause instanceof PayloadError ? cause : new PayloadError('fetch', currentIndicator, 'Impossible de charger le cohort scalaire.')
  } finally { if (sequence === sequenceScalaireApi) chargementScalaireApi.value = false }
}, { immediate: true })

let sequenceComparaisonScalairePage = 0
watch(() => [pageScalaireApiActive.value, profileMode.value, faitsScalairePagePrets.value,
  generationFaitsScalairePage.value, identiteScalairePage.value?.contentVersion,
  identiteScalairePage.value?.referenceContentVersion, identiteScalairePage.value?.descriptorVersion,
  identiteScalairePage.value?.comparisonFacet, theme.value, indicator.value,
  territoirePorte.value, niveauPorte.value, departementPorte.value, epciPorte.value,
  payloadLegacy.value.territoires.length, retryComparaisonScalairePage.value] as const,
async ([active, isProfile, factsReady, _generation, contentVersion, referenceContentVersion, descriptorVersion, comparisonFacet,
  currentTheme, currentIndicator, selectedId, routeLevel, _department, _epci, territoryCount]) => {
  const sequence = ++sequenceComparaisonScalairePage
  comparaisonScalairePage.value = null
  erreurComparaisonScalairePage.value = false
  chargementComparaisonScalairePage.value = false
  if (!active || isProfile || !factsReady || !contentVersion || !referenceContentVersion || !descriptorVersion ||
      !comparisonFacet || !territoryCount ||
      erreurScalaireApi.value || !metadataScalaireApi.value) return
  const pageMetadata = page.value
  if (!pageMetadata || pageMetadata.indicator !== currentIndicator || pageMetadata.family !== 'scalar') return
  const normalized = resoudreEtatUrl({ query: route.query, territoires: payloadLegacy.value.territoires,
    niveauxPublies: pageMetadata.levels, niveauMemorise: niveauMemorise.value })
  const level = normalized.niveau ?? resoudreNiveau(routeLevel, niveauMemorise.value, pageMetadata.levels)
  const dept = level === 'commune' ? normalized.scopeValide?.departement : undefined
  const codeEpci = level === 'commune' ? normalized.scopeValide?.epci : undefined
  const focal = payloadLegacy.value.territoires.find((territory) =>
    territory.territoire === selectedId && territory.type === level) ??
    choisirFocalCohorte(payloadLegacy.value.territoires, level, selectedId,
      level === 'commune' ? { department: dept, epci: codeEpci } : {})
  if (!focal) return
  const label = model.value?.scopeLabel ?? 'Périmètre courant'
  const request = requeteComparaisonPageScalaire(payloadLegacy.value.territoires,
    focal, level, dept, codeEpci, label)
  if (!request) return
  chargementComparaisonScalairePage.value = true
  try {
    const result = await chargerComparaisonsScalaires([currentIndicator], currentTheme as Theme,
      { [currentIndicator]: pageMetadata }, focal, payloadLegacy.value.territoires, request,
      { contentVersion, referenceContentVersion, descriptorVersion, comparisonFacet }, true, catalogueScalaireApi.value)
    if (sequence === sequenceComparaisonScalairePage) comparaisonScalairePage.value = result[currentIndicator] ?? null
  } catch {
    if (sequence === sequenceComparaisonScalairePage) erreurComparaisonScalairePage.value = true
  } finally {
    if (sequence === sequenceComparaisonScalairePage) chargementComparaisonScalairePage.value = false
  }
}, { immediate: true })

watch(() => [profileMode.value, declarationProfil.value?.resource_id, metadataProfilRoute.value?.indicator_pages?.[indicator.value]?.indicator,
  payloadLegacy.value.territoires.length, porte.value.niveau, route.query.departement, route.query.epci,
  payloadLegacy.value.territoires.find((territory) => territory.territoire === porte.value.territoire)?.type === 'region'
    ? porte.value.territoire : null, retryProfileFacts.value] as const,
async ([active, resourceId, pageId, territoryCount, routeLevel, department, epci, selectedRegionId]) => {
  const requestKey = JSON.stringify([active, resourceId, pageId, territoryCount, routeLevel, department, epci, selectedRegionId, retryProfileFacts.value])
  if (active && requestKey === profileFactsRequestKey) return
  profileFactsRequestKey = requestKey
  const sequence = ++profileFactsSequence
  profileFacts.value = []
  profileScalarFacts.value = []
  profileScalarError.value = null
  profileMembers.value = []
  descriptorProfil.value = null
  identityProfil.value = null
  targetProfil.value = null
  liaisonScalaireProfil.value = undefined
  bindingProfil.value = null
  profileFactsError.value = null
  profileComparison.value = null
  profileComparisonTarget.value = null
  profileComparisonError.value = false
  if (!active || !territoryCount || !resourceId || !pageId || !declarationProfil.value || !metadataProfilRoute.value) return

  profileFactsLoading.value = true
  try {
    const page = metadataProfilRoute.value.indicator_pages?.[indicator.value]
    const declaration = declarationProfil.value
    if (!page || page.indicator !== indicator.value) throw new PayloadError('validation', indicator.value, 'La page éditoriale du profil est absente.')
    const levels = page.levels.filter((level) => declaration.allowed_levels.includes(level))
    if (!levels.length) throw new PayloadError('validation', indicator.value, 'La page et le profil API ne partagent aucun niveau publié.')
    const resolved = resoudreEtatUrl({ query: route.query, territoires: payloadLegacy.value.territoires,
      niveauxPublies: levels, niveauMemorise: niveauMemorise.value })
    const selectedRegion = selectedRegionId
      ? payloadLegacy.value.territoires.find((territory) => territory.territoire === selectedRegionId)
      : undefined
    const regionFactsOnly = selectedRegion?.type === 'region' &&
      !estNiveauComparable(route.query[PARAM_NIVEAU]) && levels.includes('region')
    const level = regionFactsOnly ? 'region'
      : resolved.niveau ?? resoudreNiveau(routeLevel, niveauMemorise.value, levels)
    const target: ProfileTarget = {
      type: level,
      department_id: level === 'commune' ? resolved.scopeValide?.departement ?? null : null,
      epci_id: level === 'commune' ? resolved.scopeValide?.epci ?? null : null,
    }
    const result = await chargerCohorteProfilDeclare(declaration, target, payloadLegacy.value.territoires)
    if (sequence !== profileFactsSequence) return
    const linked = result.descriptor.comparison_scalar
      ? catalogueProfil.value.find((candidate) => candidate.resource_id === result.descriptor.comparison_scalar &&
        candidate.indicator_id === result.descriptor.comparison_scalar && candidate.theme_id === theme.value &&
        candidate.shapes.includes('scalar'))
      : undefined
    if (result.descriptor.comparison_scalar && !linked) {
      throw new PayloadError('validation', result.descriptor.comparison_scalar, 'La facette scalaire liée au profil est absente du catalogue API.')
    }
    const binding = adapterPageProfilDeclare(page, declaration, result.descriptor, linked,
      { detail: route.query.detail as string | undefined, sex: route.query.sex as string | undefined })
    descriptorProfil.value = result.descriptor
    identityProfil.value = result.identity
    targetProfil.value = target
    profileMembers.value = result.memberIds
    liaisonScalaireProfil.value = linked
    bindingProfil.value = binding
    profileFacts.value = result.facts
    profileFactsLoading.value = false
  } catch (cause) {
    if (sequence === profileFactsSequence) profileFactsError.value = cause instanceof PayloadError
      ? cause : new PayloadError('fetch', resourceId, 'Impossible de charger le profil déclaré.')
  } finally {
    if (sequence === profileFactsSequence) profileFactsLoading.value = false
  }
}, { immediate: true })
watch(() => [profileMode.value, declarationProfil.value?.resource_id, descriptorProfil.value?.descriptor_version,
  identityProfil.value?.contentVersion, targetProfil.value?.type, porte.value.territoire, profileMembers.value.join('\u0000'),
  retryProfileFacts.value] as const,
async ([active, _resource, descriptorVersion, profileVersion, level, selectedId, members]) => {
  const key = JSON.stringify([active, descriptorVersion, profileVersion, level, selectedId, members, retryProfileFacts.value])
  if (active && key === profileFocalRequestKey) return
  profileFocalRequestKey = key
  const sequence = ++profileFocalSequence
  profileFocalFacts.value = []
  profileFocalError.value = null
  if (!active || !selectedId || !level || !descriptorProfil.value || !identityProfil.value ||
      !declarationProfil.value || profileMembers.value.includes(selectedId)) return
  const territory = payloadLegacy.value.territoires.find((candidate) => candidate.territoire === selectedId && candidate.type === level)
  if (!territory) return
  profileFocalLoading.value = true
  try {
    const facts = await chargerFaitFocalProfilDeclare({ declaration: declarationProfil.value,
      descriptor: descriptorProfil.value, identity: identityProfil.value,
      focal: { type: level, id: selectedId }, territories: payloadLegacy.value.territoires })
    if (sequence === profileFocalSequence) profileFocalFacts.value = facts
  } catch (cause) {
    if (sequence === profileFocalSequence) profileFocalError.value = cause instanceof PayloadError ? cause
      : new PayloadError('fetch', selectedId, 'Impossible de charger les faits natifs du territoire sélectionné.')
  } finally {
    if (sequence === profileFocalSequence) profileFocalLoading.value = false
  }
}, { immediate: true })
watch(() => [profileMode.value, targetProfil.value?.type, targetProfil.value?.department_id,
  targetProfil.value?.epci_id, descriptorProfil.value?.descriptor_version, identityProfil.value?.contentVersion,
  liaisonScalaireProfil.value?.resource_id, retryProfileScalar.value] as const,
async ([active, level, department, epci, descriptorVersion, profileVersion, scalarId]) => {
  const key = JSON.stringify([active, level, department, epci, descriptorVersion, profileVersion, scalarId, retryProfileScalar.value])
  if (active && key === profileScalarRequestKey) return
  profileScalarRequestKey = key
  const sequence = ++profileScalarSequence
  profileScalarFacts.value = []
  profileScalarError.value = null
  if (!active || !targetProfil.value || !descriptorProfil.value || !identityProfil.value ||
      !declarationProfil.value || !liaisonScalaireProfil.value || profileFactsError.value) return
  const target = targetProfil.value
  const descriptor = descriptorProfil.value
  const identity = identityProfil.value
  const profileDeclaration = declarationProfil.value
  const scalarDeclaration = liaisonScalaireProfil.value
  profileScalarLoading.value = true
  try {
    const result = await chargerCohorteScalaireLiee({ profileDeclaration, declaration: scalarDeclaration,
      target, territories: payloadLegacy.value.territoires, profileDescriptor: descriptor, profileIdentity: identity })
    if (sequence !== profileScalarSequence) return
    if (result.contentVersion !== descriptor.required_scalar_version ||
        result.referenceContentVersion !== identity.referenceContentVersion) {
      throw new PayloadError('validation', scalarDeclaration.resource_id, 'La publication scalaire liée ne correspond pas au profil API.')
    }
    profileScalarFacts.value = result.facts
  } catch (cause) {
    if (sequence === profileScalarSequence) profileScalarError.value = cause instanceof PayloadError
      ? cause : new PayloadError('fetch', scalarDeclaration.resource_id, 'Impossible de charger la facette scalaire liée au profil.')
  } finally {
    if (sequence === profileScalarSequence) profileScalarLoading.value = false
  }
}, { immediate: true })
watch(
  () => [payloadLegacy.value.territoires.length, utiliseModeleIndicateur.value] as const,
  ([nombreTerritoires, doitChargerModele]) => {
    if (!doitChargerModele || nombreTerritoires === 0 || modeleIndicateurDemarre) return
    modeleIndicateurDemarre = true
    chargementModeleIndicateur.value = true
    chargerModele(selectedTheme, indicator.value, payloadLegacy.value.territoires).then(
      (modele) => {
        modeleIndicateur.value = modele
        chargementModeleIndicateur.value = false
      },
      (cause: unknown) => {
        erreurModeleIndicateur.value =
          cause instanceof PayloadError
            ? cause
            : new PayloadError('fetch', `modeles-lecture/indicateurs/${selectedTheme}/${indicator.value}.json`, 'Impossible de charger le modèle.')
        chargementModeleIndicateur.value = false
      },
    )
  },
  { immediate: true },
)

const serieLecture = ref<OrderedSeriesRead | null>(null)
const raccordementApiLecture = ref<RaccordementSemanticProjection | null>(null)
const raccordementComparaisonChargement = ref(false)
const raccordementComparaisonErreur = ref(false)
const raccordementThemeCache = new ThemeAcquisitionCache(
  (selectedTheme, key) => {
    if (!key) throw new Error('Cible requise pour l’acquisition sémantique Mobilité')
    return acquireThemeFacts(key.type, key.id, selectedTheme)
  },
  (selection, selectedTheme, key) => {
    if (!key) throw new Error('Cible requise pour la comparaison sémantique Mobilité')
    return acquireThemeComparison(key.type, key.id, selectedTheme, selection)
  },
)
const raccordementSource = computed(() => {
  const point = raccordementApiLecture.value?.metadata.points[0]
  if (!point || typeof point !== 'object') return null
  const provenance = (point as { provenance?: unknown }).provenance
  if (!Array.isArray(provenance) || !provenance[0] || typeof provenance[0] !== 'object') return null
  return provenance[0] as { source_name?: string; version?: string; reference_date?: string; publication_date?: string }
})
const serieErreur = ref(false)
const serieChargement = ref(false)
let serieRequete = 0
let serieRequestKey: string | null = null
let raccordementFocalKey: string | null = null
const niveauSerie = computed<TerritoireType>(() => {
  const levels = metadataSeriesApi.value?.indicator_pages?.[indicator.value]?.levels ??
    payloadLegacy.value.themeMetadata?.[theme.value as keyof typeof payloadLegacy.value.themeMetadata]
      ?.indicator_pages?.[indicator.value]?.levels ?? ['commune']
  const selected = payloadLegacy.value.territoires.find((territory) => territory.territoire === porte.value.territoire &&
    (orderedSeriesAdapter.value?.indicator === 'raccordement_courbe' || !porte.value.niveau ||
      territory.type === porte.value.niveau))
  // The handoff contract intentionally carries a region without `niveau`.
  // Preserve that owner-declared focal level for this native trajectory only;
  // region remains outside the shared data-first comparison-level selector.
  if (orderedSeriesAdapter.value?.indicator === 'raccordement_courbe' && selected?.type === 'region' &&
      levels.includes('region')) return 'region'
  return resoudreNiveau(porte.value.niveau, niveauMemorise.value, levels)
})
async function chargerSerie(force = false) {
  const adapter = orderedSeriesAdapter.value
  if (!adapter || !payloadLegacy.value.territoires.length) return
  const scope = resoudreEtatUrl({ query: route.query, territoires: payloadLegacy.value.territoires,
    niveauxPublies: metadataSeriesApi.value?.indicator_pages?.[indicator.value]?.levels ??
      payloadLegacy.value.themeMetadata?.[theme.value as keyof typeof payloadLegacy.value.themeMetadata]?.indicator_pages?.[indicator.value]?.levels,
    niveauMemorise: niveauMemorise.value }).scopeValide
  const department = scope?.departement
  const epci = scope?.epci
  const scopeTerritories = payloadLegacy.value.territoires.filter((territory) => territory.type === niveauSerie.value &&
    (niveauSerie.value !== 'commune' || ((!department || territory.departement === department) &&
      (!epci || territory.epci === epci))))
  const focal = payloadLegacy.value.territoires.find((territory) => territory.territoire === porte.value.territoire &&
    territory.type === niveauSerie.value) ?? scopeTerritories[0]
  if (!focal) { serieErreur.value = false; serieLecture.value = null; return }
  const url = JSON.stringify([adapter.indicator, niveauSerie.value, focal.territoire, department ?? null, epci ?? null])
  const selectedIds = adapter.indicator === 'raccordement_courbe' && niveauSerie.value === 'commune' && (department || epci)
    ? scopeTerritories.filter((territory) => territory.type === 'commune')
      .map((territory) => ({ territory_type: 'commune' as const, territory_id: territory.territoire }))
    : undefined
  const raccordement = adapter.indicator === 'raccordement_courbe'
  const requestKey = raccordement
    ? JSON.stringify([focal.type, focal.territoire, cleSelectionComparaison(selectedIds)]) : url
  if (!force && requestKey === serieRequestKey && (serieChargement.value || serieErreur.value || serieLecture.value ||
      raccordementApiLecture.value?.comparison || raccordementComparaisonChargement.value || raccordementComparaisonErreur.value)) return
  const request = ++serieRequete
  serieRequestKey = requestKey
  const focalKey = JSON.stringify([focal.type, focal.territoire])
  const retainedFocal = raccordement && raccordementFocalKey === focalKey && raccordementApiLecture.value !== null
  if (raccordement && force) {
    if (retainedFocal) raccordementThemeCache.invalidateComparison(focal.type, focal.territoire, 'mobilite', selectedIds)
    else raccordementThemeCache.invalidate(focal.type, focal.territoire, 'mobilite')
  }
  if (raccordement && !retainedFocal) {
    raccordementFocalKey = focalKey
    raccordementApiLecture.value = null
  } else if (raccordement && raccordementApiLecture.value) {
    // A changed selection invalidates only the prior aggregate/rank. The focal
    // curve and its independently owned named reference remain current.
    raccordementApiLecture.value = { ...raccordementApiLecture.value, comparison: null }
  }
  serieChargement.value = !retainedFocal
  serieErreur.value = false
  if (raccordement) {
    raccordementComparaisonChargement.value = true
    raccordementComparaisonErreur.value = false
  }
  serieLecture.value = null
  if (!raccordement) raccordementApiLecture.value = null
  try {
    if (raccordement) {
      const acquired = await raccordementThemeCache.get(focal.type, focal.territoire, 'mobilite')
      if (request !== serieRequete) return
      const projectedFocal = projectRaccordementSemanticFocal(acquired.focal, focal)
      const selectionKey = cleSelectionComparaison(selectedIds)
      raccordementApiLecture.value = { ...projectedFocal, comparison: null }
      serieChargement.value = false

      const cachedComparison = acquired.comparisons.get(selectionKey)
      if (cachedComparison && !cachedComparison.cohort_error) {
        const comparison = projectRaccordementSemanticComparison(acquired.focal, cachedComparison,
          focal, selectedIds)
        if (request === serieRequete) raccordementApiLecture.value = { ...projectedFocal, comparison }
        return
      }

      const compared = await raccordementThemeCache.select(focal.type, focal.territoire, 'mobilite', selectedIds)
      if (request !== serieRequete) return
      const comparisonResponse = compared.comparisons.get(selectionKey)
      if (!comparisonResponse || comparisonResponse.cohort_error) throw new Error('Comparaison native du raccordement absente')
      const comparison = projectRaccordementSemanticComparison(compared.focal, comparisonResponse,
        focal, selectedIds)
      raccordementApiLecture.value = { ...projectedFocal, comparison }
      return
    }
    const result = await acquireOrderedSeriesSemantic({ resource: adapter.indicator,
      level: niveauSerie.value, focal, territories: payloadLegacy.value.territoires,
      includeScalarFacet: seriesHasScalarFacet.value,
      ...(department ? { departmentId: department } : {}), ...(epci ? { epciId: epci } : {}) })
    if (result.indicator_id !== adapter.indicator || !Array.isArray(result.points) ||
      !Array.isArray(result.scope_series)) throw new Error('Invalid ordered-series response')
    if (request === serieRequete) serieLecture.value = result
  } catch {
    if (request === serieRequete) {
      if (raccordement && raccordementApiLecture.value && raccordementFocalKey === focalKey) {
        raccordementComparaisonErreur.value = true
      } else {
        serieErreur.value = true
      }
    }
  } finally {
    if (request === serieRequete) {
      serieChargement.value = false
      if (raccordement) raccordementComparaisonChargement.value = false
    }
  }
}
const pageProfilCourante = computed(() => {
  const rawPage = metadataProfilRoute.value?.indicator_pages?.[indicator.value]
  const declaration = declarationProfil.value
  const descriptor = descriptorProfil.value
  if (!profileMode.value || !rawPage || !declaration || !descriptor) return null
  return adapterPageProfilDeclare(rawPage, declaration, descriptor, liaisonScalaireProfil.value,
    { detail: typeof route.query.detail === 'string' ? route.query.detail : undefined,
      sex: typeof route.query.sex === 'string' ? route.query.sex : undefined }).page
})
const metadataProfilAdaptee = computed(() => {
  const source = metadataProfilRoute.value
  const boundPage = pageProfilCourante.value
  const descriptor = descriptorProfil.value
  if (!source || !boundPage || !descriptor) return null
  return { ...source,
    indicator_pages: { ...source.indicator_pages, [indicator.value]: boundPage },
    detail_labels: { ...source.detail_labels, [indicator.value]: Object.fromEntries(
      descriptor.axes.filter((axis) => axis.name === 'detail').map((axis) => [axis.key, axis.label])) },
  }
})
const payload = computed<Payload>(() => {
  const baseInitial = modeleIndicateur.value
    ? payloadDepuisModeleIndicateur(modeleIndicateur.value, payloadLegacy.value.territoires)
    : payloadLegacy.value
  const metadataBound = profileMode.value && metadataProfilAdaptee.value
    ? { ...baseInitial.themeMetadata, [theme.value]: metadataProfilAdaptee.value }
    : seriesPageApiActive.value && metadataSeriesApi.value
      ? { ...baseInitial.themeMetadata, [theme.value]: metadataSeriesApi.value }
    : scalaireApi.value && metadataScalaireApi.value
      ? { ...baseInitial.themeMetadata, [theme.value]: metadataScalaireApi.value }
      : baseInitial.themeMetadata
  const base = { ...baseInitial, themeMetadata: metadataBound }
  if (profileMode.value) {
    const profileIds = new Set([indicator.value, descriptorProfil.value?.comparison_scalar].filter((id): id is string => Boolean(id)))
    const indicators = base.indicateurs.filter((fact) => !(fact.theme === theme.value && profileIds.has(fact.key)))
    return { ...base, indicateurs: [...indicators, ...profileFacts.value, ...profileFocalFacts.value, ...profileScalarFacts.value] }
  }
  if (scalaireApi.value) {
    return { ...base, indicateurs: [...base.indicateurs.filter((fact) => !(fact.theme === theme.value && fact.key === indicator.value)), ...faitsScalaireApi.value] }
  }
  const adapter = orderedSeriesAdapter.value
  if (!adapter) return base
  if (adapter.indicator === 'raccordement_courbe' && !raccordementApiLecture.value) {
    return { ...base, indicateurs: base.indicateurs.filter((fact) => fact.key !== 'raccordement_courbe' &&
      fact.key !== 'raccordement_reference' && fact.key !== 'raccordement_tc') }
  }
  if (adapter.indicator === 'raccordement_courbe' && raccordementApiLecture.value) {
    const read = raccordementApiLecture.value
    const page = base.themeMetadata?.mobilite?.indicator_pages?.raccordement_courbe
    if (!page || page.family !== 'trajectory') return base
    const namedReference = read.metadata.named_references[0]
    const trajectory = page.trajectory
    const updatedPage: Extract<IndicatorPageMetadata, { family: 'trajectory' }> = { ...page,
      label: read.metadata.label, unit: read.metadata.unit, direction: read.metadata.direction,
      comparison: { ...page.comparison, details: read.metadata.axis_values },
      trajectory: { ...trajectory, endpoints: [read.metadata.axis_values[0]!, read.metadata.axis_values.at(-1)!],
        ...(trajectory.reference && namedReference && typeof namedReference.id === 'string' && typeof namedReference.label === 'string'
          ? { reference: { ...trajectory.reference, territoire: namedReference.id, label: namedReference.label } } : {}) },
    }
    const themeMetadata = base.themeMetadata?.mobilite
    const indicators = base.indicateurs.filter((fact) => fact.key !== 'raccordement_courbe' &&
      fact.key !== 'raccordement_reference' && fact.key !== 'raccordement_tc')
    return { ...base, themeMetadata: themeMetadata ? { ...base.themeMetadata, mobilite: {
      ...themeMetadata, indicator_pages: { ...themeMetadata.indicator_pages, raccordement_courbe: updatedPage },
    } } : base.themeMetadata, indicateurs: [...indicators, ...read.facts] } as Payload
  }
  const page = metadataSeriesApi.value?.indicator_pages?.[adapter.indicator] ??
    base.themeMetadata?.[adapter.theme]?.indicator_pages?.[adapter.indicator]
  const axisFacet = page?.comparison?.dimensions !== undefined || page?.comparison?.dimension !== undefined
    ? 'dimension' as const : 'detail' as const
  const apiFacts = serieLecture.value && page
    ? orderedSeriesFacts(serieLecture.value, adapter.theme, base.territoires, axisFacet)
    : []
  return { ...base, indicateurs: [...base.indicateurs.filter((fact) => !(fact.theme === adapter.theme && fact.key === adapter.indicator)), ...apiFacts] }
})
const erreur = computed(() => {
  if (profileBootstrapError.value) return profileBootstrapError.value
  if (profileMode.value) return profileFactsError.value ?? profileFocalError.value ?? erreurLegacy.value
  if (erreurManifesteModeles.value) return erreurManifesteModeles.value
  if (pageScalaireApiActive.value || (!profileMode.value && scalaireApiOptionnelle.value &&
      (!metadataScalaireApi.value || scalaireApi.value))) return erreurScalaireApi.value
  return utiliseModeleIndicateur.value ? erreurModeleIndicateur.value : erreurLegacy.value
})
const chargement = computed(() =>
  profileBootstrapLoading.value ||
  chargementManifesteModeles.value ||
  (profileMode.value && (profileFactsLoading.value || profileFocalLoading.value)) ||
  (!profileMode.value && (pageScalaireApiActive.value || scalaireApiOptionnelle.value) && chargementScalaireApi.value) ||
  (utiliseModeleIndicateur.value
    ? chargementLegacy.value || chargementModeleIndicateur.value
    : chargementLegacy.value),
)
const geometrie = useGeometrie()
const metadata = computed(() => payload.value.themeMetadata?.[theme.value as keyof typeof payload.value.themeMetadata])
const page = computed(() => {
  const editorial = profileMode.value ? pageProfilCourante.value ?? undefined : metadata.value?.indicator_pages?.[indicator.value]
  const read = seriesPageApiActive.value && orderedSeriesAdapter.value?.indicator === indicator.value
    ? serieLecture.value : null
  const descriptor = read?.native_descriptor
  const comparisonAxes = read?.comparison?.axis_comparisons?.map((row) => row.axis)
  if (editorial && descriptor && comparisonAxes?.length) {
    const dimensionFacet = editorial.comparison?.dimensions !== undefined || editorial.comparison?.dimension !== undefined
    const permitted = dimensionFacet ? { dimensions: comparisonAxes,
      dimension: comparisonAxes.includes(editorial.comparison?.dimension ?? '')
        ? editorial.comparison?.dimension : comparisonAxes.at(-1) }
      : { details: comparisonAxes,
        detail: comparisonAxes.includes(editorial.comparison?.detail ?? '')
          ? editorial.comparison?.detail : comparisonAxes.at(-1) }
    return { ...editorial, label: descriptor.label, unit: descriptor.unit,
      direction: descriptor.direction === 'none' ? editorial.direction : descriptor.direction,
      comparison: { ...editorial.comparison, ...permitted, unit: descriptor.unit,
        direction: descriptor.direction === 'none' ? editorial.comparison?.direction : descriptor.direction } }
  }
  const native = contratScalairePageNatif.value
  if (!editorial || !pageScalaireApiActive.value || !native) return editorial
  const direction = native.direction === 'low' ? 'low' : native.direction === 'high' ? 'high' : editorial.direction
  const unit = native.unit ?? editorial.unit
  return { ...editorial, unit, direction,
    ...(editorial.comparison ? { comparison: { ...editorial.comparison,
      ...(native.comparisonFacet ? { indicator: native.comparisonFacet } : {}), unit, direction } } : {}) }
})
const familyDispatch = computed(() => page.value ? dispatchIndicatorFamily(page.value, { theme: theme.value as Theme, facts: facts.value, territories: payload.value.territoires, selected: porte.value.territoire, facet: route.query, labelsDetail: metadata.value?.detail_labels[indicator.value] }) : null)
const profileRegionalFactOnly = computed(() => profileMode.value && targetProfil.value?.type === 'region' &&
  payload.value.territoires.some((territory) => territory.type === 'region' && territory.territoire === porte.value.territoire))
const profileEmptyCohort = computed(() => profileMode.value && Boolean(targetProfil.value) &&
  profileMembers.value.length === 0 && !profileFactsLoading.value && !profileFactsError.value)
watch(() => [profileMode.value, declarationProfil.value?.resource_id, descriptorProfil.value?.descriptor_version,
  identityProfil.value?.contentVersion, profileMembers.value.join('\u0000'), targetProfil.value?.type, porte.value.territoire,
  familyDispatch.value?.facet.detail, familyDispatch.value?.facet.sex, retryProfileComparison.value,
  profileFactsError.value?.file, profileFocalError.value?.file] as const,
async ([active, resourceId, descriptorVersion, contentVersion, _members, targetType, selectedId]) => {
  const descriptor = descriptorProfil.value
  const identity = identityProfil.value
  const declaration = declarationProfil.value
  const memberIds = profileMembers.value
  const facet = familyDispatch.value?.facet
  const coordinate = descriptor?.comparison_scalar ? null : descriptor?.comparison_point && facet
    ? { detail: facet.detail ?? descriptor.comparison_point.detail,
        sex: facet.sex ?? descriptor.comparison_point.sex }
    : null
  const key = JSON.stringify([active, resourceId, descriptorVersion, contentVersion, memberIds,
    targetType, selectedId, coordinate, retryProfileComparison.value, profileFactsError.value?.file])
  if (active && key === profileComparisonRequestKey) return
  profileComparisonRequestKey = key
  const sequence = ++profileComparisonSequence
  profileComparison.value = null
  profileComparisonTarget.value = null
  profileComparisonError.value = false
  profileComparisonLoading.value = false
  if (!active || !descriptor || !identity || !declaration || !facet || profileFactsError.value || profileFocalError.value || targetType === 'region') return
  if (!memberIds.length) return // An explicit empty cohort remains empty; never substitute a broader group.
  const focalTerritory = selectedId
    ? payloadLegacy.value.territoires.find((territory) => territory.territoire === selectedId && territory.type === targetProfil.value?.type)
    : undefined
  if (selectedId && !focalTerritory) return
  const focalId = selectedId ?? memberIds[0]!
  const comparisonDeclaration = descriptor.comparison_scalar ? liaisonScalaireProfil.value : undefined
  if (descriptor.comparison_scalar && !comparisonDeclaration) {
    profileComparisonError.value = true
    return
  }
  profileComparisonTarget.value = focalId
  profileComparisonLoading.value = true
  try {
    const result = await chargerComparaisonProfilDeclare({ declaration, descriptor, identity,
      focal: { type: profileFacts.value[0]?.type ??
        targetProfil.value?.type ?? (resoudreNiveau(porte.value.niveau, niveauMemorise.value, facet.levels) as TerritoireType), id: focalId },
      memberIds, coordinate, scalarDeclaration: comparisonDeclaration })
    if (sequence === profileComparisonSequence) profileComparison.value = result
  } catch {
    if (sequence === profileComparisonSequence) profileComparisonError.value = true
  } finally {
    if (sequence === profileComparisonSequence) profileComparisonLoading.value = false
  }
}, { immediate: true })
/** Le millésime API d'une carte source : les faits natifs, jamais une horloge inventée (#732). */
const vintageApi = (source: { vintageId?: string; version: string; referenceDate: string | null;
  publicationDate: string | null; lineage?: Record<string, unknown> }, licence: string | null): SourceVintageRecord => {
  const hash = source.lineage?.hash ?? source.lineage?.revision_hash
  return {
    id: source.vintageId ?? source.version, label: source.vintageId ?? source.version, version: source.version,
    licence, dateReference: source.referenceDate, datePublication: source.publicationDate,
    ...(typeof hash === 'string' ? { revisionHash: hash } : {}),
  }
}

const sources = computed(() => {
  if (!page.value || !payload.value) return []
  const authority = sourceRecords(payload.value)
  if (profileMode.value) {
    const native = [...profileFacts.value, ...profileFocalFacts.value, ...profileScalarFacts.value].flatMap((fact) => fact.fact_sources ?? [])
    for (const source of profileComparison.value?.comparisonSources ?? []) {
      native.push({ sourceId: source.sourceId, source: source.name, version: source.version,
        vintageId: source.vintageId, referenceDate: source.referenceDate, publicationDate: source.publicationDate })
    }
    const sourceIds = [...new Set([...page.value.sources, ...native.map((source) => source.sourceId)])]
    return sourceIds.map((id) => {
      const vintages = [...new Map(native.filter((source) => source.sourceId === id)
        .map((source) => [`${source.sourceId}\u0000${source.vintageId ?? source.version}`, source])).values()]
      if (!vintages.length) return null
      const existing = authority.find((record) => record.id === id || datasetDeSource(record.id) === datasetDeSource(id))
      const ficheRecord = authority.find((record) => record.id === datasetDeSource(id))
      const apiVintages: SourceVintageRecord[] = vintages.map((source) => vintageApi(source, existing?.licence ?? null))
      const representative = vintages.length === 1 ? vintages[0] : null
      return {
        id, dataset: representative?.source ?? vintages[0]!.source,
        publisher: existing?.publisher ?? representative?.source ?? vintages[0]!.source,
        url: existing?.url ?? null, licence: existing?.licence ?? null,
        vintage: representative?.version ?? 'Plusieurs millésimes',
        freshness: representative?.publicationDate ?? '—',
        sha256: existing?.sha256 ?? null, dateReference: representative?.referenceDate ?? null,
        datePublication: representative?.publicationDate ?? null, vintages: apiVintages,
        clocks: existing?.clocks ?? [], caveat: existing?.caveat ?? null,
        methodology: existing?.methodology, consumers: existing?.consumers ?? [],
        replie: existing?.replie ?? false, themes: existing?.themes ?? [theme.value as Theme],
        ficheSourceLiee: Boolean(ficheRecord), ancreSourceId: datasetDeSource(id),
      }
    }).filter((source): source is NonNullable<typeof source> => source !== null)
  }
  if (pageScalaireApiActive.value) {
    const native = [
      ...faitsScalaireApi.value.flatMap((fact) => fact.fact_sources ?? []),
      ...(comparaisonScalairePage.value?.comparisonSources ?? []).map((source) => ({
        sourceId: source.sourceId, source: source.name, version: source.version,
        vintageId: source.vintageId, referenceDate: source.referenceDate, publicationDate: source.publicationDate,
      })),
    ]
    const sourceIds = [...new Set([...page.value.sources, ...native.map((source) => source.sourceId)])]
    return sourceIds.map((id) => {
      const vintages = [...new Map(native.filter((source) => source.sourceId === id)
        .map((source) => [`${source.sourceId}\u0000${source.vintageId ?? source.version}`, source])).values()]
      if (!vintages.length) return null
      const existing = authority.find((record) => record.id === id)
      const ficheRecord = authority.find((record) => record.id === datasetDeSource(id))
      const apiVintages: SourceVintageRecord[] = vintages.map((source) => vintageApi(source, existing?.licence ?? null))
      const representative = vintages.length === 1 ? vintages[0] : null
      return {
        id, dataset: representative?.source ?? vintages[0]!.source,
        publisher: existing?.publisher ?? representative?.source ?? vintages[0]!.source,
        url: existing?.url ?? null, licence: existing?.licence ?? null,
        vintage: representative?.version ?? 'Plusieurs millésimes',
        freshness: representative?.publicationDate ?? '—',
        sha256: null, dateReference: representative?.referenceDate ?? null,
        datePublication: representative?.publicationDate ?? null, vintages: apiVintages,
        clocks: [], caveat: existing?.caveat ?? null,
        methodology: existing?.methodology, consumers: existing?.consumers ?? [],
        replie: existing?.replie ?? false, themes: existing?.themes ?? [theme.value as Theme],
        ficheSourceLiee: Boolean(ficheRecord), ancreSourceId: datasetDeSource(id),
      }
    }).filter((source): source is NonNullable<typeof source> => source !== null)
  }
  if (raccordementApiActive.value && !raccordementApiLecture.value) return []
  if ((seriesPageApiActive.value && orderedSeriesAdapter.value && serieLecture.value) ||
      (raccordementApiActive.value && raccordementApiLecture.value)) {
    const nativeFacts = raccordementApiActive.value && raccordementApiLecture.value
      ? raccordementApiLecture.value.facts
      : orderedSeriesFacts(serieLecture.value!, theme.value as Theme, payload.value.territoires)
    const native = nativeFacts.flatMap((fact) => fact.fact_sources ?? [])
    return [...new Set(native.map((source) => source.sourceId))].map((id) => {
      const vintages = [...new Map(native.filter((source) => source.sourceId === id)
        .map((source) => [`${source.sourceId}\u0000${source.vintageId ?? source.version}\u0000${String(source.lineage?.hash ?? '')}`, source])).values()]
      if (!vintages.length) return null
      const existing = authority.find((record) => record.id === id)
      const ficheRecord = authority.find((record) => record.id === datasetDeSource(id))
      const apiVintages: SourceVintageRecord[] = vintages.map((source) => vintageApi(source, existing?.licence ?? null))
      const representative = vintages.length === 1 ? vintages[0] : null
      return { id, dataset: representative?.source ?? vintages[0]!.source,
        publisher: existing?.publisher ?? representative?.source ?? vintages[0]!.source,
        url: existing?.url ?? null, licence: existing?.licence ?? null,
        vintage: representative?.version ?? 'Plusieurs millésimes',
        freshness: representative?.publicationDate ?? '—', sha256: null,
        dateReference: representative?.referenceDate ?? null,
        datePublication: representative?.publicationDate ?? null, vintages: apiVintages, clocks: [],
        caveat: existing?.caveat ?? null, methodology: existing?.methodology,
        consumers: existing?.consumers ?? [], replie: existing?.replie ?? false,
        themes: existing?.themes ?? [theme.value as Theme],
        ficheSourceLiee: Boolean(ficheRecord), ancreSourceId: datasetDeSource(id) }
    }).filter((source): source is NonNullable<typeof source> => source !== null)
  }
  return page.value.sources.map((id) => authority.find((record) => record.id === datasetDeSource(id)))
    .filter((source): source is NonNullable<typeof source> => Boolean(source))
    .map((source) => ({ ...source, ficheSourceLiee: true, ancreSourceId: source.id }))
})
/**
 * Some source versions describe a planned service day while their reference
 * date records acquisition. Keep those clocks distinct in the page copy; do
 * not infer the service day from the publication/freshness date.
 */
const horlogeService = computed(() => {
  for (const source of sources.value) {
    const clock = source.clocks.find((candidate) => candidate.reference.includes('mercredi réel de période scolaire'))
    const serviceDate = clock?.reference.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0]
    const acquisitionDate = serviceDate
      ? source.vintages.find((vintage) => vintage.version === serviceDate)?.dateReference ?? null
      : null
    if (serviceDate && acquisitionDate) return { service: dateLongue(serviceDate), acquisition: dateLongue(acquisitionDate, false) }
  }
  return null
})
// Les faits du THÈME entier — chaque consommateur filtre par SA clé (la
// facette résumée d'une distribution lit souvent une AUTRE clé publiée que
// la page, #440 ; les trajectoires et le modèle par détail filtrent déjà).
const facts = computed(() => payload.value.indicateurs.filter((f) => f.theme === theme.value))
// La machine à états URL (#508) — résolution pure de la cascade de niveaux
// et validation du périmètre. Le composant ne fait que lui fournir la query,
// les territoires publiés, les niveaux de la facette et la mémoire lue à la
// couture ; ses watchers ci-dessous n'en appliquent que le résultat.
const etatUrl = computed(() => resoudreEtatUrl({ query: route.query, territoires: payload.value.territoires, niveauxPublies: familyDispatch.value?.facet.levels, niveauMemorise: niveauMemorise.value }))
watch(() => [orderedSeriesAdapter.value?.indicator, porte.value.territoire, porte.value.niveau,
  route.query.departement, route.query.epci, niveauMemorise.value, payloadLegacy.value.territoires.length,
  payloadLegacy.value.themeMetadata?.[theme.value as keyof typeof payloadLegacy.value.themeMetadata]?.indicator_pages?.[indicator.value]?.indicator] as const,
  () => { void chargerSerie() }, { immediate: true })
const niveauRoute = computed(() => porte.value.niveau)
const requested = computed(() => ({ niveau: niveauRoute.value, ...(etatUrl.value.scopeValide ?? {}), territoire: porte.value.territoire, recherche: recherche.value, tri: ['nom', 'valeur', 'rang'].includes(String(route.query.tri)) ? route.query.tri as TriExploration : undefined, ordre: route.query.ordre === 'desc' ? 'desc' as OrdreExploration : 'asc' as OrdreExploration }))
const model = computed(() => {
  const dispatch = familyDispatch.value
  if (!dispatch) return null
  const calculated = modeleExploration(facts.value, dispatch.facet, payload.value.territoires,
    requested.value, niveauMemorise.value, profileMode.value || pageScalaireApiActive.value)
  if (pageScalaireApiActive.value) {
    const evidence = comparaisonScalairePage.value
    const state = calculated.state
    const selectedFocal = payload.value.territoires.find((territory) =>
      territory.type === state.niveau && territory.territoire === state.territoire) ??
      choisirFocalCohorte(payload.value.territoires, state.niveau, state.territoire,
        state.niveau === 'commune' ? { department: state.departement, epci: state.epci } : {})
    const request = selectedFocal ? requeteComparaisonPageScalaire(payload.value.territoires,
      selectedFocal, state.niveau, state.departement, state.epci, calculated.scopeLabel) : null
    const expectedMembers = request ? membresComparaisonPageScalaire(payload.value.territoires, request) : []
    const ranks = new Map((evidence?.memberRanks ?? []).map((item) => [item.territoryId, item]))
    const rankedMembers = evidence?.memberRanks.filter((item) => item.rank !== null).length ?? 0
    const comparisonMatchesScope = Boolean(evidence && evidence.selectedMemberCount === expectedMembers.length &&
      evidence.memberRanks.length === expectedMembers.length &&
      expectedMembers.every((member) => ranks.has(member.territoire)) &&
      rankedMembers === (evidence.eligibleCount >= 1 ? evidence.eligibleCount : 0))
    let rows = calculated.rows.map((row) => ({ ...row,
      rang: comparisonMatchesScope ? ranks.get(row.territoire.territoire)?.rank ?? null : null,
      rangTaille: comparisonMatchesScope ? ranks.get(row.territoire.territoire)?.rankSize ?? null : null,
    }))
    if (requested.value.tri === 'rang') {
      const factor = requested.value.ordre === 'desc' ? -1 : 1
      rows = [...rows].sort((left, right) => {
        if (left.rang === null) return right.rang === null ? 0 : 1
        if (right.rang === null) return -1
        return factor * (left.rang - right.rang)
      })
    }
    return { ...calculated, median: comparisonMatchesScope && evidence?.status === 'available' ? evidence.median : null, rows }
  }
  if (!profileMode.value) return calculated
  const regionOnly = profileRegionalFactOnly.value
  const selectedId = porte.value.territoire
  const comparisonRanks = new Map((profileComparison.value?.memberRanks ?? []).map((item) => [item.territoryId, item]))
  const completeComparisonRows = requested.value.recherche
    ? modeleExploration(facts.value, dispatch.facet, payload.value.territoires,
      { ...requested.value, recherche: undefined, tri: 'nom', ordre: 'asc' }, niveauMemorise.value, true).rows
    : calculated.rows
  const eligibleIds = new Set(completeComparisonRows.map((row) => row.territoire.territoire))
  const rankedIds = new Set([...comparisonRanks.values()].filter((item) => item.rank !== null).map((item) => item.territoryId))
  const focalRank = selectedId ? comparisonRanks.get(selectedId) : undefined
  const comparisonRanksMatchFacts = Boolean(profileComparison.value &&
    profileComparison.value.selectedMemberCount === profileMembers.value.length &&
    profileComparison.value.eligibleCount === eligibleIds.size &&
    profileComparison.value.memberRanks.length === profileMembers.value.length &&
    eligibleIds.size === rankedIds.size && [...eligibleIds].every((id) => rankedIds.has(id)) &&
    profileComparison.value.memberRanks.every((item) => item.rank === null || item.rankSize === profileComparison.value?.eligibleCount) &&
    (!profileComparison.value.focalInSelection || !selectedId ||
      (focalRank?.rank === profileComparison.value.rank && focalRank.rankSize === profileComparison.value.rankSize &&
        focalRank.rankTies === profileComparison.value.rankTies)))
  let profileRows = regionOnly ? [] : calculated.rows.map((row) => ({ ...row,
    rang: comparisonRanksMatchFacts ? comparisonRanks.get(row.territoire.territoire)?.rank ?? null : null,
    rangTaille: comparisonRanksMatchFacts ? comparisonRanks.get(row.territoire.territoire)?.rankSize ?? null : null,
  }))
  if (requested.value.tri === 'rang') {
    const factor = requested.value.ordre === 'desc' ? -1 : 1
    profileRows = [...profileRows].sort((left, right) => {
      if (left.rang === null) return right.rang === null ? 0 : 1
      if (right.rang === null) return -1
      return factor * (left.rang - right.rang)
    })
  }
  return {
    ...calculated,
    state: regionOnly ? { ...calculated.state, niveau: 'region' } as unknown as typeof calculated.state : calculated.state,
    median: regionOnly ? null : profileComparison.value?.status === 'available' ? profileComparison.value.median : null,
    rows: profileRows,
    distribution: regionOnly ? [] : calculated.distribution,
    density: regionOnly ? [] : calculated.density,
    high: regionOnly ? { count: 0, rows: [] } : calculated.high,
    low: regionOnly ? { count: 0, rows: [] } : calculated.low,
    scopeLabel: regionOnly ? 'Région Bretagne — faits publiés, sans comparaison' : calculated.scopeLabel,
    markerX: regionOnly ? null : calculated.markerX,
    markerY: regionOnly ? null : calculated.markerY,
  }
})
const raccordementComparisonScopeLabel = computed(() => {
  const comparison = raccordementApiLecture.value?.comparison
  if (!comparison?.scope) return null
  const target = payload.value.territoires.find((territory) =>
    territory.territoire === raccordementApiLecture.value?.metadata.territory.id &&
    territory.type === raccordementApiLecture.value?.metadata.territory.type)
  if (!target) return null
  if (comparison.scope.kind === 'explicit_selection') return model.value?.scopeLabel ?? 'Sélection de territoires'
  if (comparison.scope.kind === 'density_class') {
    return comparison.scope.density_class_code === target.classe_densite_code
      ? target.classe_densite_libelle_public ?? null : null
  }
  return semanticComparisonScopeLabel(comparison.scope, target.type)
})
// Le chemin complet de la trajectoire (#438), dans le MÊME périmètre résolu
// que le modèle par détail — le détail (actif) pilote carte/extrêmes/tableau
// sans replier la trajectoire.
const trajectoire = computed(() => {
  const dispatch = familyDispatch.value
  if (!dispatch || dispatch.family !== 'trajectory' || !model.value) return null
  const { niveau, departement, epci, territoire } = model.value.state
  const niveauTrajectoire: TerritoireType = indicator.value === 'raccordement_courbe' &&
    raccordementApiLecture.value?.metadata.territory.type === 'region' ? 'region' : niveau
  const territoireTrajectoire = niveauTrajectoire === 'region'
    ? raccordementApiLecture.value?.metadata.territory.id ?? territoire : territoire
  const referenceFacts = indicator.value === 'raccordement_courbe' && raccordementApiLecture.value
    ? raccordementApiLecture.value.referenceFacts
    : dispatch.representation.reference
  const trajectoryModel = modeleTrajectoire(
    facts.value,
    dispatch.facet,
    dispatch.representation.endpoints,
    payload.value.territoires,
    { niveau: niveauTrajectoire, departement, epci, territoire: territoireTrajectoire },
    referenceFacts,
    dispatch.representation.extension.reference?.label ?? null,
    { axis: dispatch.representation.extension.axis, labelsDetail: dispatch.representation.labelsDetail,
      nativeSeries: seriesPageApiActive.value,
      nativeAxisComparisons: seriesPageApiActive.value
        ? serieLecture.value?.comparison?.axis_comparisons?.map((row) => ({ axis: row.axis,
          statistic: row.statistic, status: row.status, value: row.value, min: row.min,
          max: row.max, eligible_count: row.eligible_count, missing_count: row.missing_count }))
        : undefined },
  )
  if (indicator.value !== 'raccordement_courbe' || !raccordementApiLecture.value) return trajectoryModel
  const comparison = raccordementApiLecture.value.comparison
  if (!comparison || comparison.status !== 'available') return { ...trajectoryModel,
    hideCohortDistribution: true, serieComparaison: [], comparaisonScopeLabel: null,
    comparaisonStatistic: null, comparaisonMemberCount: null }
  const byDetail = new Map(trajectoryModel.etapes.map((step) => [step.detail, step] as const))
  return { ...trajectoryModel,
    hideCohortDistribution: true,
    serieComparaison: comparison.points.map((point) => ({ detail: point.detail,
      label: byDetail.get(point.detail)?.label ?? point.detail,
      x: byDetail.get(point.detail)?.x ?? 0, value: point.value })),
    comparaisonScopeLabel: raccordementComparisonScopeLabel.value,
    comparaisonStatistic: comparison.statistic,
    comparaisonMemberCount: comparison.selectedMemberCount,
  }
})
// La signature intra-territoire de la distribution (#440), dans le MÊME
// périmètre résolu que la comparaison — les libellés canonical viennent des
// métadonnées du thème (payload-owned, jamais codés en dur).
const distribution = computed(() => {
  if (!familyDispatch.value || familyDispatch.value.family !== 'distribution' || !page.value || !model.value) return null
  const { niveau, departement, epci, territoire } = model.value.state
  return modeleSignature(facts.value, familyDispatch.value.facet, page.value, payload.value.territoires, metadata.value?.detail_labels?.[indicator.value] ?? {}, { niveau, departement, epci, territoire })
})
// L'ensemble de comparaison des distributions (#474) — le profil agrégé du
// périmètre actif, dans le MÊME périmètre résolu que la signature : une vue
// d'ensemble étiquetée qui REMPLACE le héros médian (une distribution de
// catégories n'a pas de médiane scalaire honnête).
const ensemble = computed(() => {
  if (!familyDispatch.value || familyDispatch.value.family !== 'distribution' || !page.value || !model.value || profileRegionalFactOnly.value) return null
  const { niveau, departement, epci } = model.value.state
  return modeleEnsembleComparaison(facts.value, familyDispatch.value.facet, page.value, payload.value.territoires, metadata.value?.detail_labels?.[indicator.value] ?? {}, { niveau, departement, epci })
})
// Le profil complet du territoire (#439), dans le MÊME périmètre résolu que
// la comparaison — la catégorie comparée pilote carte/extrêmes/tableau sans
// jamais replier le profil ; les libellés canonical viennent des métadonnées
// du thème (payload-owned, jamais codés en dur).
const profil = computed(() => {
  if (!familyDispatch.value || familyDispatch.value.family !== 'list' || !page.value || !model.value) return null
  const { niveau, departement, epci, territoire } = model.value.state
  return modeleProfil(facts.value, familyDispatch.value.facet, page.value, payload.value.territoires, metadata.value?.detail_labels?.[indicator.value] ?? {}, { niveau, departement, epci, territoire })
})
// Le nuage de la relation (#441), dans le MÊME périmètre résolu que la
// comparaison — la facette scalaire pilote carte/extrêmes/tableau sans jamais
// replier le nuage ; les libellés des rôles sont payload-owned (contrat).
const relation = computed(() => {
  if (!familyDispatch.value || familyDispatch.value.family !== 'relationship' || !page.value || !model.value) return null
  const { niveau, departement, epci, territoire } = model.value.state
  return modeleRelation(model.value.rows, facts.value, familyDispatch.value.facet, page.value, payload.value.territoires, { niveau, departement, epci, territoire })
})
// La composition contextualisée (#472), dans le MÊME périmètre résolu que la
// comparaison — les parts du territoire mis en avant face à la médiane du
// périmètre ; les libellés canonical viennent des métadonnées du thème
// (payload-owned, jamais codés en dur).
const composition = computed(() => {
  if (!familyDispatch.value || familyDispatch.value.family !== 'composition' || !page.value || !model.value) return null
  const { niveau, departement, epci, territoire } = model.value.state
  return modeleComposition(facts.value, familyDispatch.value.facet, page.value, payload.value.territoires, metadata.value?.detail_labels?.[indicator.value] ?? {}, { niveau, departement, epci, territoire })
})
const themeVars = computed(() => themeValide.value ? themeStyle(theme.value as Theme) : undefined)
const directionGlyph = computed(() => familyDispatch.value?.facet.direction === 'low' ? '▼' : '▲')
const directionText = computed(() => familyDispatch.value?.facet.direction === 'low' ? 'moins = mieux' : 'plus = mieux')
const selectedRow = computed(() => model.value?.rows.find((row) => row.highlighted))
const markerDescription = computed(() => selectedRow.value && familyDispatch.value ? `${selectedRow.value.territoire.nom} : ${formaterValeur({ value: selectedRow.value.value, unit: familyDispatch.value.facet.unit })} ${familyDispatch.value.facet.unit}, positionné sur l’axe de densité à sa valeur.` : '')
function libelleDetail(detail: string): string {
  const dispatch = familyDispatch.value
  if (dispatch?.family === 'trajectory') return dispatch.representation.labelsDetail[detail] ?? dispatch.facet.labels[detail] ?? 'Détail'
  return dispatch?.facet.labels[detail] ?? 'Détail'
}
function setSort(tri: TriExploration) { const ordre = route.query.tri === tri && route.query.ordre === 'asc' ? 'desc' : 'asc'; router.replace({ query: normalizedQuery({ tri, ordre }) }) }
const payloadCarte = computed(() => {
  const niveau = model.value?.state.niveau ?? niveauRoute.value ?? 'commune'
  const departement = niveau === 'commune' && typeof route.query.departement === 'string' ? route.query.departement : undefined
  const epci = niveau === 'commune' && typeof route.query.epci === 'string' ? route.query.epci : undefined
  const scoped = payloadPourCarte(payload.value, familyDispatch.value!.facet, { niveau, departement, epci })
  if (!pageScalaireApiActive.value || !porte.value.territoire) return scoped
  const focal = payload.value.indicateurs.find((fact) => fact.theme === theme.value &&
    fact.key === indicator.value && fact.type === niveau && fact.territoire === porte.value.territoire)
  if (!focal || scoped.indicateurs.some((fact) => fact.theme === focal.theme && fact.key === focal.key &&
      fact.type === focal.type && fact.territoire === focal.territoire)) return scoped
  // A focal outside the chosen comparison filter is one separately acquired
  // fact, not an expansion of the page's cohort or peer ranks.
  return { ...scoped, indicateurs: [...scoped.indicateurs, focal] }
})
const vue = computed(() => route.query.vue === 'carte' || route.query.vue === 'indicateur' ? route.query.vue : 'reperes')
const couche = computed<Couche | null>(() => page.value && familyDispatch.value ? ({ source: 'indicateur', clef: familyDispatch.value.facet.indicator, detail: familyDispatch.value.facet.detail, libelle: familyDispatch.value.facet.label, parDefaut: true, sousGroupe: null, storyKey: null }) : null)
const niveauMasque = computed<NiveauMasque>(() => model.value?.state.niveau === 'epci' ? 'epcis' : model.value?.state.niveau === 'departement' ? 'departements' : 'communes')
const territoireCible = computed(() => { const cible = porte.value.territoire; return cible ? payload.value.territoires.find((t) => t.territoire === cible && t.type === model.value?.state.niveau) ?? null : null })
// La demande de zoom de la carte (#505, le contrat) : un territoire porté par
// l'URL — la même lecture validée que le reste de la page.
const requeteZoom = computed(() => Number(Boolean(porte.value.territoire)))
function normalizedQuery(extra: Record<string, string | undefined> = {}) { return queryCanonique(route.query, { niveau: null, scopeValide: etatUrl.value.scopeValide }, extra) }
function setQuery(key: string, value: string) { router.replace({ query: normalizedQuery({ [key]: value || undefined }) }) }
function setVue(value: 'reperes' | 'carte' | 'indicateur') { router.replace({ query: normalizedQuery({ vue: value === 'reperes' ? undefined : value }) }) }
watch(() => [route.params.theme, route.params.indicator, route.query.recherche], () => { recherche.value = String(route.query.recherche ?? '') }, { immediate: true })
// #474/#508 : un seul applier réactif. La fonction pure garde les deux temps
// de chargement : le scope se purge dès les territoires publiés ; le niveau
// ne s'injecte qu'avec les métadonnées de la facette. Avant l'extraction, les
// deux watchers mutuellement réactifs écrivaient « niveau: undefined » dans la
// fenêtre « territoires chargés, métadonnées pas encore » et STRIPPAIENT un
// departement/EPCI valide.
watch(() => ({ etat: etatUrl.value, facet: familyDispatch.value?.resolvedUrl, page: page.value }),
  ({ etat, facet, page: currentPage }) => {
  if (!payload.value.territoires.length) return
  const selected = payload.value.territoires.find((territory) => territory.territoire === porte.value.territoire)
  const regionalFactsOnly = profileMode.value && selected?.type === 'region' &&
    page.value?.levels.includes('region') && !estNiveauComparable(route.query[PARAM_NIVEAU])
  if (regionalFactsOnly) {
    const query = { ...route.query }
    delete query[PARAM_NIVEAU]
    delete query.departement
    delete query.epci
    if (JSON.stringify(query) !== JSON.stringify(route.query)) router.replace({ query })
    return
  }
  let query = queryCanonique(route.query, etat)
  if (facet !== undefined && currentPage) query = fusionnerFacette(query, facet)
  if (JSON.stringify(query) !== JSON.stringify(route.query)) router.replace({ query })
}, { immediate: true })
watch(() => route.query[PARAM_NIVEAU], (niveau) => { if (estNiveauComparable(niveau)) { localStorage.setItem('lusk:niveau-indicateur', niveau); niveauMemorise.value = niveau } }, { immediate: true })
</script>
<template>
  <section class="indicateur-page presentation-editorial" :class="`theme-${theme}`" :style="themeVars">
    <div v-if="orderedSeriesAdapter && !raccordementApiActive && serieChargement" role="status">Chargement des données actualisées…</div>
    <div v-if="orderedSeriesAdapter && !raccordementApiActive && serieErreur" role="alert">Les données de cet indicateur sont momentanément indisponibles.<button type="button" @click="chargerSerie(true)">Réessayer</button></div>
    <div v-if="chargement || (raccordementApiActive && serieChargement)" role="status">Chargement de l’indicateur…</div><div v-else-if="erreur || (raccordementApiActive && serieErreur)" role="alert">Impossible de charger l’indicateur.<button v-if="profileBootstrapError" type="button" @click="retryProfileBootstrap++">Réessayer</button><button v-else-if="profileMode" type="button" @click="retryProfileFacts++">Réessayer</button><button v-if="!profileMode && scalaireApi" type="button" @click="retryScalaireApi++">Réessayer</button><button v-if="raccordementApiActive" type="button" @click="chargerSerie(true)">Réessayer</button></div><div v-else-if="!page || !model" role="alert">Indicateur introuvable.</div>
    <template v-else>
      <header><p class="sur-titre">{{ metadata?.label }}</p><h1>{{ page.label }}</h1><p>{{ page.definition }}</p></header>
      <section v-if="profileMode" class="profile-comparison-state" data-testid="profile-comparison-state">
        <p v-if="profileComparisonLoading || profileScalarLoading" role="status" data-testid="profile-comparison-pending">Chargement des éléments de comparaison… Les cellules du profil restent disponibles.</p>
        <div v-else-if="profileComparisonError || profileScalarError" role="alert" data-testid="profile-comparison-error">
          <p>La comparaison est momentanément indisponible. Les faits et le profil API restent affichés.</p>
          <button v-if="profileComparisonError" type="button" data-testid="profile-comparison-retry" @click="retryProfileComparison++">Réessayer la comparaison</button>
          <button v-if="profileScalarError" type="button" data-testid="profile-scalar-retry" @click="retryProfileScalar++">Réessayer la facette</button>
        </div>
        <p v-else-if="profileRegionalFactOnly" data-testid="profile-regional-facts-only">Faits publiés pour la Région Bretagne, sans comparaison entre territoires.</p>
        <p v-else-if="profileEmptyCohort" data-testid="profile-empty-cohort">Aucun territoire publié dans ce périmètre. Aucune comparaison de remplacement n’est demandée.</p>
        <p v-else-if="profileComparison?.status === 'unavailable'" data-testid="profile-comparison-unavailable">La comparaison n’est pas disponible pour ce périmètre selon la publication API.</p>
        <div v-else-if="profileComparison?.status === 'available'" data-testid="profile-comparison-summary">
          <span>{{ profileComparison.selectedMemberCount }} territoires sélectionnés · {{ profileComparison.eligibleCount }} valeurs comparables</span>
          <span v-if="familyDispatch?.family === 'distribution' || typeof profileComparison.facet === 'string'"> · Médiane : {{ formaterValeur({ value: profileComparison.median, unit: profileComparison.unit }) }} {{ profileComparison.unit }}</span>
          <span v-if="porte.territoire && profileComparisonTarget === porte.territoire && profileComparison.rank !== null"> · Rang API {{ formaterRang(profileComparison.rank, profileComparison.rankSize) }}</span>
          <span v-if="profileComparison.comparisonSources[0]"> · {{ profileComparison.comparisonSources[0].name }} · {{ profileComparison.comparisonSources[0].version }} · référence {{ profileComparison.comparisonSources[0].referenceDate ?? '—' }} · publication {{ profileComparison.comparisonSources[0].publicationDate ?? '—' }}</span>
        </div>
      </section>
      <section v-if="pageScalaireApiActive" class="scalar-comparison-state" data-testid="scalar-comparison-state">
        <p v-if="chargementScalaireFocalApi" role="status" data-testid="scalar-focal-pending">Chargement de la valeur du territoire focal… Les faits du périmètre restent affichés.</p>
        <div v-else-if="erreurScalaireFocalApi" role="alert" data-testid="scalar-focal-error">
          <p>La valeur du territoire focal est momentanément indisponible. Les faits du périmètre restent affichés.</p>
          <button type="button" data-testid="scalar-focal-retry" @click="retryScalaireApi++">Réessayer le territoire focal</button>
        </div>
        <p v-else-if="focalScalaireApiAbsent" data-testid="scalar-focal-unavailable">Aucune observation scalaire publiée pour le territoire focal ; les faits du périmètre restent affichés.</p>
        <p v-if="chargementComparaisonScalairePage" role="status" data-testid="scalar-comparison-pending">Chargement de la comparaison publiée… Les faits scalaires API restent affichés.</p>
        <div v-else-if="erreurComparaisonScalairePage" role="alert" data-testid="scalar-comparison-error">
          <p>La comparaison est momentanément indisponible. Les faits scalaires API restent affichés.</p>
          <button type="button" data-testid="scalar-comparison-retry" @click="retryComparaisonScalairePage++">Réessayer la comparaison</button>
        </div>
        <p v-else-if="comparaisonScalairePage?.status === 'unavailable'" data-testid="scalar-comparison-unavailable">La comparaison n’est pas disponible pour ce périmètre selon la publication API.</p>
        <p v-else-if="comparaisonScalairePage?.status === 'available'" data-testid="scalar-comparison-summary">
          {{ comparaisonScalairePage.selectedMemberCount }} territoires · {{ comparaisonScalairePage.eligibleCount }} valeurs comparables · Médiane API : {{ formaterValeur({ value: comparaisonScalairePage.median, unit: page.unit }) }} {{ page.unit }}
          <span v-if="comparaisonScalairePage.rank !== null"> · Rang API {{ formaterRang(comparaisonScalairePage.rank, comparaisonScalairePage.rankSize) }}</span>
          <span v-else-if="!comparaisonScalairePage.focalInSelection"> · Le territoire focal est hors de la sélection ; aucun rang ne lui est attribué.</span>
        </p>
      </section>
      <!-- La note de contexte permanente (#472) : UNE ligne partagée par toutes
           les familles, dérivée de l'état résolu — vivante aux changements d'URL. -->
       <NoteContexteIndicateur :etat="model.state" :territoires="payload.territoires" :region-facts-only="profileRegionalFactOnly" />
      <nav class="vues" aria-label="Vues de l’indicateur"><button :class="{ active: vue === 'reperes' }" @click="setVue('reperes')">Repères</button><button :class="{ active: vue === 'carte' }" @click="setVue('carte')">Carte</button><button :class="{ active: vue === 'indicateur' }" @click="setVue('indicateur')">L’indicateur</button></nav>
        <main v-if="vue === 'reperes'"><RepereFamilyOutlet v-if="familyDispatch" :dispatch="familyDispatch" :modele="trajectoire" :signature="distribution" :profil="profil" :relation="relation" :composition="composition" :ensemble="ensemble">
         <template #default>
             <section v-if="raccordementApiLecture && !profileRegionalFactOnly" class="raccordement-comparison-summary" data-testid="raccordement-comparison-summary">
              <template v-if="raccordementApiLecture.comparison?.status === 'available'">
                <div data-testid="raccordement-selected-mean"><h2>Moyenne — {{ raccordementComparisonScopeLabel }}</h2><p>{{ raccordementApiLecture.comparison.selectedMemberCount }} membres · moyenne à {{ raccordementApiLecture.metadata.comparison_point }}</p><strong>{{ formaterValeur({ value: raccordementApiLecture.comparison.valueAtComparisonPoint, unit: page.unit }) }} {{ page.unit }}</strong><p v-if="raccordementApiLecture.comparison.rank !== null">Rang à {{ raccordementApiLecture.metadata.comparison_point }} : {{ formaterRang(raccordementApiLecture.comparison.rank, raccordementApiLecture.comparison.rankSize) }}</p><p v-else>Rang indisponible à {{ raccordementApiLecture.metadata.comparison_point }}.</p></div>
              </template>
              <p v-else-if="raccordementApiLecture.comparison?.status === 'unavailable'" data-testid="raccordement-comparison-unavailable">La comparaison est indisponible pour ce périmètre selon les données publiées. La courbe du territoire et la référence nommée restent affichées.</p>
              <p v-else-if="raccordementComparaisonChargement" role="status" data-testid="raccordement-comparison-pending">Chargement de la comparaison… La courbe du territoire et la référence nommée restent affichées.</p>
              <div v-else-if="raccordementComparaisonErreur" role="alert" data-testid="raccordement-comparison-error">La comparaison est momentanément indisponible. La courbe du territoire et la référence nommée restent affichées.<button type="button" data-testid="raccordement-comparison-retry" @click="chargerSerie(true)">Réessayer la comparaison</button></div>
              <p v-if="raccordementApiLecture.facts.find((fact) => fact.detail === raccordementApiLecture?.metadata.comparison_point)">Territoire à {{ raccordementApiLecture.metadata.comparison_point }} : {{ formaterValeur({ value: raccordementApiLecture.facts.find((fact) => fact.detail === raccordementApiLecture?.metadata.comparison_point)?.value ?? null, unit: page.unit }) }} {{ page.unit }}</p>
              <p v-if="raccordementSource">Source : {{ raccordementSource.source_name }} · version {{ raccordementSource.version }} · référence {{ raccordementSource.reference_date }} · publication {{ raccordementSource.publication_date }}</p>
            </section>
            <div v-if="familyDispatch.family !== 'distribution' && !raccordementApiLecture && !profileRegionalFactOnly" class="hero"><article class="median"><span>Médiane</span><strong>{{ model!.median === null ? '—' : formaterValeur({ value: model!.median, unit: familyDispatch.facet.unit }) }} <small>{{ familyDispatch.facet.unit }}</small></strong><p>{{ model!.scopeLabel }}</p></article><article class="distribution"><h2>Distribution</h2><svg class="density" viewBox="0 0 600 180" role="img" aria-label="Densité des valeurs"><title>Densité des valeurs</title><desc v-if="markerDescription">{{ markerDescription }}</desc><path :d="`M ${model!.density.map((point, index) => `${index * (600 / Math.max(model!.density.length - 1, 1))},${20 + point.y * 1.5}`).join(' L ')}`" /><circle v-if="model!.markerX !== null && model!.markerY !== null" :cx="model!.markerX! * 6" :cy="20 + model!.markerY! * 1.5" r="7" class="point-highlight" :aria-label="markerDescription" /></svg><span v-if="markerDescription" class="visually-hidden">{{ markerDescription }}</span></article></div>
            <div v-if="!raccordementApiLecture && !profileRegionalFactOnly" class="extremes"><article><h2>Valeurs les plus hautes</h2><span v-if="model!.high.count > 1">{{ model!.high.count }} territoires à égalité</span><RouterLink v-for="row in model!.high.rows" :key="row.territoire.territoire" :to="row.fiche">{{ row.territoire.nom }} · {{ formaterValeur({ value: row.value, unit: familyDispatch.facet.unit }) }} {{ familyDispatch.facet.unit }}</RouterLink></article><article><h2>Valeurs les plus basses</h2><span v-if="model!.low.count > 1">{{ model!.low.count }} territoires à égalité</span><RouterLink v-for="row in model!.low.rows" :key="row.territoire.territoire" :to="row.fiche">{{ row.territoire.nom }} · {{ formaterValeur({ value: row.value, unit: familyDispatch.facet.unit }) }} {{ familyDispatch.facet.unit }}</RouterLink></article></div>
             <div v-if="!profileRegionalFactOnly" class="controls"><label>Niveau <select :value="model!.state.niveau" @change="setQuery(PARAM_NIVEAU, ($event.target as HTMLSelectElement).value)"><option v-for="niveau in page.levels" :key="niveau" :value="niveau">{{ niveau === 'commune' ? 'Communes' : niveau === 'epci' ? 'EPCI' : niveau === 'region' ? 'Région' : 'Départements' }}</option></select></label><label v-if="model!.state.niveau === 'commune'">Département <input :value="route.query.departement ?? ''" @input="setQuery('departement', ($event.target as HTMLInputElement).value)" /></label><label v-if="model!.state.niveau === 'commune'">EPCI <input :value="route.query.epci ?? ''" @input="setQuery('epci', ($event.target as HTMLInputElement).value)" /></label><label>Rechercher <input v-model="recherche" @input="setQuery('recherche', recherche)" /></label><label v-if="familyDispatch.family === 'trajectory'">Détail (actif) <select aria-label="Détail (actif)" :value="familyDispatch.facet.detail ?? ''" @change="setQuery('detail', ($event.target as HTMLSelectElement).value)"><option v-for="detail in familyDispatch.facet.details" :key="detail" :value="detail">{{ libelleDetail(detail) }}</option></select></label><label v-if="familyDispatch.family === 'list'">Catégorie comparée <select aria-label="Catégorie comparée" :value="familyDispatch.facet.detail ?? ''" @change="setQuery('detail', ($event.target as HTMLSelectElement).value)"><option v-for="detail in familyDispatch.facet.details" :key="detail" :value="detail">{{ familyDispatch.facet.labels[detail] ?? detail }}</option></select></label><label v-if="profileMode && familyDispatch.family !== 'list' && page.comparison?.details?.length">Catégorie comparée <select aria-label="Catégorie comparée" :value="familyDispatch.facet.detail ?? ''" @change="setQuery('detail', ($event.target as HTMLSelectElement).value)"><option v-for="detail in page.comparison.details" :key="detail" :value="detail">{{ familyDispatch.facet.labels[detail] ?? detail }}</option></select></label><label v-if="profileMode && page.comparison?.sexes?.length">Sexe comparé <select aria-label="Sexe comparé" :value="familyDispatch.facet.sex ?? ''" @change="setQuery('sex', ($event.target as HTMLSelectElement).value)"><option v-for="sex in page.comparison.sexes" :key="sex" :value="sex">{{ sex === 'F' ? 'Femmes' : 'Hommes' }}</option></select></label></div>
             <div v-if="!raccordementApiLecture && !profileRegionalFactOnly" class="comparison-table-scroll" role="region" aria-label="Tableau des territoires comparables" tabindex="0"><table><caption>Territoires comparables — {{ model!.scopeLabel }}</caption><thead><tr><th><button type="button" @click="setSort('nom')">Territoire</button></th><th><button type="button" @click="setSort('valeur')">Valeur</button></th><th><button type="button" @click="setSort('rang')">Rang</button> <span :title="directionText" :aria-label="directionText">{{ directionGlyph }} {{ directionText }}</span></th><th /></tr></thead><tbody><tr v-for="row in model!.rows" :key="row.territoire.territoire" :class="{ selection: row.highlighted }"><td><RouterLink :to="row.fiche">{{ row.territoire.nom }}</RouterLink></td><td>{{ formaterValeur({ value: row.value, unit: familyDispatch.facet.unit }) }} {{ familyDispatch.facet.unit }}</td><td><span :title="`${formaterRang(row.rang, row.rangTaille)} · ${directionText}`" :aria-label="`${formaterRang(row.rang, row.rangTaille)} · ${directionText}`">{{ formaterRang(row.rang, row.rangTaille) }}</span></td><td><button type="button" @click="setQuery(PARAM_TERRITOIRE, row.territoire.territoire)">Voir sur la distribution</button></td></tr></tbody></table></div>
          </template></RepereFamilyOutlet></main>
        <section v-else-if="vue === 'carte' && profileRegionalFactOnly" class="carte-indicateur" role="status" data-testid="profile-regional-map-unavailable">La Région dispose de faits publiés, mais pas d’une géométrie de comparaison pour cette carte.</section>
        <section v-else-if="vue === 'carte'" class="carte-indicateur"><div v-if="geometrie.masques.value" class="map-wrap"><MapExplorer :masques="geometrie.masques.value" :payload="payloadCarte" :active-ids="payloadCarte.indicateurs.map((fact) => fact.territoire)" :theme="theme as Theme" :couche="couche" :niveau="niveauMasque" :territoire-cible="territoireCible" :requete-zoom="requeteZoom" /></div><div v-else role="status">Chargement de la carte…</div></section>
        <aside v-else><h2>L’indicateur</h2><dl><template v-if="raccordementApiLecture"><dt>Définition</dt><dd>{{ raccordementApiLecture.metadata.label }}</dd><dt>Unité</dt><dd>{{ raccordementApiLecture.metadata.unit }}</dd><dt>Mesure</dt><dd>{{ raccordementApiLecture.metadata.comparison_contract.statistic }} · {{ raccordementApiLecture.metadata.axis_values.length }} points déclarés</dd></template><template v-else><dt>Définition</dt><dd>{{ page.definition }}</dd><dt>Unité</dt><dd>{{ page.unit }}</dd><dt>Calcul</dt><dd>{{ page.calculation }}</dd><dt>Direction</dt><dd><span :title="directionText" :aria-label="directionText">{{ directionGlyph }} {{ directionText }}</span></dd><dt>Précautions</dt><dd>{{ page.caveats }}</dd></template></dl><p v-if="horlogeService && !raccordementApiLecture" class="indicator-date-caveat" data-testid="raccordement-dates">Les résultats reposent sur les horaires planifiés pour le {{ horlogeService.service }} ; les sources ont été acquises le {{ horlogeService.acquisition }}.</p><section v-for="source in sources" :id="`indicator-source-${source.id}`" :key="source.id" class="source-card"><h3>{{ source.dataset }}</h3><p>Éditeur : {{ source.publisher }} · Licence : {{ source.licence ?? '—' }} · Millésime : {{ source.vintage ?? '—' }} · Fraîcheur : {{ source.freshness ?? '—' }}</p><p v-if="source.caveat">Limite de la source : {{ source.caveat }}</p><a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">Voir le jeu de données</a><RouterLink v-if="source.ficheSourceLiee" :to="{ name: 'sources', hash: `#${ancreSource(source.ancreSourceId ?? source.id)}` }">Voir la fiche source</RouterLink><ul><li v-for="vintage in source.vintages" :key="vintage.id">{{ vintage.label }} · {{ vintage.version ?? '—' }} · {{ vintage.licence ?? '—' }} · {{ vintage.dateReference ?? '—' }} · {{ vintage.datePublication ?? '—' }}<span v-if="vintage.revisionHash"> · Révision : {{ vintage.revisionHash }}</span></li></ul><dl v-if="source.clocks.length"><template v-for="clock in source.clocks" :key="`${clock.name}-${clock.reference}`"><dt>{{ clock.name }}</dt><dd>{{ clock.frequency }} · Référence : {{ clock.reference }}<span v-if="clock.trigger"> · Déclencheur : {{ clock.trigger }}</span></dd></template></dl></section></aside>
     </template>
  </section>
</template>
<style scoped>
.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.comparison-table-scroll{max-width:100%;overflow-x:auto}
.indicateur-page{min-height:100%;padding:clamp(24px,5vw,64px) max(16px,calc((100% - 1200px)/2));color:var(--text-primary)}header{max-width:760px}h1{font:var(--text-h1);margin:.3rem 0 1rem}h2{font:var(--text-h3)}.sur-titre{color:var(--indicateur-strong);font:var(--text-overline);text-transform:uppercase}.vues{display:flex;gap:24px;margin:32px 0;border-bottom:1px solid var(--border-default);padding-bottom:12px}.vues button.active{border-bottom:0;box-shadow:inset 0 -3px 0 var(--indicateur-accent);border-radius:0;font-weight:700}.hero,.extremes{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}.hero article,.extremes article,aside{padding:24px;background:var(--surface-primary);border:1px solid var(--border-default);border-radius:12px;margin-bottom:16px}.median strong{display:block;font:600 clamp(3rem,9vw,7rem)/1 var(--font-ui);margin:20px 0}.median small{font:var(--text-body)}.density{width:100%;height:170px;border-bottom:2px solid var(--indicateur-line)}.density path{fill:none;stroke:var(--indicateur-accent);stroke-width:4}.point-highlight{fill:var(--status-error)}.extremes article{display:flex;flex-direction:column;gap:8px}.indicator-date-caveat{margin:0 0 16px;color:var(--text-secondary)}.controls{display:flex;gap:16px;flex-wrap:wrap;margin:24px 0}label{display:flex;flex-direction:column;gap:4px}select,input{padding:8px;border:1px solid var(--border-default);border-radius:6px}table{width:100%;border-collapse:collapse;background:var(--surface-primary)}th,td{padding:12px;border-bottom:1px solid var(--border-subtle);text-align:left}tr.selection{background:var(--indicateur-soft)}button{border:0;background:none;color:var(--accent-primary);cursor:pointer}.carte-indicateur,.map-wrap{min-height:540px}.map-wrap{position:relative;height:540px}.map-wrap :deep(.map-explorer){height:100%}dt{font-weight:700;margin-top:12px}dd{margin:0}@media(max-width:700px){.hero,.extremes{grid-template-columns:1fr}table{font-size:.85rem}}
</style>
