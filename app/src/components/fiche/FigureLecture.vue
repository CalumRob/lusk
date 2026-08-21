<script setup lang="ts">
import FigureListeLQ from './FigureListeLQ.vue'
import type { LigneLQ } from '@/fiche/sousGroupes'
import type { FamilleFigure } from '@/payload/types'

defineProps<{
  famille: FamilleFigure
  lignes: LigneLQ[]
  labels: { rang: string; activite: string; lq: string }
}>()
</script>

<template>
  <FigureListeLQ v-if="famille === 'list'" :lignes="lignes" :labels="labels" />
</template>
