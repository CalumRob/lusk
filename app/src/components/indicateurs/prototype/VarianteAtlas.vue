<script setup lang="ts">
/**
 * #501 — PROTOTYPE JETABLE · Variante C « Atlas ».
 *
 * THÈSE STRUCTURALE : la Page d'indicateur comme PLATEAU de tuiles, un seul
 * canvas comparatif — la métaphore du mur de données.
 *  - Hiérarchie APLATIE : l'en-tête se réduit à une barre-outil collante
 *    (titre compact + facette + TOUS les réglages en ligne).
 *  - Navigation DISSOUTE : ni onglets ni vues — Carte et L'indicateur sont
 *    des TUILES du même plateau ; ?vue=carte / ?vue=indicateur défilent
 *    vers leur tuile au lieu de changer d'écran.
 *  - Héros SURDIMENSIONNÉ : une tuile 2×2 (médiane serif + histogramme réel
 *    des valeurs + panneau « à la loupe »).
 *  - Extrêmes/tableau FONDUS autrement que B : liste-barres classée (chaque
 *    ligne porte sa valeur en largeur), extrêmes en tête et pied, milieu
 *    compté puis replié dans le classement complet.
 *  - Continuité territoire : le pointeur traverse TOUTES les tuiles — loupe
 *    du héros, ligne surlignée, réglette de position dans l'échelle.
 *  - Frontière Repères/L'indicateur : la notice devient une « fiche
 *    technique » au rang de tuile PAIR — documentation paire de la donnée.
 */
import { computed, watch } from 'vue'
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
const descriptionLoupe = computed(() =>
  selection.value ? `${selection.value.territoire.nom} — position dans l'échelle du périmètre.` : '',
)

/* ── Histogramme réel des valeurs (bins dérivés de model.distribution) ──── */
const histogramme = computed(() => {
  const distribution = props.model.distribution
  if (!distribution.length) return []
  const min = distribution[0]!
  const max = distribution[distribution.length - 1]!
  const nb = Math.min(28, Math.max(8, Math.ceil(Math.sqrt(distribution.length))))
  const span = max - min || 1
  const compte = new Array<number>(nb).fill(0)
  for (const valeur of distribution) compte[Math.min(nb - 1, Math.floor(((valeur - min) / span) * nb))]++
  const maxCompte = Math.max(...compte, 1)
  return compte.map((c, index) => ({ hauteur: (c / maxCompte) * 100, c, x0: min + (span * index) / nb }))
})

/* ── Liste-barres classée (extrêmes + classement fondus, autrement que B) ─ */
const parRang = computed(() => [...props.model.rows].sort((a, b) => a.rang - b.rang))
const SEUIL_MILIEU = 16
const milieuReplie = computed(() => parRang.value.length > SEUIL_MILIEU)
const teteClassement = computed(() => parRang.value.slice(0, 8))
const piedClassement = computed(() => parRang.value.slice(-4))
const nMilieu = computed(() => Math.max(parRang.value.length - 12, 0))
const valeurMaxAbsolue = computed(() => Math.max(...props.model.rows.map((row) => row.value), 1))
function largeurBarre(valeur: number): string {
  return `${Math.max((valeur / valeurMaxAbsolue.value) * 100, 2)}%`
}

/* ── Réglages de la barre-outil ──────────────────────────────────────────── */
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
function changerUnivers(evenement: Event): void {
  const valeur = (evenement.target as HTMLSelectElement).value
  props.setQuery('departement')
  props.setQuery('epci')
  if (valeur.startsWith('dep:')) props.setQuery('departement', valeur.slice(4))
  else if (valeur.startsWith('epci:')) props.setQuery('epci', valeur.slice(5))
}
const universCourant = computed(() => (props.model.state.departement ? `dep:${props.model.state.departement}` : props.model.state.epci ? `epci:${props.model.state.epci}` : ''))

/* ── ?vue → défilement vers la tuile correspondante (plus de vues) ──────── */
watch(
  () => props.vue,
  (vue) => {
    if (vue === 'reperes') window.scrollTo({ top: 0, behavior: 'smooth' })
    else if (vue === 'carte') document.getElementById('atlas-carte')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    else if (vue === 'indicateur') document.getElementById('atlas-notices')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  },
  { immediate: true },
)

const libelleFamille = computed(() => ({
  scalar: '',
  trajectory: 'La trajectoire complète',
  composition: 'Composition face au périmètre',
  distribution: 'Signature & ensemble de comparaison',
  list: 'Profil complet',
  relationship: 'La relation déclarée',
  pyramid: 'Structure par âge et sexe',
  'comparison-bars': 'Barres de comparaison',
}[props.dispatch.family] ?? ''))
</script>

<template>
  <div class="atlas" data-proto-variante="C">
    <!-- Barre-outil collante : hiérarchie aplatie -->
    <header class="barre">
      <div class="barre-titre">
        <p class="sur-titre">{{ metadata?.label }} · atlas</p>
        <h1>{{ page.label }}</h1>
        <span class="puce puce-facette">{{ dispatch.facet.label }}</span>
        <span class="puce" :title="dirText" :aria-label="dirText">{{ glyph }} {{ dirText }}</span>
      </div>
      <div class="barre-reglages">
        <div class="segmente" role="group" aria-label="Niveau">
          <button v-for="niveau in page.levels" :key="niveau" type="button" :class="{ actif: model.state.niveau === niveau }" @click="setQuery('niveau', niveau)">{{ libellesNiveau[niveau] ?? niveau }}</button>
        </div>
        <select v-if="model.state.niveau === 'commune'" aria-label="Univers comparé" :value="universCourant" @change="changerUnivers">
          <option value="">Bretagne</option>
          <optgroup label="Par département">
            <option v-for="dep in optionsDepartements" :key="`d-${dep.code}`" :value="`dep:${dep.code}`">{{ dep.nom }}</option>
          </optgroup>
          <optgroup label="Par EPCI">
            <option v-for="epci in optionsEpcis" :key="`e-${epci.code}`" :value="`epci:${epci.code}`">{{ epci.nom }}</option>
          </optgroup>
        </select>
        <select v-if="dispatch.facet.details.length" aria-label="Détail actif" :value="dispatch.facet.detail ?? ''" @change="setQuery('detail', ($event.target as HTMLSelectElement).value)">
          <option v-for="detail in dispatch.facet.details" :key="detail" :value="detail">{{ dispatch.facet.labels[detail] ?? detail }}</option>
        </select>
        <input type="search" aria-label="Rechercher" placeholder="Rechercher…" :value="model.state.recherche ?? ''" @input="setQuery('recherche', ($event.target as HTMLInputElement).value)" />
      </div>
    </header>

    <!-- Le plateau -->
    <div class="plateau">
      <!-- Tuile héros surdimensionnée -->
      <section class="tuile tuile-hero">
        <p class="sur-titre">Le périmètre en une valeur · {{ situation.univers }}</p>
        <p class="hero-nombre voix-recit">{{ model.median === null ? '—' : formaterValeur({ value: model.median, unit: unite }) }}<small> {{ unite }}</small></p>
        <p class="hero-sous">médiane · {{ model.rows.length }} {{ model.state.niveau === 'commune' ? 'communes' : model.state.niveau === 'epci' ? 'EPCIs' : 'départements' }}</p>
        <div v-if="histogramme.length" class="histogramme" role="img" aria-label="Histogramme des valeurs du périmètre">
          <span v-for="(bin, index) in histogramme" :key="index" class="bin" :style="{ height: `${Math.max(bin.hauteur, 3)}%` }" :title="`${fmt(bin.x0)} → ${bin.c} territoire(s)`" />
        </div>
        <div class="echelle-bas"><span>{{ histogramme.length ? fmt(histogramme[0]!.x0) : '' }}</span><span>{{ histogramme.length ? fmt(model.distribution[model.distribution.length - 1]!) : '' }}</span></div>
        <aside v-if="selection" class="loupe">
          <p class="loupe-titre">À la loupe</p>
          <strong class="voix-recit">{{ selection.territoire.nom }}</strong>
          <span class="loupe-valeur">{{ fmt(selection.value) }} · {{ rangLabel(selection) }}</span>
          <div class="reglette" role="img" :aria-label="descriptionLoupe">
            <span class="reglette-point" :style="{ left: `${model.markerX ?? 50}%` }" />
          </div>
          <p class="loupe-liens"><RouterLink :to="selection.fiche">fiche</RouterLink><button type="button" @click="setQuery('territoire')">retirer</button></p>
        </aside>
      </section>

      <!-- Tuile figure familiale -->
      <section class="tuile tuile-famille">
        <template v-if="libelleFamille">
          <p class="sur-titre">{{ libelleFamille }}</p>
          <RepereFamilyOutlet :dispatch="dispatch" :modele="trajectoire" :signature="signature" :profil="profil" :relation="relation" :composition="composition" :ensemble="ensemble" />
        </template>
        <template v-else>
          <p class="sur-titre">Où se situe chaque territoire</p>
          <p class="vide-scalar">Pour un indicateur scalaire, le repère EST la comparaison : l'histogramme ci-contre porte toutes les valeurs du périmètre ; le classement continu complète la lecture.</p>
        </template>
      </section>

      <!-- Tuile liste-barres : extrêmes + classement fondus -->
      <section id="atlas-classement" class="tuile tuile-classement">
        <p class="sur-titre">Le classement continu</p>
        <ul class="liste-barres">
          <li v-for="row in teteClassement" :key="`tete-${row.territoire.territoire}`" :class="{ selectionne: row.highlighted }">
            <button type="button" class="ligne-barres" @click="setQuery('territoire', row.territoire.territoire)">
              <em class="rang">{{ row.rang }}</em>
              <span class="nom">{{ row.territoire.nom }}</span>
              <span class="barre-zone"><span class="barre" :style="{ width: largeurBarre(row.value) }" /></span>
              <span class="valeur">{{ fmt(row.value) }}</span>
            </button>
          </li>
          <li v-if="milieuReplie" class="milieu">… {{ nMilieu }} territoires entre les deux …</li>
          <li v-for="row in piedClassement" :key="`pied-${row.territoire.territoire}`" :class="{ selectionne: row.highlighted }">
            <button type="button" class="ligne-barres" @click="setQuery('territoire', row.territoire.territoire)">
              <em class="rang">{{ row.rang }}</em>
              <span class="nom">{{ row.territoire.nom }}</span>
              <span class="barre-zone"><span class="barre" :style="{ width: largeurBarre(row.value) }" /></span>
              <span class="valeur">{{ fmt(row.value) }}</span>
            </button>
          </li>
        </ul>
        <details class="tableau-complet">
          <summary>Tableau complet — {{ model.rows.length }} lignes</summary>
          <div class="tri-ligne">
            Trier&nbsp;:
            <button type="button" @click="setSort('nom')">Nom</button>
            <button type="button" @click="setSort('valeur')">Valeur</button>
            <button type="button" @click="setSort('rang')">Rang</button>
            <span v-if="model.high.count > 1">{{ model.high.count }} ex æquo au sommet</span>
            <span v-if="model.low.count > 1">{{ model.low.count }} ex æquo au plancher</span>
          </div>
          <table>
            <tbody>
              <tr v-for="row in model.rows" :key="row.territoire.territoire" :class="{ selectionne: row.highlighted }">
                <td class="cell-rang">{{ rangLabel(row) }}</td>
                <td><RouterLink :to="row.fiche">{{ row.territoire.nom }}</RouterLink></td>
                <td class="cell-valeur">{{ fmt(row.value) }}</td>
                <td><button type="button" class="pointer" @click="setQuery('territoire', row.territoire.territoire)">Pointer</button></td>
              </tr>
            </tbody>
          </table>
        </details>
      </section>

      <!-- Tuile Carte (#398 inchangé) -->
      <section id="atlas-carte" class="tuile tuile-carte">
        <p class="sur-titre">Carte — {{ dispatch.facet.label }}</p>
        <div v-if="masques" class="cadre-carte"><MapExplorer :masques="masques" :payload="payloadCarte" :active-ids="payloadCarte.indicateurs.map((fact) => fact.territoire)" :theme="theme" :couche="couche" :niveau="niveauMasque" :territoire-cible="territoireCible" :requete-zoom="Number(Boolean(model.state.territoire))" /></div>
        <div v-else role="status" class="chargement-carte">Chargement de la carte…</div>
      </section>

      <!-- Tuile notice : documentation au rang de tuile -->
      <section id="atlas-notices" class="tuile tuile-notices">
        <p class="sur-titre">Notice &amp; sources</p>
        <dl class="notice">
          <dt>Définition</dt><dd>{{ page.definition }}</dd>
          <dt>Calcul</dt><dd>{{ page.calculation }}</dd>
          <dt>Précautions</dt><dd>{{ page.caveats }}</dd>
        </dl>
        <ul class="sources-liste">
          <li v-for="source in sources" :id="`indicator-source-${source.id}`" :key="source.id">
            <strong>{{ source.dataset }}</strong>
            <span>{{ source.publisher }} · {{ source.vintage ?? '—' }} · {{ source.licence ?? '—' }}</span>
            <RouterLink :to="{ name: 'sources', hash: `#${ancreSource(source.id!)}` }">fiche source</RouterLink>
          </li>
        </ul>
        <p class="note-frontiere">Ici, la documentation est une tuile du plateau — paire de la donnée, jamais un étage au-dessus.</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.atlas{--marge:max(20px,calc((100vw - 1360px)/2));padding:24px var(--marge) 150px}
.barre{position:sticky;top:var(--header-height);z-index:70;display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;padding:12px 18px;margin-bottom:18px;background:var(--surface-chrome);backdrop-filter:blur(var(--blur-chrome));border:1px solid var(--border-default);border-radius:var(--radius-lg)}
.barre-titre{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.barre-titre .sur-titre{margin:0}
.barre-titre h1{font:700 1.15rem/1.2 var(--font-sans);letter-spacing:-0.01em;margin:0}
.puce{padding:3px 10px;border-radius:999px;background:var(--indicateur-soft);color:var(--indicateur-strong);font:600 .75rem var(--font-sans);white-space:nowrap}
.puce-facette{background:var(--brand-100);color:#0C1B19}
.barre-reglages{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.segmente{display:flex;border:1px solid var(--border-default);border-radius:999px;overflow:hidden}
.segmente button{border:0;background:var(--surface-primary);padding:7px 13px;cursor:pointer;font:600 .8rem var(--font-sans);color:var(--text-secondary);border-right:1px solid var(--border-default)}
.segmente button:last-child{border-right:0}
.segmente button.actif{background:var(--indicateur-strong);color:#FFF}
.barre-reglages select,.barre-reglages input{max-width:220px;padding:7px 10px;border:1px solid var(--border-default);border-radius:999px;background:var(--surface-primary);font:400 .85rem var(--font-sans)}
.plateau{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:18px}
.tuile{background:var(--surface-primary);border:1px solid var(--border-default);border-radius:var(--radius-lg);padding:22px;min-width:0}
.tuile .sur-titre{font:var(--text-overline);letter-spacing:var(--text-overline-tracking);text-transform:uppercase;color:var(--indicateur-strong);margin:0 0 14px}
.tuile-hero{grid-column:1/6;grid-row:1/3;display:flex;flex-direction:column}
.hero-nombre{font:500 clamp(4rem,7vw,6.5rem)/1 var(--font-serif);letter-spacing:-0.02em;font-variant-numeric:tabular-nums;margin:.1em 0 0}
.hero-nombre small{font-size:clamp(1rem,1.5vw,1.4rem);color:var(--text-secondary);font-family:var(--font-sans)}
.hero-sous{margin:.4rem 0 18px;color:var(--text-secondary);font-size:.9rem}
.histogramme{display:flex;align-items:end;gap:3px;height:150px;border-bottom:2px solid var(--indicateur-line)}
.bin{flex:1;background:var(--indicateur-accent);opacity:.82;border-radius:3px 3px 0 0;min-height:3px}
.bin:hover{opacity:1}
.echelle-bas{display:flex;justify-content:space-between;color:var(--text-secondary);font-size:.78rem;margin-top:6px}
.loupe{margin-top:auto;padding-top:16px;border-top:1px dashed var(--border-default)}
.loupe-titre{margin:0;font:var(--text-overline);letter-spacing:var(--text-overline-tracking);text-transform:uppercase;color:var(--text-secondary)}
.loupe strong{font:600 1.9rem/1.1 var(--font-serif)}
.loupe-valeur{display:block;margin:.25rem 0 .6rem;font-variant-numeric:tabular-nums}
.reglette{position:relative;height:6px;border-radius:999px;background:var(--surface-tertiary);margin-bottom:8px}
.reglette-point{position:absolute;top:-4px;width:14px;height:14px;border-radius:999px;background:var(--status-error);border:2px solid #FFF;box-shadow:var(--shadow-subtle);transform:translateX(-50%)}
.loupe-liens{display:flex;gap:14px;margin:0;align-items:center}
.loupe-liens button{border:0;background:none;color:var(--text-secondary);cursor:pointer;font:inherit;text-decoration:underline;padding:0}
.tuile-famille{grid-column:6/13;grid-row:1}
.tuile-classement{grid-column:6/13;grid-row:2}
.vide-scalar{color:var(--text-secondary);max-width:52ch}
.liste-barres{list-style:none;margin:0;padding:0}
.ligne-barres{display:grid;grid-template-columns:34px minmax(90px,180px) 1fr auto;align-items:center;gap:10px;width:100%;border:0;background:none;padding:7px 4px;cursor:pointer;font:inherit;color:inherit;text-align:left;border-bottom:1px solid var(--border-subtle)}
.ligne-barres:hover{background:var(--surface-tertiary)}
.rang{width:26px;height:26px;border-radius:999px;background:var(--indicateur-soft);color:var(--indicateur-strong);font:700 .74rem/26px var(--font-sans);text-align:center;font-style:normal}
.liste-barres li.selectionne .rang{background:var(--status-error);color:#FFF}
.liste-barres li.selectionne{outline:2px solid var(--status-error);outline-offset:-2px;border-radius:6px}
.nom{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.barre-zone{background:var(--surface-tertiary);border-radius:999px;height:14px;overflow:hidden}
.barre{display:block;height:100%;background:var(--indicateur-accent);border-radius:999px;min-width:2px}
.valeur{font-variant-numeric:tabular-nums;white-space:nowrap}
.milieu{text-align:center;color:var(--text-secondary);font-size:.82rem;padding:8px}
.tableau-complet{margin-top:14px}
.tableau-complet summary{cursor:pointer;color:var(--accent-primary);font-weight:600}
.tri-ligne{display:flex;gap:14px;align-items:center;margin:10px 0;color:var(--text-secondary);font-size:.82rem}
.tri-ligne button{border:0;background:none;color:var(--accent-primary);cursor:pointer;font:inherit;text-decoration:underline;padding:0}
.tableau-complet table{width:100%;border-collapse:collapse;font-size:.9rem}
.tableau-complet td{padding:8px 10px;border-bottom:1px solid var(--border-subtle)}
.cell-rang{white-space:nowrap;color:var(--text-secondary);font-variant-numeric:tabular-nums}
.cell-valeur{font-variant-numeric:tabular-nums}
tr.selectionne{background:var(--indicateur-soft)}
.pointer{border:0;background:none;color:var(--accent-primary);cursor:pointer;font:inherit}
.tuile-carte{grid-column:1/9}
.cadre-carte{position:relative;height:430px;border:1px solid var(--border-default);border-radius:var(--radius-md);overflow:hidden}
.cadre-carte :deep(.map-explorer){height:100%}
.chargement-carte{height:200px;display:grid;place-items:center;color:var(--text-secondary)}
.tuile-notices{grid-column:9/13}
.notice{margin:0;display:grid;grid-template-columns:88px 1fr;gap:8px 12px;font-size:.84rem}
.notice dt{font-weight:700}
.notice dd{margin:0}
.sources-liste{list-style:none;margin:16px 0 0;padding:0;display:flex;flex-direction:column;gap:10px}
.sources-liste li{display:flex;flex-direction:column;gap:2px;padding:10px 12px;background:var(--surface-secondary);border-radius:var(--radius-sm);font-size:.82rem}
.note-frontiere{margin-top:16px;color:var(--text-secondary);font-size:.8rem;font-style:italic}
@media(max-width:1100px){
  .tuile-hero,.tuile-famille,.tuile-classement,.tuile-carte,.tuile-notices{grid-column:1/13;grid-row:auto}
  .barre{position:static}
}
</style>
