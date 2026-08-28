<script setup lang="ts">
/**
 * [PROTOTYPE #511 — JETABLE] Variante D — « Cahier libre ».
 *
 * One real vertical slice: Mobilité / « L’accès aux services ». The page is
 * intentionally rebuilt as a Cahier page rather than a restyle of the old
 * dashboard. Every scalar is given a visual figure; the argument and evidence
 * sides alternate from one composed figure to the next.
 */
import { Bike, CarFront, Footprints, HeartPulse, Landmark, School, Utensils, WalletCards } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Component } from 'vue'

import DistributionFigureCahier from './DistributionFigureCahier.vue'
import { donneesMobiliteCahierPour } from './donneesMobiliteCahier'
import type { ModeMobiliteCahier, ServiceMobiliteCahier } from './donneesMobiliteCahier'
import { matiereTheme } from './matiere'
import type { MatiereTheme, SousGroupeMatiere, ValeurIndicateur } from './matiere'
import { handoffExploration } from '@/fiche/explorationHandoff'
import { detailsRangEnContexte, formaterNombreFR } from '@/payload/selectors'
import type { Indicateur, Payload, TerritoireType, Theme } from '@/payload/types'

const props = defineProps<{
  theme: Theme
  payload: Payload
  territoire: string
}>()

const matiere = computed<MatiereTheme>(() =>
  matiereTheme(props.payload, props.theme, props.territoire),
)

const rootRef = ref<HTMLElement | null>(null)
const activeFigure = ref('')
let observer: IntersectionObserver | null = null
let baselineObserver: ResizeObserver | null = null
let baselineFrame: number | null = null

const cahierGridStep = 32
// The baseline sits just above the 30–32px major stroke in the paper pattern.
const cahierFirstRule = 29

function baselineOffset(element: HTMLElement): number {
  const styles = getComputedStyle(element)
  const fontSize = Number.parseFloat(styles.fontSize) || 16
  const lineHeight = styles.lineHeight === 'normal' ? fontSize * 1.2 : Number.parseFloat(styles.lineHeight) || fontSize * 1.2
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (context) {
    context.font = `${styles.fontStyle} ${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`
    const ascent = context.measureText('H').actualBoundingBoxAscent
    if (ascent) return (lineHeight - fontSize) / 2 + ascent
  }
  return (lineHeight - fontSize) / 2 + fontSize * 0.8
}

function baselineOpticalOffset(element: HTMLElement): number {
  return element.classList.contains('cahier-marelle-anchor') ? 14 : 0
}

function baselineMeasureElement(anchor: HTMLElement): HTMLElement {
  return anchor.classList.contains('cahier-baseline-group')
    ? anchor.querySelector<HTMLElement>('h3') ?? anchor
    : anchor
}

function alignBaselineFlow(anchors: HTMLElement[], pageTop: number): void {
  for (const anchor of anchors) {
    anchor.style.setProperty('--cahier-baseline-shift', '0px')
  }

  for (const anchor of anchors) {
    const measure = baselineMeasureElement(anchor)
    const rectangle = measure.getBoundingClientRect()
    const baseline = rectangle.top + baselineOffset(measure)
    const firstLine = pageTop + cahierFirstRule
    const line = Math.round((baseline - firstLine) / cahierGridStep)
    const target = firstLine + line * cahierGridStep
    const shift = target - baseline + baselineOpticalOffset(measure)
    anchor.style.setProperty('--cahier-baseline-shift', `${shift.toFixed(2)}px`)
  }
}

function alignCahierBaselines(): void {
  const page = rootRef.value?.querySelector<HTMLElement>('.cahier-page')
  if (!page) return

  const pageTop = page.getBoundingClientRect().top
  const selector = '.cahier-baseline-anchor, .cahier-baseline-first-line, .cahier-baseline-group'
  page.querySelectorAll<HTMLElement>('.cahier-baseline-group, .cahier-baseline-anchor, .cahier-baseline-first-line').forEach((element) => {
    element.style.setProperty('--cahier-baseline-shift', '0px')
  })
  const flows: HTMLElement[][] = []
  const pageHeading = page.querySelector<HTMLElement>('.page-heading')
  if (pageHeading) flows.push([...pageHeading.querySelectorAll<HTMLElement>(selector)])

  for (const group of page.querySelectorAll<HTMLElement>('.concept-group')) {
    const heading = group.querySelector<HTMLElement>('.concept-group-heading')
    for (const side of group.querySelectorAll<HTMLElement>('.argument-side, .evidence-side')) {
      const anchors = [...side.querySelectorAll<HTMLElement>(selector)]
      if (side.classList.contains('argument-side') && heading) anchors.unshift(heading)
      flows.push(anchors)
    }
  }

  flows.filter((flow) => flow.length > 0).forEach((flow) => alignBaselineFlow(flow, pageTop))
}

function scheduleBaselineAlignment(): void {
  if (baselineFrame !== null || typeof window.requestAnimationFrame !== 'function') return
  baselineFrame = window.requestAnimationFrame(() => {
    baselineFrame = null
    alignCahierBaselines()
  })
}

const target = computed(() =>
  props.payload.territoires.find((territoire) => territoire.territoire === props.territoire),
)

const cibleType = computed<TerritoireType>(() => target.value?.type ?? 'commune')

/** Keep the official payload name, but use the short name in locative prose. */
const nomTerritoireCourt = computed(() =>
  matiere.value.nomTerritoire
    .replace(/^CA\s+/i, '')
    .replace(/^Communauté d['’]agglomération\s+/i, '')
    .replace(/^Communauté de communes\s+/i, '')
    .replace(/^Métropole\s+/i, '')
    .trim(),
)

const groupePage = computed<SousGroupeMatiere | null>(() =>
  matiere.value.groupes.find((groupe) => groupe.key === 'acces-aux-services') ??
    matiere.value.groupes[0] ??
    null,
)

const titrePage = 'Accès aux services par mode de transport'

const pageNumber = computed(() => {
  const metadata = props.payload.themeMetadata ?? {}
  const currentSubgroups = metadata[props.theme]?.subgroups ?? []
  const currentIndex = Math.max(
    0,
    currentSubgroups.findIndex((subgroup) => subgroup.key === groupePage.value?.key),
  )
  let offset = 0
  for (const theme of ['mobilite', 'demographie', 'habitat', 'economie', 'milieux', 'programmes'] as const) {
    if (theme === props.theme) break
    offset += metadata[theme]?.subgroups.length ?? 0
  }
  return offset + currentIndex + 1
})

const totalPages = computed(() =>
  Object.values(props.payload.themeMetadata ?? {}).reduce(
    (total, metadata) => total + (metadata?.subgroups.length ?? 0),
    0,
  ),
)

const valeursDuGroupe = computed<ValeurIndicateur[]>(() =>
  groupePage.value
    ? [groupePage.value.valeurPrincipale, ...groupePage.value.valeurs].filter(
        (valeur): valeur is ValeurIndicateur => valeur !== null,
      )
    : [],
)

const lecture = computed(() => groupePage.value?.lecture ?? null)

const donneesCahier = computed(() => donneesMobiliteCahierPour(props.territoire))

const distributionFigure = computed(() =>
  lecture.value?.figure?.genre === 'distribution' ? lecture.value.figure : null,
)

const sources = computed(() => {
  const values = [
    ...valeursDuGroupe.value.map((valeur) => valeur.sourceCourte),
    lecture.value?.sourceCourte,
  ]
  return [
    ...new Set(
      values
        .filter((source): source is string => Boolean(source))
        .map((source) => sourceMarginale(source)),
    ),
  ]
})

function sourceMarginale(source: string): string {
  const [avantVersion, ...versionParts] = source.split(' · ')
  const nom = (avantVersion ?? source).split(/[—–(]/)[0]?.trim() ?? source
  const version = versionParts.at(-1)?.trim()
  return version ? `${nom} · ${version}` : nom
}

function valeurPour(clef: string): ValeurIndicateur | null {
  return valeursDuGroupe.value.find((valeur) => valeur.clef === clef) ?? null
}

function indicateurPour(clef: string): Indicateur | null {
  return (
    props.payload.indicateurs.find(
      (indicateur) =>
        indicateur.theme === props.theme &&
        indicateur.territoire === props.territoire &&
        indicateur.key === clef &&
        indicateur.detail === null,
    ) ?? null
  )
}

function brutPour(clef: string): number | null {
  const valeur = indicateurPour(clef)?.value
  return typeof valeur === 'number' ? valeur : null
}

function detailsRangPour(clef: string) {
  const indicateur = indicateurPour(clef)
  return indicateur ? detailsRangEnContexte(indicateur) : null
}

function rangEstExtremite(clef: string): boolean {
  const details = detailsRangPour(clef)
  if (!details?.taille) return false
  const bord = Math.max(1, Math.ceil(details.taille * 0.05))
  return details.rang <= bord || details.rang > details.taille - bord
}

function rangCourt(rang: number, taille: number | null): string {
  return `${rang === 1 ? '1er' : `${rang}e`}/${taille ?? '—'}`
}

function rangTexte(clef: string): string | null {
  const details = detailsRangPour(clef)
  return details ? rangCourt(details.rang, details.taille) : null
}

interface StatistiqueLecture {
  mediane: number | null
  rang: string | null
  extremite: boolean
}

// The diversity-loss stories are derived readings, not published indicator
// pages. Their handoff points to the published total-loss constituent rather
// than inventing a dead `/div_loss_*` indicator route.
const INDICATEUR_HANDOFF_PAR_LECTURE: Readonly<Record<string, string>> = {
  div_loss_t: 'tot_loss_t',
  div_loss_b: 'tot_loss_b',
}

/** Story scalars do not have indicator rows, so derive their peer rank locally. */
function statistiqueLecture(clef: string): StatistiqueLecture {
  const groupe = groupePage.value?.key
  if (!groupe) return { mediane: null, rang: null, extremite: false }

  const histoires = props.payload.histoires.filter((histoire) => {
    return histoire.theme === props.theme && histoire.groupe === groupe
  })
  const valeursPour = (territoires: ReadonlySet<string>) => histoires
    .filter((histoire) => {
      return territoires.has(histoire.territoire)
    })
    .map((histoire) => {
      const valeur = (histoire as unknown as Record<string, unknown>)[clef]
      return typeof valeur === 'number' ? valeur : null
    })
    .filter((valeur): valeur is number => valeur !== null)
    .sort((a, b) => a - b)

  const territoireCible = target.value
  const territoiresParRang = props.payload.territoires.filter((territoire) => {
    if (territoireCible?.type === 'commune' && territoireCible.epci) {
      return territoire.type === 'commune' && territoire.epci === territoireCible.epci
    }
    return territoire.type === cibleType.value
  })
  const territoiresParComparaison = props.payload.territoires.filter((territoire) => territoire.type === 'epci')
  const valeurs = valeursPour(new Set(territoiresParRang.map((territoire) => territoire.territoire)))
  const valeursComparaison = valeursPour(new Set(territoiresParComparaison.map((territoire) => territoire.territoire)))

  const histoireCourante = props.payload.histoires.find(
    (histoire) => histoire.theme === props.theme && histoire.territoire === props.territoire && histoire.groupe === groupe,
  )
  const brut = histoireCourante
    ? (histoireCourante as unknown as Record<string, unknown>)[clef]
    : null
  if (typeof brut !== 'number' || valeurs.length === 0) return { mediane: null, rang: null, extremite: false }

  const position = valeurs.findIndex((valeur) => valeur === brut)
  const rang = position < 0 ? null : position + 1
  const bord = Math.max(1, Math.ceil(valeurs.length * 0.05))
  const milieu = Math.floor(valeursComparaison.length / 2)
  const mediane =
    valeursComparaison.length === 0
      ? null
      : valeursComparaison.length % 2
        ? valeursComparaison[milieu] ?? null
        : ((valeursComparaison[milieu - 1] ?? 0) + (valeursComparaison[milieu] ?? 0)) / 2
  return {
    mediane,
    rang:
      rang === null
        ? null
        : rangCourt(rang, valeurs.length),
    extremite: rang !== null && (rang <= bord || rang > valeurs.length - bord),
  }
}

function moyenneMediane(clef: string): number | null {
  const valeurs = props.payload.indicateurs
    .filter(
      (indicateur) =>
        indicateur.theme === props.theme &&
        indicateur.type === 'epci' &&
        indicateur.key === clef &&
        indicateur.detail === null &&
        indicateur.value !== null,
    )
    .map((indicateur) => indicateur.value as number)
    .sort((a, b) => a - b)

  if (valeurs.length === 0) return null
  const milieu = Math.floor(valeurs.length / 2)
  return valeurs.length % 2 ? valeurs[milieu] ?? null : ((valeurs[milieu - 1] ?? 0) + (valeurs[milieu] ?? 0)) / 2
}

function lienIndicateur(clef: string) {
  const clefPubliee = INDICATEUR_HANDOFF_PAR_LECTURE[clef] ?? clef
  return handoffExploration(props.payload.themeMetadata?.[props.theme], clefPubliee, target.value)
}

function formatCompte(valeur: number | null): string {
  return valeur === null ? '—' : formaterNombreFR(valeur, 1)
}

function formatMillions(valeur: number | null): string {
  if (valeur === null) return '—'
  if (Math.abs(valeur) < 1_000_000) return formaterNombreFR(valeur, 0)
  const nombre = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(valeur / 1_000_000)
  return `${nombre} ${Math.abs(valeur) >= 2_000_000 ? 'millions' : 'million'}`
}

function formatPourcent(valeur: number | null): string {
  return valeur === null ? '—' : formaterNombreFR(valeur * 100, 0)
}

function largeurBarre(valeur: number | null, maximum: number): string {
  if (valeur === null || maximum <= 0) return '0%'
  return `${Math.max(4, Math.min(100, (valeur / maximum) * 100))}%`
}

const modes = computed(() => {
  const lectureValeurs = lecture.value?.valeursCles ?? []
  return [
    {
      clef: 'div_loss_t',
      mode: 't' as const,
      label: 'À pied + en transports en commun',
      valeur: lectureValeurs.find((valeur) => valeur.clef === 'div_loss_t'),
      icon: Footprints,
      statistique: statistiqueLecture('div_loss_t'),
    },
    {
      clef: 'div_loss_b',
      mode: 'b' as const,
      label: 'À vélo + TC',
      valeur: lectureValeurs.find((valeur) => valeur.clef === 'div_loss_b'),
      icon: Bike,
      statistique: statistiqueLecture('div_loss_b'),
    },
  ]
})

const pertes = computed(() =>
  [
    { clef: 'tot_loss_t', mode: 't' as const, label: 'À pied + en transports en commun', icon: Footprints },
    { clef: 'tot_loss_b', mode: 'b' as const, label: 'À vélo + TC', icon: Bike },
  ].map((ligne) => ({
    ...ligne,
    actuel: brutPour(ligne.clef),
    actuelTexte: valeurPour(ligne.clef)?.valeurTexte ?? '—',
    repere: moyenneMediane(ligne.clef),
    rang: rangTexte(ligne.clef),
    extremite: rangEstExtremite(ligne.clef),
  })),
)

const pertesMaximum = computed(() =>
  Math.max(
    0,
    ...pertes.value.flatMap((ligne) => [ligne.actuel ?? 0, ligne.repere ?? 0]),
  ),
)

const modesComplets: readonly { clef: ModeMobiliteCahier; label: string; icon: Component }[] = [
  { clef: 'c', label: 'Voiture', icon: CarFront },
  { clef: 'b', label: 'Vélo', icon: Bike },
  { clef: 't', label: 'À pied + TC', icon: Footprints },
]

const accesFigures = computed(() => {
  const donnees = donneesCahier.value
  if (!donnees) return []

  const definition: readonly { clef: ServiceMobiliteCahier; label: string; icon: Component }[] = [
    { clef: 'administration', label: 'Administration', icon: Landmark },
    { clef: 'alimentation', label: 'Alimentation', icon: Utensils },
    { clef: 'sante', label: 'Santé', icon: HeartPulse },
    { clef: 'banque', label: 'Banque', icon: WalletCards },
    { clef: 'ecole', label: 'École', icon: School },
  ]

  return definition.map((figure) => ({
    ...figure,
    rangPied: donnees.rangsPied[figure.clef],
    modes: modesComplets.map((mode) => ({
      ...mode,
      valeur: donnees.parts[figure.clef][mode.clef],
      repere: donnees.medianes[figure.clef][mode.clef],
    })),
  }))
})

function styleAccesDonut(figure: (typeof accesFigures)['value'][number]): Record<string, string> {
  const part = (clef: ModeMobiliteCahier): number =>
    figure.modes.find((mode) => mode.clef === clef)?.valeur ?? 0
  const marche = Math.max(0, Math.min(1, part('t')))
  const velo = Math.max(marche, Math.min(1, part('b')))
  const voiture = Math.max(velo, Math.min(1, part('c')))
  return {
    '--donut-marche': `${marche * 360}deg`,
    '--donut-velo': `${velo * 360}deg`,
    '--donut-voiture': `${voiture * 360}deg`,
  }
}

function rangPiedEstExtremite(figure: (typeof accesFigures)['value'][number]): boolean {
  const bord = Math.max(1, Math.ceil(figure.rangPied.total * 0.05))
  return figure.rangPied.rang <= bord || figure.rangPied.rang > figure.rangPied.total - bord
}

/** Give each hand-marked rank a small, deterministic wobble rather than one repeated stamp. */
function variationRang(seed: string): Record<string, string> {
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

const servicesMieuxDesservis = computed(() =>
  accesFigures.value.filter((figure) =>
    figure.modes.every((mode) => mode.valeur >= mode.repere),
  ).length,
)

const comparaison = computed(() => {
  return 'Médiane EPCI bretons'
})

function ancreFigure(nom: string): string {
  return `figure-${nom}`
}

onMounted(() => {
  activeFigure.value = ancreFigure('lecture')
  scheduleBaselineAlignment()

  if (rootRef.value && 'ResizeObserver' in window) {
    baselineObserver = new ResizeObserver(scheduleBaselineAlignment)
    baselineObserver.observe(rootRef.value)
  }

  const fontsReady = document.fonts?.ready
  if (fontsReady) void fontsReady.then(scheduleBaselineAlignment)

  if (!rootRef.value || !('IntersectionObserver' in window)) return

  const figures = [...rootRef.value.querySelectorAll<HTMLElement>('[data-figure]')]
  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      const key = visible[0]?.target.getAttribute('data-figure')
      if (key) activeFigure.value = key
    },
    { rootMargin: '-14% 0px -66% 0px', threshold: [0, 0.25, 0.75] },
  )
  figures.forEach((figure) => observer?.observe(figure))
})

onBeforeUnmount(() => {
  observer?.disconnect()
  baselineObserver?.disconnect()
  if (baselineFrame !== null) window.cancelAnimationFrame(baselineFrame)
})
</script>

<template>
  <article
    ref="rootRef"
    class="cahier"
    :style="{
      '--cahier-theme': `var(--theme-${theme}-line)`,
      '--cahier-theme-strong': `var(--theme-${theme}-strong)`,
      '--cahier-ground': `var(--theme-${theme}-soft)`,
      '--cahier-theme-emphasis': `var(--theme-${theme})`,
      '--cahier-region-emphasis': 'var(--brand-200)',
      '--cahier-mode-foot': `var(--theme-${theme}-foot)`,
      '--cahier-mode-bike': `var(--theme-${theme}-bike)`,
      '--cahier-mode-car': `var(--theme-${theme}-car)`,
    }"
  >
    <!-- The cover is intentionally only a prototype frame; #511 review is on
         the body pages. -->
    <header class="cahier-cover">
      <nav class="cahier-local-nav" aria-label="Navigation de la fiche">
        <RouterLink class="cahier-wordmark" to="/">Lusk</RouterLink>
        <span class="cahier-local-divider" aria-hidden="true">·</span>
        <span>Fiche d’identité</span>
        <RouterLink class="cahier-home-link" to="/">Accueil</RouterLink>
      </nav>
      <div class="cover-body">
        <p class="cover-context">{{ matiere.nomTheme }} · Bretagne</p>
        <h1>{{ matiere.nomTerritoire }}</h1>
        <p class="cover-lead">Un cahier de lecture pour regarder ce qui se passe ici.</p>
        <div class="cover-signature">
          <span>Fiche de lecture</span><span aria-hidden="true">/</span><span>Données publiques</span>
        </div>
      </div>
      <div class="cover-bottom-rule" aria-hidden="true" />
    </header>

    <div class="cahier-reader">
      <aside class="cahier-spine" aria-label="Sommaire du cahier">
        <p class="spine-title">Sommaire</p>
        <ol>
          <li>
            <a
              :href="`#${ancreFigure('lecture')}`"
              :aria-current="activeFigure === ancreFigure('lecture') ? 'location' : undefined"
            >
              <span class="spine-number">{{ String(pageNumber).padStart(2, '0') }}</span>
                <span>{{ titrePage }}</span>
            </a>
          </li>
          <li>
            <a
              :href="`#${ancreFigure('sources')}`"
              :aria-current="activeFigure === ancreFigure('sources') ? 'location' : undefined"
            >
              <span class="spine-number">—</span>
              <span>Carnet des sources</span>
            </a>
          </li>
        </ol>
      </aside>

      <main class="cahier-pages">
        <section
          :id="ancreFigure('lecture')"
          class="cahier-page"
          data-figure="figure-lecture"
          :aria-labelledby="`${ancreFigure('lecture')}-title`"
        >
          <div class="page-margin" aria-label="Informations marginales">
            <div class="page-number">
              <span>page</span>
              {{ String(pageNumber).padStart(2, '0') }}<small>/{{ String(totalPages).padStart(2, '0') }}</small>
            </div>
            <div v-if="groupePage" class="margin-sources">
              <span class="margin-label">Sources</span>
              <RouterLink v-for="source in sources" :key="source" to="/sources">
                {{ source }}
              </RouterLink>
            </div>
          </div>

          <header class="page-heading">
            <h2 class="cahier-baseline-anchor" :id="`${ancreFigure('lecture')}-title`">{{ titrePage }}</h2>
            <p class="page-subtitle cahier-baseline-first-line">
              Cette page illustre les différences d'accès aux services pour les habitants en fonction du mode de déplacement : voiture,
              vélo et marche (transports en commun inclus). Elle présente les résultats d'une analyse qui cartographie les équipements
              (BPE INSEE) accessibles en <strong class="window-value">20 minutes</strong>, pour chaque mode, autour de chaque bâtiment résidentiel breton
              (<strong class="region-emphasis">{{ donneesCahier ? formatMillions(donneesCahier.totalBatimentsBretons) : '—' }}</strong> de bâtiments au total, dont
              <strong class="theme-emphasis">{{ donneesCahier ? formaterNombreFR(donneesCahier.batimentsTerritoire, 0) : '—' }}</strong> à {{ nomTerritoireCourt }}).
            </p>
          </header>

          <div class="figure-stack">
            <section class="concept-group">
              <div class="concept-group-heading cahier-baseline-group">
                <span>01</span>
                <h3>Perte de diversité</h3>
              </div>
              <section class="figure-spread" :id="ancreFigure('vingt-minutes')" data-figure="figure-vingt-minutes">
                <div class="argument-side">
                   <h4 class="cahier-baseline-anchor cahier-marelle-anchor">Ce que l'on perd sans voiture</h4>
                   <p class="argument-copy cahier-baseline-first-line">
                     À {{ nomTerritoireCourt }}, sans voiture et dans un rayon de vingt minutes, le bâtiment médian perd accès à
                     <strong class="mode-emphasis--t">{{ modes[0]?.valeur?.texte ?? '—' }}</strong> différents types de services dans un rayon de vingt minutes.
                     C'est bien mieux que dans l'EPCI médian, et le vélo permet de limiter cette perte à
                     <strong class="mode-emphasis--b">{{ modes[1]?.valeur?.texte ?? '—' }}</strong>.
                   </p>
                    <RouterLink
                      v-if="lienIndicateur('div_loss_t')"
                      class="more-link cahier-baseline-anchor"
                      :to="lienIndicateur('div_loss_t')!"
                      target="_blank"
                      rel="noopener noreferrer"
                    >En savoir plus</RouterLink>
                   <div class="mode-figures-heading type-figure-column" aria-hidden="true"><span /><span>Types de services perdus</span></div>
                  <dl class="mode-figures">
                     <div v-for="mode in modes" :key="mode.clef" :class="['mode-figure', `mode-figure--${mode.mode}`]">
                      <dt><component :is="mode.icon" :size="20" stroke-width="1.6" />{{ mode.label }}</dt>
                      <dd>
                        <span class="mode-value" :class="{ 'is-extreme': mode.statistique.extremite }">
                          {{ mode.valeur?.texte ?? '—' }}
                        </span>
                        <small v-if="mode.statistique.mediane !== null" class="mode-reference regional-reading">
                            {{ comparaison }} : <strong class="region-emphasis">{{ formaterNombreFR(mode.statistique.mediane, 0) }}</strong>
                        </small>
                         <RouterLink
                           v-if="mode.statistique.rang && lienIndicateur(mode.clef)"
                           class="mode-rank regional-reading rank-emphasis rank-link"
                           :class="{ 'is-extreme': mode.statistique.extremite }"
                           :style="variationRang(mode.clef)"
                           :to="lienIndicateur(mode.clef)!"
                           target="_blank"
                           rel="noopener noreferrer"
                         >{{ mode.statistique.rang }}</RouterLink>
                         <small v-else-if="mode.statistique.rang" class="mode-rank regional-reading rank-emphasis" :class="{ 'is-extreme': mode.statistique.extremite }" :style="variationRang(mode.clef)">
                           {{ mode.statistique.rang }}
                         </small>
                      </dd>
                    </div>
                  </dl>
                </div>

                <figure class="evidence-side evidence-figure">
                <figcaption class="cahier-baseline-anchor">Distribution des bâtiments de {{ nomTerritoireCourt }} par types de services perdus</figcaption>
                  <DistributionFigureCahier
                    v-if="distributionFigure"
                    :distribution="distributionFigure.distribution"
                    :mediane="distributionFigure.mediane"
                    :mediane-velo="distributionFigure.medianeVelo"
                    :modes="distributionFigure.modes"
                    :nom="distributionFigure.nom"
                    :nuage="distributionFigure.nuage"
                  />
                </figure>
              </section>
            </section>

            <section class="concept-group">
              <div class="concept-group-heading cahier-baseline-group">
                <span>02</span>
                <h3>Perte totale</h3>
              </div>
              <section class="figure-spread figure-spread--flip" :id="ancreFigure('perte-totale')" data-figure="figure-perte-totale">
                <figure class="evidence-side evidence-figure">
                  <figcaption class="cahier-baseline-anchor">Accès perdus par bâtiment</figcaption>
                   <div class="comparison-figure" :aria-label="`Perte totale comparée à ${comparaison}`">
                       <div class="comparison-header type-figure-column">
                         <span>Mode</span><span>{{ nomTerritoireCourt }}</span><span>{{ comparaison }}</span>
                    </div>
                     <div v-for="perte in pertes" :key="perte.clef" :class="['comparison-row', `comparison-row--${perte.mode}`]">
                      <div class="comparison-label">
                        <component :is="perte.icon" :size="18" stroke-width="1.6" />
                        <span>{{ perte.label }}</span>
                      </div>
                      <div class="bar-cell bar-cell--current">
                        <div class="bar-line">
                          <span class="bar bar--current" :style="{ width: largeurBarre(perte.actuel, pertesMaximum) }" />
                      <strong :class="{ 'is-extreme': perte.extremite }">{{ perte.actuelTexte }}</strong>
                        </div>
                         <RouterLink
                           v-if="perte.rang && lienIndicateur(perte.clef)"
                           class="comparison-rank rank-emphasis rank-link"
                            :class="{ 'is-extreme': perte.extremite }"
                            :style="variationRang(perte.clef)"
                            :to="lienIndicateur(perte.clef)!"
                            target="_blank"
                            rel="noopener noreferrer"
                         >{{ perte.rang }}</RouterLink>
                         <small v-else-if="perte.rang" class="comparison-rank rank-emphasis" :class="{ 'is-extreme': perte.extremite }" :style="variationRang(perte.clef)">{{ perte.rang }}</small>
                      </div>
                      <div class="bar-cell bar-cell--reference">
                        <div class="bar-line">
                          <span class="bar bar--reference" :style="{ width: largeurBarre(perte.repere, pertesMaximum) }" />
                      <strong>{{ formatCompte(perte.repere) }}</strong>
                        </div>
                         <small class="comparison-rank rank-emphasis" aria-hidden="true">&nbsp;</small>
                      </div>
                    </div>
                  </div>
                </figure>

                <div class="argument-side">
                  <h4 class="cahier-baseline-anchor cahier-marelle-anchor">Et en volume ?</h4>
                   <p class="argument-copy cahier-baseline-first-line">
                     Si on perd peu de <em>types</em> de services à {{ nomTerritoireCourt }}, on perd quand même beaucoup d'équipements au total :
                      <strong class="mode-emphasis--t">{{ pertes[0]?.actuelTexte ?? '—' }}</strong> à pied + TC et
                     <strong class="mode-emphasis--b">{{ pertes[1]?.actuelTexte ?? '—' }}</strong> à vélo + TC.
                     C'est plus que la médiane des EPCI bretons.
                   </p>
                    <RouterLink
                      v-if="lienIndicateur('tot_loss_t')"
                      class="more-link cahier-baseline-anchor"
                      :to="lienIndicateur('tot_loss_t')!"
                      target="_blank"
                      rel="noopener noreferrer"
                    >En savoir plus</RouterLink>
                </div>
              </section>
            </section>

            <section class="concept-group">
              <div class="concept-group-heading cahier-baseline-group">
                <span>03</span>
                <h3>Les services essentiels</h3>
              </div>
              <section class="figure-spread" :id="ancreFigure('isolement')" data-figure="figure-isolement">
                <div class="argument-side">
                  <h4 class="cahier-baseline-anchor cahier-marelle-anchor">Tous les équipements ne se valent pas</h4>
                   <p class="argument-copy cahier-baseline-first-line">
                     À {{ nomTerritoireCourt }}, les bâtiments ont une couverture totale en voiture. Même si certains restent isolés à pied,
                     la desserte est très bonne : <strong class="region-emphasis">{{ servicesMieuxDesservis }}/5</strong> des services essentiels listés sont mieux desservis que dans l’EPCI médian.
                   </p>
                    <RouterLink
                      v-if="lienIndicateur('iso_alimentation')"
                      class="more-link cahier-baseline-anchor"
                      :to="lienIndicateur('iso_alimentation')!"
                      target="_blank"
                      rel="noopener noreferrer"
                    >En savoir plus</RouterLink>
                </div>

                <figure class="evidence-side access-figure-collection">
                  <h4 class="access-figure-title cahier-baseline-anchor">Part des bâtiments qui ont accès à chaque type de service en vingt minutes</h4>
                  <div class="access-figures" aria-label="Part des bâtiments accessibles par service et par mode">
                    <figure v-for="figure in accesFigures" :key="figure.clef" class="access-figure">
                    <div
                      class="stacked-donut"
                      :style="styleAccesDonut(figure)"
                      :tabindex="0"
                      role="img"
                      :aria-describedby="`acces-detail-${figure.clef}`"
                       :aria-label="`${figure.label}. ${figure.modes.map((mode) => `${mode.label} : ${formatPourcent(mode.valeur)} %, médiane EPCI bretons ${formatPourcent(mode.repere)} %`).join('; ')}`"
                    >
                      <span class="stacked-donut-center">
                        <component :is="figure.icon" class="stacked-donut-icon" :size="16" stroke-width="1.5" aria-hidden="true" />
                        <span>{{ figure.label }}</span>
                      </span>
                    </div>
                      <div class="access-foot-summary">
                        <div class="access-foot-value">
                          <strong :class="{ 'is-extreme': rangPiedEstExtremite(figure) }">{{ formatPourcent(figure.modes.find((mode) => mode.clef === 't')?.valeur ?? null) }}<small>%</small></strong>
                          <span class="access-foot-label"><Footprints :size="14" stroke-width="1.7" aria-hidden="true" />À pied + TC</span>
                        </div>
                      <div class="access-foot-comparison">
                         <span class="regional-reading">Médiane EPCI bretons : <strong class="region-emphasis">{{ formatPourcent(figure.modes.find((mode) => mode.clef === 't')?.repere ?? null) }}<small>%</small></strong></span>
                          <RouterLink
                            v-if="lienIndicateur(`iso_${figure.clef}`)"
                            class="regional-reading rank-emphasis rank-emphasis--regional rank-link"
                            :class="{ 'is-extreme': rangPiedEstExtremite(figure) }"
                            :style="variationRang(figure.clef)"
                            :to="lienIndicateur(`iso_${figure.clef}`)!"
                            target="_blank"
                            rel="noopener noreferrer"
                          >{{ figure.rangPied.rang }}e/{{ figure.rangPied.total }}</RouterLink>
                          <span v-else class="regional-reading rank-emphasis rank-emphasis--regional" :class="{ 'is-extreme': rangPiedEstExtremite(figure) }" :style="variationRang(figure.clef)">{{ figure.rangPied.rang }}e/{{ figure.rangPied.total }}</span>
                      </div>
                    </div>
                    <div :id="`acces-detail-${figure.clef}`" class="access-tooltip" role="tooltip">
                      <strong>Détail par mode</strong>
                      <dl>
                        <div v-for="mode in figure.modes" :key="mode.clef" :class="`access-detail--${mode.clef}`">
                          <dt><component :is="mode.icon" :size="12" stroke-width="1.7" />{{ mode.label }}</dt>
                          <dd>{{ formatPourcent(mode.valeur) }} %</dd>
                          <small>Médiane EPCI bretons : {{ formatPourcent(mode.repere) }} %</small>
                        </div>
                      </dl>
                    </div>
                    </figure>
                    <div class="access-legend" aria-label="Légende des parts d'accessibilité">
                      <p>Chaque cercle empile les accès disponibles : d'abord à pied + TC, puis à vélo + TC, puis en voiture.</p>
                      <span class="access-legend-item access-legend-item--t"><i />À pied + TC</span>
                      <span class="access-legend-item access-legend-item--b"><i />À vélo + TC</span>
                      <span class="access-legend-item access-legend-item--c"><i />Voiture</span>
                      <span class="access-legend-item access-legend-item--none"><i />Aucun accès</span>
                    </div>
                  </div>
                </figure>
              </section>
            </section>
          </div>
        </section>

        <section
          :id="ancreFigure('sources')"
          class="sources-page"
          data-figure="figure-sources"
          aria-labelledby="sources-title"
        >
          <div class="page-margin" aria-hidden="true"><div class="page-number"><span>fin</span> ·</div></div>
          <header class="page-heading">
            <h2 id="sources-title">Carnet des sources</h2>
          </header>
          <dl class="sources-list">
            <div v-for="preuve in matiere.preuves" :key="preuve.id">
              <dt>{{ preuve.dataset }}</dt>
              <dd>
                <span v-if="preuve.editeur">{{ preuve.editeur }}</span>
                <span v-if="preuve.licence"> · {{ preuve.licence }}</span>
                <span v-if="preuve.fraicheur"> · {{ preuve.fraicheur }}</span>
              </dd>
            </div>
          </dl>
          <RouterLink class="sources-link" to="/sources">Voir toutes les sources</RouterLink>
        </section>
      </main>
    </div>
  </article>
</template>

<style scoped>
@font-face {
  font-family: 'Marelle';
  src: url('/fonts/Marelle-Regular.woff2') format('woff2');
  font-display: swap;
  font-weight: 400;
}

.cahier {
  --paper: #f1f2ec;
  --paper-deep: #dfe5df;
  --ink: #232a2a;
  --muted: #62706c;
  --red: #a44f51;
  --red-soft: rgba(164, 79, 81, 0.58);
  --cahier-default: var(--muted);
  --cahier-theme-emphasis: var(--theme-mobilite);
  --cahier-region-emphasis: var(--brand-200);
  --cahier-mode-foot: var(--theme-mobilite-foot);
  --cahier-mode-bike: var(--theme-mobilite-bike);
  --cahier-mode-car: var(--theme-mobilite-car);
  --margin-line: 104px;
  --rule: color-mix(in srgb, var(--cahier-theme) 19%, transparent);
  --fine-rule: color-mix(in srgb, var(--cahier-theme) 8%, transparent);
  min-height: 100vh;
  color: var(--ink);
  background: var(--cahier-ground);
  font-family: var(--font-sans);
}

.cahier-cover,
.cahier-page,
.sources-page {
  background-color: var(--paper);
  background-image:
    linear-gradient(
      to right,
       transparent 0,
       transparent var(--margin-line),
       var(--red-soft) var(--margin-line),
       var(--red-soft) calc(var(--margin-line) + 1px),
       transparent calc(var(--margin-line) + 1px)
    ),
    repeating-linear-gradient(
      to bottom,
      transparent 0 7px,
      var(--fine-rule) 7px 8px,
      transparent 8px 15px,
      var(--fine-rule) 15px 16px,
      transparent 16px 23px,
      var(--fine-rule) 23px 24px,
      transparent 24px 30px,
      var(--rule) 30px 32px
    );
}

.cahier-cover {
  padding: 22px clamp(24px, 6vw, 96px) 64px;
  border-bottom: 1px solid var(--red-soft);
}

.cahier-local-nav {
  display: flex;
  align-items: baseline;
  gap: 12px;
  max-width: 1400px;
  margin: 0 auto;
  padding-left: 92px;
  color: var(--muted);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.cahier-local-nav a {
  color: inherit;
  text-underline-offset: 4px;
}

.cahier-wordmark {
  color: var(--ink) !important;
  font-family: var(--font-serif);
  font-size: 20px;
  font-style: italic;
  font-weight: 600;
  letter-spacing: -0.03em;
  text-transform: none;
}

.cahier-local-divider {
  color: var(--red);
  font-size: 20px;
}

.cahier-home-link {
  margin-left: auto;
}

.cover-body {
  max-width: 1400px;
  margin: 116px auto 0;
  padding-left: 92px;
}

.cover-context {
  margin: 0 0 18px;
  color: var(--cahier-theme-strong);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.cover-body h1 {
  max-width: 1050px;
  margin: 0;
  color: var(--ink);
  font-family: var(--font-serif);
  font-size: clamp(4rem, 10vw, 8rem);
  font-weight: 500;
  letter-spacing: -0.065em;
  line-height: 0.86;
}

.cover-lead {
  max-width: 38rem;
  margin: 30px 0 0;
  color: var(--muted);
  font-family: var(--font-serif);
  font-size: 21px;
  line-height: 1.4;
}

.cover-signature {
  display: flex;
  gap: 12px;
  margin-top: 76px;
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.cover-signature span:nth-child(2) {
  color: var(--red);
}

.cover-bottom-rule {
  max-width: 1400px;
  height: 9px;
  margin: 76px auto 0;
  border-top: 1px solid var(--cahier-theme);
  border-bottom: 1px solid var(--red);
}

.cahier-reader {
  display: grid;
  grid-template-columns: minmax(160px, 210px) minmax(0, 1fr);
  gap: clamp(28px, 4vw, 68px);
  max-width: 1640px;
  margin: 0 auto;
  padding: 80px clamp(24px, 6vw, 96px) 128px;
}

.cahier-spine {
  position: sticky;
  top: 24px;
  align-self: start;
  padding-top: 4px;
}

.spine-title,
.margin-label {
  margin: 0;
  color: var(--cahier-theme-strong);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.cahier-spine ol {
  display: grid;
  gap: 6px;
  margin: 18px 0 0;
  padding: 0;
  list-style: none;
}

.cahier-spine a {
  display: grid;
  grid-template-columns: 28px 1fr;
  gap: 8px;
  padding: 7px 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.3;
  text-decoration: none;
}

.cahier-spine a > span:last-child {
  min-width: 0;
  overflow-wrap: anywhere;
}

.cahier-spine a:hover,
.cahier-spine a[aria-current='location'] {
  color: var(--ink);
}

.cahier-spine a[aria-current='location'] .spine-number {
  color: var(--red);
}

.spine-number {
  color: var(--cahier-theme-strong);
  font-variant-numeric: tabular-nums;
}

.mobile-index {
  display: none;
}

.cahier-pages {
  display: grid;
  gap: 96px;
  min-width: 0;
}

.cahier-page,
.sources-page {
  container: cahier-page / inline-size;
  position: relative;
  min-width: 0;
  --page-left-inset: 148px;
  --page-right-inset: 64px;
  padding: 48px var(--page-right-inset) 56px var(--page-left-inset);
  border: 1px solid color-mix(in srgb, var(--ink) 15%, transparent);
  box-shadow: 0 14px 30px rgba(67, 57, 42, 0.11);
  scroll-margin-top: 28px;
}

.page-margin {
  position: absolute;
  top: 48px;
  left: 18px;
  display: grid;
  width: 72px;
  gap: 30px;
  align-content: start;
  text-align: center;
}

.page-number {
  display: grid;
  gap: 3px;
  color: var(--red);
  font-family: var(--font-serif);
  font-size: 29px;
  line-height: 0.9;
}

.page-number span {
  color: var(--muted);
  font-family: var(--font-sans);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.page-number small {
  color: var(--muted);
  font-family: var(--font-sans);
  font-size: 9px;
}

.margin-sources {
  display: grid;
  gap: 10px;
  justify-items: center;
  overflow-wrap: anywhere;
}

.margin-sources a {
  color: var(--cahier-theme-strong);
  font-size: 10px;
  line-height: 1.1;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
  word-break: break-word;
}

.page-heading {
  padding-right: calc(var(--page-left-inset) - var(--page-right-inset));
  padding-bottom: 18px;
}

.page-heading h2 {
  max-width: none;
  margin: 0;
  color: var(--ink);
  font-family: var(--font-serif);
  font-size: clamp(1.65rem, 2.8vw, 2.4rem);
  font-weight: 400;
  letter-spacing: -0.035em;
  line-height: 1;
  text-align: center;
}

.page-subtitle {
  max-width: none;
  margin: 14px 0 0;
  color: var(--cahier-default);
  font-family: var(--font-sans);
  font-size: 15px;
  font-weight: 400;
  line-height: 1.55;
  text-align: justify;
}

.page-subtitle .window-value,
.theme-emphasis {
  color: var(--cahier-theme-emphasis);
  font-weight: 700;
}

.region-emphasis {
  color: var(--cahier-region-emphasis);
  font-weight: 700;
}

.mode-emphasis--t {
  color: var(--cahier-mode-foot);
  font-weight: 700;
}

.mode-emphasis--b {
  color: var(--cahier-mode-bike);
  font-weight: 700;
}

.concept-group-heading {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 14px;
  padding: 8px 0 14px;
}

.concept-group-heading span {
  color: var(--red);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  letter-spacing: 0.08em;
  text-align: center;
}

.concept-group-heading h3 {
  margin: 0;
  color: var(--ink);
  font-family: var(--font-serif);
  font-size: calc(1.2rem + 2px);
  font-weight: 500;
  letter-spacing: -0.02em;
  line-height: 1;
}

.figure-stack {
  display: grid;
  gap: 0;
}

.figure-spread {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(420px, 1.2fr);
  column-gap: clamp(40px, 5vw, 76px);
  row-gap: 34px;
  align-items: start;
  padding: 22px 0;
}

.figure-spread--flip .argument-side {
  order: 2;
}

.figure-spread--flip .evidence-side {
  order: 1;
}

.argument-side,
.evidence-side {
  min-width: 0;
}

.argument-side {
  --mode-scalar-width: 160px;
}

.argument-side h3,
.argument-side h4 {
  margin: 0;
  color: var(--cahier-theme-emphasis);
  font-family: 'Marelle', var(--font-serif);
  font-size: clamp(calc(1rem + 2px), calc(1.35vw + 2px), calc(1.25rem + 2px));
  font-weight: 500;
  letter-spacing: 0;
  line-height: 1.2;
}

.evidence-figure figcaption {
  margin: 0;
  color: var(--cahier-default);
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1.25;
}

.argument-copy {
  max-width: none;
  width: 100%;
  margin: 22px 0 0;
  color: var(--cahier-default);
  font-size: 15px;
  font-weight: 400;
  line-height: 1.55;
  text-align: justify;
}

.argument-copy em {
  color: inherit;
  font-style: italic;
}

.more-link {
  display: inline-block;
  margin-top: 18px;
  color: var(--red);
  font-size: 14px;
  font-weight: 700;
  text-underline-offset: 4px;
}

.argument-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 30px 0 0;
  color: var(--cahier-default);
  font-size: 12px;
  line-height: 1.4;
}

.mode-figures {
  display: grid;
  gap: 0;
  margin: 10px 0 0;
}

.mode-figures-heading {
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--mode-scalar-width);
  gap: 12px;
  color: var(--cahier-default);
  text-align: center;
}

.mode-figure {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 14px 0 34px;
}

.mode-figure dt {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--cahier-default);
  font: var(--type-figure-mode);
  line-height: 1.3;
}

.mode-figure dt svg {
  flex: 0 0 auto;
}

.mode-figure--t dt svg,
.mode-figure--t .mode-value {
  color: var(--cahier-mode-foot);
}

.mode-figure--b dt svg,
.mode-figure--b .mode-value {
  color: var(--cahier-mode-bike);
}

.mode-figure dd {
  position: relative;
  width: var(--mode-scalar-width);
  min-width: 0;
  margin: 0;
  color: var(--cahier-default);
  font: var(--type-figure-value);
  font-size: 27px;
  text-align: center;
}

.mode-value {
  display: block;
}

.mode-value.is-extreme,
.bar-cell strong.is-extreme,
.access-foot-value strong.is-extreme,
.iso-donut .donut-value.is-extreme {
  text-decoration: underline;
  text-decoration-color: var(--red);
  text-decoration-thickness: 2px;
  text-underline-offset: 4px;
}

.rank-emphasis.is-extreme {
  position: relative;
  z-index: 0;
  display: inline-block;
  width: max-content;
  padding: 4px 2px 5px;
  border: 0;
  line-height: 1.2;
  text-decoration: none;
  justify-self: center;
}

.rank-emphasis.is-extreme::before,
.rank-emphasis.is-extreme::after {
  position: absolute;
  z-index: 0;
  content: '';
  pointer-events: none;
}

.rank-emphasis.is-extreme::before {
  inset: -2px -2px -3px;
  border: 1px solid var(--red);
  border-top-color: color-mix(in srgb, var(--red) 48%, transparent);
  border-radius: var(--rank-radius-a, 48% 53% 46% 52% / 54% 45% 55% 47%);
  transform: rotate(var(--rank-angle-a, -4deg));
}

.rank-emphasis.is-extreme::after {
  inset: -3px -2px -2px -3px;
  border: 1px solid transparent;
  border-left-color: color-mix(in srgb, var(--red) 48%, transparent);
  border-right-color: color-mix(in srgb, var(--red) 72%, transparent);
  border-bottom-color: color-mix(in srgb, var(--red) 72%, transparent);
  border-radius: var(--rank-radius-b, 53% 46% 54% 47% / 46% 56% 44% 54%);
  transform: rotate(var(--rank-angle-b, 4deg));
}

.mode-figure dd small {
  display: block;
  margin-top: 9px;
  color: var(--cahier-default);
  font-family: var(--font-sans);
  font-size: 11px;
  line-height: 1.2;
  text-transform: uppercase;
}

.mode-figure dd small:first-of-type {
  margin-top: 11px;
}

.mode-figure dd small.mode-reference {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  width: 100%;
  max-width: none;
  white-space: nowrap;
  margin-top: 0;
  color: var(--cahier-default);
  line-height: 1.25;
  text-transform: none;
}

.mode-figure dd small.mode-rank {
  position: absolute;
  top: calc(100% + 20px);
  left: 0;
  width: 100%;
  margin-top: 0;
  color: var(--cahier-region-emphasis);
  line-height: 1.25;
  text-transform: none;
}

.mode-figure dd small.mode-rank.is-extreme {
  left: 50%;
  width: max-content;
  transform: translateX(-50%);
}

.regional-reading {
  font: var(--type-figure-mode);
  font-size: 11px;
  line-height: 1.25;
}

.rank-emphasis {
  font-weight: 700;
}

.rank-link {
  position: relative;
  z-index: 1;
  color: inherit;
  text-decoration: none;
}

.rank-link:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.rank-link:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 3px;
}

.rank-emphasis--regional {
  color: var(--cahier-region-emphasis);
}

.mode-figure dd small.mode-reference .region-emphasis {
  color: var(--cahier-region-emphasis);
}

.evidence-figure {
  margin: 0;
  padding: 12px 0 0;
}

.evidence-figure figcaption {
  margin-bottom: 20px;
}

.comparison-figure {
  display: grid;
  gap: 0;
  padding: 16px 0 18px;
}

.comparison-header,
.comparison-row {
  display: grid;
  grid-template-columns: minmax(150px, 1.1fr) minmax(100px, 1fr) minmax(100px, 1fr);
  gap: 16px;
  align-items: center;
}

.comparison-header {
  padding-bottom: 12px;
  color: var(--cahier-default);
}

.comparison-header span:not(:first-child) {
  text-align: right;
}

.comparison-row {
  padding: 18px 0;
}

.comparison-label {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  color: var(--cahier-default);
  font: var(--type-figure-mode);
  line-height: 1.25;
  text-align: left;
}

.comparison-label svg {
  flex: 0 0 auto;
}

.comparison-row--t .comparison-label svg,
.comparison-row--t .bar-cell--current .bar,
.comparison-row--t .bar-cell--current strong,
.comparison-row--t .bar-cell--current .comparison-rank {
  color: var(--cahier-mode-foot);
}

.comparison-row--t .bar-cell--current .bar {
  background: var(--cahier-mode-foot);
}

.comparison-row--b .comparison-label svg,
.comparison-row--b .bar-cell--current .bar,
.comparison-row--b .bar-cell--current strong,
.comparison-row--b .bar-cell--current .comparison-rank {
  color: var(--cahier-mode-bike);
}

.comparison-row--b .bar-cell--current .bar {
  background: var(--cahier-mode-bike);
}

.bar-cell {
  position: relative;
  display: grid;
  gap: 5px;
  align-content: start;
  align-self: start;
}

.comparison-row {
  align-items: start;
}

.comparison-rank {
  display: block;
  width: 100%;
  margin-top: 0;
  color: var(--cahier-region-emphasis);
  font-size: 11px;
  line-height: 1.2;
  text-align: right;
}

.comparison-rank.is-extreme {
  width: max-content;
  margin-left: auto;
}

.bar-line {
  display: grid;
  grid-template-columns: minmax(20px, 1fr) auto;
  gap: 10px;
  align-items: center;
  min-height: 18px;
}

.bar {
  display: block;
  min-width: 4px;
  height: 9px;
  background: var(--cahier-region-emphasis);
}

.bar--reference {
  background: var(--cahier-region-emphasis);
}

.bar-cell strong {
  color: var(--cahier-region-emphasis);
  font: var(--type-figure-value);
  font-variant-numeric: tabular-nums;
}

.bar-cell--reference strong {
  color: var(--cahier-region-emphasis);
}

.access-figure-collection {
  min-width: 0;
  margin: 0;
  padding: 12px 0 0;
}

.access-figure-title {
  margin: 0 0 20px;
  color: var(--cahier-default);
  font: var(--type-figure-column);
  font-weight: 700;
  line-height: 1.25;
  text-align: center;
}

.access-figures {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 28px 18px;
  align-items: start;
}

.access-figure {
  position: relative;
  display: grid;
  min-width: 0;
  gap: 8px;
  justify-items: center;
  margin: 0;
  padding: 0;
}

.stacked-donut {
  position: relative;
  width: clamp(92px, 12vw, 132px);
  aspect-ratio: 1;
  margin: 0 auto;
  border-radius: 50%;
  background: conic-gradient(
    var(--cahier-mode-foot) 0deg var(--donut-marche),
    var(--cahier-mode-bike) var(--donut-marche) var(--donut-velo),
    var(--cahier-mode-car) var(--donut-velo) var(--donut-voiture),
    var(--paper-deep) var(--donut-voiture) 360deg
  );
}

.stacked-donut::after {
  position: absolute;
  inset: 10%;
  z-index: 1;
  border-radius: 50%;
  background: var(--paper);
  content: '';
}

.stacked-donut:focus-visible {
  outline: 2px solid var(--cahier-region-emphasis);
  outline-offset: 5px;
}

.stacked-donut-center {
  position: absolute;
  inset: 16%;
  z-index: 2;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 4px;
  color: var(--cahier-default);
  font: var(--type-figure-mode);
  line-height: 1.1;
  text-align: center;
}

.stacked-donut-icon {
  color: var(--cahier-default);
}

.access-foot-summary {
  display: grid;
  width: 100%;
  gap: 4px;
  justify-items: center;
}

.access-foot-value {
  display: grid;
  justify-items: center;
  gap: 3px;
  width: 100%;
  color: var(--cahier-mode-foot);
  font: var(--type-figure-mode);
}

.access-foot-value strong {
  font: var(--type-figure-value);
  font-variant-numeric: tabular-nums;
}

.access-foot-value strong small {
  font-size: 0.65em;
}

.access-foot-label {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  gap: 5px;
  font-size: 10px;
  line-height: 1.1;
  white-space: nowrap;
}

.access-foot-comparison {
  display: grid;
  justify-content: center;
  gap: 2px;
  color: var(--cahier-default);
  font: var(--type-figure-mode);
  font-size: 11px;
  line-height: 1.25;
  text-align: center;
}

.access-foot-comparison .region-emphasis {
  color: var(--cahier-region-emphasis);
}

.access-foot-comparison strong {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.access-foot-comparison strong small {
  font-size: 0.65em;
}

.access-tooltip {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  z-index: 10;
  width: min(220px, calc(100% + 80px));
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--cahier-theme-emphasis) 30%, transparent);
  background: var(--paper);
  box-shadow: 0 12px 28px rgba(35, 42, 42, 0.16);
  color: var(--cahier-default);
  font: var(--type-figure-column);
  line-height: 1.25;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, -4px);
  visibility: hidden;
}

.stacked-donut:hover ~ .access-tooltip,
.stacked-donut:focus-visible ~ .access-tooltip {
  opacity: 1;
  transform: translate(-50%, 0);
  visibility: visible;
}

.access-tooltip > strong {
  color: var(--cahier-region-emphasis);
}

.access-tooltip dl {
  display: grid;
  gap: 7px;
  margin: 8px 0 0;
}

.access-tooltip dl > div {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px 8px;
}

.access-tooltip dt {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 5px;
  color: var(--cahier-default);
  font: var(--type-figure-mode);
}

.access-tooltip dd {
  margin: 0;
  font: var(--type-figure-value);
  font-variant-numeric: tabular-nums;
}

.access-tooltip small {
  grid-column: 1 / -1;
  color: var(--cahier-region-emphasis);
  font: inherit;
  font-size: 10px;
}

.access-detail--t dt,
.access-detail--t dd {
  color: var(--cahier-mode-foot);
}

.access-detail--b dt,
.access-detail--b dd {
  color: var(--cahier-mode-bike);
}

.access-detail--c dt,
.access-detail--c dd {
  color: var(--cahier-mode-car);
}

.access-legend {
  grid-column: 3;
  grid-row: 2;
  align-self: center;
  display: grid;
  gap: 7px;
  justify-items: center;
  padding: 10px 0;
  color: var(--cahier-default);
  font: var(--type-figure-legend);
  text-align: center;
}

.access-legend p {
  margin: 0 0 3px;
}

.access-legend-item {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
}

.access-legend-item i {
  display: inline-block;
  flex: 0 0 auto;
  width: 9px;
  height: 9px;
  border-radius: 50%;
}

.access-legend-item--t i {
  background: var(--cahier-mode-foot);
}

.access-legend-item--b i {
  background: var(--cahier-mode-bike);
}

.access-legend-item--c i {
  background: var(--cahier-mode-car);
}

.access-legend-item--none i {
  background: var(--paper-deep);
}

.access-legend small {
  margin-top: 3px;
  color: var(--cahier-region-emphasis);
  font: inherit;
  font-size: 10px;
}

.sources-page {
  padding-bottom: 72px;
}

.sources-list {
  display: grid;
  gap: 18px;
  margin: 48px 0 0;
}

.sources-list dt {
  color: var(--ink);
  font-size: 14px;
  font-weight: 700;
}

.sources-list dd {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
}

.sources-link {
  display: inline-block;
  margin-top: 48px;
  color: var(--cahier-theme-strong);
  font-size: 13px;
  text-underline-offset: 4px;
}

/* Align only the requested anchors to the paper's major baselines. */
@media (min-width: 761px) {
  .cahier-baseline-anchor,
  .cahier-baseline-first-line,
  .cahier-baseline-group {
    transform: translateY(var(--cahier-baseline-shift, 0px));
    margin-bottom: var(--cahier-baseline-shift, 0px);
  }

  .evidence-figure figcaption.cahier-baseline-anchor {
    margin-bottom: calc(20px + var(--cahier-baseline-shift, 0px));
  }
}

/* Browser zoom changes the page container before it changes the viewport. */
@container cahier-page (max-width: 900px) {
  .figure-spread {
    grid-template-columns: 1fr;
    gap: 32px;
  }

  .figure-spread--flip .argument-side,
  .figure-spread--flip .evidence-side {
    order: initial;
  }
}

@container cahier-page (max-width: 620px) {

  .comparison-header,
  .comparison-row {
    grid-template-columns: minmax(120px, 1fr) minmax(90px, 1fr) minmax(90px, 1fr);
  }

  .access-figures {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .access-legend {
    grid-column: 1 / -1;
    grid-row: auto;
  }
}

@container cahier-page (max-width: 480px) {
  .comparison-header,
  .comparison-row {
    grid-template-columns: minmax(100px, 1fr) minmax(76px, 1fr) minmax(76px, 1fr);
    gap: 8px;
  }
}

@media (max-width: 760px) {
  .cahier {
    --margin-line: 82px;
  }

  .cahier-reader {
    grid-template-columns: 1fr;
    padding-top: 36px;
  }

  .cahier-spine {
    display: none;
  }

  .mobile-index {
    display: block;
    padding: 0 24px;
    border-bottom: 1px solid var(--red-soft);
    background: var(--paper);
  }

  .mobile-index summary {
    padding: 17px 0;
    color: var(--cahier-theme-strong);
    cursor: pointer;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .mobile-index nav {
    display: grid;
    gap: 2px;
    padding: 0 0 18px 18px;
  }

  .mobile-index a {
    display: flex;
    gap: 12px;
    padding: 8px 0;
    color: var(--muted);
    font-size: 14px;
    text-decoration: none;
  }

  .figure-spread {
    grid-template-columns: 1fr;
    gap: 36px;
  }

  .figure-spread--flip .argument-side,
  .figure-spread--flip .evidence-side {
    order: initial;
  }

  .page-margin {
    width: 58px;
  }

  .cahier-page,
  .sources-page {
    --page-left-inset: 116px;
    --page-right-inset: 28px;
    padding-right: var(--page-right-inset);
    padding-left: var(--page-left-inset);
  }
}

@media (max-width: 600px) {
  .cahier {
    --margin-line: 74px;
  }

  .cahier-cover {
    padding: 18px 20px 44px;
  }

  .cahier-local-nav {
    padding-left: 44px;
    font-size: 10px;
  }

  .cahier-home-link {
    display: none;
  }

  .cover-body {
    margin-top: 76px;
    padding-left: 44px;
  }

  .cover-body h1 {
    font-size: clamp(3.5rem, 20vw, 6rem);
  }

  .cover-lead {
    font-size: 18px;
  }

  .cover-signature {
    margin-top: 48px;
    font-size: 9px;
  }

  .cover-bottom-rule {
    margin-top: 52px;
  }

  .cahier-reader {
    padding: 48px 20px 88px;
  }

  .cahier-pages {
    gap: 64px;
  }

  .cahier-page,
  .sources-page {
    --page-left-inset: 96px;
    --page-right-inset: 18px;
    padding: 36px var(--page-right-inset) 40px var(--page-left-inset);
  }

  .page-margin {
    top: 36px;
    left: 10px;
    width: 48px;
  }

  .page-number {
    font-size: 24px;
  }

  .page-heading h2 {
    font-size: clamp(1.35rem, 7vw, 1.85rem);
  }

  .page-content {
    padding-top: 0;
  }

  .figure-spread {
    padding: 28px 0;
  }

  .reading-figure {
    --figure-compact-height: 300px;
  }

  .comparison-header,
  .comparison-row {
    grid-template-columns: minmax(100px, 1fr) minmax(80px, 1fr) minmax(80px, 1fr);
    gap: 8px;
  }

  .comparison-label {
    font-size: 11px;
  }

  .access-figures {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 24px 10px;
  }

}

@media (prefers-reduced-motion: reduce) {
  .cahier * {
    scroll-behavior: auto !important;
  }
}
</style>
