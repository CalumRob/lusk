<script setup lang="ts">
import type { TextBlock } from '@/fiche/content/themeContent'

defineProps<{
  blocks: readonly TextBlock[]
}>()
</script>

<template>
  <div class="cahier-prose">
    <p v-for="(block, blockIndex) in blocks" :key="blockIndex" class="cahier-baseline-first-line">
      <template v-for="(segment, segmentIndex) in block" :key="segmentIndex">
        <strong
          v-if="segment.kind === 'emphasis'"
          :class="{
            'region-emphasis': segment.tone === 'region',
            'theme-emphasis': segment.tone === 'theme',
            'car-emphasis': segment.tone === 'car',
            'bike-emphasis': segment.tone === 'bike',
            'foot-emphasis': segment.tone === 'foot',
            'neutral-emphasis': segment.tone === 'neutral',
            'default-emphasis': segment.tone === 'default',
          }"
        >{{ segment.value }}</strong>
        <template v-else>{{ segment.value }}</template>
      </template>
    </p>
  </div>
</template>

<style>
@import './cahierLayout.css';

.cahier-prose p { margin: 0; }
.cahier-prose p:last-child { margin-bottom: 0; }
.cahier-prose strong.theme-emphasis { color: var(--cahier-theme-emphasis); font-weight: 700; }
.cahier-prose strong.region-emphasis { color: var(--cahier-region-emphasis); font-weight: 700; }
.cahier-prose strong.car-emphasis { color: var(--cahier-mode-car); font-weight: 700; }
.cahier-prose strong.bike-emphasis { color: var(--cahier-mode-bike); font-weight: 700; }
.cahier-prose strong.foot-emphasis { color: var(--cahier-mode-foot); font-weight: 700; }
.cahier-prose strong.neutral-emphasis { color: var(--cahier-default, var(--muted, #62706c)); font-weight: 700; }
.cahier-prose strong.default-emphasis { font-weight: 700; }
</style>
