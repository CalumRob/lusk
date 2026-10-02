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
import { mergeOrderedSeriesFacts, orderedSeriesAdapterFor, orderedSeriesFacts, orderedSeriesReaderEnabled, type OrderedSeriesRead } from '@/payload/orderedSeriesAdapter'
import { chargerMetadataStructureAge, chargerStructureAgeProfile, remplacerStructureAgeStatique, structureAgeProfileEnabled } from '@/payload/structureAgeProfile'
import { chargerCohorteScalaire, choisirFocalCohorte, indicateursScalairesEnregistres, scalarCohortEnabled, validerEnregistrementScalaires } from '@/payload/scalarCohort'
import type { Indicateur, ThemeMetadata } from '@/payload/types'

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
const theme = computed(() => String(route.params.theme)); const indicator = computed(() => String(route.params.indicator))
// Cutover is an operator-controlled build setting. Keep static behavior until
// the serving schema/API are deployed and explicitly enabled together.
const orderedSeriesAdapter = computed(() => {
  const adapter = orderedSeriesAdapterFor(theme.value, indicator.value)
  if (!adapter) return null
  const page = payloadLegacy.value.themeMetadata?.[theme.value as keyof typeof payloadLegacy.value.themeMetadata]
    ?.indicator_pages?.[indicator.value] as { series_dataset_id?: string; series_publication?: 'legacy' | 'owned' } | undefined
  // Metadata selects ownership; absence during loading is not a legacy binding.
  if (!page) return null
  const datasetId = page?.series_dataset_id
  const publicationMode = page?.series_publication
  const enabled = orderedSeriesReaderEnabled(indicator.value, import.meta.env as Record<string, string | undefined>)
  return enabled ? { ...adapter, datasetId, publicationMode } : null
})
const themeValide = computed(() => (THEMES_CANONIQUES as readonly string[]).includes(theme.value))
const selectedTheme = theme.value as Theme
const profilAgeApi = selectedTheme === 'demographie' && indicator.value === 'structure_age' &&
  structureAgeProfileEnabled(import.meta.env as Record<string, string | undefined>)
const scalaireApiAuMontage = scalarCohortEnabled(import.meta.env as Record<string, string | undefined>)
const attendreLegacy: Fichier[] = scalaireApiAuMontage
  ? ['territoires']
  : profilAgeApi
  ? ['territoires', 'indicateurs_demographie', 'theme_demographie']
  : themeValide.value ? ['territoires', `indicateurs_${selectedTheme}`, `theme_${selectedTheme}`] : ['territoires']
const payloadChargerInjecte = inject(PAYLOAD_CHARGER_KEY, null)
const manifesteChargerInjecte = inject(INDICATOR_READ_MODEL_MANIFEST_CHARGER_KEY, null)
const modeleChargerInjecte = inject(INDICATOR_READ_MODEL_CHARGER_KEY, null)
// Production resolves this from the generated manifest. Tests that inject only
// the legacy file seam keep the historical page contract without network work.
const utiliseManifeste = !profilAgeApi && !scalaireApiAuMontage && themeValide.value && (manifesteChargerInjecte !== null || payloadChargerInjecte === null)
const attendrePage = ref<Fichier[]>(utiliseManifeste ? ['territoires'] : attendreLegacy)
const demarrerPage = ref<Fichier[]>(utiliseManifeste ? ['territoires'] : attendreLegacy)
const { payload: payloadLegacy, erreur: erreurLegacy, chargement: chargementLegacy } = usePayload({
  attendre: attendrePage,
  demarrer: demarrerPage,
})
const erreurManifesteModeles = ref<PayloadError | null>(null)
const chargementManifesteModeles = ref(utiliseManifeste)
const routeModeleIndicateur = ref(false)
const chargerManifeste = manifesteChargerInjecte ?? chargerManifesteModelesLecture
if (utiliseManifeste) {
  chargerManifeste().then(
    (manifeste) => {
      routeModeleIndicateur.value = manifeste.routes[selectedTheme]?.includes(indicator.value) ?? false
      if (!routeModeleIndicateur.value) {
        attendrePage.value = attendreLegacy
        demarrerPage.value = attendreLegacy
      }
      chargementManifesteModeles.value = false
    },
    (cause: unknown) => {
      erreurManifesteModeles.value =
        cause instanceof PayloadError
          ? cause
          : new PayloadError('fetch', 'modeles-lecture/manifest.json', 'Impossible de charger le manifeste des modèles.')
      chargementManifesteModeles.value = false
    },
  )
}
const utiliseModeleIndicateur = computed(() => !profilAgeApi && utiliseManifeste && routeModeleIndicateur.value)
const modeleIndicateur = ref<IndicatorReadModel | null>(null)
const erreurModeleIndicateur = ref<PayloadError | null>(null)
const chargementModeleIndicateur = ref(false)
let modeleIndicateurDemarre = false
const chargerModele = modeleChargerInjecte ?? chargerModeleIndicateur
const faitsProfilAge = ref<Indicateur[]>([])
const erreurProfilAge = ref<PayloadError | null>(null)
const chargementProfilAge = ref(false)
const retryProfilAge = ref(0)
const metadataStructureAgeApi = ref<ThemeMetadata | null>(null)
let sequenceProfilAge = 0
let chargementMetadataProfil: Promise<ThemeMetadata> | null = null
let derniereCleRequeteProfil = ''
watch(
  () => [profilAgeApi, porte.value.territoire, porte.value.niveau, route.query.departement,
    route.query.epci, payloadLegacy.value.territoires.length, retryProfilAge.value] as const,
  async ([active, territoryId, level, department, epci, territoryCount]) => {
    const requestKey = JSON.stringify([active, territoryId, level, department, epci, territoryCount, retryProfilAge.value])
    if (active && requestKey === derniereCleRequeteProfil) return
    derniereCleRequeteProfil = requestKey
    const sequence = ++sequenceProfilAge
    faitsProfilAge.value = []
    erreurProfilAge.value = null
    if (!active || !territoryCount) return
    chargementProfilAge.value = true
    try {
      if (!metadataStructureAgeApi.value) {
        chargementMetadataProfil ??= chargerMetadataStructureAge()
        try { metadataStructureAgeApi.value = await chargementMetadataProfil }
        finally { chargementMetadataProfil = null }
      }
      if (sequence !== sequenceProfilAge) return
      const page = metadataStructureAgeApi.value.indicator_pages?.structure_age
      if (!page) throw new PayloadError('validation', 'theme_demographie.json', 'La page structure_age est absente des métadonnées.')
      const comparison = page.comparison
      if (!comparison?.details || !comparison.sexes || !comparison.sex || !comparison.detail) {
        throw new PayloadError('validation', 'structure_age', 'La facette de comparaison déclarée est incomplète.')
      }
    if (!territoryId) {
      erreurProfilAge.value = new PayloadError('validation', 'structure_age', 'Sélectionnez un territoire pour charger le profil complet.')
      return
    }
    const selected = payloadLegacy.value.territoires.find((item) => item.territoire === territoryId && (!level || item.type === level))
    if (!selected) {
      erreurProfilAge.value = new PayloadError('validation', 'structure_age', 'Le territoire sélectionné est absent du référentiel.')
      return
    }
      const profileFacts = await chargerStructureAgeProfile(selected, payloadLegacy.value.territoires,
        { department: typeof department === 'string' ? department : undefined,
          epci: typeof epci === 'string' ? epci : undefined },
        { details: comparison.details, sexes: comparison.sexes,
          labels: metadataStructureAgeApi.value.detail_labels.structure_age,
          detail: comparison.detail, sex: comparison.sex, label: page.label, unit: page.unit,
          direction: page.direction, sources: page.sources })
      if (sequence === sequenceProfilAge) faitsProfilAge.value = profileFacts
    } catch (cause) {
      if (sequence === sequenceProfilAge) erreurProfilAge.value = cause instanceof PayloadError ? cause : new PayloadError('fetch', 'structure_age', 'Impossible de charger le profil.')
    } finally { if (sequence === sequenceProfilAge) chargementProfilAge.value = false }
  }, { immediate: true },
)

const scalaireApiOptionnelle = computed(() => scalarCohortEnabled(import.meta.env as Record<string, string | undefined>))
const indicateursScalairesCourants = ref<string[]>([])
const scalaireApi = computed(() => scalaireApiOptionnelle.value && metadataScalaireApi.value?.theme === theme.value &&
  indicateursScalairesCourants.value.includes(indicator.value))
const metadataScalaireApi = ref<ThemeMetadata | null>(null)
const faitsScalaireApi = ref<Indicateur[]>([])
const erreurScalaireApi = ref<PayloadError | null>(null)
const chargementScalaireApi = ref(false)
const retryScalaireApi = ref(0)
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
  validerEnregistrementScalaires(metadata, registered)
  indicateursScalairesCourants.value = registered
  return metadata
}
watch(() => [scalaireApiOptionnelle.value, theme.value, indicator.value, porte.value.territoire,
  porte.value.niveau, route.query.departement, route.query.epci,
  payloadLegacy.value.territoires.length, retryScalaireApi.value] as const,
async ([active, currentTheme, currentIndicator, selectedId, routeLevel, department, epci, territoryCount]) => {
  const key = JSON.stringify([active, currentTheme, currentIndicator, selectedId, routeLevel, department, epci, territoryCount, retryScalaireApi.value])
  if (active && key === cleRequeteScalaireApi) return
  cleRequeteScalaireApi = key
  const sequence = ++sequenceScalaireApi
  faitsScalaireApi.value = []; erreurScalaireApi.value = null
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
    const focal = choisirFocalCohorte(payloadLegacy.value.territoires, level, selectedId,
      level === 'commune' ? { department: dept, epci: codeEpci } : {})
    if (!focal) throw new PayloadError('validation', currentIndicator, 'Aucun territoire admissible dans ce périmètre.')
    const rows = await chargerCohorteScalaire(currentIndicator, currentTheme as Theme, page, focal, level,
      payloadLegacy.value.territoires, level === 'commune' ? { department: dept, epci: codeEpci } : {})
    if (sequence === sequenceScalaireApi) faitsScalaireApi.value = rows
  } catch (cause) {
    if (sequence === sequenceScalaireApi) erreurScalaireApi.value = cause instanceof PayloadError ? cause : new PayloadError('fetch', currentIndicator, 'Impossible de charger le cohort scalaire.')
  } finally { if (sequence === sequenceScalaireApi) chargementScalaireApi.value = false }
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
const serieErreur = ref(false)
const serieChargement = ref(false)
let serieRequete = 0
let serieRequestKey: string | null = null
const niveauSerie = computed(() => resoudreNiveau(porte.value.niveau, niveauMemorise.value,
  payloadLegacy.value.themeMetadata?.[theme.value as keyof typeof payloadLegacy.value.themeMetadata]?.indicator_pages?.[indicator.value]?.levels ?? ['commune']))
async function chargerSerie(force = false) {
  const adapter = orderedSeriesAdapter.value
  if (!adapter || !payloadLegacy.value.territoires.length) return
  const scope = resoudreEtatUrl({ query: route.query, territoires: payloadLegacy.value.territoires,
    niveauxPublies: payloadLegacy.value.themeMetadata?.[theme.value as keyof typeof payloadLegacy.value.themeMetadata]?.indicator_pages?.[indicator.value]?.levels,
    niveauMemorise: niveauMemorise.value }).scopeValide
  const department = scope?.departement
  const epci = scope?.epci
  const scopeTerritories = payloadLegacy.value.territoires.filter((territory) => territory.type === niveauSerie.value &&
    (niveauSerie.value !== 'commune' || ((!department || territory.departement === department) &&
      (!epci || territory.epci === epci))))
  const focal = payloadLegacy.value.territoires.find((territory) => territory.territoire === porte.value.territoire) ?? scopeTerritories[0]
  if (!focal) { serieErreur.value = false; serieLecture.value = null; return }
  const query = new URLSearchParams({ scope_level: niveauSerie.value })
  if (niveauSerie.value === 'commune' && department) query.set('department_id', department)
  if (niveauSerie.value === 'commune' && epci) query.set('epci_id', epci)
  const url = adapter.publicationMode === 'owned'
    ? `/api/series-datasets/${encodeURIComponent(adapter.datasetId ?? '')}/territories/${encodeURIComponent(focal.type)}/${encodeURIComponent(focal.territoire)}/${encodeURIComponent(adapter.pathIndicator)}?${query}`
    : `/api/territories/${encodeURIComponent(focal.type)}/${encodeURIComponent(focal.territoire)}/series/${encodeURIComponent(adapter.pathIndicator)}?${query}`
  if (!force && url === serieRequestKey && (serieChargement.value || serieErreur.value || serieLecture.value)) return
  const request = ++serieRequete
  serieRequestKey = url
  serieChargement.value = true
  serieErreur.value = false
  serieLecture.value = null
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const result = await response.json() as OrderedSeriesRead
    if (result.indicator_id !== adapter.indicator || !Array.isArray(result.points) ||
      (adapter.publicationMode === 'owned' && result.dataset_id !== adapter.datasetId) ||
      !Array.isArray(result.scope_series)) throw new Error('Invalid ordered-series response')
    if (request === serieRequete) serieLecture.value = result
  } catch {
    if (request === serieRequete) serieErreur.value = true
  } finally {
    if (request === serieRequete) serieChargement.value = false
  }
}
const payload = computed(() => {
  const baseInitial = profilAgeApi
    ? { ...payloadLegacy.value,
        indicateurs: remplacerStructureAgeStatique(payloadLegacy.value.indicateurs, faitsProfilAge.value),
        themeMetadata: metadataStructureAgeApi.value
          ? { ...payloadLegacy.value.themeMetadata, demographie: metadataStructureAgeApi.value }
          : payloadLegacy.value.themeMetadata }
    : modeleIndicateur.value
      ? payloadDepuisModeleIndicateur(modeleIndicateur.value, payloadLegacy.value.territoires)
      : payloadLegacy.value
  const base = scalaireApi.value && metadataScalaireApi.value
    ? { ...baseInitial, themeMetadata: { ...baseInitial.themeMetadata, [theme.value]: metadataScalaireApi.value } }
    : baseInitial
  if (scalaireApi.value) {
    return { ...base, indicateurs: [...base.indicateurs.filter((fact) => !(fact.theme === theme.value && fact.key === indicator.value)), ...faitsScalaireApi.value] }
  }
  const adapter = orderedSeriesAdapter.value
  if (!adapter) return base
  const page = base.themeMetadata?.[adapter.theme]?.indicator_pages?.[adapter.indicator]
  const apiFacts = serieLecture.value && page
    ? orderedSeriesFacts(serieLecture.value, adapter.theme, base.territoires).map((fact) => ({ ...fact, unit: page.unit }))
    : []
  return { ...base, indicateurs: mergeOrderedSeriesFacts(base.indicateurs, adapter.indicator, apiFacts) }
})
const erreur = computed(() => {
  if (erreurManifesteModeles.value) return erreurManifesteModeles.value
  if (scalaireApiOptionnelle.value && (!metadataScalaireApi.value || scalaireApi.value)) return erreurScalaireApi.value
  if (profilAgeApi) return erreurProfilAge.value
  return utiliseModeleIndicateur.value ? erreurModeleIndicateur.value : erreurLegacy.value
})
const chargement = computed(() =>
  chargementManifesteModeles.value ||
  (scalaireApiOptionnelle.value && chargementScalaireApi.value) ||
  (profilAgeApi && chargementProfilAge.value) ||
  (utiliseModeleIndicateur.value
    ? chargementLegacy.value || chargementModeleIndicateur.value
    : chargementLegacy.value),
)
const geometrie = useGeometrie()
const metadata = computed(() => payload.value.themeMetadata?.[theme.value as keyof typeof payload.value.themeMetadata])
const page = computed(() => metadata.value?.indicator_pages?.[indicator.value])
const familyDispatch = computed(() => page.value ? dispatchIndicatorFamily(page.value, { theme: theme.value as Theme, facts: facts.value, territories: payload.value.territoires, selected: porte.value.territoire, facet: route.query, labelsDetail: metadata.value?.detail_labels[indicator.value] }) : null)
const sources = computed(() => {
  if (!page.value || !payload.value) return []
  const authority = sourceRecords(payload.value)
  return page.value.sources.map((id) => authority.find((record) => record.id === datasetDeSource(id))).filter((source): source is NonNullable<typeof source> => Boolean(source))
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
const model = computed(() => familyDispatch.value ? modeleExploration(facts.value, familyDispatch.value.facet, payload.value.territoires, requested.value, niveauMemorise.value, scalaireApi.value) : null)
// Le chemin complet de la trajectoire (#438), dans le MÊME périmètre résolu
// que le modèle par détail — le détail (actif) pilote carte/extrêmes/tableau
// sans replier la trajectoire.
const trajectoire = computed(() => {
  const dispatch = familyDispatch.value
  if (!dispatch || dispatch.family !== 'trajectory' || !model.value) return null
  const { niveau, departement, epci, territoire } = model.value.state
  return modeleTrajectoire(
    facts.value,
    dispatch.facet,
    dispatch.representation.endpoints,
    payload.value.territoires,
    { niveau, departement, epci, territoire },
    dispatch.representation.reference,
    dispatch.representation.extension.reference?.label ?? null,
    { axis: dispatch.representation.extension.axis, labelsDetail: dispatch.representation.labelsDetail },
  )
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
  if (!familyDispatch.value || familyDispatch.value.family !== 'distribution' || !page.value || !model.value) return null
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
  return payloadPourCarte(payload.value, familyDispatch.value!.facet, { niveau, departement, epci })
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
watch(etatUrl, (etat) => { if (!payload.value.territoires.length) return; const query = queryCanonique(route.query, etat); if (JSON.stringify(query) !== JSON.stringify(route.query)) router.replace({ query }) }, { immediate: true })
watch(() => route.query[PARAM_NIVEAU], (niveau) => { if (estNiveauComparable(niveau)) { localStorage.setItem('lusk:niveau-indicateur', niveau); niveauMemorise.value = niveau } }, { immediate: true })
watch(() => familyDispatch.value?.resolvedUrl, (resolved) => {
  if (resolved === undefined || !page.value) return
  const next = fusionnerFacette(route.query, resolved)
  if (JSON.stringify(next) !== JSON.stringify(route.query)) router.replace({ query: next })
}, { immediate: true })
</script>
<template>
  <section class="indicateur-page presentation-editorial" :class="`theme-${theme}`" :style="themeVars">
    <div v-if="orderedSeriesAdapter && serieChargement" role="status">Chargement des données actualisées…</div>
    <div v-if="orderedSeriesAdapter && serieErreur" role="alert">Les données de cet indicateur sont momentanément indisponibles.<button type="button" @click="chargerSerie(true)">Réessayer</button></div>
    <div v-if="chargement" role="status">Chargement de l’indicateur…</div><div v-else-if="erreur" role="alert">Impossible de charger l’indicateur.<button v-if="profilAgeApi" type="button" @click="retryProfilAge++">Réessayer</button><button v-if="scalaireApiOptionnelle" type="button" @click="retryScalaireApi++">Réessayer</button></div><div v-else-if="!page || !model" role="alert">Indicateur introuvable.</div>
    <template v-else>
      <header><p class="sur-titre">{{ metadata?.label }}</p><h1>{{ page.label }}</h1><p>{{ page.definition }}</p></header>
      <!-- La note de contexte permanente (#472) : UNE ligne partagée par toutes
           les familles, dérivée de l'état résolu — vivante aux changements d'URL. -->
      <NoteContexteIndicateur :etat="model.state" :territoires="payload.territoires" />
      <nav class="vues" aria-label="Vues de l’indicateur"><button :class="{ active: vue === 'reperes' }" @click="setVue('reperes')">Repères</button><button :class="{ active: vue === 'carte' }" @click="setVue('carte')">Carte</button><button :class="{ active: vue === 'indicateur' }" @click="setVue('indicateur')">L’indicateur</button></nav>
        <main v-if="vue === 'reperes'"><RepereFamilyOutlet v-if="familyDispatch" :dispatch="familyDispatch" :modele="trajectoire" :signature="distribution" :profil="profil" :relation="relation" :composition="composition" :ensemble="ensemble">
         <template #default>
          <div v-if="familyDispatch.family !== 'distribution'" class="hero"><article class="median"><span>Médiane</span><strong>{{ model!.median === null ? '—' : formaterValeur({ value: model!.median, unit: familyDispatch.facet.unit }) }} <small>{{ familyDispatch.facet.unit }}</small></strong><p>{{ model!.scopeLabel }}</p></article><article class="distribution"><h2>Distribution</h2><svg class="density" viewBox="0 0 600 180" role="img" aria-label="Densité des valeurs"><title>Densité des valeurs</title><desc v-if="markerDescription">{{ markerDescription }}</desc><path :d="`M ${model!.density.map((point, index) => `${index * (600 / Math.max(model!.density.length - 1, 1))},${20 + point.y * 1.5}`).join(' L ')}`" /><circle v-if="model!.markerX !== null && model!.markerY !== null" :cx="model!.markerX! * 6" :cy="20 + model!.markerY! * 1.5" r="7" class="point-highlight" :aria-label="markerDescription" /></svg><span v-if="markerDescription" class="visually-hidden">{{ markerDescription }}</span></article></div>
          <div class="extremes"><article><h2>Valeurs les plus hautes</h2><span v-if="model!.high.count > 1">{{ model!.high.count }} territoires à égalité</span><RouterLink v-for="row in model!.high.rows" :key="row.territoire.territoire" :to="row.fiche">{{ row.territoire.nom }} · {{ formaterValeur({ value: row.value, unit: familyDispatch.facet.unit }) }} {{ familyDispatch.facet.unit }}</RouterLink></article><article><h2>Valeurs les plus basses</h2><span v-if="model!.low.count > 1">{{ model!.low.count }} territoires à égalité</span><RouterLink v-for="row in model!.low.rows" :key="row.territoire.territoire" :to="row.fiche">{{ row.territoire.nom }} · {{ formaterValeur({ value: row.value, unit: familyDispatch.facet.unit }) }} {{ familyDispatch.facet.unit }}</RouterLink></article></div>
           <div class="controls"><label>Niveau <select :value="model!.state.niveau" @change="setQuery(PARAM_NIVEAU, ($event.target as HTMLSelectElement).value)"><option v-for="niveau in page.levels" :key="niveau" :value="niveau">{{ niveau === 'commune' ? 'Communes' : niveau === 'epci' ? 'EPCI' : 'Départements' }}</option></select></label><label v-if="model!.state.niveau === 'commune'">Département <input :value="route.query.departement ?? ''" @input="setQuery('departement', ($event.target as HTMLInputElement).value)" /></label><label v-if="model!.state.niveau === 'commune'">EPCI <input :value="route.query.epci ?? ''" @input="setQuery('epci', ($event.target as HTMLInputElement).value)" /></label><label>Rechercher <input v-model="recherche" @input="setQuery('recherche', recherche)" /></label><label v-if="familyDispatch.family === 'trajectory'">Détail (actif) <select aria-label="Détail (actif)" :value="familyDispatch.facet.detail ?? ''" @change="setQuery('detail', ($event.target as HTMLSelectElement).value)"><option v-for="detail in familyDispatch.facet.details" :key="detail" :value="detail">{{ libelleDetail(detail) }}</option></select></label><label v-if="familyDispatch.family === 'list'">Catégorie comparée <select aria-label="Catégorie comparée" :value="familyDispatch.facet.detail ?? ''" @change="setQuery('detail', ($event.target as HTMLSelectElement).value)"><option v-for="detail in familyDispatch.facet.details" :key="detail" :value="detail">{{ familyDispatch.facet.labels[detail] ?? detail }}</option></select></label></div>
           <table><caption>Territoires comparables — {{ model!.scopeLabel }}</caption><thead><tr><th><button type="button" @click="setSort('nom')">Territoire</button></th><th><button type="button" @click="setSort('valeur')">Valeur</button></th><th><button type="button" @click="setSort('rang')">Rang</button> <span :title="directionText" :aria-label="directionText">{{ directionGlyph }} {{ directionText }}</span></th><th /></tr></thead><tbody><tr v-for="row in model!.rows" :key="row.territoire.territoire" :class="{ selection: row.highlighted }"><td><RouterLink :to="row.fiche">{{ row.territoire.nom }}</RouterLink></td><td>{{ formaterValeur({ value: row.value, unit: familyDispatch.facet.unit }) }} {{ familyDispatch.facet.unit }}</td><td><span :title="`${directionGlyph} ${directionText}`" :aria-label="`${formaterRang(row.rang, row.rangTaille)} · ${directionText}`">{{ formaterRang(row.rang, row.rangTaille) }}</span></td><td><button type="button" @click="setQuery(PARAM_TERRITOIRE, row.territoire.territoire)">Voir sur la distribution</button></td></tr></tbody></table>
          </template></RepereFamilyOutlet></main>
       <section v-else-if="vue === 'carte'" class="carte-indicateur"><div v-if="geometrie.masques.value" class="map-wrap"><MapExplorer :masques="geometrie.masques.value" :payload="payloadCarte" :active-ids="payloadCarte.indicateurs.map((fact) => fact.territoire)" :theme="theme as Theme" :couche="couche" :niveau="niveauMasque" :territoire-cible="territoireCible" :requete-zoom="requeteZoom" /></div><div v-else role="status">Chargement de la carte…</div></section>
        <aside v-else><h2>L’indicateur</h2><dl><dt>Définition</dt><dd>{{ page.definition }}</dd><dt>Unité</dt><dd>{{ page.unit }}</dd><dt>Calcul</dt><dd>{{ page.calculation }}</dd><dt>Direction</dt><dd><span :title="directionText" :aria-label="directionText">{{ directionGlyph }} {{ directionText }}</span></dd><dt>Précautions</dt><dd>{{ page.caveats }}</dd></dl><p v-if="horlogeService" class="indicator-date-caveat" data-testid="raccordement-dates">Les résultats reposent sur les horaires planifiés pour le {{ horlogeService.service }} ; les sources ont été acquises le {{ horlogeService.acquisition }}.</p><section v-for="source in sources" :id="`indicator-source-${source.id}`" :key="source.id" class="source-card"><h3>{{ source.dataset }}</h3><p>Éditeur : {{ source.publisher }} · Licence : {{ source.licence ?? '—' }} · Millésime : {{ source.vintage ?? '—' }} · Fraîcheur : {{ source.freshness ?? '—' }}</p><p v-if="source.caveat">Limite de la source : {{ source.caveat }}</p><a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">Voir le jeu de données</a><RouterLink :to="{ name: 'sources', hash: `#${ancreSource(source.id)}` }">Voir la fiche source</RouterLink><ul><li v-for="vintage in source.vintages" :key="vintage.id">{{ vintage.label }} · {{ vintage.version ?? '—' }} · {{ vintage.licence ?? '—' }} · {{ vintage.dateReference ?? '—' }} · {{ vintage.datePublication ?? '—' }}</li></ul><dl v-if="source.clocks.length"><template v-for="clock in source.clocks" :key="`${clock.name}-${clock.reference}`"><dt>{{ clock.name }}</dt><dd>{{ clock.frequency }} · Référence : {{ clock.reference }}<span v-if="clock.trigger"> · Déclencheur : {{ clock.trigger }}</span></dd></template></dl></section></aside>
     </template>
  </section>
</template>
<style scoped>
.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.indicateur-page{min-height:100%;padding:clamp(24px,5vw,64px) max(16px,calc((100% - 1200px)/2));color:var(--text-primary)}header{max-width:760px}h1{font:var(--text-h1);margin:.3rem 0 1rem}h2{font:var(--text-h3)}.sur-titre{color:var(--indicateur-strong);font:var(--text-overline);text-transform:uppercase}.vues{display:flex;gap:24px;margin:32px 0;border-bottom:1px solid var(--border-default);padding-bottom:12px}.vues button.active{border-bottom:3px solid var(--indicateur-accent);font-weight:700}.hero,.extremes{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}.hero article,.extremes article,aside{padding:24px;background:var(--surface-primary);border:1px solid var(--border-default);border-radius:12px;margin-bottom:16px}.median strong{display:block;font:600 clamp(3rem,9vw,7rem)/1 var(--font-ui);margin:20px 0}.median small{font:var(--text-body)}.density{width:100%;height:170px;border-bottom:2px solid var(--indicateur-line)}.density path{fill:none;stroke:var(--indicateur-accent);stroke-width:4}.point-highlight{fill:var(--status-error)}.extremes article{display:flex;flex-direction:column;gap:8px}.indicator-date-caveat{margin:0 0 16px;color:var(--text-secondary)}.controls{display:flex;gap:16px;flex-wrap:wrap;margin:24px 0}label{display:flex;flex-direction:column;gap:4px}select,input{padding:8px;border:1px solid var(--border-default);border-radius:6px}table{width:100%;border-collapse:collapse;background:var(--surface-primary)}th,td{padding:12px;border-bottom:1px solid var(--border-subtle);text-align:left}tr.selection{background:var(--indicateur-soft)}button{border:0;background:none;color:var(--accent-primary);cursor:pointer}.carte-indicateur,.map-wrap{min-height:540px}.map-wrap{position:relative;height:540px}.map-wrap :deep(.map-explorer){height:100%}dt{font-weight:700;margin-top:12px}dd{margin:0}@media(max-width:700px){.hero,.extremes{grid-template-columns:1fr}table{font-size:.85rem}}
</style>
