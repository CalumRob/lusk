<script setup lang="ts">
import { RouterLink } from 'vue-router'
import type { RouteLocationRaw } from 'vue-router'

import type { NumericFact } from '@/fiche/content/territoryFacts'
import { comparisonRank } from '@/fiche/content/comparisonRank'
import { puceRangDirection } from '@/fiche/figureGrammaire'

const props = withDefaults(
  defineProps<{
    fact?: NumericFact
    servedRank?: { position: number; size: number; direction: import('@/methodes/indicateurs').DirectionRang; key: string } | null
    to?: RouteLocationRaw | null
    placement?: 'inline' | 'comparison' | 'access'
    decorative?: boolean
  }>(),
  { to: null, placement: 'inline', decorative: false },
)

function rankText(fact?: NumericFact, servedRank?: { position: number; size: number } | null): string | null {
  const rank = servedRank ?? fact?.comparison?.rank
  if (rank) {
    if (!Number.isInteger(rank.position) || !Number.isInteger(rank.size) || rank.position < 1 || rank.size < 2 || rank.position > rank.size) return null
    return `${rank.position === 1 ? '1er' : `${rank.position}e`}/${rank.size}`
  }
  return fact ? comparisonRank(fact)?.rang ?? null : null
}

function rankDescription(fact?: NumericFact, servedRank?: { position: number; size: number; direction: string } | null): string | null {
  const rank = rankText(fact, servedRank)
  const direction = servedRank?.direction ?? fact?.comparison?.direction
  if (!rank || !direction) return null
  return puceRangDirection(rank, direction as import('@/methodes/indicateurs').DirectionRang).phrase
}

function isExtreme(fact?: NumericFact): boolean {
  const rank = fact?.comparison?.rank
  if (!rank) return false
  const edge = Math.max(1, Math.ceil(rank.size * 0.05))
  return rank.position <= edge || rank.position > rank.size - edge
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
  <template v-if="rankText(props.fact, props.servedRank)">
    <RouterLink
      v-if="props.to && props.fact"
      :to="props.to"
      target="_blank"
      rel="noopener noreferrer"
      class="cahier-rank rank-emphasis rank-link"
      :class="[`cahier-rank--${props.placement}`, { 'is-extreme': isExtreme(props.fact) }]"
      :style="rankStyle(props.fact.key)"
      :title="rankDescription(props.fact, props.servedRank) ?? undefined"
      :aria-label="props.decorative ? undefined : rankDescription(props.fact) ?? undefined"
      :aria-hidden="props.decorative ? 'true' : undefined"
    >{{ rankText(props.fact, props.servedRank) }}</RouterLink>
    <span
      v-else
      class="cahier-rank rank-emphasis"
      :class="[`cahier-rank--${props.placement}`, { 'is-extreme': isExtreme(props.fact) }]"
      :style="rankStyle(props.fact?.key ?? props.servedRank?.key ?? '')"
      :title="rankDescription(props.fact, props.servedRank) ?? undefined"
      role="img"
      :aria-label="props.decorative ? undefined : rankDescription(props.fact, props.servedRank) ?? undefined"
      :aria-hidden="props.decorative ? 'true' : undefined"
    >{{ rankText(props.fact, props.servedRank) }}</span>
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

.cahier-rank.is-extreme {
  position: relative;
  z-index: 0;
  display: inline-block;
  width: max-content;
  padding: 4px 2px 5px;
  border: 0;
  line-height: 1.2;
  text-decoration: none;
}

.cahier-rank.is-extreme::before,
.cahier-rank.is-extreme::after {
  position: absolute;
  z-index: 0;
  content: '';
  pointer-events: none;
}

.cahier-rank.is-extreme::before {
  inset: -2px -2px -3px;
  border: 1px solid var(--red);
  border-top-color: color-mix(in srgb, var(--red) 48%, transparent);
  border-radius: var(--rank-radius-a, 48% 53% 46% 52% / 54% 45% 55% 47%);
  transform: rotate(var(--rank-angle-a, -4deg));
}

.cahier-rank.is-extreme::after {
  inset: -3px -2px -2px -3px;
  border: 1px solid transparent;
  border-left-color: color-mix(in srgb, var(--red) 48%, transparent);
  border-right-color: color-mix(in srgb, var(--red) 72%, transparent);
  border-bottom-color: color-mix(in srgb, var(--red) 72%, transparent);
  border-radius: var(--rank-radius-b, 53% 46% 54% 47% / 46% 56% 44% 54%);
  transform: rotate(var(--rank-angle-b, 4deg));
}

.cahier-rank--comparison.is-extreme { margin-left: auto; }
.cahier-rank--access.is-extreme { margin-inline: auto; }

.cahier-rank:hover { text-decoration: none; }
.cahier-rank:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
</style>
