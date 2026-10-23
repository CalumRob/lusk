import { createApp, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import VarianteCahierLibre from '@/fiche/prototype/VarianteCahierLibre.vue'
import BpeProfilesChartCahier from '@/fiche/prototype/BpeProfilesChartCahier.vue'
import type { CahierPagination } from '@/fiche/prototype/cahierPagination'
import type { ThemeContent } from '@/fiche/content/themeContent'
import type { BpeAccessProfileFact } from '@/fiche/content/territoryFacts'
import { routes } from '@/router'

export async function mountPlainCahier(
  container: Element,
  content: ThemeContent,
  pagination: CahierPagination,
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes,
  })
  const app = createApp(VarianteCahierLibre, {
    content,
    pagination,
    presentation: 'plain',
    showAllUnits: true,
  })
  app.use(router)
  await router.push('/')
  await router.isReady()
  app.mount(container)
  await nextTick()
  return app
}

/** Mounts a synthetic high-count profile plot so mobile checks exercise a long y-axis label. */
export async function mountLongYAxisFigure(container: Element) {
  const profiles: BpeAccessProfileFact[] = [
    { profile: 'acces-pied-tc', label: 'Profil synthétique A', count: 1234, exemplar: null, comparison: null },
    { profile: 'velo-compense', label: 'Profil synthétique B', count: 800, exemplar: null, comparison: null },
    { profile: 'voiture-requise', label: 'Profil synthétique C', count: 350, exemplar: null, comparison: null },
    { profile: 'inaccessible-20-minutes', label: 'Profil synthétique D', count: 100, exemplar: null, comparison: null },
  ]
  const app = createApp(BpeProfilesChartCahier, {
    profiles,
    totalTypes: 1234,
    territoryName: 'Territoire synthétique',
    donutTooltipTitle: 'Répartition synthétique',
    comparisonLabel: null,
    explorationTo: null,
  })
  app.mount(container)
  await nextTick()
  return app
}
