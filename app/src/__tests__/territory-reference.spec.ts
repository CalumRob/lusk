import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'

import TerritoireView from '../views/TerritoireView.vue'
import { chargerMetadonneesTheme, THEME_METADATA_CHARGER_KEY } from '../payload/themeCatalogue'
import { TRANSPORT_DEADLINE_MS } from '../payload/transportDeadline'
import {
  chargerReferenceTerritoires,
  territoireDemande,
  TERRITORY_REFERENCE_CHARGER_KEY,
  useTerritoryReference,
} from '../payload/territoryReference'
import type { ChargerReferenceTerritoires } from '../payload/territoryReference'
import { PayloadError, validerTerritoires } from '../payload/validate'
import { routes } from '../router'
import { nativeCatalogueResponse, nativeBatchResponse, nativeReadFixture } from './helpers/semanticApiFixtures'

const referenceBrute = JSON.parse(readFileSync(
  resolve(process.cwd(), '../public/data/territoires.json'), 'utf8'))
const referenceValidee = validerTerritoires(referenceBrute, 'territoires.json')

function reponseReference(body: unknown = referenceBrute, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
}

describe('chargeur de la référence territoire compacte (#868)', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('charge /data/territoires.json une seule fois par session et le valide', async () => {
    const fetchMock = vi.fn(async () => reponseReference())
    vi.stubGlobal('fetch', fetchMock)
    const premiere = await chargerReferenceTerritoires()
    const seconde = await chargerReferenceTerritoires()
    expect(premiere).toBe(seconde)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/data/territoires.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(premiere.find((t) => t.territoire === '22001')?.nom).toBe('Allineuc')
  })

  it('rejette une référence mal formée, type l’erreur fetch sur 404, puis redevient utilisable', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reponseReference('{"pas":"un tableau"}'))
      .mockResolvedValueOnce(reponseReference('introuvable', 404))
      .mockResolvedValueOnce(reponseReference())
    vi.stubGlobal('fetch', fetchMock)
    await expect(chargerReferenceTerritoires()).rejects.toBeInstanceOf(PayloadError)
    await expect(chargerReferenceTerritoires()).rejects.toMatchObject({ kind: 'fetch' })
    const ok = await chargerReferenceTerritoires()
    expect(ok.length).toBeGreaterThan(1000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('borne une réponse de référence suspendue, libère son minuteur puis relit sur demande explicite', async () => {
    vi.useFakeTimers()
    try {
      let suspendu = true
      const fetchMock = vi.fn((_url: string, init?: { signal?: AbortSignal }) => suspendu
        ? new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort',
            () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
        })
        : Promise.resolve(reponseReference()))
      vi.stubGlobal('fetch', fetchMock)

      const enAttente = chargerReferenceTerritoires().catch((cause: unknown) => cause)
      await vi.advanceTimersByTimeAsync(TRANSPORT_DEADLINE_MS)
      const echec = await enAttente
      expect(echec).toBeInstanceOf(PayloadError)
      expect(echec).toMatchObject({ kind: 'fetch', file: 'territoires.json' })
      expect(String((echec as Error).message)).toMatch(/aucune réponse/i)
      // The deadline timer is cleared on every path, and the stalled socket is
      // aborted rather than left open.
      expect(vi.getTimerCount()).toBe(0)
      expect((fetchMock.mock.calls[0]![1] as { signal?: AbortSignal }).signal?.aborted).toBe(true)

      suspendu = false
      const reference = await chargerReferenceTerritoires()
      expect(reference.find((territoire) => territoire.territoire === '22001')?.nom).toBe('Allineuc')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })

  it('borne aussi la lecture du corps quand les en-têtes sont arrivés', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi.fn((_url: string, init?: { signal?: AbortSignal }) => Promise.resolve({
        ok: true, status: 200,
        json: () => new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort',
            () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
        }),
      }))
      vi.stubGlobal('fetch', fetchMock)

      const enAttente = chargerReferenceTerritoires().catch((cause: unknown) => cause)
      await vi.advanceTimersByTimeAsync(TRANSPORT_DEADLINE_MS)
      const echec = await enAttente
      expect(echec).toBeInstanceOf(PayloadError)
      expect(String((echec as Error).message)).toMatch(/aucune réponse/i)
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it('résout l’identité demandée et refuse type inconnu, cible absente ou type divergent', () => {
    expect(territoireDemande(referenceValidee, 'commune', '22001').nom).toBe('Allineuc')
    expect(() => territoireDemande(referenceValidee, 'bateau', '22001')).toThrow(PayloadError)
    expect(() => territoireDemande(referenceValidee, 'commune', '99999')).toThrow(/absent de la référence/)
    // 22 est un département : « commune/22 » est un type divergent, jamais une identité valide
    expect(() => territoireDemande(referenceValidee, 'commune', '22')).toThrow(/absent de la référence/)
  })
})

describe('useTerritoryReference — identité de route, relecture, réponses tardives', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  function sonde(charger: ChargerReferenceTerritoires, type: string, id: string, actifInitial = true) {
    const typeRef = ref(type)
    const idRef = ref(id)
    const actif = ref(actifInitial)
    const Probe = defineComponent({
      setup() {
        const etat = useTerritoryReference(typeRef, idRef, actif)
        // Top-level refs returned from setup are unwrapped on the instance proxy.
        return { etat, chargement: etat.chargement, erreur: etat.erreur, territory: etat.territory, typeRef, idRef, actif }
      },
      render() {
        const self = this as any
        return h('div', `${self.chargement ? 'chargement' : 'pret'}|${self.erreur ? self.erreur.kind : 'ok'}|${self.territory?.nom ?? '-'}`)
      },
    })
    const wrapper = mount(Probe, { global: { provide: { [TERRITORY_REFERENCE_CHARGER_KEY]: charger } } })
    return { wrapper, typeRef, idRef, actif }
  }

  it('valide l’identité, échoue proprement puis réessaie le même endpoint', async () => {
    const charger = vi.fn<ChargerReferenceTerritoires>()
      .mockRejectedValueOnce(new PayloadError('fetch', 'territoires.json', 'panne'))
      .mockResolvedValueOnce(referenceValidee)
    const { wrapper } = sonde(charger, 'commune', '22001')
    await flushPromises()
    expect(wrapper.text()).toBe('pret|fetch|-')
    ;(wrapper.vm as any).etat.recharger()
    await flushPromises()
    expect(wrapper.text()).toBe('pret|ok|Allineuc')
    expect(charger).toHaveBeenCalledTimes(2)
  })

  it('ignore une réponse tardive d’un ancien territoire après un changement de route', async () => {
    let resolveAncien!: (value: typeof referenceValidee) => void
    let ancienEnCours = true
    const charger = vi.fn<ChargerReferenceTerritoires>(() =>
      ancienEnCours
        ? new Promise<typeof referenceValidee>((resolve) => { resolveAncien = resolve })
        : Promise.resolve(referenceValidee))
    const { wrapper, idRef } = sonde(charger, 'commune', '22001')
    await flushPromises()
    expect(wrapper.text()).toContain('chargement')

    ancienEnCours = false
    idRef.value = '22002'
    await flushPromises()
    expect(wrapper.text()).toBe('pret|ok|Andel')

    // La réponse tardive de l’ancienne route ne doit pas écraser la nouvelle.
    resolveAncien(referenceValidee)
    await flushPromises()
    expect(wrapper.text()).toBe('pret|ok|Andel')
  })

  it('n’est jamais figée en chargement quand la référence est suspendue, et récupère sur recharger', async () => {
    vi.useFakeTimers()
    try {
      let suspendu = true
      const fetchMock = vi.fn((_url: string, init?: { signal?: AbortSignal }) => suspendu
        ? new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort',
            () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
        })
        : Promise.resolve(reponseReference()))
      vi.stubGlobal('fetch', fetchMock)
      const typeRef = ref('commune')
      const idRef = ref('22001')
      const actif = ref(true)
      const Probe = defineComponent({
        setup() {
          const etat = useTerritoryReference(typeRef, idRef, actif)
          return { etat, chargement: etat.chargement, erreur: etat.erreur, territory: etat.territory }
        },
        render() {
          const self = this as any
          return h('div', `${self.chargement ? 'chargement' : 'pret'}|${self.erreur ? self.erreur.kind : 'ok'}|${self.territory?.nom ?? '-'}`)
        },
      })
      const wrapper = mount(Probe)
      expect(wrapper.text()).toContain('chargement')

      await vi.advanceTimersByTimeAsync(TRANSPORT_DEADLINE_MS)
      await wrapper.vm.$nextTick()
      // The bounded failure is the existing typed page error: chargement is
      // settled false, so the identity skeleton can never stay frozen.
      expect(wrapper.text()).toBe('pret|fetch|-')

      suspendu = false
      ;(wrapper.vm as any).etat.recharger()
      for (let turn = 0; turn < 10; turn += 1) await Promise.resolve()
      await wrapper.vm.$nextTick()
      expect(wrapper.text()).toBe('pret|ok|Allineuc')
      expect(fetchMock).toHaveBeenCalledTimes(2)
      wrapper.unmount()
    } finally { vi.useRealTimers() }
  })

  it('reste inerte quand la route n’est pas active', async () => {
    const charger = vi.fn<ChargerReferenceTerritoires>(async () => referenceValidee)
    const { wrapper } = sonde(charger, 'commune', '22001', false)
    await flushPromises()
    expect(charger).not.toHaveBeenCalled()
    expect(wrapper.text()).toBe('pret|ok|-')
  })
})

describe('fiche montée — bootstrap référence sur la route (#868)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it('rend un échec de référence borné, jamais un chargement figé, puis réessaie la même requête', async () => {
    vi.useFakeTimers()
    try {
      let referenceSuspendue = true
      const fetchApi = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url !== '/data/territoires.json') {
          if (url === '/api/resources') return Promise.resolve(nativeCatalogueResponse())
          if (url === '/api/resources/read-batch') {
            const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
            return Promise.resolve(nativeBatchResponse(items, (item, resource) =>
              nativeReadFixture(item, resource, { syntheticProfileComparisons: true })))
          }
          if (url.startsWith('/data/theme_') && url.endsWith('.json')) {
            return Promise.resolve(new Response(readFileSync(
              resolve(process.cwd(), '../public/data', url.slice('/data/'.length)), 'utf8'), { status: 200 }))
          }
          return Promise.reject(new Error(`Requête interdite: ${url}`))
        }
        if (!referenceSuspendue) return Promise.resolve(reponseReference())
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort',
            () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
        })
      })
      vi.stubGlobal('fetch', fetchApi)

      const router = createRouter({ history: createMemoryHistory(), routes })
      await router.push('/territoire/commune/22001?theme=programmes')
      await router.isReady()
      const wrapper = mount(TerritoireView, {
        global: {
          plugins: [router],
          provide: { [THEME_METADATA_CHARGER_KEY]: chargerMetadonneesTheme },
        },
      })

      await vi.advanceTimersByTimeAsync(TRANSPORT_DEADLINE_MS)
      await wrapper.vm.$nextTick()
      // The critical identity read is bounded: the existing typed page error is
      // shown, so `chargementFiche` can never stay true forever.
      expect(wrapper.get('.etat-erreur').text()).toContain('Impossible de charger les données de la fiche.')

      referenceSuspendue = false
      await wrapper.get('.etat-erreur button').trigger('click')
      for (let turn = 0; turn < 40; turn += 1) await Promise.resolve()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.etat-erreur').exists()).toBe(false)
      expect(wrapper.find('h1').text()).toBe('Allineuc')
      expect(fetchApi.mock.calls.filter(([input]) => String(input) === '/data/territoires.json')).toHaveLength(2)
      wrapper.unmount()
    } finally { vi.useRealTimers() }
  }, 60000)

  it('une seule charge de référence pendant la navigation, aucun modèle ni table globale, portée scopée à la commune courante', async () => {
    const requetes: string[] = []
    const lots: Array<Array<Record<string, any>>> = []
    const fetchApi = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requetes.push(url)
      if (url === '/data/territoires.json') return reponseReference()
      if (url.startsWith('/data/theme_') && url.endsWith('.json')) {
        return new Response(readFileSync(resolve(process.cwd(), '../public/data', url.slice('/data/'.length)), 'utf8'), { status: 200 })
      }
      if (url === '/api/resources') return nativeCatalogueResponse()
      if (url === '/api/resources/read-batch') {
        const { items } = JSON.parse(String(init?.body)) as { items: Array<Record<string, any>> }
        lots.push(items)
        return nativeBatchResponse(items, (item, resource) => nativeReadFixture(item, resource, { syntheticProfileComparisons: true }))
      }
      throw new Error(`Requête interdite: ${url}`)
    })
    vi.stubGlobal('fetch', fetchApi)

    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/territoire/commune/22001?theme=programmes')
    await router.isReady()
    const wrapper = mount(TerritoireView, {
      global: {
        plugins: [router],
        provide: { [THEME_METADATA_CHARGER_KEY]: chargerMetadonneesTheme },
      },
    })
    await flushPromises()
    expect(wrapper.find('h1').text()).toBe('Allineuc')

    // La portée EPCI suit la commune courante : la sélection typée vise SON EPCI
    // (résolu depuis la référence), jamais celui de la commune précédente.
    await router.push('/territoire/commune/22002?theme=programmes&comparaison=epci')
    await flushPromises()
    expect(wrapper.find('h1').text()).toBe('Andel')
    const epci22002 = referenceValidee.find((t) => t.type === 'epci' &&
      t.territoire === referenceValidee.find((c) => c.territoire === '22002')!.epci)!
    const selections = lots.flat().filter((item) => item.intent.kind === 'selected_comparison')
    expect(selections.length).toBeGreaterThan(0)
    // #860 — la sélection typée vise la cohorte communale développée de SON EPCI
    const epci22002Communes = referenceValidee
      .filter((t) => t.type === 'commune' && t.epci === epci22002.territoire)
      .map((t) => ({ type: 'commune' as const, id: t.territoire }))
      .sort((a, b) => a.id.localeCompare(b.id))
    expect(selections.at(-1)!.intent.members).toEqual(epci22002Communes)

    // Une seule lecture de la référence pour toute la navigation ; jamais de
    // modèle par territoire ni de tables numériques globales.
    expect(requetes.filter((url) => url === '/data/territoires.json')).toHaveLength(1)
    expect(requetes.some((url) => url.includes('modeles-lecture'))).toBe(false)
    expect(requetes.some((url) => url.startsWith('/data/indicateurs_') || url.startsWith('/data/histoires_'))).toBe(false)
    // Les lectures natives du thème actif ont bien eu lieu.
    expect(lots.flat().some((item) => item.intent.kind === 'facts')).toBe(true)
    wrapper.unmount()
  }, 20000)
})
