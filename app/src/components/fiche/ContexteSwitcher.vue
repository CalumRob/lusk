<script setup lang="ts">
/**
 * ContexteSwitcher — the rank-in-context ladder (site-map.md §Fiche): the
 * steps a territory sits on (commune → son EPCI → son département → la
 * région), each linking to its fiche. The current territory is a non-link
 * with aria-current="page". The ladder itself is computed by the pure
 * echelleContexte helper (steps that don't apply never reach this component);
 * the fiche view owns the payload and the route params.
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
    class="contexte-switcher"
    aria-label="Contexte du territoire"
  >
    <template v-for="(echelon, index) in echelons" :key="echelon.territoire">
      <span
        v-if="echelon.territoire === actuel"
        class="contexte-switcher-actuel"
        aria-current="page"
      >{{ echelon.nom }}</span>
      <RouterLink
        v-else
        class="contexte-switcher-lien"
        :to="lienFiche(echelon)"
      >{{ echelon.nom }}</RouterLink>
      <AppIcon
        v-if="index < echelons.length - 1"
        :icone="ChevronRight"
        :taille="14"
        class="contexte-switcher-separateur"
      />
    </template>
  </nav>
</template>

<style scoped>
.contexte-switcher {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-2);
  font: var(--text-body-sm);
}

.contexte-switcher-lien {
  color: var(--accent-primary);
  font-weight: 500;
}

.contexte-switcher-actuel {
  color: var(--text-primary);
  font-weight: 600;
}

.contexte-switcher-separateur {
  color: var(--text-tertiary);
}
</style>
