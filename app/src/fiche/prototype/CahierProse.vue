<script setup lang="ts">
import type { TextBlock } from '@/fiche/content/themeContent'
import { AEDAR_TIME_MODE_COLORS } from './aedarTimeModeColors'
import AppIcon from '@/components/AppIcon.vue'
import { ArrowRight } from 'lucide-vue-next'

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
        <strong
          v-else-if="segment.kind === 'mode-emphasis'"
          class="aedar-mode-emphasis"
          :style="{ color: AEDAR_TIME_MODE_COLORS[segment.mode] }"
        >{{ segment.value }}</strong>
        <a
          v-else-if="segment.kind === 'link'"
          class="cahier-prose__link"
          :href="segment.href"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ segment.value }}<AppIcon :icone="ArrowRight" :taille="12" aria-hidden="true" class="cahier-prose__link-icon" />
        </a>
        <template v-else>{{ segment.value }}</template>
      </template>
    </p>
  </div>
</template>

<style>
@import './cahierLayout.css';

.cahier-prose p { margin: 0; }
.cahier-prose p:last-child { margin-bottom: 0; }
.cahier-prose strong { font-family: var(--font-body-emphasis); }
.cahier-prose strong.aedar-mode-emphasis { font-weight: 700; }
.cahier-prose a.cahier-prose__link {
  color: var(--accent-primary);
  font-weight: 600;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}
.cahier-prose a.cahier-prose__link:hover { color: var(--accent-hover); }
.cahier-prose a.cahier-prose__link:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
  border-radius: 2px;
}
.cahier-prose__link-icon { margin-inline-start: 0.16em; vertical-align: -0.12em; }
.cahier-prose strong.theme-emphasis { color: var(--cahier-theme-emphasis); font-weight: 700; }
.cahier-prose strong.region-emphasis { color: var(--color-figure-reference); font-weight: 700; }
.cahier-prose strong.car-emphasis { color: var(--color-figure-mode-car); font-weight: 700; }
.cahier-prose strong.bike-emphasis { color: var(--color-figure-mode-bike); font-weight: 700; }
.cahier-prose strong.foot-emphasis { color: var(--color-figure-mode-foot); font-weight: 700; }
.cahier-prose strong.neutral-emphasis { color: var(--cahier-default, var(--muted, #62706c)); font-family: var(--font-body); font-weight: 700; }
.cahier-prose strong.default-emphasis { font-weight: 700; }
</style>
