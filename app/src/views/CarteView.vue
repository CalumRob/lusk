<script setup lang="ts">
/**
 * La carte interactive (/carte) — layouts.md §3: the ThemeTabs subheader
 * (reused — payload-driven, ?theme= in the URL, « Programmes & financements »
 * as the first tab per ADR-0019, #282), then a full-bleed MapExplorer + a
 * 360px MapSidebar (mobile → bottom sheet).
 *
 * ADR-0019: the theme tab drives the map's LAYER SET (couchesDuTheme — the
 * layer model derives from the payload, never a carte-side spec). ?theme=
 * selects the theme's DEFAULT layer (coucheParDefaut — its first story
 * scalar); the sidebar's layer clicks switch the active couche (in-memory
 * state). The first tab is the « Programmes & financements » layer group
 * (#282): ?onglet=programmes (+ &programme=<sigle>) drives the membership
 * categorical highlights (level-native — ACV/PVD/ORT à la commune, CRTE/
 * Territoires d'industrie/ORT à l'EPCI, aucune au département) and the
 * subventions choropleth (total € à chaque niveau, échelle par la règle de
 * trois). ?onglet= et ?theme= sont MUTUELLEMENT EXCLUSIFS (l'un efface
 * l'autre) ; les deux absents = l'état neutre (masques seuls). L'URL est
 * l'état : elle survit au rechargement. States follow the shell's pattern:
 * skeleton while the payload/geometry load, a typed error with Retry, and
 * the honest « Fonds de carte indisponible. » when no mask file is published.
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
import { SIGLES_PROGRAMMES } from '@/payload/types'
import type { SigleProgramme, Territoire, Theme } from '@/payload/types'
import { usePayload } from '@/payload/usePayload'

const route = useRoute()
const router = useRouter()

const {
  payload,
  erreur: erreurPayload,
  chargement: chargementPayload,
  recharger: rechargerPayload,
} = usePayload()
const {
  masques,
  erreur: erreurGeometrie,
  chargement: chargementGeometrie,
  recharger: rechargerGeometrie,
} = useGeometrie()

const themes = computed(() => (payload.value ? themesPresent(payload.value) : []))

/** L'onglet programmes — ?onglet=programmes dans l'URL (ADR-0019 #282). */
const ongletProgrammes = computed(() => route.query.onglet === 'programmes')

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
  () => [route.query.theme, route.query.onglet, route.query.programme, payload.value, chargementPayload.value] as const,
  ([theme, onglet, programme, pl, busy]) => {
    // Le payload grandit : la normalisation attend que le wait-set soit
    // réglé — un thème absent pendant le chargement n'est pas encore une
    // normalisation à faire (jamais une réécriture d'URL sur du vide).
    if (!pl || busy) return
    const themesValides = themesPresent(pl) as string[]
    const themeValide = typeof theme === 'string' && themesValides.includes(theme)
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
    if (theme !== undefined || onglet !== undefined || programme !== undefined) {
      router.replace({ query: {} })
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
  selection.value && payload.value ? couchesDuTheme(payload.value, selection.value) : null,
)

/** The ACTIVE layer — in-memory state; reset to the theme's default on theme change (ADR-0019). */
const coucheActive = ref<Couche | null>(null)
watch(
  couchesTheme,
  (ct) => {
    coucheActive.value = ct?.coucheParDefaut ?? null
  },
  { immediate: true },
)

/** Le jeu de couches de l'onglet programmes au niveau courant (level-native —
 *  l'adhésion n'existe qu'à son ancrage, les subventions à chaque niveau). */
const couchesProgrammesDuNiveau = computed<CoucheProgramme[]>(() =>
  payload.value && ongletProgrammes.value
    ? couchesProgrammes(payload.value, niveau.value)
    : [],
)

/** La couche active de l'onglet programmes — le sigle demandé (s'il a des
 *  lignes au niveau courant — la re-jointure d'ADR-0019), sinon la couche
 *  par défaut (les subventions). */
const coucheProgrammesActive = computed<CoucheProgramme | null>(() => {
  if (!payload.value || !ongletProgrammes.value) return null
  const demandee = programmeSelectionne.value
  if (demandee) {
    const membre = couchesProgrammesDuNiveau.value.find(
      (c) => c.source === 'membre' && c.sigle === demandee,
    )
    if (membre) return membre
  }
  return coucheParDefautProgrammes(payload.value, niveau.value)
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
  return couche.source === 'indicateur'
    ? indicateurParTerritoire(payload.value!.indicateurs, theme, couche.clef, couche.detail)
    : valeurHistoireParTerritoire(payload.value!, theme, couche.clef)
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
    const parTerritoire = subventionsParTerritoire(payload.value, niveau.value)
    const valeurs: number[] = []
    for (const ligne of parTerritoire.values()) {
      if (ligne.value !== null) valeurs.push(ligne.value)
    }
    const echelle = echelleValeurs(valeurs)
    const couleurs = echelleChoroplethe(ANCRAGE_PROGRAMMES, Math.max(2, echelle.seuils.length + 1))
    return { couche, couleurs, seuils: echelle.seuils, estDivergente: false, unite: '€', estPourcentage: false }
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
        libelle-premier="Programmes &amp; financements"
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
            :payload="payload"
            :theme="selection"
            :couche="coucheActiveCarte"
            :niveau="niveau"
            :territoire-cible="demandeRecherche?.territoire ?? null"
            :requete-zoom="demandeRecherche?.requete ?? 0"
          />
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
