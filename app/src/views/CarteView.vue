<script setup lang="ts">
/**
 * La carte interactive (/carte) — layouts.md §3: the ThemeTabs subheader
 * (reused — payload-driven, ?theme= in the URL, « Programmes et subventions »
 * as the first tab per ADR-0019, #282), then a full-bleed MapExplorer + a
 * 360px MapSidebar (mobile → bottom sheet).
 *
 * ADR-0019: the theme tab drives the map's LAYER SET (couchesDuTheme — the
 * layer model derives from the payload, never a carte-side spec). ?theme=
 * selects the theme's DEFAULT layer (coucheParDefaut — its first story
 * scalar); the sidebar's layer clicks switch the active couche (in-memory
 * state). The first tab is the « Programmes et subventions » layer group
 * (#282): ?onglet=programmes (+ &programme=<sigle>) drives the membership
 * categorical highlights (level-native — ACV/PVD/ORT à la commune, CRTE/
 * Territoires d'industrie/ORT à l'EPCI, aucune au département) and the
 * subventions choropleth (total € à chaque niveau, échelle par la règle de
 * trois). ?onglet= et ?theme= sont MUTUELLEMENT EXCLUSIFS (l'un efface
 * l'autre) ; les deux absents = l'état neutre (masques seuls). L'URL est
 * l'état : elle survit au rechargement. States follow the shell's pattern:
 * skeleton while the payload/geometry load, a typed error with Retry, and
 * the honest « Fonds de carte indisponible. » when no mask file is published.
 *
 * T7 (#303) — la carte neutre d'abord : le wait-set de la carte est
 * ['territoires', 'run-report'] (la géométrie vient de son propre seam,
 * useGeometrie). La carte neutre (masques + noms de référence) rend dès que
 * ce set se règle ; la liste de couches et les choroplèthes se remplissent
 * progressivement au fil de l'atterrissage des paires de thèmes (et du fichier
 * programmes pour l'onglet « Programmes et subventions »). La normalisation
 * d'URL garde un thème canonique en vol — elle n'écrit jamais sur un état
 * encore en chargement.
 */
import { AlertCircle, MapPinOff } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import MapExplorer from '@/components/carte/MapExplorer.vue'
import MapSidebar from '@/components/carte/MapSidebar.vue'
import ThemeTabs from '@/components/ThemeTabs.vue'
import {
  ANCRAGE_PROGRAMMES,
  ANCRAGES_THEMES,
  COULEUR_CONTOUR,
  COULEUR_MEMBRE,
  COULEUR_NEUTRE,
  echelleChoroplethe,
  rampeDivergente,
} from '@/carte/couleurs'
import { couchesDuTheme } from '@/carte/coucheModel'
import type { Couche, CoucheCarte, CouchesTheme, EntreeCouches } from '@/carte/coucheModel'
import { indicateurParTerritoire, collectionAvecValeurs, subventionsParTerritoire, valeurHistoireParTerritoire } from '@/carte/fusion'
import {
  coucheParDefautProgrammes,
  couchesProgrammes,
} from '@/carte/programmesCouches'
import type { CoucheProgramme } from '@/carte/programmesCouches'
import { echelleValeurs } from '@/carte/seuils'
import { idOnglet, idPanneau } from '@/fiche/onglets'
import type { SlugOnglet } from '@/fiche/onglets'
import { NIVEAUX_MASQUE } from '@/geo/types'
import type { NiveauMasque } from '@/geo/types'
import { useGeometrie } from '@/geo/useGeometrie'
import { themesPresent } from '@/payload/selectors'
import { SIGLES_PROGRAMMES, THEMES_CANONIQUES } from '@/payload/types'
import type { Payload, SigleProgramme, Territoire, Theme, ThemeMetadata } from '@/payload/types'
import { usePayload } from '@/payload/usePayload'
import { chargerRangScalaire } from '@/payload/scalarCohort'
import type { ScalarComparisonRank } from '@/payload/scalarCohort'
import { acquireMapThemeFacts } from '@/payload/mapSemanticAcquisition'
import type { Indicateur } from '@/payload/types'

const route = useRoute()
const router = useRouter()

const {
  payload,
  erreur: erreurPayload,
  chargement: chargementPayload,
  recharger: rechargerPayload,
} = usePayload({ attendre: ['territoires', 'run-report'] })
const {
  masques,
  erreur: erreurGeometrie,
  chargement: chargementGeometrie,
  recharger: rechargerGeometrie,
} = useGeometrie()

const themes = computed(() => (payload.value ? themesPresent(payload.value) : []))

/** L'onglet programmes — ?onglet=programmes dans l'URL (ADR-0019 #282). */
const ongletProgrammes = computed(() => route.query.onglet === 'programmes')
const themeAcquisCarte = computed<Theme | null>(() => ongletProgrammes.value ? 'programmes' : selection.value)

/** Le sigle d'adhésion demandé — ?programme=<sigle>, valable seulement dans
 *  l'onglet programmes (un sigle hors onglet n'est pas un état). */
const programmeSelectionne = computed<SigleProgramme | null>(() => {
  if (!ongletProgrammes.value) return null
  const demande = route.query.programme
  if (typeof demande === 'string' && (SIGLES_PROGRAMMES as readonly string[]).includes(demande)) {
    return demande as SigleProgramme
  }
  return null
})

const selection = computed<Theme | null>(() => {
  if (ongletProgrammes.value) return null
  const demande = route.query.theme
  if (
    payload.value &&
    typeof demande === 'string' &&
    (themes.value as string[]).includes(demande)
  ) {
    return demande as Theme
  }
  return null
})

/** Le slug du panneau actif — le premier onglet renommé sur la carte. */
const slugPanneau = computed<SlugOnglet>(() =>
  ongletProgrammes.value ? 'programmes' : selection.value,
)

/** Le slug passé à ThemeTabs — le premier onglet est le défaut (sélectionné
 *  quand aucun thème ne l'est), comme l'était Aperçu. */
const selectionOnglet = computed<Theme | null | 'programmes'>(() =>
  selection.value ?? 'programmes',
)

function choisirOnglet(slug: SlugOnglet): void {
  if (slug === 'programmes') {
    router.replace({ query: { onglet: 'programmes' } })
    return
  }
  router.replace({ query: slug ? { theme: slug } : {} })
}

// Normalisation de l'URL (ADR-0019) : ?onglet=programmes et ?theme= sont
// mutuellement exclusifs — l'onglet l'emporte, un thème inconnu ou un sigle
// inconnu retombe sur l'état neutre ({}), jamais un état partiel.
watch(
  () =>
    [route.query.theme, route.query.onglet, route.query.programme, payload.value, chargementPayload.value, erreurPayload.value] as const,
  ([theme, onglet, programme, pl, busy, enErreur]) => {
    // La normalisation attend que le wait-set soit réglé et que la carte ne
    // soit pas en erreur — un échec du wait-set ne prouve pas l'absence d'un
    // thème, l'URL n'est pas réécrite avant que Retry ait refait ses preuves
    // (le même garde que la fiche, #302).
    if (!pl || busy || enErreur) return
    const themesValides = themesPresent(pl) as string[]
    const themeValide = typeof theme === 'string' && themesValides.includes(theme)
    // Un thème canonique absent du payload peut encore atterrir (le payload
    // grandit) : sa réécriture attend son arrivée, l'état neutre honnête
    // s'affiche jusque-là (T7, #303).
    const themeCanonique =
      typeof theme === 'string' && (THEMES_CANONIQUES as readonly string[]).includes(theme)
    const ongletValide = onglet === 'programmes'
    const programmeValide =
      typeof programme === 'string' && (SIGLES_PROGRAMMES as readonly string[]).includes(programme)

    if (ongletValide) {
      if (theme !== undefined || (programme !== undefined && !programmeValide)) {
        router.replace({
          query: { onglet: 'programmes', ...(programmeValide ? { programme } : {}) },
        })
      }
      return
    }
    if (themeValide) {
      if (onglet !== undefined) router.replace({ query: { theme } })
      return
    }
    // Un thème non canonique ne peut jamais rendre → il est nettoyé ; un
    // thème canonique en vol est GARDÉ (il peut encore atterrir).
    if (theme !== undefined && !themeCanonique) {
      router.replace({ query: {} })
      return
    }
    if (onglet !== undefined || programme !== undefined) {
      router.replace({ query: themeCanonique ? { theme } : {} })
    }
  },
  { immediate: true },
)

const niveauxDisponibles = computed<NiveauMasque[]>(() => {
  const m = masques.value
  if (!m) return []
  return NIVEAUX_MASQUE.filter((niveau) => m[niveau] !== null)
})

/** The default mask level — the requested one, or the first available. */
const niveauDemande = ref<NiveauMasque>('communes')
const niveau = computed<NiveauMasque>(() => {
  if (niveauxDisponibles.value.length === 0) return niveauDemande.value
  return niveauxDisponibles.value.includes(niveauDemande.value)
    ? niveauDemande.value
    : niveauxDisponibles.value[0]
})

/** La recherche (#283) : le territoire sélectionné + une clé croissante —
 *  re-sélectionner le MÊME territoire re-zoome (la clé, pas l'identité). */
const demandeRecherche = ref<{ territoire: Territoire; requete: number } | null>(null)
let compteurRecherche = 0

/** Le niveau de masque d'un type de territoire — la région n'en a pas. */
function niveauDuType(type: Territoire['type']): NiveauMasque | null {
  if (type === 'commune') return 'communes'
  if (type === 'epci') return 'epcis'
  if (type === 'departement') return 'departements'
  return null
}

/** La recherche de la sidebar (#283) : bascule d'abord le niveau sur celui de
 *  l'entité cherchée (« whichever level matches »), puis demande à la carte de
 *  zoomer dessus et d'ouvrir son popup par couche. */
function rechercherTerritoire(t: Territoire): void {
  const niveauCible = niveauDuType(t.type)
  if (niveauCible && niveauCible !== niveau.value) {
    niveauDemande.value = niveauCible
  }
  demandeRecherche.value = { territoire: t, requete: ++compteurRecherche }
}

const geometrieAbsente = computed(
  () =>
    !chargementGeometrie.value &&
    !erreurGeometrie.value &&
    masques.value !== null &&
    niveauxDisponibles.value.length === 0,
)

/** The legend data — the same pure logic that paints the map. */
const couchesTheme = computed<CouchesTheme | null>(() =>
  selection.value && payloadCarte.value && mapDeclarations.value.length > 0
    ? couchesDuTheme(payloadCarte.value, selection.value, {
        indicatorIds: new Set(mapDeclarations.value.filter((resource) => resource.shapes.some((shape) =>
          ['scalar', 'declared_profile', 'period_detail', 'ordered_series'].includes(shape)))
          .map((resource) => resource.indicator_id)),
        scalarIds: new Set(mapDeclarations.value.filter((resource) => resource.shapes.includes('scalar'))
          .map((resource) => resource.indicator_id)),
        storyFields: new Set(mapStories.value.flatMap((row) => Object.entries(row)
          .filter(([, value]) => typeof value === 'number').map(([key]) => key))),
        axes: mapAxes.value,
      })
    : null,
)

/** The ACTIVE layer — in-memory state; reset to the theme's default on theme change (ADR-0019). */
const coucheActive = ref<Couche | null>(null)
watch(
  couchesTheme,
  (ct) => {
    if (!ct) return
    const entrees = ct?.entrees.flatMap((entry) => entry.type === 'couche'
      ? [entry.couche] : entry.groupe.couches) ?? []
    const activeIsStillPublished = coucheActive.value && entrees.some((layer) =>
      layer.source === coucheActive.value?.source && layer.clef === coucheActive.value?.clef &&
      layer.detail === coucheActive.value?.detail && layer.storyKey === coucheActive.value?.storyKey)
    if (!activeIsStillPublished) coucheActive.value = ct?.coucheParDefaut ?? null
  },
  { immediate: true },
)
watch(selection, () => {
  coucheActive.value = couchesTheme.value?.coucheParDefaut ?? null
})

// Standalone map values are API-only. The static model supplies presentation
// and stable layer ordering; producer discovery and native cohort facts admit
// the layers/values at the active level. No scalar flag or static fallback.
const mapFacts = ref<Indicateur[]>([])
const mapStories = ref<Array<Record<string, unknown>>>([])
const mapMemberships = ref<NonNullable<Payload['programmes']>['mapMemberships']>([])
const mapGrantFacts = ref<Indicateur[]>([])
const mapAxes = ref<Record<string, string[]>>({})
const mapThemeMetadata = ref<ThemeMetadata | null>(null)
const mapDeclarations = ref<import('@/payload/semanticResourceClient').SemanticResourceDeclaration[]>([])
const mapIdentities = ref<Record<string, { contentVersion: string; referenceContentVersion: string }>>({})
const mapStatus = ref<'idle' | 'loading' | 'error' | 'ready'>('idle')
const retryMapFacts = ref(0)
const territoryRankTarget = ref<Territoire | null>(null)
const territoryRank = ref<{ territoryId: string; indicator: string; level: Territoire['type']; rank: ScalarComparisonRank } | null>(null)
const territoryRankStatus = ref<'idle' | 'loading' | 'error' | 'ready'>('idle')
let mapSequence = 0
let territoryRankSequence = 0
let territoryRankRequestKey: string | null = null
const indicateurScalaireActif = computed(() => {
  const layer = coucheActive.value
  return selection.value && layer?.source === 'indicateur' && layer.detail === null ? layer.clef : null
})
const niveauApi = computed(() => ({ communes: 'commune', epcis: 'epci', departements: 'departement' } as const)[niveau.value])

async function chargerRangCarte(focal: Territoire, force = false): Promise<void> {
  const theme = selection.value
  const indicator = indicateurScalaireActif.value
  const level = niveauApi.value
  const metadata = theme ? payload.value?.themeMetadata?.[theme] : undefined
  const page = indicator ? metadata?.indicator_pages?.[indicator] : undefined
  if (!theme || !indicator || !level || mapStatus.value !== 'ready' || !page || page.family !== 'scalar' || !payload.value) return
  const identity = mapIdentities.value[indicator]
  if (!identity) return
  const key = JSON.stringify([theme, indicator, level, focal.territoire,
    identity.contentVersion, identity.referenceContentVersion])
  if (!force && territoryRankRequestKey === key &&
      ['loading', 'error', 'ready'].includes(territoryRankStatus.value)) return
  territoryRankTarget.value = focal
  territoryRankRequestKey = key
  const sequence = ++territoryRankSequence
  territoryRank.value = null
  territoryRankStatus.value = 'loading'
  try {
    const rank = await chargerRangScalaire(indicator, theme, page, focal, payload.value.territoires, identity)
    if (sequence === territoryRankSequence) {
      territoryRank.value = rank ? { territoryId: focal.territoire, indicator, level, rank } : null
      territoryRankStatus.value = 'ready'
    }
  } catch {
    if (sequence === territoryRankSequence) territoryRankStatus.value = 'error'
  }
}

function selectionnerTerritoirePourRang(focal: Territoire): void {
  territoryRankTarget.value = focal
  territoryRank.value = null
  territoryRankStatus.value = 'idle'
  territoryRankRequestKey = null
  void chargerRangCarte(focal)
}

function retryTerritoryRank(): void {
  if (!territoryRankTarget.value) return
  territoryRankRequestKey = null
  void chargerRangCarte(territoryRankTarget.value, true)
}

watch([themeAcquisCarte, niveauApi, payload, chargementPayload, erreurPayload, retryMapFacts],
  async ([theme, level, currentPayload, loadingPayload, payloadFailed]) => {
  const sequence = ++mapSequence
  // A pending comparison belongs to the cohort/layer that initiated it. Invalidate
  // it before resetting the visible rank state so a late response cannot revive it.
  territoryRankSequence++
  mapFacts.value = []
  mapStories.value = []
  mapMemberships.value = []
  mapGrantFacts.value = []
  mapAxes.value = {}
  mapThemeMetadata.value = null
  mapDeclarations.value = []
  mapIdentities.value = {}
  mapStatus.value = 'idle'
  territoryRankTarget.value = null
  territoryRank.value = null
  territoryRankStatus.value = 'idle'
  territoryRankRequestKey = null
  if (!theme || !level || !currentPayload || loadingPayload || payloadFailed) return
  mapStatus.value = 'loading'
  try {
    let metadata: ThemeMetadata | undefined = currentPayload.themeMetadata?.[theme]
    if (!metadata) {
      const response = await fetch(`/data/theme_${theme}.json`)
      if (!response.ok) throw new Error('Métadonnées de présentation de la carte indisponibles')
      metadata = await response.json() as ThemeMetadata
      if (metadata.theme !== theme) throw new Error('Métadonnées de présentation incompatibles')
    }
    mapThemeMetadata.value = metadata
    const acquired = await acquireMapThemeFacts(theme, level, currentPayload.territoires,
      metadata.indicator_keys, metadata.subgroups.flatMap((subgroup) => subgroup.reading
        ? [{ storyKey: subgroup.reading.story_key, params: subgroup.reading.params }] : []),
      (declarations) => { if (sequence === mapSequence) mapDeclarations.value = declarations }, metadata.indicator_pages)
    if (sequence === mapSequence) {
      mapFacts.value = acquired.facts
      mapStories.value = acquired.stories
      mapMemberships.value = acquired.memberships as NonNullable<Payload['programmes']>['mapMemberships']
      mapGrantFacts.value = acquired.grants
      mapAxes.value = acquired.axes
      mapDeclarations.value = acquired.declarations
      mapIdentities.value = acquired.identities
      mapStatus.value = 'ready'
      if (territoryRankTarget.value) void chargerRangCarte(territoryRankTarget.value)
    }
  } catch {
    if (sequence === mapSequence) mapStatus.value = 'error'
  }
  }, { immediate: true })

watch([selection, indicateurScalaireActif, niveauApi], () => {
  territoryRankSequence++
  territoryRank.value = null
  territoryRankStatus.value = 'idle'
  territoryRankRequestKey = null
})

const payloadCarte = computed(() => {
  const current = payload.value
  if (!current) return current
  if (ongletProgrammes.value) {
    return { ...current, themeMetadata: { ...current.themeMetadata,
      programmes: mapThemeMetadata.value ?? current.themeMetadata?.programmes }, apercu: [],
      programmes: { membres: [], subventions: [], mapMemberships: mapMemberships.value },
      mapGrantFacts: mapStatus.value === 'ready' ? mapGrantFacts.value : [] }
  }
  const theme = selection.value
  if (!theme) return { ...current, apercu: [] }
  const indicateurs = current.indicateurs.filter((row) => row.theme !== theme)
  const histoires = current.histoires.filter((row) => row.theme !== theme)
  const acquired = mapStatus.value === 'ready' ? mapFacts.value.map((row) =>
    territoryRank.value && territoryRank.value.territoryId === row.territoire &&
      territoryRank.value.indicator === row.key && territoryRank.value.level === row.type
      ? { ...row, comparaisonApi: { rang: territoryRank.value.rank.rank,
          taille: territoryRank.value.rank.rankSize, portee: territoryRank.value.rank.scope } } : row) : []
  return { ...current, themeMetadata: { ...current.themeMetadata, [theme]: mapThemeMetadata.value ?? current.themeMetadata?.[theme] }, apercu: [], indicateurs: [...indicateurs, ...acquired],
    histoires: [...histoires, ...mapStories.value] as typeof current.histoires }
})

/** Le jeu de couches de l'onglet programmes au niveau courant (level-native —
 *  l'adhésion n'existe qu'à son ancrage, les subventions à chaque niveau). */
const couchesProgrammesDuNiveau = computed<CoucheProgramme[]>(() =>
  payloadCarte.value && ongletProgrammes.value
    ? couchesProgrammes(payloadCarte.value, niveau.value)
    : [],
)

/** La couche active de l'onglet programmes — le sigle demandé (s'il a des
 *  lignes au niveau courant — la re-jointure d'ADR-0019), sinon la couche
 *  par défaut (les subventions). */
const coucheProgrammesActive = computed<CoucheProgramme | null>(() => {
  if (!payloadCarte.value || !ongletProgrammes.value) return null
  const demandee = programmeSelectionne.value
  if (demandee) {
    const membre = couchesProgrammesDuNiveau.value.find(
      (c) => c.source === 'membre' && c.sigle === demandee,
    )
    if (membre) return membre
  }
  return coucheParDefautProgrammes(payloadCarte.value, niveau.value)
})

/** La couche passée à la carte — l'onglet programmes ou le thème. */
const coucheActiveCarte = computed<CoucheCarte | null>(() =>
  ongletProgrammes.value ? coucheProgrammesActive.value : coucheActive.value,
)

/** Les entrées de la sidebar — les couches programmes ou le jeu de couches du thème. */
const entreesSidebar = computed<EntreeCouches[]>(() =>
  ongletProgrammes.value
    ? couchesProgrammesDuNiveau.value.map((couche) => ({ type: 'couche' as const, couche }))
    : couchesTheme.value?.entrees ?? [],
)

function choisirCouche(couche: CoucheCarte): void {
  if (ongletProgrammes.value) {
    // l'état des couches programmes est l'URL — partageable, il survit au rechargement
    if (couche.source === 'membre') {
      router.replace({ query: { onglet: 'programmes', programme: couche.sigle } })
    } else if (couche.source === 'subvention') {
      router.replace({ query: { onglet: 'programmes' } })
    }
    return
  }
  if (couche.source === 'indicateur' || couche.source === 'histoire') {
    coucheActive.value = couche
  }
}

/** The layer's joined values per territoire — the indicator rows (clef +
 *  detail) or the histoire scalar, per the couche's source. */
function valeursDeLaCouche(couche: Couche): ReadonlyMap<string, { value: number | null; unit: string }> {
  const theme = selection.value as Theme
  const mapPayload = payloadCarte.value ?? payload.value!
  return couche.source === 'indicateur'
    ? indicateurParTerritoire(mapPayload.indicateurs, theme, couche.clef, couche.detail)
    : valeurHistoireParTerritoire(mapPayload, theme, couche.clef)
}

const legende = computed(() => {
  const m = masques.value?.[niveau.value]
  if (!payload.value || !m) return null

  // #282 — l'onglet programmes : la légende catégorielle in/out d'une couche
  // d'adhésion, la choroplèthe € (règle de trois) de la couche subventions.
  if (ongletProgrammes.value) {
    const couche = coucheProgrammesActive.value
    if (!couche) return null
    if (couche.source === 'membre') {
      return { couche, couleurs: [], seuils: [], estDivergente: false, unite: '', estPourcentage: false }
    }
    const parTerritoire = subventionsParTerritoire(payloadCarte.value ?? payload.value, niveau.value)
    const valeurs: number[] = []
    for (const ligne of parTerritoire.values()) {
      if (ligne.value !== null) valeurs.push(ligne.value)
    }
    const echelle = echelleValeurs(valeurs)
    const couleurs = echelleChoroplethe(ANCRAGE_PROGRAMMES, Math.max(2, echelle.seuils.length + 1))
    const unite = parTerritoire.values().next().value?.unit ?? ''
    return { couche, couleurs, seuils: echelle.seuils, estDivergente: false, unite, estPourcentage: unite === '%' }
  }

  const couche = coucheActive.value
  if (!couche || !selection.value) return null

  // #294 — l'échelle de la légende lit le MÊME jeu de lignes que le
  // remplissage : la collection du niveau actif jointe aux lignes de la couche
  // (la re-jointure d'ADR-0019, #281), jamais toutes les lignes du payload
  // (tous niveaux mélangés — la légende désaccordée de la carte). Fonctions
  // pures déterministes : mêmes entrées, mêmes bornes, plus aucune dérive.
  const parTerritoire = valeursDeLaCouche(couche)
  const jointe = collectionAvecValeurs(m, parTerritoire)
  const valeurs: number[] = []
  for (const feature of jointe.features) {
    const valeur = (feature.properties as { valeur?: number | null }).valeur
    if (typeof valeur === 'number') valeurs.push(valeur)
  }
  const echelle = echelleValeurs(valeurs)
  const couleurs =
    echelle.type === 'divergente'
      ? rampeDivergente(ANCRAGES_THEMES[selection.value], echelle.seuils)
      : echelleChoroplethe(
          ANCRAGES_THEMES[selection.value],
          Math.max(2, echelle.seuils.length + 1),
        )
  const premiere = parTerritoire.values().next().value
  return {
    couche,
    couleurs,
    seuils: echelle.seuils,
    estDivergente: echelle.type === 'divergente',
    unite: premiere?.unit ?? '',
    estPourcentage: premiere?.unit === '%',
  }
})

const classesFond = computed(() =>
  selection.value ? `carte--theme-${selection.value}` : 'carte--theme-apercu',
)
</script>

<template>
  <section class="carte" :class="classesFond" :aria-busy="chargementPayload || chargementGeometrie ? 'true' : 'false'">
    <div v-if="chargementPayload" class="carte-etat carte-etat--plein" role="status" aria-label="Chargement de la carte">
      <div class="squelette carte-squelette--ligne" />
      <div class="squelette carte-squelette--ligne" />
    </div>

    <div v-else-if="erreurPayload" class="carte-etat carte-etat--plein carte-etat--erreur">
      <AppIcon :icone="AlertCircle" :taille="28" class="carte-etat-icone" />
      <p class="carte-etat-texte">Impossible de charger les données de la carte.</p>
      <button type="button" class="carte-etat-bouton" @click="rechargerPayload">Réessayer</button>
    </div>

    <template v-else>
      <ThemeTabs
        :themes="themes"
        :selected="selectionOnglet"
        libelle-premier="Programmes et subventions"
        premier-slug="programmes"
        @select="choisirOnglet"
      />
      <div
        class="carte-corps"
        role="tabpanel"
        :id="idPanneau(slugPanneau)"
        :aria-labelledby="idOnglet(slugPanneau)"
      >
        <div
          v-if="chargementGeometrie"
          class="carte-etat"
          role="status"
          aria-label="Chargement du fond de carte"
        >
          <div class="squelette carte-squelette--carte" />
        </div>

        <div v-else-if="erreurGeometrie" class="carte-etat carte-etat--erreur">
          <AppIcon :icone="AlertCircle" :taille="28" class="carte-etat-icone" />
          <p class="carte-etat-texte">Impossible de charger le fond de carte.</p>
          <button type="button" class="carte-etat-bouton" @click="rechargerGeometrie">
            Réessayer
          </button>
        </div>

        <div v-else-if="geometrieAbsente" class="carte-etat">
          <AppIcon :icone="MapPinOff" :taille="28" class="carte-etat-icone" />
          <p class="carte-etat-texte">Fonds de carte indisponible.</p>
          <p class="carte-etat-detail">
            La géométrie des territoires n'est pas encore publiée.
          </p>
        </div>

        <template v-else>
          <MapExplorer
            :masques="masques!"
            :payload="payloadCarte ?? payload"
            :theme="selection"
            :couche="coucheActiveCarte"
            :niveau="niveau"
            :territoire-cible="demandeRecherche?.territoire ?? null"
            :requete-zoom="demandeRecherche?.requete ?? 0"
            @territoire-clique="selectionnerTerritoirePourRang"
          />
          <div v-if="themeAcquisCarte && mapStatus === 'loading'" class="carte-etat carte-etat--cohorte" role="status">
            <p class="carte-etat-texte">Chargement des valeurs natives de la carte…</p>
          </div>
          <div v-else-if="themeAcquisCarte && mapStatus === 'error'" class="carte-etat carte-etat--cohorte carte-etat--erreur" role="alert">
            <p class="carte-etat-texte">Impossible de charger les valeurs natives de la carte.</p>
            <button type="button" class="carte-etat-bouton" @click="retryMapFacts++">Réessayer</button>
          </div>
          <div v-if="territoryRankStatus === 'loading' && territoryRankTarget" class="carte-etat carte-etat--cohorte" role="status">
            <p class="carte-etat-texte">Chargement du rang dans son groupe de comparaison…</p>
          </div>
          <div v-else-if="territoryRankStatus === 'error' && territoryRankTarget" class="carte-etat carte-etat--cohorte carte-etat--erreur" role="alert">
            <p class="carte-etat-texte">Le rang de comparaison est indisponible.</p>
            <button type="button" class="carte-etat-bouton" @click="retryTerritoryRank">Réessayer</button>
          </div>
          <MapSidebar
            :territoires="payload.territoires"
            :niveau="niveau"
            :niveaux-disponibles="niveauxDisponibles"
            :entrees="entreesSidebar"
            :couche-active="coucheActiveCarte"
            :couleurs="legende?.couleurs ?? []"
            :seuils="legende?.seuils ?? []"
            :est-divergente="legende?.estDivergente ?? false"
            :unite="legende?.unite ?? ''"
            :est-pourcentage="legende?.estPourcentage ?? false"
            :couleur-vide="COULEUR_NEUTRE"
            :couleur-contour="COULEUR_CONTOUR"
            :couleur-membre="COULEUR_MEMBRE"
            @niveau-change="(n: NiveauMasque) => (niveauDemande = n)"
            @couche-change="choisirCouche"
            @recherche-territoire="rechercherTerritoire"
          />
        </template>
      </div>
    </template>
  </section>
</template>

<style scoped>
.carte {
  flex: 0 0 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  /* plein écran sous le header — dvh quand dispo, vh en secours ;
     flex: 0 0 auto pour que la hauteur explicite l'emporte sur le flex. */
  height: calc(100vh - var(--header-height));
  height: calc(100dvh - var(--header-height));
  background: var(--surface-secondary);
  transition: background-color 300ms ease-in-out;
}

.carte--theme-mobilite {
  background: var(--theme-mobilite-wash);
}

.carte--theme-demographie {
  background: var(--theme-demographie-wash);
}

.carte--theme-habitat {
  background: var(--theme-habitat-wash);
}

.carte--theme-economie {
  background: var(--theme-economie-wash);
}

.carte-corps {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}

.carte-etat {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-8);
  text-align: center;
  background: var(--surface-secondary);
}

.carte-etat--plein {
  position: static;
  flex: 1;
}

.carte-etat-icone {
  color: var(--text-tertiary);
}

.carte-etat-texte {
  margin: 0;
  color: var(--text-secondary);
  font: var(--text-body-lg);
}

.carte-etat-detail {
  margin: 0;
  color: var(--text-tertiary);
  font: var(--text-body-sm);
}

.carte-etat-bouton {
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

.carte-etat-bouton:hover {
  background: var(--surface-tertiary);
  border-color: var(--brand-500);
}

.carte-squelette--ligne {
  width: min(480px, 80%);
  height: 1rem;
}

.carte-squelette--carte {
  width: min(640px, 90%);
  height: min(320px, 50%);
}
</style>
