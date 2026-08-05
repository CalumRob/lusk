<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'

import {
  FILIGRANE_ALEA_KEY,
  bornesLargeurFiligrane,
  couleurFiligrane,
  tirerFiligrane,
} from '@/fiche/filigrane'
import type { TirageFiligrane } from '@/fiche/filigrane'
import type { Theme } from '@/payload/types'

/**
 * FiligraneFiche — the fiche watermark (DESIGN.md §7): the locked ermine
 * drawn behind the tab content, ink kept, accents in the active theme's
 * anchor. Size and position are drawn once per mount — a tab switch remounts
 * (new draw), a re-render never moves it.
 */
const props = defineProps<{ theme: Theme | null }>()

const alea = inject(FILIGRANE_ALEA_KEY, Math.random)

const racine = ref<HTMLElement | null>(null)
const tirage = ref<TirageFiligrane | null>(null)

onMounted(() => {
  const zone = racine.value?.parentElement?.getBoundingClientRect()
  if (!zone) return
  tirage.value = tirerFiligrane(
    { largeur: zone.width, hauteur: zone.height },
    alea,
    bornesLargeurFiligrane(window.innerWidth),
  )
})

const styleFiligrane = computed<Record<string, string>>(() => ({
  opacity: 'var(--filigrane-opacity)',
  '--filigrane-accent': couleurFiligrane(props.theme),
  ...(tirage.value
    ? {
        left: `${tirage.value.x}px`,
        top: `${tirage.value.y}px`,
        width: `${tirage.value.largeur}px`,
      }
    : {}),
}))
</script>

<template>
  <span
    ref="racine"
    class="filigrane-fiche"
    aria-hidden="true"
    :style="styleFiligrane"
  >
    <!-- The locked ermine (LuskBrand) — same paths, accents recolored to the theme. -->
    <svg v-if="tirage" viewBox="15 95.7 86.4 47" focusable="false">
      <path d="M47.3 109.7 C 40.82 109.53, 33.51 110.13, 27.49 111.59 L27.38 116.18 C 29.35 115.72, 31.42 115.15, 33.5 114.6 C 40.5 112.9, 45 111.3, 47.3 110.6 Z" fill="var(--filigrane-accent)" />
      <path d="M27.49 111.59 C 26.27 111.89, 25.1 112.23, 24 112.6 C 20.8 113.8, 19 115.2, 18 116.8 C 20.29 117.52, 23.65 117.04, 27.38 116.18 L27.49 111.59 Z" fill="#1B1B19" />
      <path d="m96.3 111.1c-1-1.5-1.6-2.5-2.2-3.8-0.7-1.5-2-2.7-2.7-3.2v-0.1c-0.1-1.5-1.4-2.5-2.6-2.2-0.3 0.1-0.7 0.3-1 0.5-1.2-0.6-2.5-1-3.7-0.1-3.3-0.9-6.4-1.9-10.2-2.3-2.3-0.2-5.2-0.4-7.5-0.2-5.2 0.3-9.2 1.5-12.8 3.5-2.7 1.5-5 3.5-6.4 5.4-2 2.7-2.6 4.9-2.9 7.7l-0.2 1.9c-0.5 4-1.8 5.1-2.3 5.6-1.2 1.2-1.3 1.4-1.4 4.9 0 1.6-0.5 5.5 1.8 5.6 2 0 2.9-5.1 4-6.2 0.5-0.5 1.9-0.2 4-0.9 4.3-1.4 6.7-4.9 6.4-9.5-0.1-1.1-0.4-2.6-0.7-3.8 0.9 0.3 2.6 1.3 3.2 3.5 1.6-1.1 4.2-2.5 7.6-3.3 0.2-2.3 1.7-3.6 3.9-3.8-1.1 1.7-2.4 4.7-0.6 6.3 0.9 0.7 4.9 2.6 6.4 3.3 1.1 0.5 2.9 1.4 4 1.1s1.3-1.5 0.5-2.9c-0.5-1-1.7-2.5-2.9-3.7 1.5-1.1 3-1.3 4.9-0.8s3 1.1 5.5 1.5c1.3 0.2 4.2 0.3 5.8-0.2 1.2-0.5 2.9-1.6 2.1-3.8z" fill="#1B1B19" />
      <path d="m84.2 106.8s0.7-1.1 1.7-2c0.5-0.5 1-0.4 2.1-0.3-1.6-1.8-4-1.7-3.8 2.3z" fill="var(--filigrane-accent)" />
      <path d="m91.5 109.6c-0.1 0.5-0.6 0.9-1.1 0.8s-0.9-0.6-0.8-1.1 0.6-0.8 1.1-0.7 0.8 0.6 0.8 1z" fill="var(--filigrane-accent)" />
    </svg>
  </span>
</template>

<style scoped>
.filigrane-fiche {
  position: absolute;
  z-index: -1;
  pointer-events: none;
  user-select: none;
}

.filigrane-fiche svg {
  display: block;
  width: 100%;
  height: auto;
}
</style>
