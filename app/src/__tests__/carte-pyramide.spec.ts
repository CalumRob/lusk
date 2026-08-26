import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 30_000 })

// Régression : l'onglet Carte de structure_age mourait (rejet non géré dans le watcher de peinture, aucun shell rendu) parce que le pré-filtrage par facet.sex affamait resoudreGroupeSexe.
import IndicateurView from '../views/IndicateurView.vue'
import { chargerFichier } from '../payload/loader'
import type { ChargerOptions, Fichier, ReponseFetch } from '../payload/loader'
import type { Territoire } from '../payload/types'
import { routes } from '../router'
import { PAYLOAD_CHARGER_KEY } from '../payload/usePayload'
import { GEOMETRIE_CHARGER_KEY } from '../geo/useGeometrie'

const dataDir = join(process.cwd(), '..', 'public', 'data')
const fetchReel = async (url: string): Promise<ReponseFetch> => {
  try {
    const corps = readFileSync(join(dataDir, url.replace(/^\/data\//, '')), 'utf8')
    return { ok: true, status: 200, json: async () => JSON.parse(corps) }
  } catch {
    return { ok: false, status: 404, json: async () => null }
  }
}
const chargerElargi = chargerFichier as unknown as (
  nom: Fichier,
  territoiresOuOptions?: Territoire[] | ChargerOptions,
  options?: ChargerOptions,
) => Promise<unknown>
const SANS_REFERENCE = (fichier: Fichier) =>
  fichier === 'territoires' || fichier === 'run-report' || fichier === 'vintages' || fichier.startsWith('theme_')
const cache = new Map<Fichier, Promise<unknown>>()
let territoiresValides: Territoire[] | null = null
function chargerCommis(fichier: Fichier): Promise<unknown> {
  const options = { fetchImpl: fetchReel }
  if (!cache.has(fichier)) {
    cache.set(
      fichier,
      (SANS_REFERENCE(fichier)
        ? chargerElargi(fichier, options)
        : (async () => {
            territoiresValides ??= (await chargerElargi('territoires', options)) as Territoire[]
            return chargerElargi(fichier, territoiresValides, options)
          })()
      ).catch((cause: unknown) => {
        cache.delete(fichier)
        throw cause
      }),
    )
  }
  return cache.get(fichier)!
}
const geo = (nom: string) => JSON.parse(readFileSync(join(dataDir, nom), 'utf8'))

beforeEach(() => localStorage.clear())

describe('La carte de la page pyramide (structure_age) contre le payload commis — le payloadPourCarte ne filtre PAS par sexe : fusion agrège F+M (#390) et la peinture ne doit jamais recevoir un groupe unisexe', () => {
  it('la carte pyramide rend sans rejet non géré', async () => {
    const rejets: string[] = []
    const surRejet = (cause: unknown) => rejets.push(String((cause as Error)?.message ?? cause))
    process.on('unhandledRejection', surRejet)

    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/indicateurs/demographie/structure_age?vue=carte&territoire=22001')
    await router.isReady()
    const wrapper = mount(IndicateurView, {
      global: {
        plugins: [router],
        provide: {
          [PAYLOAD_CHARGER_KEY]: chargerCommis,
          [GEOMETRIE_CHARGER_KEY]: async () => ({
            communes: geo('communes.geojson'),
            epcis: geo('epcis.geojson'),
            departements: geo('departements.geojson'),
          }),
        },
      },
    })
    await flushPromises()
    await flushPromises()
    await flushPromises()
    process.off('unhandledRejection', surRejet)

    const chargeur = wrapper.find('.carte-indicateur [role="status"]')
    const canevas = wrapper.find('.carte-indicateur .map-explorer-canevas')
    const diagnostic = [
      rejets.length ? `rejets: ${rejets.join(' | ').slice(0, 400)}` : 'aucun rejet',
      chargeur.exists() ? 'bloqué sur Chargement' : 'chargement terminé',
      canevas.exists() ? 'shell carte monté' : 'PAS de shell carte',
    ].join(' — ')
    expect(rejets, diagnostic).toEqual([])
    expect(canevas.exists(), diagnostic).toBe(true)
  })
})
