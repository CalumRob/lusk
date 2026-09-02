<script setup lang="ts">
import { RouterLink } from 'vue-router'
import type { RouteLocationRaw } from 'vue-router'

import type { NumericFact } from '@/fiche/content/territoryFacts'

const props = withDefaults(
  defineProps<{
    fact: NumericFact
    to?: RouteLocationRaw | null
    placement?: 'inline' | 'comparison' | 'access'
  }>(),
  { to: null, placement: 'inline' },
)

function rankText(fact: NumericFact): string | null {
  const rank = fact.comparison?.rank
  if (!rank) return null
  return `${rank.position === 1 ? '1er' : `${rank.position}e`}/${rank.size}`
}

function rankDescription(fact: NumericFact): string | null {
  const rank = rankText(fact)
  if (!rank || !fact.comparison) return null
  return `${rank} — ${fact.comparison.direction === 'plus-est-mieux' ? 'plus est mieux' : 'moins est mieux'}`
}

function isExtreme(fact: NumericFact): boolean {
  const rank = fact.comparison?.rank
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
  <template v-if="rankText(props.fact)">
    <RouterLink
      v-if="props.to"
      :to="props.to"
      target="_blank"
      rel="noopener noreferrer"
      class="cahier-rank rank-emphasis rank-link"
      :class="[`cahier-rank--${props.placement}`, { 'is-extreme': isExtreme(props.fact) }]"
      :style="rankStyle(props.fact.key)"
      :title="rankDescription(props.fact) ?? undefined"
      :aria-label="rankDescription(props.fact) ?? undefined"
    >{{ rankText(props.fact) }}</RouterLink>
    <span
      v-else
      class="cahier-rank rank-emphasis"
      :class="[`cahier-rank--${props.placement}`, { 'is-extreme': isExtreme(props.fact) }]"
      :style="rankStyle(props.fact.key)"
      :title="rankDescription(props.fact) ?? undefined"
    >{{ rankText(props.fact) }}</span>
  </template>
</template>

<style scoped>
.cahier-rank {
  color: var(--cahier-region-emphasis);
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

.cahier-rank--comparison { text-align: right; }
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
