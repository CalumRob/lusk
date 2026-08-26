<script setup lang="ts">
/**
 * #501 — PROTOTYPE JETABLE : la barre de commutation partagée des trois
 * shells Repères. Fixe en bas d'écran, cliquable ET pilotable aux flèches
 * ← → ; préserve TOUS les paramètres d'URL (?niveau, ?territoire, ?detail,
 * ?vue…) pour que la comparaison A/B/C se fasse à état constant.
 *
 * Disponible UNIQUEMENT en développement : la page hôte ne l'importe qu'en
 * DEV (import dynamique éliminé à la compilation) — aucun trace en prod.
 */
import { onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { VarianteProto } from './protocole-types'

const props = defineProps<{ variante: VarianteProto }>()
const route = useRoute()
const router = useRouter()

const VARIANTES: readonly { id: VarianteProto; nom: string; resume: string }[] = [
  { id: 'A', nom: 'Récit', resume: 'dossier vertical continu' },
  { id: 'B', nom: 'Console', resume: 'poste de lecture scindé' },
  { id: 'C', nom: 'Atlas', resume: 'plateau de tuiles' },
]

function choisir(id: VarianteProto): void {
  if (id === props.variante) return
  router.replace({ query: { ...route.query, variant: id } })
}

function quitter(): void {
  const query = { ...route.query }
  delete (query as Record<string, unknown>).variant
  router.replace({ query })
}

function decaler(delta: number): void {
  const ids = VARIANTES.map((v) => v.id)
  const index = ids.indexOf(props.variante)
  choisir(ids[(index + delta + ids.length) % ids.length]!)
}

function surTouche(evenement: KeyboardEvent): void {
  const cible = evenement.target as HTMLElement | null
  if (cible && ['INPUT', 'SELECT', 'TEXTAREA'].includes(cible.tagName)) return
  if (evenement.key === 'ArrowRight') {
    evenement.preventDefault()
    decaler(1)
  } else if (evenement.key === 'ArrowLeft') {
    evenement.preventDefault()
    decaler(-1)
  }
}

onMounted(() => window.addEventListener('keydown', surTouche))
onUnmounted(() => window.removeEventListener('keydown', surTouche))
</script>

<template>
  <div class="barre-variantes" role="toolbar" aria-label="Sélecteur de variantes du prototype (#501)">
    <span class="proto-tag">PROTO #501</span>
    <button
      v-for="v in VARIANTES"
      :key="v.id"
      type="button"
      class="v-btn"
      :class="{ actif: v.id === variante }"
      :title="`${v.nom} — ${v.resume} (flèches ← → pour cycler)`"
      @click="choisir(v.id)"
    >
      <strong>{{ v.id }}</strong>&nbsp;{{ v.nom }}
    </button>
    <button type="button" class="quitter" title="Quitter le prototype — shell de production" aria-label="Quitter le prototype" @click="quitter">×</button>
    <span class="indice-touches" aria-hidden="true">←→</span>
  </div>
</template>

<style scoped>
.barre-variantes{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:var(--z-toast);display:flex;align-items:center;gap:6px;padding:7px 10px;background:#1F2D2B;border-radius:999px;box-shadow:var(--shadow-prominent)}
.proto-tag{font:var(--text-overline);letter-spacing:.08em;background:var(--brand-100);color:#0C1B19;border-radius:999px;padding:4px 9px}
.v-btn{border:0;background:none;color:#C9D8D5;font:600 .85rem/1 var(--font-sans);padding:8px 13px;border-radius:999px;cursor:pointer}
.v-btn strong{font-weight:800;margin-right:2px}
.v-btn:hover{color:#FFFFFF;background:rgba(255,255,255,.08)}
.v-btn.actif{background:var(--brand-100);color:#0C1B19}
.quitter{border:0;background:none;color:#8FA5A1;font-size:1.15rem;line-height:1;padding:6px 10px;cursor:pointer;border-radius:999px}
.quitter:hover{color:#FFF;background:rgba(255,255,255,.08)}
.indice-touches{color:#8FA5A1;font:600 .72rem var(--font-sans);padding-right:2px}
@media(max-width:700px){.indice-touches{display:none}.v-btn{padding:8px 10px}}
</style>
