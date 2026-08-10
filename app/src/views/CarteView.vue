<script setup lang="ts">
/**
 * La carte interactive (/carte) — layouts.md §3: the ThemeTabs subheader
 * (reused — payload-driven, ?theme= in the URL, Aperçu default), then a
 * full-bleed MapExplorer + a 360px MapSidebar (mobile → bottom sheet).
 *
 * ADR-0019: the theme tab drives the map's LAYER SET (couchesDuTheme — the
 * layer model derives from the payload, never a carte-side spec). ?theme=
 * selects the theme's DEFAULT layer (coucheParDefaut — its first story
 * scalar); the sidebar's layer clicks switch the active couche (in-memory
 * state — the fine-grained layer URL encoding is a later ticket). Aperçu =
 * territory masks only (the neutral state). States follow the shell's
 * pattern: skeleton while the payload/geometry load, a typed error with
 * Retry, and the honest « Fonds de carte indisponible. » when no mask file
 * is published yet (the pipeline ticket must publish the geometry).
 */
import { AlertCircle, MapPinOff } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import MapExplorer from '@/components/carte/MapExplorer.vue'
import MapSidebar from '@/components/carte/MapSidebar.vue'
import ThemeTabs from '@/components/ThemeTabs.vue'
import {
  ANCRAGES_THEMES,
  COULEUR_CONTOUR,
  COULEUR_NEUTRE,
  echelleChoroplethe,
  rampeDivergente,
} from '@/carte/couleurs'
import { couchesDuTheme } from '@/carte/coucheModel'
import type { Couche, CouchesTheme } from '@/carte/coucheModel'
import { indicateurParTerritoire, valeurHistoireParTerritoire } from '@/carte/fusion'
import { echelleValeurs } from '@/carte/seuils'
import { idOnglet, idPanneau } from '@/fiche/onglets'
import type { SlugOnglet } from '@/fiche/onglets'
import { NIVEAUX_MASQUE } from '@/geo/types'
import type { NiveauMasque } from '@/geo/types'
import { useGeometrie } from '@/geo/useGeometrie'
import { themesPresent } from '@/payload/selectors'
import type { Theme } from '@/payload/types'
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

const selection = computed<Theme | null>(() => {
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

function choisirOnglet(slug: SlugOnglet): void {
  router.replace({ query: slug ? { theme: slug } : {} })
}

watch(
  () => [route.query.theme, payload.value] as const,
  ([theme, pl]) => {
    if (!pl) return
    if (typeof theme === 'string' && !(themesPresent(pl) as string[]).includes(theme)) {
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

function choisirCouche(couche: Couche): void {
  coucheActive.value = couche
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
  const couche = coucheActive.value
  const m = masques.value?.[niveau.value]
  if (!couche || !selection.value || !payload.value || !m) return null

  const parTerritoire = valeursDeLaCouche(couche)
  const valeurs: number[] = []
  for (const ligne of parTerritoire.values()) {
    if (ligne.value !== null) valeurs.push(ligne.value)
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
    <template v-if="payload">
      <ThemeTabs :themes="themes" :selected="selection" @select="choisirOnglet" />
      <div
        class="carte-corps"
        role="tabpanel"
        :id="idPanneau(selection)"
        :aria-labelledby="idOnglet(selection)"
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
            :couche="coucheActive"
            :niveau="niveau"
          />
          <MapSidebar
            :territoires="payload.territoires"
            :niveau="niveau"
            :niveaux-disponibles="niveauxDisponibles"
            :entrees="couchesTheme?.entrees ?? []"
            :couche-active="coucheActive"
            :couleurs="legende?.couleurs ?? []"
            :seuils="legende?.seuils ?? []"
            :est-divergente="legende?.estDivergente ?? false"
            :unite="legende?.unite ?? ''"
            :est-pourcentage="legende?.estPourcentage ?? false"
            :couleur-vide="COULEUR_NEUTRE"
            :couleur-contour="COULEUR_CONTOUR"
            @niveau-change="(n: NiveauMasque) => (niveauDemande = n)"
            @couche-change="choisirCouche"
          />
        </template>
      </div>
    </template>

    <div v-else-if="chargementPayload" class="carte-etat carte-etat--plein" role="status" aria-label="Chargement de la carte">
      <div class="squelette carte-squelette--ligne" />
      <div class="squelette carte-squelette--ligne" />
    </div>

    <div v-else-if="erreurPayload" class="carte-etat carte-etat--plein carte-etat--erreur">
      <AppIcon :icone="AlertCircle" :taille="28" class="carte-etat-icone" />
      <p class="carte-etat-texte">Impossible de charger les données de la carte.</p>
      <button type="button" class="carte-etat-bouton" @click="rechargerPayload">Réessayer</button>
    </div>
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
