<script setup lang="ts">
/**
 * #501 — PROTOTYPE JETABLE · Variante A « Récit ».
 *
 * THÈSE STRUCTURALE : la Page d'indicateur comme DOSSIER ÉDITORIAL continu.
 *  - Hiérarchie : un seul fil vertical d'article (colonne ~800px, les
 *    figures débordent plus larges que le texte) ; la note de contexte
 *    devient le chapo réécrit avec des sélecteurs EN LIGNE.
 *  - Navigation : PLUS D'ONGLETS. Un sommaire collant remplace les vues ;
 *    Carte est un chapitre du dossier ; L'indicateur est ABSORBÉ en notice
 *    finale — la frontière Repères/L'indicateur disparaît.
 *  - Héros : la médiane composée en Newsreader géant, ouverture de l'article,
 *    bande de densité pleine largeur annotée dessous.
 *  - Continuité territoire : un ruban collant sous le sommaire porte le
 *    territoire « à la loupe » pendant tout le défilement.
 *  - Extrêmes/tableau : extrêmes en vis-à-vis au milieu du dossier ; le
 *    tableau complet FERME le dossier, replié dans un <details>.
 */
import { computed, watch } from 'vue'
import type { ProtocoleProps } from './protocole-types'
import { formaterValeur } from '@/payload/selectors'
import { situationContexte } from '@/indicateurs/explorationModel'
import { ancreSource } from '@/methodes/sources'
import RepereFamilyOutlet from '@/components/indicateurs/RepereFamilyOutlet.vue'
import MapExplorer from '@/components/carte/MapExplorer.vue'

const props = defineProps<ProtocoleProps>()

/* ── Matière partagée (petits utilitaires propres à la variante) ────────── */
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
const niveauLabel = computed(() => ({ commune: 'communes', epci: 'EPCI', departement: 'départements' })[props.model.state.niveau])

/* ── Bande de densité annotée (KDE du modèle, même matière que le shell) ── */
const cheminDensite = computed(() =>
  props.model.density.length
    ? `M ${props.model.density.map((point, index, arr) => `${(index * (600 / Math.max(arr.length - 1, 1))).toFixed(2)},${(20 + point.y * 1.5).toFixed(2)}`).join(' L ')}`
    : '',
)
const aireDensite = computed(() => (cheminDensite.value ? `${cheminDensite.value} L 600,180 L 0,180 Z` : ''))
const medianeX = computed(() => {
  const distribution = props.model.distribution
  if (!distribution.length || props.model.median === null) return null
  const min = distribution[0]!
  const max = distribution[distribution.length - 1]!
  return max === min ? 300 : ((props.model.median - min) / (max - min)) * 600
})
const marqueurCx = computed(() => (props.model.markerX !== null ? props.model.markerX * 6 : null))
const marqueurCy = computed(() => (props.model.markerY !== null ? 20 + props.model.markerY * 1.5 : null))
const valeurMin = computed(() => (props.model.distribution.length ? fmt(props.model.distribution[0]!) : '—'))
const valeurMax = computed(() => (props.model.distribution.length ? fmt(props.model.distribution[props.model.distribution.length - 1]!) : '—'))
const descriptionMarqueur = computed(() =>
  selection.value && props.dispatch
    ? `${selection.value.territoire.nom} : ${fmt(selection.value.value)}, positionné sur l’axe de densité à sa valeur.`
    : '',
)

/* ── Univers comparé : UNE liste (Bretagne / départements / EPCIs) ──────── */
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
const universCourant = computed(() => (props.model.state.departement ? `dep:${props.model.state.departement}` : props.model.state.epci ? `epci:${props.model.state.epci}` : ''))
function changerUnivers(evenement: Event): void {
  const valeur = (evenement.target as HTMLSelectElement).value
  if (!valeur) {
    props.setQuery('departement')
    props.setQuery('epci')
  } else if (valeur.startsWith('dep:')) {
    props.setQuery('epci')
    props.setQuery('departement', valeur.slice(4))
  } else {
    props.setQuery('departement')
    props.setQuery('epci', valeur.slice(5))
  }
}

/* ── Chapitre familial (masqué pour scalar : le héros EST le repère) ────── */
const libelleFamille = computed(() => ({
  scalar: '',
  trajectory: 'La trajectoire complète',
  composition: 'La composition face au périmètre',
  distribution: 'Signature & ensemble de comparaison',
  list: 'Le profil complet',
  relationship: 'La relation déclarée',
  pyramid: 'La structure par âge et sexe',
  'comparison-bars': 'Les barres de comparaison',
}[props.dispatch.family] ?? ''))

/* ── Carte / ?vue → ancrage dans le dossier (plus de changement de vue) ── */
watch(
  () => props.vue,
  (vue) => {
    if (vue === 'carte') document.getElementById('recit-carte')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    else if (vue === 'indicateur') document.getElementById('recit-comprendre')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  },
  { immediate: true },
)

const rechercheLocale = computed(() => props.model.state.recherche ?? '')
</script>

<template>
  <article class="recit" data-proto-variante="A">
    <!-- Sommaire collant + ruban du territoire à la loupe -->
    <nav class="sommaire" aria-label="Sommaire du dossier">
      <div class="sommaire-liens">
        <a href="#recit-valeur">La valeur</a>
        <a v-if="libelleFamille" href="#recit-figure">{{ libelleFamille }}</a>
        <a href="#recit-extremes">Les extrêmes</a>
        <a href="#recit-carte">Carte</a>
        <a href="#recit-comprendre">Comprendre</a>
        <a href="#recit-tableau">Tableau</a>
      </div>
      <p v-if="selection" class="ruban-loupe">
        À la loupe&nbsp;: <strong>{{ selection.territoire.nom }}</strong>
        <span>{{ fmt(selection.value) }} · {{ rangLabel(selection) }}</span>
        <RouterLink :to="selection.fiche">fiche</RouterLink>
        <button type="button" aria-label="Retirer le territoire à la loupe" @click="setQuery('territoire')">×</button>
      </p>
    </nav>

    <!-- Tête du dossier : sur-titre, titre serif, chapo-contexte en ligne -->
    <header class="recit-tete">
      <p class="sur-titre">{{ metadata?.label }} · dossier</p>
      <h1 class="recit-titre voix-recit">{{ page.label }}</h1>
      <p class="recit-chapo voix-recit">{{ page.definition }}</p>
      <p class="recit-contexte">
        Comparaison des
        <select class="select-inline" aria-label="Niveau de comparaison" :value="model.state.niveau" @change="setQuery('niveau', ($event.target as HTMLSelectElement).value)">
          <option value="commune">communes</option>
          <option value="epci">EPCI</option>
          <option value="departement">départements</option>
        </select>
        de
        <select v-if="model.state.niveau === 'commune'" class="select-inline" aria-label="Univers comparé" :value="universCourant" @change="changerUnivers">
          <option value="">Bretagne</option>
          <optgroup label="Par département">
            <option v-for="dep in optionsDepartements" :key="`dep-${dep.code}`" :value="`dep:${dep.code}`">{{ dep.nom }}</option>
          </optgroup>
          <optgroup label="Par EPCI">
            <option v-for="epci in optionsEpcis" :key="`epci-${epci.code}`" :value="`epci:${epci.code}`">{{ epci.nom }}</option>
          </optgroup>
        </select>
        <strong v-else class="univers-fixe">{{ situation.univers }}</strong>
        <span class="direction-note" :title="dirText" :aria-label="dirText">{{ glyph }} {{ dirText }}</span>
      </p>
      <label v-if="dispatch.facet.details.length" class="detail-en-ligne">
        Détail actif
        <select class="select-inline" aria-label="Détail actif" :value="dispatch.facet.detail ?? ''" @change="setQuery('detail', ($event.target as HTMLSelectElement).value)">
          <option v-for="detail in dispatch.facet.details" :key="detail" :value="detail">{{ dispatch.facet.labels[detail] ?? detail }}</option>
        </select>
      </label>
    </header>

    <!-- Chapitre La valeur : héros médiane + bande de densité annotée -->
    <section id="recit-valeur" class="chapitre">
      <p class="overline-chapitre">La valeur</p>
      <div class="hero-recit" :class="{ 'avec-loupe': selection }">
        <div class="hero-mediane">
          <span class="hero-etiquette">Médiane · {{ situation.univers }}</span>
          <strong class="voix-recit hero-nombre">{{ model.median === null ? '—' : formaterValeur({ value: model.median, unit: unite }) }}</strong>
          <small class="hero-unite">{{ unite }}</small>
        </div>
        <aside v-if="selection" class="hero-loupe carte-figure carte-figure--accent-fort">
          <span class="loupe-etiquette">À la loupe</span>
          <strong class="voix-recit loupe-nom">{{ selection.territoire.nom }}</strong>
          <p class="loupe-faits">{{ fmt(selection.value) }} · {{ rangLabel(selection) }}</p>
          <RouterLink :to="selection.fiche">Voir la fiche du territoire →</RouterLink>
        </aside>
      </div>
      <figure class="bande-densite">
        <svg viewBox="0 0 600 200" role="img" aria-label="Densité des valeurs du périmètre comparé">
          <title>Densité des valeurs</title>
          <desc v-if="descriptionMarqueur">{{ descriptionMarqueur }}</desc>
          <path v-if="aireDensite" class="densite-aire" :d="aireDensite" />
          <path v-if="cheminDensite" class="densite-courbe" :d="cheminDensite" />
          <line v-if="medianeX !== null" class="densite-mediane" :x1="medianeX" :x2="medianeX" y1="14" y2="182" />
          <text v-if="medianeX !== null" class="densite-mediane-texte" :x="medianeX" y="10" text-anchor="middle">médiane {{ fmt(model.median) }}</text>
          <circle v-if="marqueurCx !== null && marqueurCy !== null" class="densite-marqueur" :cx="marqueurCx" :cy="marqueurCy" r="7"><title>{{ descriptionMarqueur }}</title></circle>
        </svg>
        <figcaption>Échelle&nbsp;: {{ valeurMin }} → {{ valeurMax }}<span v-if="descriptionMarqueur"> · le point rouge porte {{ selection?.territoire.nom }}</span></figcaption>
        <span v-if="descriptionMarqueur" class="visuellement-cache">{{ descriptionMarqueur }}</span>
      </figure>
    </section>

    <!-- Chapitre familial (sauf scalar : le héros ci-dessus est le repère) -->
    <section v-if="libelleFamille" id="recit-figure" class="chapitre chapitre-large">
      <p class="overline-chapitre">{{ libelleFamille }}</p>
      <RepereFamilyOutlet :dispatch="dispatch" :modele="trajectoire" :signature="signature" :profil="profil" :relation="relation" :composition="composition" :ensemble="ensemble" />
    </section>

    <!-- Chapitre Les extrêmes : vis-à-vis haut / bas -->
    <section id="recit-extremes" class="chapitre">
      <p class="overline-chapitre">Les extrêmes</p>
      <div class="extremes-face">
        <div class="col-extreme">
          <h2>Valeurs les plus hautes</h2>
          <p v-if="model.high.count > 1" class="egalite">{{ model.high.count }} territoires à égalité</p>
          <ol>
            <li v-for="row in model.high.rows" :key="`haut-${row.territoire.territoire}`">
              <button type="button" class="extreme-item" @click="setQuery('territoire', row.territoire.territoire)">
                <em class="rang-badge">{{ row.rang }}</em>
                <span class="extreme-nom">{{ row.territoire.nom }}</span>
                <span class="extreme-valeur">{{ fmt(row.value) }}</span>
              </button>
            </li>
          </ol>
        </div>
        <div class="col-extreme">
          <h2>Valeurs les plus basses</h2>
          <p v-if="model.low.count > 1" class="egalite">{{ model.low.count }} territoires à égalité</p>
          <ol>
            <li v-for="row in model.low.rows" :key="`bas-${row.territoire.territoire}`">
              <button type="button" class="extreme-item" @click="setQuery('territoire', row.territoire.territoire)">
                <em class="rang-badge">{{ row.rang }}</em>
                <span class="extreme-nom">{{ row.territoire.nom }}</span>
                <span class="extreme-valeur">{{ fmt(row.value) }}</span>
              </button>
            </li>
          </ol>
        </div>
      </div>
    </section>

    <!-- Chapitre Carte : la même facette, projetée (travail #398 inchangé) -->
    <section id="recit-carte" class="chapitre chapitre-large">
      <p class="overline-chapitre">Carte</p>
      <p class="chapitre-intro">La même facette — « {{ dispatch.facet.label }} » — projetée sur {{ situation.univers }}.</p>
      <div v-if="masques" class="cadre-carte"><MapExplorer :masques="masques" :payload="payloadCarte" :active-ids="payloadCarte.indicateurs.map((fact) => fact.territoire)" :theme="theme" :couche="couche" :niveau="niveauMasque" :territoire-cible="territoireCible" :requete-zoom="Number(Boolean(model.state.territoire))" /></div>
      <div v-else role="status">Chargement de la carte…</div>
    </section>

    <!-- Chapitre Comprendre : L'indicateur ABSORBÉ dans le dossier -->
    <section id="recit-comprendre" class="chapitre">
      <p class="overline-chapitre">Comprendre l’indicateur</p>
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
        <p v-if="source.caveat" class="source-caveat">Limite de la source : {{ source.caveat }}</p>
        <p class="source-liens">
          <a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">Voir le jeu de données</a>
          <RouterLink :to="{ name: 'sources', hash: `#${ancreSource(source.id!)}` }">Voir la fiche source</RouterLink>
        </p>
      </section>
      <p class="note-frontiere">Dans cette variante, la notice fait partie du dossier — elle n’est pas une vue séparée.</p>
    </section>

    <!-- Chapitre Tableau : ferme le dossier, replié -->
    <section id="recit-tableau" class="chapitre chapitre-large">
      <details class="tableau-replie">
        <summary>Consulter les {{ model.rows.length }} {{ niveauLabel }} en tableau</summary>
        <div class="tableau-controles">
          <label>Rechercher <input :value="rechercheLocale" @input="setQuery('recherche', ($event.target as HTMLInputElement).value)" /></label>
          <span class="tri-boutons">
            Trier&nbsp;:
            <button type="button" @click="setSort('nom')">Nom</button>
            <button type="button" @click="setSort('valeur')">Valeur</button>
            <button type="button" @click="setSort('rang')">Rang</button>
          </span>
        </div>
        <table>
          <caption>Territoires comparables — {{ model.scopeLabel }}</caption>
          <thead><tr><th scope="col">Territoire</th><th scope="col">Valeur</th><th scope="col">Rang</th><th scope="col"><span :title="dirText" :aria-label="dirText">{{ glyph }}</span></th></tr></thead>
          <tbody>
            <tr v-for="row in model.rows" :key="row.territoire.territoire" :class="{ selectionne: row.highlighted }">
              <td><RouterLink :to="row.fiche">{{ row.territoire.nom }}</RouterLink></td>
              <td>{{ fmt(row.value) }}</td>
              <td>{{ rangLabel(row) }}</td>
              <td><button type="button" @click="setQuery('territoire', row.territoire.territoire)">Pointer</button></td>
            </tr>
          </tbody>
        </table>
      </details>
    </section>
  </article>
</template>

<style scoped>
.visuellement-cache{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.recit{--largeur-texte:800px;max-width:var(--largeur-texte);margin-inline:auto;padding:calc(var(--space-8) + var(--space-6)) var(--grid-margin-mobile) 140px}
.sommaire{position:sticky;top:calc(var(--header-height) + 8px);z-index:60;display:flex;flex-direction:column;gap:6px;margin-bottom:var(--space-10)}
.sommaire-liens{display:flex;gap:4px 18px;flex-wrap:wrap;padding:10px 16px;background:var(--surface-chrome);backdrop-filter:blur(var(--blur-chrome));border:1px solid var(--border-default);border-radius:999px;font:500 .82rem/1.3 var(--font-sans)}
.sommaire-liens a{color:var(--text-secondary)}
.sommaire-liens a:hover{color:var(--accent-hover)}
.ruban-loupe{display:flex;align-items:center;gap:10px;margin:0;padding:8px 16px;background:var(--indicateur-soft);border:1px solid color-mix(in oklab, var(--indicateur-accent) 35%, transparent);border-radius:999px;font-size:.85rem}
.ruban-loupe strong{font-weight:700}
.ruban-loupe span{color:var(--text-secondary)}
.ruban-loupe button{margin-left:auto;border:0;background:none;cursor:pointer;color:var(--text-secondary);font-size:1rem;line-height:1}
.recit-tete{margin-bottom:var(--space-12)}
.recit-titre{font:600 clamp(2.4rem, 5vw, 3.6rem)/1.08 var(--font-serif);letter-spacing:-0.01em;margin:.4rem 0 1rem;max-width:18ch}
.recit-chapo{font:400 clamp(1.05rem, 2vw, 1.25rem)/1.55 var(--font-serif);color:var(--text-primary);max-width:56ch;margin:0 0 1rem}
.recit-contexte{display:flex;align-items:baseline;gap:.35ch;flex-wrap:wrap;color:var(--text-secondary);font-size:.95rem;margin:0}
.select-inline{border:0;border-bottom:2px solid var(--indicateur-accent);background:none;font:700 .95rem var(--font-sans);color:var(--text-primary);padding:0 .2rem;cursor:pointer;width:auto;max-width:min(360px,58vw)}
.univers-fixe{color:var(--text-primary)}
.direction-note{margin-left:auto;padding-left:12px;white-space:nowrap}
.detail-en-ligne{display:inline-flex;gap:.6ch;align-items:baseline;margin-top:.9rem;color:var(--text-secondary);font-size:.85rem}
.chapitre{margin-bottom:var(--space-16)}
.chapitre-large{width:min(1040px, 94vw);margin-inline:auto}
.overline-chapitre{font:var(--text-overline);letter-spacing:var(--text-overline-tracking);text-transform:uppercase;color:var(--indicateur-strong);border-top:1px solid var(--border-default);padding-top:var(--space-4);margin:0 0 var(--space-6)}
.chapitre-large .overline-chapitre{max-width:var(--largeur-texte)}
.chapitre-intro{color:var(--text-secondary);max-width:var(--largeur-texte);margin:-8px 0 16px}
.hero-recit{display:grid;grid-template-columns:1fr;gap:24px;align-items:end}
.hero-recit.avec-loupe{grid-template-columns:minmax(0,1.4fr) minmax(240px,1fr)}
.hero-etiquette,.loupe-etiquette{display:block;font:var(--text-overline);letter-spacing:var(--text-overline-tracking);text-transform:uppercase;color:var(--text-secondary)}
.hero-nombre{display:block;font:500 clamp(4.5rem, 11vw, 8rem)/1 var(--font-serif);letter-spacing:-0.02em;font-variant-numeric:tabular-nums;margin-top:.15em}
.hero-unite{color:var(--text-secondary);font-size:1rem}
.hero-loupe{padding:20px;border-radius:var(--radius-lg)}
.loupe-nom{display:block;font:600 1.7rem/1.15 var(--font-serif);margin:.2rem 0 .3rem}
.loupe-faits{margin:0 0 .6rem;font-variant-numeric:tabular-nums}
.bande-densite{margin:40px 0 0}
.bande-densite svg{width:100%;height:auto;display:block}
.densite-aire{fill:var(--indicateur-soft);stroke:none}
.densite-courbe{fill:none;stroke:var(--indicateur-accent);stroke-width:3.5;stroke-linejoin:round}
.densite-mediane{stroke:var(--text-tertiary);stroke-width:1.5;stroke-dasharray:4 4}
.densite-mediane-texte{font:600 12px var(--font-sans);fill:var(--text-secondary)}
.densite-marqueur{fill:var(--status-error);stroke:#FFF;stroke-width:2}
.bande-densite figcaption{margin-top:8px;display:flex;justify-content:space-between;color:var(--text-secondary);font-size:.8rem}
.extremes-face{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;background:var(--surface-primary);border:1px solid var(--border-default);border-radius:var(--radius-lg);padding:24px}
.col-extreme h2{font:var(--text-h3);margin:0 0 12px}
.egalite{color:var(--text-secondary);font-size:.85rem;margin:0 0 8px}
.col-extreme ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.extreme-item{display:flex;align-items:center;gap:10px;width:100%;border:0;background:none;padding:9px 6px;border-bottom:1px solid var(--border-subtle);cursor:pointer;text-align:left;font:inherit;color:inherit}
.extreme-item:hover{background:var(--surface-tertiary)}
.rang-badge{flex:none;width:26px;height:26px;border-radius:999px;background:var(--indicateur-soft);color:var(--indicateur-strong);font:700 .78rem/26px var(--font-sans);text-align:center;font-style:normal}
.extreme-nom{flex:1}
.extreme-valeur{font-variant-numeric:tabular-nums;color:var(--text-primary)}
.cadre-carte{position:relative;height:520px;border:1px solid var(--border-default);border-radius:var(--radius-lg);overflow:hidden;background:var(--surface-primary)}
.cadre-carte :deep(.map-explorer){height:100%}
.notice{margin:0;display:grid;grid-template-columns:160px 1fr;gap:10px 20px}
.notice dt{font-weight:700}
.notice dd{margin:0}
.carte-source{background:var(--surface-primary);border:1px solid var(--border-default);border-radius:var(--radius-lg);padding:16px 20px;margin-top:16px}
.carte-source h3{margin:0 0 6px;font:var(--text-h3)}
.carte-source p{margin:.2rem 0;color:var(--text-secondary);font-size:.9rem}
.source-liens{display:flex;gap:18px}
.note-frontiere{margin-top:20px;color:var(--text-secondary);font-size:.85rem;font-style:italic}
.tableau-replie{background:var(--surface-primary);border:1px solid var(--border-default);border-radius:var(--radius-lg);padding:0}
.tableau-replie summary{cursor:pointer;padding:18px 22px;font-weight:700}
.tableau-replie[open] summary{border-bottom:1px solid var(--border-default)}
.tableau-controles{display:flex;gap:20px;flex-wrap:wrap;align-items:end;padding:14px 22px}
.tableau-controles label{display:flex;flex-direction:column;gap:4px;font-size:.85rem;color:var(--text-secondary)}
.tableau-controles input{padding:8px;border:1px solid var(--border-default);border-radius:6px}
.tri-boutons button{border:0;background:none;color:var(--accent-primary);cursor:pointer;font:inherit;text-decoration:underline;padding:0 4px}
table{width:100%;border-collapse:collapse}
th,td{padding:11px 22px;border-bottom:1px solid var(--border-subtle);text-align:left}
caption{text-align:left;padding:12px 22px 0;color:var(--text-secondary);font-size:.85rem}
tr.selectionne{background:var(--indicateur-soft)}
td:last-child button{border:0;background:none;color:var(--accent-primary);cursor:pointer;font:inherit}
@media(max-width:760px){
  .hero-recit.avec-loupe{grid-template-columns:1fr}
  .extremes-face{grid-template-columns:1fr}
  .notice{grid-template-columns:1fr}
  .sommaire-liens{overflow-x:auto;flex-wrap:nowrap}
}
</style>
