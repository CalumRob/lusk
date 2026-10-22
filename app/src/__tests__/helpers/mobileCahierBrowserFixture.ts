import { createApp, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import VarianteCahierLibre from '@/fiche/prototype/VarianteCahierLibre.vue'
import type { CahierPagination } from '@/fiche/prototype/cahierPagination'
import type { ThemeContent } from '@/fiche/content/themeContent'
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
