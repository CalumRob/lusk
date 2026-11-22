import { deflateRawSync, inflateRawSync } from 'node:zlib'

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LINK_PARAM, decodeAtelierLink, emptyAtelierState, encodeAtelierLink,
  type AtelierState, type Codec,
} from '../atelier'
import { routes } from '../router'
import AtelierView from '../views/AtelierView.vue'

/**
 * La page Atelier (#1080), testée au ras de ce que lit le lecteur : une page
 * blanche, des blocs de texte, un titre inline et un lien qui restaure tout.
 * Le codec injecté garde l'encodage déterministe (happy-dom n'a pas besoin de
 * CompressionStream pour ces assertions).
 */
const codec: Codec = {
  async deflate(bytes) { return new Uint8Array(deflateRawSync(bytes)) },
  async inflate(bytes) { return new Uint8Array(inflateRawSync(bytes)) },
}

async function lienDe(etat: AtelierState): Promise<string> {
  return encodeAtelierLink(etat, codec)
}

function pageAvec(blocks: AtelierState['blocks'], title = 'Atelier'): AtelierState {
  return { ...emptyAtelierState(), title, blocks }
}

const ecrirePressePapier = vi.fn(async (_texte: string) => {})

let montee: ReturnType<typeof mount> | null = null

async function monter(chemin = '/atelier') {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(chemin)
  await router.isReady()
  const wrapper = mount(AtelierView, { global: { plugins: [router] } })
  await flushPromises()
  // Le codec par défaut passe par CompressionStream/Blob.stream : on avance
  // le temps simulé pour laisser le décodage se terminer, sans attente réelle.
  await vi.advanceTimersByTimeAsync(80)
  montee = wrapper
  return { router, wrapper }
}

beforeEach(() => {
  // Seuls les minuteries sont simulées : `flushPromises()` utilise setImmediate
  // et doit rester réelle, sinon elle attendrait une timer qu'on ne fait pas avancer.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  ecrirePressePapier.mockClear()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: ecrirePressePapier },
  })
})

afterEach(() => {
  montee?.unmount()
  montee = null
  vi.useRealTimers()
})

async function ajouterTexte(wrapper: ReturnType<typeof mount>, texte: string): Promise<void> {
  await wrapper.find('button.atelier-ajouter-texte').trigger('click')
  await wrapper.find('textarea.atelier-prose-zone').setValue(texte)
  await wrapper.find('button[aria-label="Enregistrer le texte"]').trigger('click')
}

describe('atelier — page blanche et en-tête composé', () => {
  it('ouvre une page blanche : titre « Atelier », « Ajouter un texte » et le vide des figures', async () => {
    const { wrapper } = await monter()

    expect(wrapper.find('.atelier-titre').text()).toContain('Atelier')
    expect(wrapper.find('button.atelier-titre-bouton').exists()).toBe(true)
    expect(wrapper.find('button.atelier-partager').text()).toContain('Partager')
    expect(wrapper.find('button.atelier-ajouter-texte').text()).toContain('Ajouter un texte')
    expect(wrapper.text()).toContain('Aucune figure sur cette page.')
    expect(wrapper.text()).not.toContain('Ajouter une figure')
    expect(wrapper.text()).not.toMatch(/01\s*\/\s*01/) // pas de compteur de page
    expect(wrapper.find('.atelier-md').exists()).toBe(false)
  })

  it('laisse une place à l’action PDF sans bouton à demi-construit', async () => {
    const { wrapper } = await monter()
    const actions = wrapper.find('.atelier-entete__actions')
    expect(actions.find('button').text()).toContain('Partager')
    expect(actions.findAll('button')).toHaveLength(1)
  })
})

describe('atelier — blocs de texte', () => {
  it('ajoute un bloc, l’édite et rend le sous-ensemble Markdown', async () => {
    const { wrapper } = await monter()
    await ajouterTexte(wrapper, '## Introduction\nUn **mot gras** et une *emphase*.\n- un\n- deux')

    const prose = wrapper.find('.atelier-md')
    expect(prose.find('h2').text()).toBe('Introduction')
    expect(prose.find('strong').text()).toBe('mot gras')
    expect(prose.find('em').text()).toBe('emphase')
    expect(prose.findAll('li').map((li) => li.text())).toEqual(['un', 'deux'])
  })

  it('ne garde pas un bloc de texte vide', async () => {
    const { wrapper } = await monter()
    await wrapper.find('button.atelier-ajouter-texte').trigger('click')
    await wrapper.find('textarea.atelier-prose-zone').setValue('   \n  ')
    await wrapper.find('button[aria-label="Enregistrer le texte"]').trigger('click')

    expect(wrapper.find('textarea.atelier-prose-zone').exists()).toBe(false)
    expect(wrapper.find('.atelier-md').exists()).toBe(false)
    expect(wrapper.text()).toContain('Aucune figure sur cette page.')
  })

  it('modifie puis retire un bloc de texte', async () => {
    const { wrapper } = await monter()
    await ajouterTexte(wrapper, 'Premier texte')
    expect(wrapper.find('.atelier-md').text()).toBe('Premier texte')

    await wrapper.find('button[aria-label="Modifier le texte"]').trigger('click')
    await wrapper.find('textarea.atelier-prose-zone').setValue('Texte modifié')
    await wrapper.find('button[aria-label="Enregistrer le texte"]').trigger('click')
    expect(wrapper.find('.atelier-md').text()).toBe('Texte modifié')

    await wrapper.find('button[aria-label="Retirer le texte"]').trigger('click')
    expect(wrapper.find('.atelier-md').exists()).toBe(false)
  })

  it('insère un texte entre deux blocs existants', async () => {
    const { wrapper } = await monter()
    await ajouterTexte(wrapper, 'Premier')
    await ajouterTexte(wrapper, 'Troisième')

    await wrapper.find('button[aria-label="Insérer un texte ici"]').trigger('click')
    await wrapper.find('textarea.atelier-prose-zone').setValue('Deuxième')
    await wrapper.find('button[aria-label="Enregistrer le texte"]').trigger('click')

    expect(wrapper.findAll('.atelier-md').map((p) => p.text())).toEqual(['Premier', 'Deuxième', 'Troisième'])
  })

  it('donne un id inédit après restauration d’une page trouée, sans toucher aux blocs existants', async () => {
    // b1 a été supprimé avant le partage : les ids restaurés ne sont pas contigus.
    const etat = pageAvec([
      { kind: 'prose', id: 'b2', markdown: 'Premier' },
      { kind: 'prose', id: 'b3', markdown: 'Troisième' },
    ])
    const lien = await lienDe(etat)
    expect((await decodeAtelierLink(lien, codec)).state.blocks.map((bloc) => bloc.id)).toEqual(['b2', 'b3'])

    const { wrapper } = await monter(`/atelier?c=${lien}`)
    expect(wrapper.findAll('.bloc-prose').map((bloc) => bloc.attributes('data-bloc'))).toEqual(['b2', 'b3'])

    await ajouterTexte(wrapper, 'Nouveau')
    const ids = wrapper.findAll('.bloc-prose').map((bloc) => bloc.attributes('data-bloc'))
    expect(new Set(ids).size).toBe(ids.length) // aucun id dupliqué
    expect(ids).toEqual(['b2', 'b3', 'b4'])
    const nouvelId = ids[2]!

    // Éditer le nouveau ne modifie que lui.
    const nouveau = wrapper.find(`[data-bloc="${nouvelId}"]`)
    await nouveau.find('button[aria-label="Modifier le texte"]').trigger('click')
    await nouveau.find('textarea.atelier-prose-zone').setValue('Nouveau édité')
    await nouveau.find('button[aria-label="Enregistrer le texte"]').trigger('click')
    expect(wrapper.findAll('.atelier-md').map((p) => p.text())).toEqual(['Premier', 'Troisième', 'Nouveau édité'])

    // Retirer le nouveau ne retire que lui.
    await wrapper.find(`[data-bloc="${nouvelId}"] button[aria-label="Retirer le texte"]`).trigger('click')
    expect(wrapper.findAll('.atelier-md').map((p) => p.text())).toEqual(['Premier', 'Troisième'])
    expect(wrapper.findAll('.bloc-prose').map((bloc) => bloc.attributes('data-bloc'))).toEqual(['b2', 'b3'])
  })
})

describe('atelier — titre, partage et restauration', () => {
  it('édite le titre inline et le retient dans le lien partagé', async () => {
    const { wrapper } = await monter()
    await wrapper.find('button.atelier-titre-bouton').trigger('click')
    const champ = wrapper.find('input.atelier-titre-champ')
    expect(champ.exists()).toBe(true)
    await champ.setValue('Mon atelier')
    await champ.trigger('keydown.enter')
    expect(wrapper.find('.atelier-titre').text()).toContain('Mon atelier')

    await ajouterTexte(wrapper, 'Texte **partagé**')
    await wrapper.find('button.atelier-partager').trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(80)

    expect(ecrirePressePapier).toHaveBeenCalledTimes(1)
    const url = ecrirePressePapier.mock.calls[0]![0] as string
    const c = new URL(url).searchParams.get(LINK_PARAM)
    expect(c).toBeTruthy()
    const restaure = await decodeAtelierLink(c!, codec)
    expect(restaure.state.title).toBe('Mon atelier')
    expect(restaure.state.blocks).toEqual([
      { kind: 'prose', id: expect.any(String), markdown: 'Texte **partagé**' },
    ])
  })

  it('garde le lien de l’URL en sync, de façon différée, au fil des éditions', async () => {
    const { router, wrapper } = await monter()
    expect(router.currentRoute.value.query[LINK_PARAM]).toBeUndefined()

    await ajouterTexte(wrapper, 'Sync')
    // La synchronisation est différée de 400 ms : rien dans l'URL avant l'avance.
    expect(router.currentRoute.value.query[LINK_PARAM]).toBeUndefined()

    await vi.advanceTimersByTimeAsync(450)
    // Le callback du débounce attend l'encodeur asynchrone avant router.replace.
    await flushPromises()
    expect(typeof router.currentRoute.value.query[LINK_PARAM]).toBe('string')
  })

  it('restaure exactement une page partagée', async () => {
    const lien = await lienDe(pageAvec([
      { kind: 'prose', id: 'p1', markdown: '## Titre\nTexte **restauré**' },
    ], 'Restauré'))
    const { wrapper } = await monter(`/atelier?c=${lien}`)

    expect(wrapper.find('.atelier-titre').text()).toContain('Restauré')
    expect(wrapper.find('h2').text()).toBe('Titre')
    expect(wrapper.find('strong').text()).toBe('restauré')
    expect(wrapper.find('.atelier-notice').exists()).toBe(false)
  })

  it('ouvre une page vide avec une notice sur un lien invalide, sans lever', async () => {
    const { wrapper } = await monter('/atelier?c=!!!pas-du-base64!!!')
    expect(wrapper.find('.atelier-notice').text()).toMatch(/illisible|invalide/i)
    expect(wrapper.find('.atelier-titre').text()).toContain('Atelier')
    expect(wrapper.find('.atelier-md').exists()).toBe(false)
  })

  it('ouvre une page vide avec une notice sur une version inconnue', async () => {
    const lien = await lienDe({ v: 2, title: 'Vieux', blocks: [] } as unknown as AtelierState)
    const { wrapper } = await monter(`/atelier?c=${lien}`)
    expect(wrapper.find('.atelier-notice').text()).toMatch(/version/i)
    expect(wrapper.find('.atelier-titre').text()).toContain('Atelier')
    expect(wrapper.find('.atelier-md').exists()).toBe(false)
  })

  it('rend le texte injecté d’un lien partagé comme du texte littéral', async () => {
    const lien = await lienDe(pageAvec([
      { kind: 'prose', id: 'p1', markdown: '<img src=x onerror="alert(1)">\n[Cliquer](javascript:alert(1))\nhttps://hameçon.example' },
    ]))
    const { wrapper } = await monter(`/atelier?c=${lien}`)

    expect(wrapper.text()).toContain('<img src=x onerror="alert(1)">')
    expect(wrapper.text()).toContain('[Cliquer](javascript:alert(1))')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('a').exists()).toBe(false)
  })
})
