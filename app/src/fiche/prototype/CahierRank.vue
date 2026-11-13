<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import type { RouteLocationRaw } from 'vue-router'

import type { NumericFact } from '@/fiche/content/territoryFacts'
import { comparisonRank } from '@/fiche/content/comparisonRank'
import { estRangExtreme, formatServedRank, puceRangDirection } from '@/fiche/figureGrammaire'
import type { DirectionRang } from '@/methodes/indicateurs'

const props = withDefaults(
  defineProps<{
    fact?: NumericFact
    servedRank?: { position: number; size: number; ties?: number | null; direction: DirectionRang; key: string } | null
    to?: RouteLocationRaw | null
    placement?: 'inline' | 'comparison' | 'access'
    decorative?: boolean
  }>(),
  { to: null, placement: 'inline', decorative: false },
)

/**
 * The one rank this mark displays. A producer-served rank is authoritative when
 * present (it belongs to the active selection); the fact's comparison rank is
 * the fallback for a native fact. Text, tie marker, outline and accessible
 * description all read this same input, so they can never disagree.
 */
const effectiveRank = computed(() => props.servedRank ?? props.fact?.comparison?.rank ?? null)
const rankText = computed(() => formatServedRank(effectiveRank.value))
const extreme = computed(() => estRangExtreme(effectiveRank.value))

function rankDescription(): string | null {
  if (props.servedRank) return puceRangDirection(props.servedRank, props.servedRank.direction)?.phraseAria ?? null
  return props.fact ? comparisonRank(props.fact)?.phraseAria ?? null : null
}

function rankStyle(seed: string): Record<string, string> {
  let hash = 0
  for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  const a = hash % 5
  const b = (hash >>> 3) % 5
  return {
    '--rank-angle-a': `${-5 + a}deg`,
    '--rank-angle-b': `${2 + b}deg`,
    '--rank-radius-a': `${47 + a}% ${54 - a}% ${45 + b}% ${53 - b}% / ${53 - b}% ${46 + a}% ${54 - a}% ${47 + b}%`,
    '--rank-radius-b': `${52 - b}% ${47 + a}% ${55 - a}% ${46 + b}% / ${45 + a}% ${55 - b}% ${46 + b}% ${54 - a}%`,
  }
}
</script>

<template>
  <template v-if="rankText">
    <RouterLink
      v-if="props.to && props.fact"
      :to="props.to"
      target="_blank"
      rel="noopener noreferrer"
      class="cahier-rank rank-emphasis rank-link"
      :class="`cahier-rank--${props.placement}`"
      :style="rankStyle(props.fact.key)"
      :title="rankDescription() ?? undefined"
      :aria-label="props.decorative ? undefined : rankDescription() ?? undefined"
      :aria-hidden="props.decorative ? 'true' : undefined"
    ><span class="cahier-rank-ink" :class="{ 'is-extreme': extreme }">{{ rankText }}</span></RouterLink>
    <span
      v-else
      class="cahier-rank rank-emphasis"
      :class="`cahier-rank--${props.placement}`"
      :style="rankStyle(props.fact?.key ?? props.servedRank?.key ?? '')"
      :title="rankDescription() ?? undefined"
      role="img"
      :aria-label="props.decorative ? undefined : rankDescription() ?? undefined"
      :aria-hidden="props.decorative ? 'true' : undefined"
    ><span class="cahier-rank-ink" :class="{ 'is-extreme': extreme }">{{ rankText }}</span></span>
  </template>
</template>

<style scoped>
.cahier-rank {
  color: var(--brand-200);
  font: var(--type-figure-comparison);
  font-weight: 700;
  line-height: 1.2;
  text-decoration: none;
}

.cahier-rank--comparison,
.cahier-rank--access {
  display: block;
  width: 100%;
}

.cahier-rank--comparison { text-align: center; }
.cahier-rank--access { text-align: center; }

.cahier-rank:hover { text-decoration: none; }
.cahier-rank:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
</style>

<style>
@import "./cahierRankCircle.css";
</style>
