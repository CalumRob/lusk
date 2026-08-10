<script setup lang="ts">
/**
 * MapExplorer — the full-bleed map shell (layouts.md §3 + ui-elements.md
 * §Map shell, ported per ADR-0008: PMTiles → GeoJSON; basemap per ADR-0018:
 * CARTO → Etalab). Positron d'Etalab en tuiles vecteur (OSM, ODbL), style
 * local sans labels (app/public/positron-nolabels.json — l'attribution OSM
 * obligatoire vient du TileJSON, contrôle ⓘ compact par défaut de MapLibre),
 * territory masks (communes / EPCIs / départements) as plain GeoJSON
 * sources — no PMTiles protocol — and the selected theme's indicator layer
 * joined from the fiche payload.
 *
 * The view owns the theme + level state; this component renders the map and
 * reacts to them. Aperçu (theme null, no layer) = territory masks only. The
 * ACTIVE LAYER (the couche the view passes down — ADR-0019) paints the active
 * level's fill: an indicateur layer reads its clef + detail rows, a story
 * layer its histoire scalar; a theme whose default is null (Économie) keeps
 * neutral masks.
 *
 * Popups: name + 2–3 KPI figures (kpisPourPopup) + « Voir la fiche » → the
 * territory's fiche. A11y: the popup's link is focusable (focusAfterOpen),
 * the map region is labelled, the NavigationControl stays keyboard-reachable.
 *
 * Hover (audit #208 item 57): a lightweight tooltip follows the cursor —
 * the territory name + the selected theme's indicator value (contenuTooltip)
 * — while the click keeps the full popup. The tooltip is never focusable
 * (survol ≠ clic) and is removed on mouseleave / over empty space. When a
 * click-popup is open, the tooltip anchors to the popup and renders BELOW it
 * (ADR-0019) instead of following the cursor into its footprint.
 */
import maplibregl from 'maplibre-gl'
import type {
  FillLayerSpecification,
  GeoJSONSource,
  Map as CarteMaple,
  MapGeoJSONFeature,
  Popup,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import {
  ANCRAGE_PROGRAMMES,
  ANCRAGES_THEMES,
  COULEUR_CONTOUR,
  COULEUR_MEMBRE,
  COULEUR_NEUTRE,
  LARGEUR_CONTOUR,
  echelleChoroplethe,
  rampeDivergente,
} from '@/carte/couleurs'
import type { Couche, CoucheCarte } from '@/carte/coucheModel'
import {
  collectionAvecMembres,
  collectionAvecValeurs,
  expressionCouleurs,
  expressionMembres,
  indicateurParTerritoire,
  membresParTerritoire,
  subventionsParTerritoire,
  valeurHistoireParTerritoire,
} from '@/carte/fusion'
import type { CollectionAvecValeurs } from '@/carte/fusion'
import { kpisPourPopup, contenuTooltip } from '@/carte/popup'
import { echelleValeurs } from '@/carte/seuils'
import type { CollectionMasque, Masques, NiveauMasque } from '@/geo/types'
import { trouverTerritoire } from '@/payload/selectors'
import type { Payload, Theme } from '@/payload/types'

const props = defineProps<{
  masques: Masques
  payload: Payload
  theme: Theme | null
  /** The active layer — a theme layer (null in Aperçu / Économie) or a
   *  programmes layer (membre / subvention, #282). */
  couche: CoucheCarte | null
  niveau: NiveauMasque
}>()

const router = useRouter()

const mapContainer = ref<HTMLElement | null>(null)
let carte: CarteMaple | null = null
let popup: Popup | null = null
let tooltip: Popup | null = null
/** Le tooltip courant est-il ancré sous le popup ouvert (ADR-0019) ? */
let tooltipSousPopup = false
let observeurTaille: ResizeObserver | null = null
let derive: ReturnType<typeof setTimeout> | null = null

/** Marge (px) entre le bas du popup et le tooltip quand le popup est ouvert. */
const DECALAGE_SOUS_POPUP = 12
const ID_SOURCE = (niveau: NiveauMasque) => `masques-${niveau}`
const ID_REMPLISSAGE = (niveau: NiveauMasque) => `masques-${niveau}-remplissage`
const ID_CONTOUR = (niveau: NiveauMasque) => `masques-${niveau}-contour`

const NIVEAUX_PRESENTS = (masques: Masques): NiveauMasque[] =>
  (['communes', 'epcis', 'departements'] as const).filter((n) => masques[n] !== null)

function masqueDe(niveau: NiveauMasque): CollectionMasque | null {
  return props.masques[niveau] ?? null
}

/** The active level's fill — joined to the active layer's rows. A theme layer
 *  reads its indicateur clef + detail (or the histoire scalar, ADR-0019); a
 *  programmes layer reads the membership boolean (membre) or the subvention
 *  total (subvention, #282). */
function collectionActive(
  niveau: NiveauMasque,
): CollectionAvecValeurs | CollectionAvecMembres | CollectionMasque | null {
  const collection = masqueDe(niveau)
  if (!collection) return null
  const { couche } = props
  if (!couche) return collection
  if (couche.source === 'membre') {
    return collectionAvecMembres(collection, membresParTerritoire(props.payload, couche.sigle, niveau))
  }
  if (couche.source === 'subvention') {
    return collectionAvecValeurs(collection, subventionsParTerritoire(props.payload, niveau))
  }
  if (!props.theme) return collection
  const parTerritoire =
    couche.source === 'indicateur'
      ? indicateurParTerritoire(props.payload.indicateurs, props.theme, couche.clef, couche.detail)
      : valeurHistoireParTerritoire(props.payload, props.theme, couche.clef)
  return collectionAvecValeurs(collection, parTerritoire)
}

type PaintRemplissage = FillLayerSpecification['paint']

function valeursDeLaCollection(
  collection: CollectionAvecValeurs | CollectionAvecMembres | CollectionMasque,
): number[] {
  const valeurs: number[] = []
  for (const feature of collection.features) {
    const v = (feature.properties as { valeur?: number | null }).valeur
    if (typeof v === 'number') valeurs.push(v)
  }
  return valeurs
}

function peintureRemplissage(niveau: NiveauMasque): PaintRemplissage | null {
  const { couche } = props
  if (!couche) return null
  // #282 — les couches programmes : le highlight catégoriel in/out (membre)
  // à côté de la choroplèthe de valeurs (subvention), sur la rampe de marque.
  if (couche.source === 'membre') {
    return { 'fill-color': expressionMembres(COULEUR_MEMBRE) }
  }
  if (couche.source === 'subvention') {
    const collection = collectionActive(niveau)
    if (!collection) return null
    const echelle = echelleValeurs(valeursDeLaCollection(collection))
    const couleurs = echelleChoroplethe(ANCRAGE_PROGRAMMES, Math.max(2, echelle.seuils.length + 1))
    return { 'fill-color': expressionCouleurs(echelle.seuils, couleurs) }
  }
  if (!props.theme) return null
  const collection = collectionActive(niveau)
  if (!collection) return null
  const echelle = echelleValeurs(valeursDeLaCollection(collection))
  const couleurs =
    echelle.type === 'divergente'
      ? rampeDivergente(ANCRAGES_THEMES[props.theme], echelle.seuils)
      : echelleChoroplethe(ANCRAGES_THEMES[props.theme], Math.max(2, echelle.seuils.length + 1))
  return { 'fill-color': expressionCouleurs(echelle.seuils, couleurs) }
}

function ajouterCouches(): void {
  if (!carte) return
  for (const niveau of NIVEAUX_PRESENTS(props.masques)) {
    const collection = masqueDe(niveau)
    if (!collection || carte.getSource(ID_SOURCE(niveau))) continue
    carte.addSource(ID_SOURCE(niveau), {
      type: 'geojson',
      data: collection as unknown as GeoJSON.FeatureCollection,
    })
    carte.addLayer({
      id: ID_REMPLISSAGE(niveau),
      type: 'fill',
      source: ID_SOURCE(niveau),
      layout: { visibility: 'none' },
      paint: {
        'fill-color': COULEUR_NEUTRE,
        'fill-opacity': 0.9,
        'fill-outline-color': COULEUR_CONTOUR,
      },
    })
    carte.addLayer({
      id: ID_CONTOUR(niveau),
      type: 'line',
      source: ID_SOURCE(niveau),
      layout: { visibility: 'none' },
      paint: { 'line-color': COULEUR_CONTOUR, 'line-width': LARGEUR_CONTOUR },
    })
  }
}

/** Applies the active level's visibility + the theme's fill paint. */
function appliquerNiveau(): void {
  if (!carte) return
  for (const niveau of NIVEAUX_PRESENTS(props.masques)) {
    const actif = niveau === props.niveau
    for (const id of [ID_REMPLISSAGE(niveau), ID_CONTOUR(niveau)]) {
      if (carte.getLayer(id)) {
        carte.setLayoutProperty(id, 'visibility', actif ? 'visible' : 'none')
      }
    }
  }
  const remplissage = ID_REMPLISSAGE(props.niveau)
  if (!carte.getLayer(remplissage)) return
  const peinture = peintureRemplissage(props.niveau)
  if (peinture) {
    carte.setPaintProperty(remplissage, 'fill-color', peinture['fill-color'])
  } else {
    carte.setPaintProperty(remplissage, 'fill-color', COULEUR_NEUTRE)
  }
  // les données jointes ont pu changer (thème) — recharge la source active.
  const collection = collectionActive(props.niveau)
  if (collection) {
    ;(carte.getSource(ID_SOURCE(props.niveau)) as GeoJSONSource)?.setData(
      collection as unknown as GeoJSON.FeatureCollection,
    )
  }
}

function nomTerritoire(territoire: string): string {
  return trouverTerritoire(props.payload, territoire)?.nom ?? territoire
}

/** La couche de thème pour le popup — les couches programmes (#282) ne
 *  portent ni clef ni détail (le popup rejoint le thème seulement, #281). */
function couchePourPopup(): Couche | null {
  const { couche } = props
  if (couche && (couche.source === 'indicateur' || couche.source === 'histoire')) return couche
  return null
}

function ouvrirPopup(feature: MapGeoJSONFeature, lngLat: maplibregl.LngLat): void {
  fermerTooltip()
  const territoire = String(feature.properties.territoire)
  const nom = nomTerritoire(territoire)
  const fiche = trouverTerritoire(props.payload, territoire)

  const kpis = kpisPourPopup(props.payload, territoire, props.theme, couchePourPopup())
  const lignesKpis = kpis
    .map(
      (k) =>
        `<div class="popup-carte-kpi"><span class="popup-carte-libelle">${k.libelle}</span>` +
        `<span class="popup-carte-valeur">${k.valeur} <span class="popup-carte-unite">${k.unite}</span></span></div>`,
    )
    .join('')

  const lienFiche = fiche
    ? `<a class="popup-carte-lien" href="${router.resolve({
        name: 'territoire',
        params: { type: fiche.type, id: fiche.territoire },
      }).href}">Voir la fiche</a>`
    : ''

  const contenu = `<div class="popup-carte">
    <h3 class="popup-carte-titre">${nom}</h3>
    <div class="popup-carte-kpis">${lignesKpis}</div>
    ${lienFiche}
  </div>`

  popup?.remove()
  const nouveauPopup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    focusAfterOpen: true,
    className: 'popup-carte-fenetre',
    maxWidth: '320px',
  })
    .setLngLat(lngLat)
    .setHTML(contenu)
    .addTo(carte as CarteMaple)
  popup = nouveauPopup
  // La fermeture par le bouton × ou closeOnClick passe par l'événement 'close'
  // de MapLibre, hors de surClic — on oublie l'instance pour que le tooltip
  // revienne sous le curseur (ADR-0019). Garde d'identité : seul le popup
  // courant peut se refermer sur lui-même.
  nouveauPopup.on('close', () => {
    if (popup === nouveauPopup) popup = null
  })
}

function surClic(e: maplibregl.MapLayerMouseEvent): void {
  if (!carte) return
  const remplissage = ID_REMPLISSAGE(props.niveau)
  const features = carte.queryRenderedFeatures(e.point, { layers: [remplissage] })
  if (features.length === 0) {
    popup?.remove()
    popup = null
    return
  }
  ouvrirPopup(features[0] as MapGeoJSONFeature, e.lngLat)
}

function fermerTooltip(): void {
  tooltip?.remove()
  tooltip = null
  tooltipSousPopup = false
}

/** Combien de la hauteur du popup descend sous son point d'ancrage, selon
 *  l'ancre choisie par MapLibre (la classe maplibregl-popup-anchor-*). Sert à
 *  poser le tooltip sous la BASE du popup, pas sous son point d'ancrage —
 *  sinon chevauchement près des bords de la carte où le popup se retourne. */
function hauteurSousAncre(popup: Popup): number {
  const classes = popup.getElement().classList
  const facteur = classes.contains('maplibregl-popup-anchor-top')
    ? 1
    : classes.contains('maplibregl-popup-anchor-left') ||
        classes.contains('maplibregl-popup-anchor-right') ||
        classes.contains('maplibregl-popup-anchor-center')
      ? 0.5
      : 0
  return popup.getElement().offsetHeight * facteur
}

function afficherTooltip(feature: MapGeoJSONFeature, lngLat: maplibregl.LngLat): void {
  const territoire = String(feature.properties.territoire)
  const contenu = contenuTooltip(props.payload, territoire, props.theme, couchePourPopup())
  const html = `<div class="tooltip-carte">
    <span class="tooltip-carte-nom">${contenu.nom}</span>
    ${contenu.valeur ? `<span class="tooltip-carte-valeur">${contenu.valeur}</span>` : ''}
  </div>`
  // ADR-0019 : un popup ouvert ancre le tooltip à son propre point, décalé
  // vers le bas — le tooltip ne suit plus le curseur dans l'empreinte du
  // popup (fin du chevauchement).
  const popupOuvert = popup
  const sousPopup = popupOuvert !== null
  const position = popupOuvert ? popupOuvert.getLngLat() : lngLat
  const decalage = DECALAGE_SOUS_POPUP + (popupOuvert ? hauteurSousAncre(popupOuvert) : 0)
  if (tooltip && tooltipSousPopup === sousPopup) {
    tooltip.setLngLat(position).setHTML(html)
    return
  }
  // Le mode (sous popup / suiveur de curseur) a changé — on recrée le tooltip
  // avec les options qui correspondent (l'ancre et le décalage ne se règlent
  // qu'à la construction).
  fermerTooltip()
  tooltipSousPopup = sousPopup
  tooltip = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    focusAfterOpen: false,
    className: 'tooltip-carte-fenetre',
    maxWidth: '280px',
    ...(sousPopup ? { anchor: 'top', offset: [0, decalage] } : {}),
  })
    .setLngLat(position)
    .setHTML(html)
    .addTo(carte as CarteMaple)
}

function surSurvol(e: maplibregl.MapLayerMouseEvent): void {
  if (!carte) return
  const remplissage = ID_REMPLISSAGE(props.niveau)
  const features = carte.queryRenderedFeatures(e.point, { layers: [remplissage] })
  carte.getCanvas().style.cursor = features.length > 0 ? 'pointer' : ''
  if (features.length === 0) {
    fermerTooltip()
    return
  }
  afficherTooltip(features[0] as MapGeoJSONFeature, e.lngLat)
}

function initialiserCarte(): void {
  if (!mapContainer.value || carte) return
  // Le fond de plan : positron d'Etalab en tuiles vecteur (ADR-0018), OSM sous
  // ODbL — style local sans labels (app/public/positron-nolabels.json, le look
  // voyager_nolabels conservé). L'attribution OSM obligatoire est lue depuis
  // le TileJSON de la source (planet-vector.json) et rendue par le contrôle
  // d'attribution compact par défaut de MapLibre.
  carte = new maplibregl.Map({
    container: mapContainer.value,
    style: '/positron-nolabels.json',
    transformRequest: (url) => ({ url }),
    center: [-2.8, 48.2],
    zoom: 8,
    minZoom: 7,
    maxZoom: 16,
  })

  carte.addControl(new maplibregl.NavigationControl(), 'top-right')

  carte.on('load', () => {
    ajouterCouches()
    appliquerNiveau()
    if (carte) carte.on('click', surClic)
    if (carte) carte.on('mousemove', surSurvol)
    if (carte) carte.on('mouseleave', fermerTooltip)
  })

  carte.on('error', (e) => {
    console.error('MapLibre — erreur carte :', e.error?.message ?? e.message)
  })
}

watch(
  () => [props.niveau, props.theme, props.couche, props.masques, props.payload] as const,
  () => {
    if (!carte || !carte.isStyleLoaded()) return
    fermerTooltip()
    ajouterCouches()
    appliquerNiveau()
  },
  { deep: true },
)

onMounted(() => {
  initialiserCarte()
  observeurTaille = new ResizeObserver(() => {
    if (derive) clearTimeout(derive)
    derive = setTimeout(() => carte?.resize(), 150)
  })
  if (mapContainer.value) observeurTaille.observe(mapContainer.value)
})

onBeforeUnmount(() => {
  observeurTaille?.disconnect()
  if (derive) clearTimeout(derive)
  popup?.remove()
  fermerTooltip()
  carte?.remove()
  carte = null
})
</script>

<template>
  <div class="map-explorer">
    <div ref="mapContainer" class="map-explorer-canevas" role="region" aria-label="Carte interactive" />
  </div>
</template>

<style scoped>
.map-explorer {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  /* The map flexes with the viewport (issue #67 — viewport-height page):
     a floor here would push the page past 100dvh on short screens. The
     ResizeObserver keeps MapLibre in sync. */
  min-height: 0;
  background: var(--surface-tertiary);
}

.map-explorer-canevas {
  position: absolute;
  inset: 0;
}
</style>

<style>
/* The MapLibre popup content — global because MapLibre renders it outside the
   component's subtree (its own container in the map's DOM). Styled with the
   tokens (ui-elements.md §Map shell: name + KPIs + link). */
.popup-carte-fenetre .maplibregl-popup-content {
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-prominent);
  font-family: var(--font-sans);
}

.popup-carte {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 220px;
}

.popup-carte-titre {
  margin: 0;
  font: var(--text-h3);
  color: var(--text-primary);
}

.popup-carte-kpis {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  border-top: 1px solid var(--border-subtle);
  padding-top: var(--space-3);
}

.popup-carte-kpi {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-4);
  font: var(--text-body-sm);
}

.popup-carte-libelle {
  color: var(--text-secondary);
}

.popup-carte-valeur {
  font-weight: 600;
  font-variant-numeric: var(--text-numeric-variant);
  color: var(--text-primary);
  white-space: nowrap;
}

.popup-carte-unite {
  font-weight: 400;
  color: var(--text-tertiary);
}

.popup-carte-lien {
  align-self: flex-start;
  font: var(--text-body-sm);
  font-weight: 600;
  color: var(--accent-primary);
}

.popup-carte-lien:hover {
  color: var(--accent-hover);
}

/* The hover tooltip (audit #208 item 57) — MapLibre renders it outside the
   component's subtree, so it is styled globally like the popup. Lightweight:
   no close button, no focus, compact padding — survol ≠ clic. */
.tooltip-carte-fenetre .maplibregl-popup-content {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-subtle);
  font-family: var(--font-sans);
}

.tooltip-carte {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  /* ADR-0019 : le nowrap du conteneur faisait déborder les longs noms (EPCI)
     hors de la boîte — le nom passe à la ligne, la valeur garde une ligne. */
  min-width: 0;
}

.tooltip-carte-nom {
  font: var(--text-body-sm);
  font-weight: 600;
  color: var(--text-primary);
  /* retour à la ligne : « Communauté de communes Presqu'île de Crozon-Aulne
     maritime » se replie dans la boîte (max-width 280px du tooltip) au lieu
     de saigner dehors ; overflow-wrap coupe les très longs mots. */
  white-space: normal;
  overflow-wrap: anywhere;
  min-width: 0;
}

.tooltip-carte-valeur {
  font: var(--text-body-sm);
  font-variant-numeric: var(--text-numeric-variant);
  color: var(--text-secondary);
  white-space: nowrap;
}
</style>
