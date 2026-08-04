<script setup lang="ts">
/**
 * MapLegend — the map's legend (ui-elements.md §Map shell, layouts.md §3):
 * the theme's choropleth buckets (colour swatch + numeric range — color is
 * never the sole carrier, DESIGN.md §8) plus the no-data row, or — in Aperçu
 * (no theme) — the active mask level's simple note. Collapsible.
 */
import { ChevronDown } from 'lucide-vue-next'
import { computed, ref } from 'vue'

import AppIcon from '@/components/AppIcon.vue'
import type { ConfigCouche } from '@/carte/configCouche'
import type { NiveauMasque } from '@/geo/types'
import { NOMS_NIVEAUX } from '@/geo/types'

const props = defineProps<{
  niveau: NiveauMasque
  config: ConfigCouche | null
  couleurs: string[]
  seuils: number[]
  unite: string
  estPourcentage: boolean
}>()

const repliee = ref(false)

/** French number — comma decimal, thin-space thousands (the legend's bounds). */
function formaterSeuil(x: number): string {
  const brute = props.estPourcentage ? x * 100 : x
  const fixe = brute.toFixed(brute % 1 === 0 ? 0 : 1)
  const [entiers, decPart = ''] = fixe.split('.')
  const decs = decPart.replace(/0+$/, '')
  const groupes = entiers.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return decs ? `${groupes},${decs}` : groupes
}

const bornes = computed<{ couleur: string; debut: string | null; fin: string | null }[]>(() => {
  if (props.seuils.length === 0) return []
  const premier = props.seuils[0]
  const dernier = props.seuils[props.seuils.length - 1]
  return [
    { couleur: props.couleurs[0], debut: null, fin: formaterSeuil(premier) },
    ...props.seuils.slice(1).map((seuil, i) => ({
      couleur: props.couleurs[i + 1],
      debut: formaterSeuil(props.seuils[i]),
      fin: formaterSeuil(seuil),
    })),
    {
      couleur: props.couleurs[props.seuils.length],
      debut: formaterSeuil(dernier),
      fin: null,
    },
  ]
})
</script>

<template>
  <section class="carte-legendes" :aria-label="config ? `Légende — ${config.libelle}` : 'Légende de la carte'">
    <button type="button" class="carte-legendes-entete" :aria-expanded="!repliee" @click="repliee = !repliee">
      <h2 class="carte-legendes-titre">{{ config ? config.libelle : NOMS_NIVEAUX[niveau] }}</h2>
      <AppIcon :icone="ChevronDown" :taille="16" class="carte-legendes-chevron" :class="{ 'est-replie': repliee }" />
    </button>

    <div v-show="!repliee" class="carte-legendes-corps">
      <template v-if="config && bornes.length > 0">
        <ul class="carte-legendes-gammes">
          <li
            v-for="(borne, index) in bornes"
            :key="index"
            class="carte-legendes-gamme"
          >
            <span class="carte-legendes-swatch" :style="{ backgroundColor: borne.couleur }" aria-hidden="true" />
            <span class="carte-legendes-gamme-texte">
              {{
                borne.fin === null
                  ? `${borne.debut} et +`
                  : borne.debut === null
                    ? `≤ ${borne.fin}`
                    : `${borne.debut} – ${borne.fin}`
              }}
              <span class="carte-legendes-unite">{{ unite }}</span>
            </span>
          </li>
        </ul>
        <p class="carte-legendes-vide">
          <span class="carte-legendes-swatch carte-legendes-swatch--vide" aria-hidden="true" />
          <span>Non disponible</span>
        </p>
      </template>

      <p v-else class="carte-legendes-masques">
        {{ NOMS_NIVEAUX[niveau] }} — les territoires, sans couche d'indicateurs.
      </p>
    </div>
  </section>
</template>

<style scoped>
.carte-legendes {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-primary);
  box-shadow: var(--shadow-subtle);
  overflow: hidden;
}

.carte-legendes-entete {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border: 0;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
}

.carte-legendes-titre {
  margin: 0;
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  text-transform: uppercase;
}

.carte-legendes-chevron {
  color: var(--text-tertiary);
  transition: transform 200ms ease-in-out;
}

.carte-legendes-chevron.est-replie {
  transform: rotate(-90deg);
}

.carte-legendes-corps {
  padding: 0 var(--space-4) var(--space-4);
}

.carte-legendes-gammes {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.carte-legendes-gamme {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font: var(--text-caption);
  color: var(--text-secondary);
}

.carte-legendes-swatch {
  width: 18px;
  height: 12px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

.carte-legendes-swatch--vide {
  background-color: var(--surface-tertiary);
  border: 1px solid var(--border-subtle);
}

.carte-legendes-vide {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin: var(--space-3) 0 0;
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-subtle);
  font: var(--text-caption);
  color: var(--text-tertiary);
}

.carte-legendes-masques {
  margin: 0;
  font: var(--text-body-sm);
  color: var(--text-secondary);
}
</style>
