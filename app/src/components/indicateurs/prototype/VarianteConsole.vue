<script setup lang="ts">
/**
 * #501 — PROTOTYPE JETABLE · Variante B « Console ».
 *
 * THÈSE STRUCTURALE : la Page d'indicateur comme POSTE DE LECTURE scindé.
 *  - Hiérarchie : deux panneaux — une console gauche FIXE (identité, héros
 *    numérique vivant, TOUS les réglages d'état) et une scène droite qui
 *    défile ; le héros ne quitte JAMAIS l'écran.
 *  - Navigation : les onglets sont raffinés en RAIL vertical permanent
 *    (Repères / Carte) + bouton « Comprendre » qui ouvre un TIROIR —
 *    L'indicateur devient une couche superposée, plus une vue sœur.
 *  - Héros : compact et permanent DANS la console (valeur pointée ou
 *    médiane), doublé d'une bande médiane+densité en tête de scène.
 *  - Contexte de comparaison : la console possède TOUT l'état (niveau,
 *    département/EPCI, recherche, détail) — la scène ne fait que lire.
 *  - Extrêmes/tableau FONDUS : une échelle unique triée par rang avec les
 *    3 premiers et 3 derniers épinglés, le milieu replié derrière un seuil.
 *  - Continuité territoire : la carte-territoire de la console se met à
 *    jour instantanément au clic sur n'importe quelle ligne.
 */
import { computed, ref } from 'vue'
import type { ProtocoleProps } from './protocole-types'
import { formaterValeur } from '@/payload/selectors'
import { situationContexte } from '@/indicateurs/explorationModel'
import { ancreSource } from '@/methodes/sources'
import RepereFamilyOutlet from '@/components/indicateurs/RepereFamilyOutlet.vue'
import MapExplorer from '@/components/carte/MapExplorer.vue'

const props = defineProps<ProtocoleProps>()

const unite = computed(() => props.dispatch.facet.unit)
function fmt(valeur: number | null): string {
  return valeur === null ? '—' : `${formaterValeur({ value: valeur, unit: unite.value })} ${unite.value}`
}
function rangLabel(row: { rang: number; rangTaille: number }): string {
  return `${row.rang === 1 ? '1er' : `${row.rang}e`} / ${row.rangTaille}`
}
const glyph = computed(() => (props.dispatch.facet.direction === 'low' ? '▼' : '▲'))
const dirText = computed(() => (props.dispatch.facet.direction === 'low' ? 'moins = mieux' : 'plus = mieux'))
const situation = computed(() => situationContexte(props.territoires, props.model.state))
const selection = computed(() => props.model.rows.find((row) => row.highlighted) ?? null)

/* ── Le héros vivant de la console : territoire pointé, sinon médiane ───── */
const heroValeur = computed(() => {
  const valeur = selection.value ? selection.value.value : props.model.median
  return valeur === null ? '—' : formaterValeur({ value: valeur, unit: unite.value })
})
const heroEtiquette = computed(() => (selection.value ? 'Territoire pointé' : `Médiane · ${props.model.scopeLabel}`))

/* ── Bande de densité compacte de la scène (y ∈ 16..126 dans un viewBox 140) ── */
const cheminDensite = computed(() =>
  props.model.density.length
    ? `M ${props.model.density.map((point, index, arr) => `${(index * (600 / Math.max(arr.length - 1, 1))).toFixed(2)},${(16 + point.y * 1.1).toFixed(2)}`).join(' L ')}`
    : '',
)
const marqueurCx = computed(() => (props.model.markerX !== null ? props.model.markerX * 6 : null))
const marqueurCy = computed(() => (props.model.markerY !== null ? 16 + props.model.markerY * 1.1 : null))

/* ── Réglages : niveaux, univers (département/EPCI), détail ─────────────── */
const libellesNiveau: Record<string, string> = { commune: 'Communes', epci: 'EPCI', departement: 'Départements' }
const optionsDepartements = computed(() => {
  const vus = new Map<string, string>()
  for (const territoire of props.territoires) {
    if (territoire.type !== 'commune' || !territoire.departement || vus.has(territoire.departement)) continue
    const dep = props.territoires.find((t) => t.type === 'departement' && t.departement === territoire.departement)
    vus.set(territoire.departement, dep?.nom ?? territoire.departement)
  }
  return [...vus.entries()].map(([code, nom]) => ({ code, nom })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
})
const optionsEpcis = computed(() => props.territoires.filter((t) => t.type === 'epci').map((t) => ({ code: t.territoire, nom: t.nom })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr')))

/* ── L'échelle fusionnée : extrêmes épinglés + milieu replié ────────────── */
const parRang = computed(() => [...props.model.rows].sort((a, b) => a.rang - b.rang))
const SEUIL_PINCES = 9
const echelleDepliee = ref(props.model.rows.length <= SEUIL_PINCES)
const taillePinces = computed(() => Math.max(props.model.rows.length - 6, 0))
function afficherLignes(): typeof props.model.rows {
  if (echelleDepliee.value || props.model.rows.length <= SEUIL_PINCES) return props.model.rows
  return [...parRang.value.slice(0, 3), ...parRang.value.slice(-3)]
}
const descriptionMarqueur = computed(() =>
  selection.value ? `${selection.value.territoire.nom} : ${fmt(selection.value.value)}, positionné sur l’axe de densité à sa valeur.` : '',
)
</script>

<template>
  <div class="console-shell" data-proto-variante="B">
    <!-- ════════ CONSOLE GAUCHE : identité + héros vivant + tout l'état ════ -->
    <aside class="console">
      <header class="console-identite">
        <p class="sur-titre">{{ metadata?.label }} · console</p>
        <h2>{{ page.label }}</h2>
        <p class="chip-direction" :title="dirText" :aria-label="dirText">{{ glyph }} {{ dirText }}</p>
      </header>

      <div class="console-hero" :class="{ pointee: selection }" data-testid="proto-b-heros">
        <span class="hero-etiquette">{{ heroEtiquette }}</span>
        <strong class="voix-recit hero-valeur">{{ heroValeur }}</strong>
        <small>{{ unite }}</small>
        <p v-if="selection" class="hero-sub">
          {{ rangLabel(selection) }}
          <RouterLink :to="selection.fiche">fiche</RouterLink>
          <button type="button" aria-label="Retirer le territoire pointé" title="Retirer le territoire pointé" @click="setQuery('territoire')">×</button>
        </p>
      </div>

      <!-- Le rail des vues : raffinement des onglets -->
      <nav class="rail-vues" aria-label="Vues de l’indicateur">
        <span class="rail-label">Vue</span>
        <button type="button" :class="{ actif: vue === 'reperes' }" @click="setVue('reperes')"><span aria-hidden="true">▦</span> Repères</button>
        <button type="button" :class="{ actif: vue === 'carte' }" @click="setVue('carte')"><span aria-hidden="true">◈</span> Carte</button>
        <button type="button" :class="{ actif: vue === 'indicateur' }" @click="setVue('indicateur')"><span aria-hidden="true">✳</span> Comprendre</button>
      </nav>

      <!-- La console possède TOUT l'état de comparaison -->
      <div class="console-controles">
        <fieldset class="segmente">
          <legend>Niveau</legend>
          <button
            v-for="niveau in page.levels"
            :key="niveau"
            type="button"
            :class="{ actif: model.state.niveau === niveau }"
            @click="setQuery('niveau', niveau)"
          >{{ libellesNiveau[niveau] ?? niveau }}</button>
        </fieldset>
        <template v-if="model.state.niveau === 'commune'">
          <label>Département
            <select :value="model.state.departement ?? ''" @change="setQuery('departement', ($event.target as HTMLSelectElement).value || undefined)">
              <option value="">Toute la Bretagne</option>
              <option v-for="dep in optionsDepartements" :key="dep.code" :value="dep.code">{{ dep.nom }}</option>
            </select>
          </label>
          <label>EPCI
            <select :value="model.state.epci ?? ''" @change="setQuery('epci', ($event.target as HTMLSelectElement).value || undefined)">
              <option value="">Toute la Bretagne</option>
              <option v-for="epci in optionsEpcis" :key="epci.code" :value="epci.code">{{ epci.nom }}</option>
            </select>
          </label>
        </template>
        <label v-if="dispatch.facet.details.length">Détail actif
          <select aria-label="Détail actif" :value="dispatch.facet.detail ?? ''" @change="setQuery('detail', ($event.target as HTMLSelectElement).value)">
            <option v-for="detail in dispatch.facet.details" :key="detail" :value="detail">{{ dispatch.facet.labels[detail] ?? detail }}</option>
          </select>
        </label>
        <label>Rechercher un {{ model.state.niveau === 'commune' ? 'territoire' : model.state.niveau === 'epci' ? 'EPCI' : 'département' }}
          <input type="search" :value="model.state.recherche ?? ''" placeholder="Nom…" @input="setQuery('recherche', ($event.target as HTMLInputElement).value)" />
        </label>
      </div>

      <p class="console-contexte">{{ situation.univers }}<span v-if="situation.horsPerimetre && situation.nom"> — {{ situation.nom }} est hors périmètre</span></p>
    </aside>

    <!-- ════════ SCÈNE DROITE : lecture seule, défile seule ═══════════════ -->
    <main class="scene">
      <template v-if="vue !== 'carte'">
        <div class="scene-haut">
          <article class="scene-mediane">
            <span>Médiane du périmètre</span>
            <strong class="voix-recit">{{ model.median === null ? '—' : formaterValeur({ value: model.median, unit: unite }) }} <small>{{ unite }}</small></strong>
          </article>
          <figure class="scene-densite" role="img" aria-label="Densité des valeurs du périmètre">
            <svg viewBox="0 0 600 140" preserveAspectRatio="none" aria-hidden="true">
              <title>Densité des valeurs</title>
              <desc v-if="descriptionMarqueur">{{ descriptionMarqueur }}</desc>
              <path v-if="cheminDensite" class="densite-courbe" :d="cheminDensite" />
              <circle v-if="marqueurCx !== null && marqueurCy !== null" class="densite-marqueur" :cx="marqueurCx" :cy="marqueurCy" r="6" />
            </svg>
            <figcaption>{{ model.rows.length }} valeurs · {{ situation.univers }}</figcaption>
            <span v-if="descriptionMarqueur" class="visuellement-cache">{{ descriptionMarqueur }}</span>
          </figure>
        </div>

        <RepereFamilyOutlet class="scene-famille" :dispatch="dispatch" :modele="trajectoire" :signature="signature" :profil="profil" :relation="relation" :composition="composition" :ensemble="ensemble" />

        <!-- Échelle fusionnée : extrêmes épinglés, milieu replié -->
        <section class="echelle">
          <header class="echelle-tete">
            <h2>Échelle des territoires — {{ model.scopeLabel }}</h2>
            <button type="button" class="basculer" @click="echelleDepliee = !echelleDepliee">
              {{ echelleDepliee ? 'Replier' : `Tout voir (${model.rows.length})` }}
            </button>
          </header>
          <table>
            <thead>
              <tr>
                <th scope="col"><button type="button" @click="setSort('rang')">Rang</button></th>
                <th scope="col"><button type="button" @click="setSort('nom')">Territoire</button></th>
                <th scope="col"><button type="button" @click="setSort('valeur')">Valeur</button></th>
                <th scope="col"><span :title="dirText" :aria-label="dirText">{{ glyph }}</span></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="(row, index) in afficherLignes()" :key="row.territoire.territoire">
                <tr v-if="index === 3 && taillePinces > 0 && !echelleDepliee && model.rows.length > SEUIL_PINCES" class="pince">
                  <td :colspan="4"><button type="button" class="ouvrir-pinces" @click="echelleDepliee = true">… {{ taillePinces }} territoires entre les deux — tout voir</button></td>
                </tr>
                <tr :class="{ selectionne: row.highlighted }">
                  <td class="cell-rang">{{ rangLabel(row) }}</td>
                  <td><RouterLink :to="row.fiche">{{ row.territoire.nom }}</RouterLink></td>
                  <td class="cell-valeur">{{ fmt(row.value) }}</td>
                  <td><button type="button" class="pointer" @click="setQuery('territoire', row.territoire.territoire)">Pointer</button></td>
                </tr>
              </template>
            </tbody>
          </table>
          <p v-if="model.high.count > 1 || model.low.count > 1" class="egalites-note">
            <span v-if="model.high.count > 1">{{ model.high.count }} territoires à égalité au sommet.</span>
            <span v-if="model.low.count > 1">{{ model.low.count }} territoires à égalité au plancher.</span>
          </p>
        </section>
      </template>

      <!-- Vue Carte : travail #398 inchangé, plein panneau -->
      <template v-else>
        <div v-if="masques" class="scene-carte"><MapExplorer :masques="masques" :payload="payloadCarte" :active-ids="payloadCarte.indicateurs.map((fact) => fact.territoire)" :theme="theme" :couche="couche" :niveau="niveauMasque" :territoire-cible="territoireCible" :requete-zoom="Number(Boolean(model.state.territoire))" /></div>
        <div v-else role="status">Chargement de la carte…</div>
      </template>

      <!-- Tiroir « Comprendre » : L'indicateur en COUCHE, pas en vue sœur -->
      <Transition name="tiroir">
        <aside v-if="vue === 'indicateur'" class="tiroir" role="dialog" aria-label="Comprendre l’indicateur">
          <header><h2>Comprendre — {{ page.label }}</h2><button type="button" class="fermer" @click="setVue('reperes')">Fermer ×</button></header>
          <dl class="notice">
            <dt>Définition</dt><dd>{{ page.definition }}</dd>
            <dt>Unité</dt><dd>{{ page.unit }}</dd>
            <dt>Calcul</dt><dd>{{ page.calculation }}</dd>
            <dt>Direction</dt><dd><span :title="dirText" :aria-label="dirText">{{ glyph }} {{ dirText }}</span></dd>
            <dt>Précautions</dt><dd>{{ page.caveats }}</dd>
          </dl>
          <section v-for="source in sources" :id="`indicator-source-${source.id}`" :key="source.id" class="carte-source">
            <h3>{{ source.dataset }}</h3>
            <p>Éditeur : {{ source.publisher }} · Licence : {{ source.licence ?? '—' }} · Millésime : {{ source.vintage ?? '—' }} · Fraîcheur : {{ source.freshness ?? '—' }}</p>
            <p v-if="source.caveat">Limite de la source : {{ source.caveat }}</p>
            <p class="source-liens">
              <a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">Jeu de données</a>
              <RouterLink :to="{ name: 'sources', hash: `#${ancreSource(source.id!)}` }">Fiche source</RouterLink>
            </p>
          </section>
          <p class="note-frontiere">Dans cette variante, la documentation est un tiroir au-dessus des Repères — elle ne remplace jamais la lecture.</p>
        </aside>
      </Transition>
    </main>
  </div>
</template>

<style scoped>
.visuellement-cache{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.console-shell{display:grid;grid-template-columns:360px minmax(0,1fr);height:calc(100vh - var(--header-height));background:var(--surface-secondary)}
.console{overflow-y:auto;padding:28px 26px 120px;background:var(--surface-primary);border-right:1px solid var(--border-default);display:flex;flex-direction:column;gap:22px}
.sur-titre{color:var(--indicateur-strong);font:var(--text-overline);text-transform:uppercase;margin:0}
.console-identite h2{font:var(--text-h2);letter-spacing:var(--text-h2-tracking);margin:.3rem 0 .5rem}
.chip-direction{display:inline-block;margin:0;font-size:.8rem;color:var(--text-secondary)}
.console-hero{padding:20px;background:var(--indicateur-wash);border-radius:var(--radius-lg);border:1px solid color-mix(in oklab, var(--indicateur-accent) 25%, transparent)}
.console-hero.pointee{border-width:2px}
.hero-etiquette{font:var(--text-overline);letter-spacing:var(--text-overline-tracking);text-transform:uppercase;color:var(--text-secondary)}
.hero-valeur{display:block;font:500 clamp(2.4rem,4vw,3.4rem)/1.05 var(--font-serif);letter-spacing:-0.02em;font-variant-numeric:tabular-nums;margin-top:.12em}
.hero-sub{margin:.5rem 0 0;display:flex;align-items:center;gap:10px;color:var(--text-secondary);font-size:.85rem}
.hero-sub button{margin-left:auto;border:0;background:none;cursor:pointer;color:var(--text-secondary);font-size:1rem;line-height:1}
.rail-vues{display:flex;flex-direction:column;gap:4px}
.rail-label{font:var(--text-overline);letter-spacing:var(--text-overline-tracking);text-transform:uppercase;color:var(--text-secondary);margin-bottom:2px}
.rail-vues button{display:flex;align-items:center;gap:10px;border:0;background:none;text-align:left;padding:9px 12px;border-radius:var(--radius-sm);cursor:pointer;font:600 .92rem var(--font-sans);color:var(--text-secondary)}
.rail-vues button:hover{background:var(--surface-tertiary)}
.rail-vues button.actif{background:var(--indicateur-soft);color:var(--indicateur-strong)}
.console-controles{display:flex;flex-direction:column;gap:14px}
.segmente{border:0;padding:0;margin:0}
.segmente legend{font:var(--text-caption);letter-spacing:var(--text-caption-tracking);color:var(--text-secondary);padding:0}
.segmente{display:flex;gap:0;border:1px solid var(--border-default);border-radius:var(--radius-sm);overflow:hidden}
.segmente legend{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
.segmente button{flex:1;border:0;background:var(--surface-primary);padding:9px 4px;cursor:pointer;font:600 .82rem var(--font-sans);color:var(--text-secondary);border-right:1px solid var(--border-default)}
.segmente button:last-child{border-right:0}
.segmente button.actif{background:var(--indicateur-strong);color:#FFF}
.console-controles label{display:flex;flex-direction:column;gap:4px;font:var(--text-caption);letter-spacing:var(--text-caption-tracking);color:var(--text-secondary)}
.console-controles select,.console-controles input{padding:8px;border:1px solid var(--border-default);border-radius:var(--radius-sm);background:var(--surface-primary);font:400 .9rem var(--font-sans)}
.console-contexte{margin:auto 0 0;padding-top:14px;border-top:1px solid var(--border-subtle);color:var(--text-secondary);font-size:.8rem}
.scene{position:relative;overflow-y:auto;padding:28px clamp(20px,3vw,48px) 140px;display:flex;flex-direction:column;gap:22px}
.scene-haut{display:grid;grid-template-columns:minmax(200px,.55fr) minmax(0,1fr);gap:18px;align-items:end}
.scene-mediane span{font:var(--text-overline);letter-spacing:var(--text-overline-tracking);text-transform:uppercase;color:var(--text-secondary)}
.scene-mediane strong{display:block;font:500 clamp(2.2rem,3.4vw,3rem)/1.05 var(--font-serif);font-variant-numeric:tabular-nums}
.scene-mediane small{font-size:1rem;font-weight:400}
.scene-densite{margin:0}
.scene-densite svg{width:100%;height:96px;display:block}
.densite-courbe{fill:none;stroke:var(--indicateur-accent);stroke-width:3}
.densite-marqueur{fill:var(--status-error);stroke:#FFF;stroke-width:2}
.scene-densite figcaption{color:var(--text-secondary);font-size:.78rem;text-align:right}
.scene-famille{max-width:1000px}
/* Le renderer scalaire porte un <p class="visually-hidden"> qui n'est réellement
   caché par AUCUNE règle globale (défaut préexistant du shell, observé #501) —
   la variante le masque localement. */
.scene-famille :deep(.visually-hidden){position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.echelle{background:var(--surface-primary);border:1px solid var(--border-default);border-radius:var(--radius-lg);overflow:hidden;align-self:stretch}
.echelle-tete{display:flex;align-items:center;justify-content:space-between;padding:14px 20px}
.echelle-tete h2{font:var(--text-h3);margin:0}
.basculer{border:1px solid var(--border-default);background:var(--surface-primary);border-radius:999px;padding:7px 14px;cursor:pointer;font:600 .82rem var(--font-sans);color:var(--accent-primary)}
.echelle table{width:100%;border-collapse:collapse}
.echelle th{text-align:left;padding:8px 20px;border-bottom:1px solid var(--border-default);font:var(--text-caption);letter-spacing:var(--text-caption-tracking);text-transform:uppercase;color:var(--text-secondary)}
.echelle th button{border:0;background:none;cursor:pointer;font:inherit;color:inherit;padding:0}
.echelle td{padding:9px 20px;border-bottom:1px solid var(--border-subtle)}
.cell-rang{font-variant-numeric:tabular-nums;color:var(--text-secondary);white-space:nowrap}
.cell-valeur{font-variant-numeric:tabular-nums}
tr.selectionne{background:var(--indicateur-soft)}
tr.pince td{padding:0;text-align:center;background:var(--surface-tertiary)}
.ouvrir-pinces{width:100%;border:0;background:none;cursor:pointer;padding:9px;color:var(--accent-primary);font:600 .85rem var(--font-sans)}
.pointer{border:0;background:none;color:var(--accent-primary);cursor:pointer;font:inherit}
.pointer:hover{text-decoration:underline}
.egalites-note{display:flex;gap:18px;margin:0;padding:10px 20px;color:var(--text-secondary);font-size:.82rem}
.scene-carte{position:relative;min-height:60vh;height:calc(100% - 40px);border:1px solid var(--border-default);border-radius:var(--radius-lg);overflow:hidden;background:var(--surface-primary)}
.scene-carte :deep(.map-explorer){height:100%}
.tiroir{position:absolute;top:12px;right:12px;bottom:12px;width:min(480px,calc(100% - 24px));overflow-y:auto;background:var(--surface-elevated);border:1px solid var(--border-default);border-radius:var(--radius-lg);box-shadow:var(--shadow-prominent);padding:22px 24px;z-index:80}
.tiroir header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.tiroir h2{font:var(--text-h3);margin:0}
.fermer{border:0;background:none;cursor:pointer;color:var(--text-secondary);font:inherit}
.notice{margin:0;display:grid;grid-template-columns:110px 1fr;gap:8px 14px;font-size:.9rem}
.notice dt{font-weight:700}
.notice dd{margin:0}
.carte-source{background:var(--surface-primary);border:1px solid var(--border-default);border-radius:var(--radius-md);padding:12px 16px;margin-top:14px}
.carte-source h3{margin:0 0 4px;font-size:.95rem}
.carte-source p{margin:.15rem 0;color:var(--text-secondary);font-size:.82rem}
.source-liens{display:flex;gap:14px}
.note-frontiere{margin-top:16px;color:var(--text-secondary);font-size:.8rem;font-style:italic}
.tiroir-enter-active,.tiroir-leave-active{transition:transform .25s ease,opacity .25s ease}
.tiroir-enter-from,.tiroir-leave-to{transform:translateX(24px);opacity:0}
@media(max-width:940px){
  .console-shell{display:block;height:auto}
  .console{border-right:0;border-bottom:1px solid var(--border-default);padding-bottom:30px}
  .scene{overflow:visible;padding-bottom:150px}
  .scene-haut{grid-template-columns:1fr}
  .tiroir{position:fixed;inset:12px;width:auto;z-index:calc(var(--z-overlay))}
}
</style>
