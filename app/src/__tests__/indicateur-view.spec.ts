import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, beforeEach } from 'vitest'
import IndicateurView from '../views/IndicateurView.vue'
import { chargerAvec, indicateursDemographieFixture, indicateursHabitatFixture, indicateursMilieuxFixture, indicateursMobiliteFixture, metadonneesThemesFixtures, territoiresFixture, histoiresDemographieFixture, apercuAvecNAFixture, runReportFraisFixture, vintagesFixture } from '../payload/fixtures'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import { COULEURS_DPE } from '../fiche/couleursDpe'
import type { Payload, FamilleFigure, IndicatorPageMetadata } from '../payload/types'
import { routes } from '../router'
import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'
import type { Fichier } from '../payload/loader'

const payload: Payload = { territoires: [...territoiresFixture, { territoire: 'e', type: 'epci', nom: 'EPCI test', departement: null, epci: null }], indicateurs: indicateursDemographieFixture, histoires: histoiresDemographieFixture, apercu: apercuAvecNAFixture, runReport: runReportFraisFixture, vintages: vintagesFixture, programmes: null, themeMetadata: { demographie: metadonneesThemesFixtures.demographie } }
function pagePourFamille(family: FamilleFigure): IndicatorPageMetadata {
  const page = structuredClone(metadonneesThemesFixtures.demographie.indicator_pages!.densite) as any
  page.family = family
  page.comparison = { details: ['total'], detail: 'total', labels: { total: 'Total' }, unit: 'hab./km²', direction: 'high' }
  if (family === 'trajectory') page.trajectory = { endpoints: ['debut', 'fin'] }
  if (family === 'composition') page.composition = { parts: ['total'] }
  if (family === 'distribution') page.distribution = { signature: ['total'] }
  if (family === 'relationship') page.relationship = { roles: { x: { indicator: 'densite', detail: null, label: 'Axe X', unit: 'hab./km²' }, y: { indicator: 'densite', detail: null, label: 'Axe Y', unit: 'hab./km²' } } }
  if (family === 'list') page.list = { categories: ['total'] }
  if (family === 'pyramid') page.pyramid = { dimensions: ['total'] }
  if (family === 'comparison-bars') page.comparisonBars = { series: ['total'] }
  return page
}
async function monter(url: string, appels: string[] = [], metadataOverride = metadonneesThemesFixtures.demographie, factsOverride = payload.indicateurs, themeOverride: keyof typeof metadonneesThemesFixtures = 'demographie') {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(url)
  await router.isReady()
  const empty = { type: 'FeatureCollection' as const, features: [] }
  const routedPayload = { ...payload, indicateurs: factsOverride, themeMetadata: { [themeOverride]: metadataOverride } }
  const wrapper = mount(IndicateurView, {
    global: {
      plugins: [router],
      provide: {
        [PAYLOAD_CHARGER_KEY]: async (fichier: Fichier) => { appels.push(fichier); return chargerAvec(routedPayload)(fichier) },
        [GEOMETRIE_CHARGER_KEY]: async () => ({ communes: empty, epcis: empty, departements: empty }),
      },
      stubs: {
        MapExplorer: {
          props: ['payload', 'activeIds', 'niveau', 'territoireCible', 'couche'],
          template: '<div data-testid="map" :data-level="niveau" :data-selected="territoireCible?.territoire" :data-values="activeIds.join(\',\')" />',
        },
      },
    },
  })
  await flushPromises()
  return { wrapper, router }
}
beforeEach(() => localStorage.clear())

describe('IndicateurView — routed URL seam', () => {
  it('defaults to Repères and switches real URL-backed views; invalid vue is cleared by selecting Repères', async () => { const { wrapper, router } = await monter('/indicateurs/demographie/densite?vue=wat'); expect(wrapper.find('main').exists()).toBe(true); await wrapper.findAll('.vues button')[0].trigger('click'); await flushPromises(); expect(router.currentRoute.value.query.vue).toBeUndefined(); await router.push({ query: { vue: 'carte' } }); await flushPromises(); expect(router.currentRoute.value.query.vue).toBe('carte'); await router.push({ query: { vue: 'indicateur' } }); await flushPromises(); expect(router.currentRoute.value.query.vue).toBe('indicateur') })
  it('renders unknown indicator honestly', async () => { const { wrapper } = await monter('/indicateurs/demographie/not-published'); expect(wrapper.text()).toContain('Indicateur introuvable') })
  it('renders an unknown theme as a finite honest error state', async () => { const { wrapper } = await monter('/indicateurs/inconnu/densite'); expect(wrapper.text()).toContain('Indicateur introuvable'); expect(wrapper.text()).not.toContain('Chargement de l’indicateur') })
  it('reacts when the router reuses the view for a new indicator parameter', async () => { const { wrapper, router } = await monter('/indicateurs/demographie/densite'); expect(wrapper.text()).toContain('Densité de population'); await router.push('/indicateurs/demographie/not-published'); await flushPromises(); expect(wrapper.text()).toContain('Indicateur introuvable'); expect(wrapper.text()).not.toContain('Densité de population') })
  it('remounts the selected theme page with its hermetic wait-set', async () => { const appels: string[] = []; const { wrapper, router } = await monter('/indicateurs/demographie/densite', appels); expect(appels).toEqual(expect.arrayContaining(['territoires', 'indicateurs_demographie', 'theme_demographie'])); await router.push('/indicateurs/habitat/not-published'); await flushPromises(); expect(wrapper.text()).toContain('Indicateur introuvable'); expect(wrapper.text()).not.toContain('Densité de population') })
  it('writes fallback level, lets explicit URL win, filters, preserves fiche theme and scopes', async () => { localStorage.setItem('lusk:niveau-indicateur', 'commune'); const { wrapper, router } = await monter('/indicateurs/demographie/densite'); expect(router.currentRoute.value.query.niveau).toBe('commune'); await wrapper.find('input').setValue('Commune A'); expect(wrapper.text()).toContain('Commune A'); expect(wrapper.find('a[href*="theme=demographie"]').exists()).toBe(true); await wrapper.find('select').setValue('epci'); await flushPromises(); expect(router.currentRoute.value.query.departement).toBeUndefined(); expect(router.currentRoute.value.query.epci).toBeUndefined() })
  it('renders unit and reusable complete source records', async () => { const { wrapper, router } = await monter('/indicateurs/demographie/densite?vue=indicateur'); expect(wrapper.text()).toContain('hab./km²'); expect(wrapper.text()).toContain('Publication annuelle'); expect(router.currentRoute.value.query.vue).toBe('indicateur') })
   it('mounts map integration with the exact active facet facts', async () => { const { wrapper, router } = await monter('/indicateurs/demographie/densite?vue=carte&territoire=29002'); const expected = payload.indicateurs.filter((fact) => fact.key === 'densite' && fact.type === 'commune').map((fact) => fact.territoire); expect(wrapper.find('[data-testid="map"]').exists()).toBe(true); expect(wrapper.find('[data-testid="map"]').attributes('data-level')).toBe('communes'); expect(wrapper.find('[data-testid="map"]').attributes('data-selected')).toBe('29002'); expect(wrapper.find('[data-testid="map"]').attributes('data-values')).toBe(expected.join(',')); expect(router.currentRoute.value.query.vue).toBe('carte') })
  it('persists a level selected through the routed control', async () => { const { wrapper } = await monter('/indicateurs/demographie/densite'); await wrapper.find('select').setValue('epci'); await flushPromises(); expect(localStorage.getItem('lusk:niveau-indicateur')).toBe('epci') })
  it('renders real EPCI rows after switching the routed level', async () => { const { wrapper } = await monter('/indicateurs/demographie/densite'); await wrapper.find('select').setValue('epci'); await flushPromises(); expect(wrapper.find('tbody').text()).toContain('EPCI X'); expect(wrapper.find('tbody').text()).toContain('EPCI Y') })
  it('normalizes explicit non-commune scopes and invalid scope identifiers on first load', async () => { const { router } = await monter('/indicateurs/demographie/densite?niveau=epci&departement=22&epci=missing'); expect(router.currentRoute.value.query.departement).toBeUndefined(); expect(router.currentRoute.value.query.epci).toBeUndefined(); const second = await monter('/indicateurs/demographie/densite?niveau=commune&departement=missing&epci=missing'); expect(second.router.currentRoute.value.query.departement).toBeUndefined(); expect(second.router.currentRoute.value.query.epci).toBeUndefined() })
  it('sorts by explicit URL-backed name, value and direction-aware rank controls', async () => { const { wrapper, router } = await monter('/indicateurs/demographie/densite?tri=nom&ordre=asc'); expect(wrapper.findAll('tbody tr')[0].text()).toContain('Commune A1'); await wrapper.findAll('thead button')[1].trigger('click'); await flushPromises(); expect(router.currentRoute.value.query.tri).toBe('valeur'); expect(router.currentRoute.value.query.ordre).toBe('asc'); expect(wrapper.findAll('tbody tr')[0].text()).toContain('Commune D') })
  it('clicking a table row persists the selected territory and uses a non-fixed density marker', async () => { const { wrapper, router } = await monter('/indicateurs/demographie/densite'); await wrapper.findAll('tbody button')[0].trigger('click'); await flushPromises(); expect(router.currentRoute.value.query.territoire).toBe('22001'); const marker = wrapper.find('.point-highlight'); expect(marker.exists()).toBe(true); expect(marker.attributes('cx')).not.toBe('300') })
  it('gives the selected density marker an accessible formatted description', async () => { const { wrapper } = await monter('/indicateurs/demographie/densite?territoire=22001'); expect(wrapper.find('svg desc').text()).toContain('Commune A1'); expect(wrapper.find('svg desc').text()).toContain('200'); expect(wrapper.find('svg desc').text()).toContain('positionné sur l’axe') })
   it.each(['scalar', 'composition', 'trajectory', 'distribution', 'relationship', 'list', 'pyramid', 'comparison-bars'] as const)('routed family %s mounts through the real outlet and renderer', async (family) => { const metadata = structuredClone(metadonneesThemesFixtures.demographie); metadata.indicator_pages!.densite = pagePourFamille(family); const facts = payload.indicateurs.map((fact) => fact.key === 'densite' ? { ...fact, detail: 'total' } : fact); const { wrapper, router } = await monter('/indicateurs/demographie/densite', [], metadata, facts); expect(router.currentRoute.value.name).toBe('indicateur'); expect(wrapper.find('.repere-family-outlet').exists()).toBe(true); expect(wrapper.find(`[data-renderer="${family}"]`).exists()).toBe(true) })
   it('keeps routed unavailable, incomplete, and invalid states honest', async () => { const metadata = structuredClone(metadonneesThemesFixtures.demographie); metadata.indicator_pages!.densite = pagePourFamille('composition'); const unavailable = await monter('/indicateurs/demographie/densite', [], metadata, payload.indicateurs.filter((fact) => fact.key !== 'densite')); expect(unavailable.wrapper.find('[role="status"]').text()).toContain('pas disponible'); const incompleteFacts = payload.indicateurs.map((fact) => fact.key === 'densite' ? { ...fact, detail: 'total', value: null } : fact); const incomplete = await monter('/indicateurs/demographie/densite', [], metadata, incompleteFacts); expect(incomplete.wrapper.find('[role="status"]').text()).toContain('partiels'); expect(incomplete.wrapper.find('[data-renderer="composition"]').exists()).toBe(true); const invalidMetadata = structuredClone(metadata); delete (invalidMetadata.indicator_pages!.densite as any).composition; const invalid = await monter('/indicateurs/demographie/densite', [], invalidMetadata, incompleteFacts); expect(invalid.wrapper.text()).toContain('La facette de cette famille de Repères est invalide.') })
  it('routed malformed facets become invalid and persist one canonical URL without loops', async () => { const metadata = structuredClone(metadonneesThemesFixtures.demographie); metadata.indicator_pages!.densite.comparison = { details: ['total'], detail: 'total', dimensions: ['menages'], dimension: 'menages', sexes: ['F'], sex: 'F' }; const { router } = await monter('/indicateurs/demographie/densite?detail=stale&sex=X&dimension=stale', [], metadata); await flushPromises(); expect(router.currentRoute.value.query.facet).toBeUndefined(); expect(router.currentRoute.value.query.detail).toBe('total'); expect(router.currentRoute.value.query.sex).toBe('F'); expect(router.currentRoute.value.query.dimension).toBe('menages'); const before = router.currentRoute.value.fullPath; await flushPromises(); expect(router.currentRoute.value.fullPath).toBe(before) })
  it('renders unique extremes as named fiche links', async () => { const { wrapper } = await monter('/indicateurs/demographie/densite'); expect(wrapper.find('a[href*="territoire/commune/22001"]').exists()).toBe(true); })
  it('renders tied extremes as counts without pretending one territory wins', async () => { const tiedPayload = structuredClone(payload); tiedPayload.indicateurs = tiedPayload.indicateurs.map((fact) => fact.key === 'densite' && fact.type === 'commune' ? { ...fact, value: 10 } : fact); const original = payload.indicateurs; payload.indicateurs = tiedPayload.indicateurs; const { wrapper } = await monter('/indicateurs/demographie/densite'); expect(wrapper.text()).toContain('4 territoires à égalité'); expect(wrapper.find('.extremes a').exists()).toBe(false); payload.indicateurs = original })
})

// La grammaire Repères des trajectoires (#438) — la page routée rend le chemin
// complet à côté du détail (actif) qui pilote carte/extrêmes/tableau ; les
// bornes déclarées sans valeur restent sur l'axe ; le copié-collé produit est
// exclusivement français (« détail (actif) », jamais « endpoint »).
describe('IndicateurView — trajectoires (#438)', () => {
  const detailsArtif = ['M2', 'M3', '2020', '2021', '2022', '2023', '2024', '2025']
  function metadataTrajectoire(): typeof metadonneesThemesFixtures.milieux {
    const metadata = structuredClone(metadonneesThemesFixtures.milieux)
    metadata.indicator_pages = { artif_par_habitant: {
      indicator: 'artif_par_habitant', detail: null, label: 'Intensité état',
      family: 'trajectory', trajectory: { endpoints: ['M2', 'M3'] },
      definition: 'Surface artificialisée par habitant à chaque état.', unit: 'm²/hab',
      calculation: 'Surface de l’état divisée par la population.', direction: 'low',
      caveats: 'Les millésimes départementaux diffèrent.',
      levels: ['commune', 'epci', 'departement'], sources: ['ocsge_artificialisation_22_2025'],
      comparison: { details: detailsArtif, detail: '2025', unit: 'm²/hab', labels: Object.fromEntries(detailsArtif.map((d) => [d, metadata.detail_labels.artif_par_habitant[d]])) },
    } }
    return metadata
  }
  const faitsMilieux = indicateursMilieuxFixture.filter((fact) => fact.type !== 'region')

  it('ouvre sur le dernier détail déclaré, l’écrit dans l’URL et le détail (actif) pilote carte et tableau', async () => {
    const { wrapper, router } = await monter('/indicateurs/milieux/artif_par_habitant', [], metadataTrajectoire(), faitsMilieux, 'milieux')
    expect(router.currentRoute.value.query.detail).toBe('2025')
    expect(wrapper.find('[data-renderer="trajectory"]').exists()).toBe(true)
    const selectDetail = wrapper.find('select[aria-label="Détail (actif)"]')
    expect(selectDetail.exists()).toBe(true)
    await selectDetail.setValue('2024')
    await flushPromises()
    expect(router.currentRoute.value.query.detail).toBe('2024')
    // Le tableau suit le détail actif : les communes du 29 seules portent 2024.
    expect(wrapper.find('tbody').text()).toContain('Commune B')
    expect(wrapper.find('tbody').text()).not.toContain('Commune A1')
    // La carte reçoit exactement les faits du détail actif.
    await router.push({ query: { ...router.currentRoute.value.query, vue: 'carte' } })
    await flushPromises()
    expect(wrapper.find('[data-testid="map"]').attributes('data-values')).toBe('29001,29002')
  })

  it('garde sur l’axe les états déclarés sans valeur et trace à l’échelle des valeurs réelles', async () => {
    const { wrapper } = await monter('/indicateurs/milieux/artif_par_habitant?territoire=22001', [], metadataTrajectoire(), faitsMilieux, 'milieux')
    // M2/M3 ne portent aucune ligne communale : déclarés, ils restent rendus.
    const m2 = wrapper.find('[data-etape="M2"]')
    const m3 = wrapper.find('[data-etape="M3"]')
    expect(m2.exists()).toBe(true)
    expect(m3.exists()).toBe(true)
    expect(m2.attributes('data-etat')).toBe('sans-valeur')
    expect(wrapper.find('[data-etape="2025"]').attributes('data-etat')).toBe('valeurs')
    // L'échelle des valeurs est réelle : deux détails de médianes très
    // différentes ne partagent JAMAIS la même ordonnée (le défaut aplati du
    // PR supplanté), et le territoire mis en avant trace son propre chemin.
    const cy2024 = Number(wrapper.find('[data-etape="2024"] circle').attributes('cy'))
    const cy2025 = Number(wrapper.find('[data-etape="2025"] circle').attributes('cy'))
    expect(cy2024).not.toBe(cy2025)
    expect(Math.abs(cy2024 - cy2025)).toBeGreaterThan(20)
    expect(wrapper.find('.trajectoire-territoire').exists()).toBe(true)
  })

  it('rend un vocabulaire exclusivement français — « détail (actif) », jamais « endpoint »', async () => {
    const { wrapper } = await monter('/indicateurs/milieux/artif_par_habitant', [], metadataTrajectoire(), faitsMilieux, 'milieux')
    const texte = wrapper.text()
    expect(texte).toContain('Détail (actif)')
    expect(texte.toLowerCase()).not.toContain('endpoint')
    expect(texte.toLowerCase()).not.toContain('spread')
  })
})

// La grammaire Repères des profils/listes (#439) — la page routée rend le
// profil COMPLET du territoire sélectionné (l'ordre vient des métadonnées,
// jamais des faits) et la catégorie comparée pilote médiane/extrêmes/tableau
// à travers le seam existant : les contrôles de tri marchent, le rang est
// directionnel, extrêmes et lignes portent des liens de fiche qui résolvent,
// et une catégorie demandée inconnue est surfacée honnêtement — JAMAIS
// réécrite en silence vers la première catégorie (le défaut du PR supplanté).
describe('IndicateurView — profils/listes (#439)', () => {
  const CATEGORIES = ['t_longueur', 't_densite', 'b_longueur', 'b_densite', 'c_longueur', 'c_densite'] as const
  function metadataListe(): typeof metadonneesThemesFixtures.mobilite {
    const metadata = structuredClone(metadonneesThemesFixtures.mobilite)
    metadata.indicator_pages = { reseaux: {
      indicator: 'reseaux', detail: null, label: 'Réseaux à pied / vélo / voiture',
      definition: 'Le profil complet du réseau par mode.', unit: 'km',
      calculation: 'Longueurs et densités publiées par le pipeline.', direction: 'high',
      caveats: 'Les catégories portent leurs unités propres.',
      levels: ['commune', 'epci', 'departement'], sources: ['amenagements_cyclables'],
      family: 'list',
      list: { categories: [...CATEGORIES] },
      comparison: { details: [...CATEGORIES], detail: 'b_longueur', unit: 'km', direction: 'high', labels: { ...metadata.detail_labels.reseaux } },
    } }
    return metadata
  }
  // Les faits reseaux du fixture typé, clonés sur quatre communes avec des
  // b_longueur DISTINCTS (le reste des catégories suit la source clonée).
  function faitsReseaux(): ReturnType<typeof indicateursMobiliteFixture.filter> {
    const source = indicateursMobiliteFixture.filter((fait) => fait.key === 'reseaux' && fait.territoire === '22001')
    const clones = ([['22001', 0], ['22002', 10], ['29001', 5], ['29002', 3]] as const).flatMap(([territoire, bLongueur]) =>
      source.map((fait) => ({ ...fait, territoire, value: fait.detail === 'b_longueur' ? bLongueur : fait.value })),
    )
    return [...indicateursMobiliteFixture.filter((fait) => fait.key !== 'reseaux' || fait.type !== 'commune'), ...clones] as ReturnType<typeof indicateursMobiliteFixture.filter>
  }

  it('rend le profil complet dans l’ordre déclaré, nomme la catégorie comparée et porte l’unité PAR catégorie', async () => {
    const { wrapper, router } = await monter('/indicateurs/mobilite/reseaux?territoire=22001', [], metadataListe(), faitsReseaux(), 'mobilite')
    expect(wrapper.find('[data-renderer="list"]').exists()).toBe(true)
    // Le profil complet : six catégories déclarées, dans L'ORDRE DU CANON.
    const lignes = wrapper.findAll('[data-ligne-profil]')
    expect(lignes.map((ligne) => ligne.attributes('data-ligne-profil'))).toEqual([...CATEGORIES])
    // L'unité est PAR catégorie (km pour les longueurs, km/km² pour les densités).
    expect(lignes[0].text()).toContain(' km')
    expect(lignes[1].text()).toContain('km/km²')
    expect(wrapper.text()).toContain('Longueur — à vélo')
    // La catégorie comparée est explicite et sélectionnable — copie française.
    const selectCategorie = wrapper.find('select[aria-label="Catégorie comparée"]')
    expect(selectCategorie.exists()).toBe(true)
    expect(selectCategorie.findAll('option')).toHaveLength(CATEGORIES.length)
    expect(router.currentRoute.value.query.detail).toBe('b_longueur')
    // Le nom du territoire porté par le modèle nourrit l'aria-label du bloc
    // (le même motif que signature.nom chez les distributions).
    expect(wrapper.find('.profil-lignes').attributes('aria-label')).toBe('Profil de Commune A1 sur 6 catégories déclarées')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('trie par valeur via les contrôles existants — le rang est directionnel et les liens de fiche résolvent', async () => {
    const { wrapper, router } = await monter('/indicateurs/mobilite/reseaux', [], metadataListe(), faitsReseaux(), 'mobilite')
    await wrapper.findAll('thead button')[1].trigger('click')
    await flushPromises()
    // Tri par valeur ascendant : la plus petite longueur vélo d'abord…
    expect(router.currentRoute.value.query.tri).toBe('valeur')
    expect(wrapper.findAll('tbody tr')[0].text()).toContain('Commune A1')
    // …et le rang DIRECTIONNEL : la plus grande valeur porte « 1er / 4 ».
    await wrapper.findAll('thead button')[1].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.ordre).toBe('desc')
    expect(wrapper.findAll('tbody tr')[0].text()).toContain('Commune D')
    expect(wrapper.findAll('tbody tr')[0].text()).toContain('1er / 4')
    // Les extrêmes uniques et les lignes portent des liens de fiche RÉSOLVABLES.
    const extreme = wrapper.find('.extremes a[href*="/territoire/commune/22002"]')
    expect(extreme.exists()).toBe(true)
    expect(extreme.attributes('href')).toContain('theme=mobilite')
    expect(wrapper.find('tbody a[href*="/territoire/commune/29002"]').exists()).toBe(true)
  })

  it('reste honnête : silence sans sélection, profil incomplet et territoire absent distingués, catégorie résolue JAMAIS en silence', async () => {
    // Sans territoire sélectionné : rien n'est affirmé.
    const initial = await monter('/indicateurs/mobilite/reseaux', [], metadataListe(), faitsReseaux(), 'mobilite')
    expect(initial.wrapper.text()).toContain('Sélectionnez un territoire pour voir son profil complet.')
    // Un territoire du périmètre dont une catégorie manque : les lignes
    // DISPONIBLES restent rendues — le profil ne disparaît pas — et
    // l'incomplétude est dite à côté, en nommant la catégorie manquante.
    const ampute = faitsReseaux().filter((fait) => !(fait.territoire === '22001' && fait.detail === 'c_densite'))
    const incomplet = await monter('/indicateurs/mobilite/reseaux?territoire=22001', [], metadataListe(), ampute, 'mobilite')
    expect(incomplet.wrapper.findAll('[data-ligne-profil]')).toHaveLength(5)
    expect(incomplet.wrapper.find('[data-ligne-profil="b_longueur"]').exists()).toBe(true)
    expect(incomplet.wrapper.find('[data-ligne-profil="c_densite"]').exists()).toBe(false)
    expect(incomplet.wrapper.text()).toContain('Profil incomplet — sans valeur publiée à ce niveau : Densité — en voiture.')
    expect(incomplet.wrapper.text()).not.toContain('absent')
    // Un EPCI sélectionné dans une comparaison de communes : ABSENT à ce niveau.
    const absent = await monter('/indicateurs/mobilite/reseaux?territoire=200000001', [], metadataListe(), faitsReseaux(), 'mobilite')
    expect(absent.wrapper.find('[role="status"]').text()).toContain('EPCI X : territoire absent à ce niveau de comparaison.')
    // Une catégorie demandée hors contrat est RÉSOLUE EXPLICITEMENT vers la
    // catégorie canonique (URL + sélecteur) — jamais un repli silencieux sur
    // la première catégorie sans que le visiteur voie laquelle est active.
    const inconnue = await monter('/indicateurs/mobilite/reseaux?detail=stale', [], metadataListe(), faitsReseaux(), 'mobilite')
    expect(inconnue.router.currentRoute.value.query.detail).toBe('b_longueur')
    expect((inconnue.wrapper.find('select[aria-label="Catégorie comparée"]').element as HTMLSelectElement).value).toBe('b_longueur')
  })
})

// La grammaire Repères des distributions (#440) — UN test routé qui verrouille
// les états indisponibles HONNÊTES : la signature complète se rend, et les deux
// échecs sont distingués l'un de l'autre — « territoire absent à ce niveau »
// n'est JAMAIS habillé en « distribution incomplète ou supprimée » (le défaut
// du PR supplanté, qui inventait un motif de suppression).
describe('IndicateurView — distributions (#440)', () => {
  function metadataDistribution(): typeof metadonneesThemesFixtures.habitat {
    const metadata = structuredClone(metadonneesThemesFixtures.habitat)
    metadata.indicator_pages = { distribution_dpe: {
      indicator: 'distribution_dpe', detail: null, label: 'Distribution des étiquettes DPE (A à G)',
      definition: 'Répartition des diagnostics de performance énergétique du territoire par étiquette, de A à G.',
      unit: '%', calculation: 'Part de chaque étiquette parmi les diagnostics disponibles du territoire.',
      direction: 'low',
      caveats: 'La comparaison entre territoires porte sur la part de passoires thermiques (F/G), jamais sur les étiquettes une à une.',
      levels: ['commune', 'epci', 'departement'], sources: ['dpe_22'],
      family: 'distribution',
      distribution: { signature: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] },
      comparison: { indicator: 'part_passoires', label: 'Part de passoires thermiques', unit: '%', direction: 'low' },
    } }
    return metadata
  }

  it('rend la signature complète, nomme la facette résumée et distingue « absent » de « incomplète ou supprimée »', async () => {
    // Sans territoire sélectionné : rien n'est affirmé — un appel, pas un état.
    const initial = await monter('/indicateurs/habitat/distribution_dpe', [], metadataDistribution(), indicateursHabitatFixture, 'habitat')
    expect(initial.wrapper.find('[data-renderer="distribution"]').exists()).toBe(true)
    expect(initial.wrapper.text()).toContain('Sélectionnez un territoire pour voir sa signature complète')

    // Signature complète : les barres déclarées A→G se rendent, et la facette
    // résumée est VISIBLE du visiteur avec son libellé à elle.
    await initial.router.push({ query: { territoire: '22001' } }); await flushPromises()
    const complet = initial.wrapper.text()
    expect(complet).toContain('Part de passoires thermiques')
    for (const etiquette of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
      expect(initial.wrapper.find(`[data-detail="${etiquette}"]`).exists(), `étiquette ${etiquette}`).toBe(true)
    }
    // ADR-0023 : les barres DPE portent les couleurs officielles A→G — jamais
    // le dégradé du thème (le même verrou que la figure compacte de fiche).
    const styleBarreA = initial.wrapper.find('[data-detail="A"] .barre').attributes('style')!.replace(/\s/g, '').toLowerCase()
    expect(styleBarreA).toContain(COULEURS_DPE.A.toLowerCase())
    expect(styleBarreA).not.toContain('indicateur-accent')
    const styleBarreF = initial.wrapper.find('[data-detail="F"] .barre').attributes('style')!.replace(/\s/g, '').toLowerCase()
    expect(styleBarreF).toContain(COULEURS_DPE.F.toLowerCase())

    // Une étiquette sans valeur publiée : le périmètre PORTE le territoire,
    // la distribution est incomplète ou supprimée — dit comme tel.
    const sansG = indicateursHabitatFixture.filter((fact) => !(fact.key === 'distribution_dpe' && fact.detail === 'G'))
    const incomplete = await monter('/indicateurs/habitat/distribution_dpe?territoire=22001', [], metadataDistribution(), sansG, 'habitat')
    expect(incomplete.wrapper.text()).toContain('Commune A1 : distribution incomplète ou supprimée à ce niveau.')

    // Un EPCI sélectionné dans une comparaison de communes : ABSENT à ce
    // niveau — jamais un motif de suppression inventé.
    const absent = await monter('/indicateurs/habitat/distribution_dpe?territoire=200000001', [], metadataDistribution(), indicateursHabitatFixture, 'habitat')
    expect(absent.wrapper.find('[role="status"]').text()).toContain('EPCI X : territoire absent à ce niveau de comparaison.')
    expect(absent.wrapper.text()).not.toContain('supprimée')
  })
})
