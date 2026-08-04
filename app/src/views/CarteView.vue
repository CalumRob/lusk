<script setup lang="ts">
/**
 * La carte interactive (/carte) — layouts.md §3: the ThemeTabs subheader
 * (reused — payload-driven, ?theme= in the URL, Aperçu default), then a
 * full-bleed MapExplorer + a 360px MapSidebar (mobile → bottom sheet).
 *
 * The theme tab drives the map's indicator layer and the legend (configCouche
 * — the seam's pure logic); Aperçu = territory masks only. States follow the
 * shell's pattern: skeleton while the payload/geometry load, a typed error
 * with Retry, and the honest « Fonds de carte indisponible. » when no mask
 * file is published yet (the pipeline ticket must publish the geometry).
 */
import { AlertCircle, MapPinOff } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import MapExplorer from '@/components/carte/MapExplorer.vue'
import MapSidebar from '@/components/carte/MapSidebar.vue'
import ThemeTabs from '@/components/ThemeTabs.vue'
import { ANCRAGES_THEMES, echelleChoroplethe } from '@/carte/couleurs'
import { configCoucheTheme } from '@/carte/configCouche'
import { indicateurParTerritoire } from '@/carte/fusion'
import { seuilsQuantiles } from '@/carte/seuils'
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

const NOMBRE_CLASSES = 5

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
const config = computed(() => (selection.value ? configCoucheTheme(selection.value) : null))
const legende = computed(() => {
  const cfg = config.value
  const m = masques.value?.[niveau.value]
  if (!cfg || !selection.value || !payload.value || !m) return null

  const parTerritoire = indicateurParTerritoire(
    payload.value.indicateurs,
    selection.value,
    cfg.indicateur,
  )
  const valeurs: number[] = []
  for (const ligne of parTerritoire.values()) {
    if (ligne.value !== null) valeurs.push(ligne.value)
  }
  const seuils = seuilsQuantiles(valeurs, NOMBRE_CLASSES)
  const couleurs = echelleChoroplethe(
    ANCRAGES_THEMES[selection.value],
    Math.max(2, seuils.length + 1),
  )
  const premier = parTerritoire.values().next().value
  return {
    config: cfg,
    couleurs,
    seuils,
    unite: premier?.unit ?? '',
    estPourcentage: premier?.unit === '%',
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
            :niveau="niveau"
          />
          <MapSidebar
            :territoires="payload.territoires"
            :niveau="niveau"
            :niveaux-disponibles="niveauxDisponibles"
            :config="legende?.config ?? null"
            :couleurs="legende?.couleurs ?? []"
            :seuils="legende?.seuils ?? []"
            :unite="legende?.unite ?? ''"
            :est-pourcentage="legende?.estPourcentage ?? false"
            @niveau-change="(n: NiveauMasque) => (niveauDemande = n)"
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
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
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
