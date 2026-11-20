<script setup lang="ts">
/** PROTOTYPE — throwaway. /prototype/atelier?variant=A|B|C — a blank Atelier page and the cell-picker modal. */
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import { CAHIER_COLOR_ROLES } from '@/fiche/prototype/cahierColorRoles'
import '@/fiche/prototype/cahierLayout.css'

import AtelierFigureModal, { type FigureSpec } from './AtelierFigureModal.vue'
import AtelierFigurePlaceholder from './AtelierFigurePlaceholder.vue'
import './atelierPrototype.css'
import { loadCatalogue, type ResourceDef } from './prototypeCellules'
import PrototypeSwitcher from './PrototypeSwitcher.vue'

const route = useRoute()
const variant = computed(() => (['A', 'B', 'C'].includes(String(route.query.variant).toUpperCase()) ? (String(route.query.variant).toUpperCase() as 'A' | 'B' | 'C') : 'A'))

/** Cross-theme page: the general (brand) ramp stands where a theme would. */
const roles = { ...CAHIER_COLOR_ROLES, '--cahier-theme': 'var(--brand-500)', '--cahier-theme-strong': 'var(--brand-700)', '--cahier-theme-emphasis': 'var(--brand-600)' }

const catalogue = ref<ResourceDef[]>([])
const status = ref<'loading' | 'ready' | 'error'>('loading')
const error = ref('')
const modalOpen = ref(false)
const figures = ref<{ id: number; spec: FigureSpec }[]>([])
let counter = 0

onMounted(async () => {
  try {
    catalogue.value = await loadCatalogue()
    status.value = 'ready'
    if (route.query.open === '1') modalOpen.value = true
  } catch (e) {
    status.value = 'error'
    error.value = e instanceof Error ? e.message : String(e)
  }
})

function create(spec: FigureSpec) {
  figures.value.push({ id: ++counter, spec })
  modalOpen.value = false
}
</script>

<template>
  <div class="atelier cahier presentation-editorial" :style="roles as Record<string, string>">
    <div class="atelier-wrap">
      <div class="atelier-page">
        <aside class="atelier-page__margin" aria-label="Marge">
          <p class="atelier-numeral">
            {{ String(figures.length).padStart(2, '0') }}
            <span>figure<template v-if="figures.length > 1">s</template></span>
          </p>
          <p v-if="!figures.length" class="atelier-marginalia">une page blanche</p>
        </aside>

        <header class="atelier-heading">
          <h1>Atelier</h1>
          <p>Registre expert · lecture libre des cellules</p>
        </header>

        <p v-if="!figures.length" class="atelier-prose">
          Composez vos propres figures à partir des <strong>cellules</strong> publiées : un nombre par territoire, à toutes ses coordonnées. Rien n’est calculé à votre place — une formule porte le nom de son expression.
        </p>

        <p v-if="status === 'loading'" class="atelier-prose" role="status">Lecture du catalogue des ressources…</p>
        <p v-else-if="status === 'error'" class="atelier-prose" role="alert">Le catalogue des ressources est injoignable ({{ error }}).</p>

        <div class="atelier-pages">
          <AtelierFigurePlaceholder
            v-for="(figure, index) in figures"
            :key="figure.id"
            :spec="figure.spec"
            :number="index + 1"
            @remove="figures = figures.filter((f) => f.id !== figure.id)"
          />
          <div v-if="status === 'ready'" class="at-slot">
            <p>{{ figures.length ? 'Une figure de plus ?' : 'Aucune figure sur cette page.' }}</p>
            <button type="button" class="at-add" @click="modalOpen = true"><span class="at-add__plus" aria-hidden="true">+</span>Ajouter une figure</button>
          </div>
        </div>
      </div>
    </div>

    <AtelierFigureModal :open="modalOpen" :variant="variant" :catalogue="catalogue" @close="modalOpen = false" @create="create" />
    <PrototypeSwitcher v-if="!modalOpen" />
  </div>
</template>
