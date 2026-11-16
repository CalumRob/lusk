<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'

import {
  MARQUE_LUSK_ERMINE,
  REMPLISSAGES_MARQUE_LUSK,
} from '@/components/luskBrandMark'
import type { RoleRemplissageMarqueLusk } from '@/components/luskBrandMark'
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
let observateur: ResizeObserver | null = null

function dessiner(zoneElement: HTMLElement): boolean {
  const zone = zoneElement.getBoundingClientRect()
  if (zone.width <= 0 || zone.height <= 0) return false
  tirage.value = tirerFiligrane(
    { largeur: zone.width, hauteur: zone.height },
    alea,
    bornesLargeurFiligrane(window.innerWidth),
  )
  return true
}

onMounted(() => {
  const zone = racine.value?.parentElement
  if (!zone || dessiner(zone)) return
  observateur = new ResizeObserver(() => {
    if (tirage.value) return
    if (!dessiner(zone)) return
    observateur?.disconnect()
    observateur = null
  })
  observateur.observe(zone)
})

onBeforeUnmount(() => observateur?.disconnect())

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

/** Ink stays the locked mark ink; the accent takes this surface's theme anchor. */
function remplissageFiligrane(role: RoleRemplissageMarqueLusk): string {
  return role === 'accent' ? 'var(--filigrane-accent)' : REMPLISSAGES_MARQUE_LUSK.ink
}
</script>

<template>
  <span
    ref="racine"
    class="filigrane-fiche"
    aria-hidden="true"
    :style="styleFiligrane"
  >
    <!-- The locked ermine geometry (luskBrandMark) with this surface's accent. -->
    <svg v-if="tirage" :viewBox="MARQUE_LUSK_ERMINE.viewBox" focusable="false">
      <path v-for="chemin in MARQUE_LUSK_ERMINE.chemins" :key="chemin.d" :d="chemin.d" :fill="remplissageFiligrane(chemin.role)" />
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
