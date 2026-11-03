<script setup lang="ts">
/**
 * EchelleTerritoriale — l'échelle territoriale de la fiche (site-map.md §Fiche) :
 * les échelons sur lesquels le territoire se situe (commune → son EPCI → son
 * département → la région), chacun menant à sa fiche. Le territoire courant est
 * un non-lien avec aria-current="page". L'échelle elle-même est calculée par le
 * helper pur echelleContexte (les échelons inapplicables n'atteignent jamais ce
 * composant) ; la fiche possède le payload et les params de route.
 *
 * #860 — renommé de ContexteSwitcher : l'ancien nom entrait en collision avec le
 * « Contexte de comparaison » (CONTEXT.md).
 */
import { ChevronRight } from 'lucide-vue-next'
import { computed } from 'vue'

import AppIcon from '@/components/AppIcon.vue'
import { lienFiche } from '@/fiche/contratExploration'
import type { Territoire } from '@/payload/types'

const props = defineProps<{
  echelons: Territoire[]
}>()

const actuel = computed(() => props.echelons[0]?.territoire ?? null)
</script>

<template>
  <nav
    v-if="echelons.length > 0"
    class="echelle-territoriale"
    aria-label="Échelle territoriale"
  >
    <template v-for="(echelon, index) in echelons" :key="echelon.territoire">
      <span
        v-if="echelon.territoire === actuel"
        class="echelle-territoriale-actuel"
        aria-current="page"
      >{{ echelon.nom }}</span>
      <RouterLink
        v-else
        class="echelle-territoriale-lien"
        :to="lienFiche(echelon)"
      >{{ echelon.nom }}</RouterLink>
      <AppIcon
        v-if="index < echelons.length - 1"
        :icone="ChevronRight"
        :taille="14"
        class="echelle-territoriale-separateur"
      />
    </template>
  </nav>
</template>

<style scoped>
.echelle-territoriale {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-2);
  font: var(--text-body-sm);
}

.echelle-territoriale-lien {
  color: var(--accent-primary);
  font-weight: 500;
}

.echelle-territoriale-actuel {
  color: var(--text-primary);
  font-weight: 600;
}

.echelle-territoriale-separateur {
  color: var(--text-tertiary);
}
</style>
