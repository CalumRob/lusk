import { deflateRawSync, inflateRawSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import type { Codec } from '@/atelier/linkCodec'
import { decodeAtelierLink, encodeAtelierLink, LINK_PARAM } from '@/atelier/linkCodec'
import { emptyAtelierState, type AtelierState, type CellRef } from '@/atelier/state'

/**
 * An injected codec keeps the suite deterministic and proves the compression
 * seam exists (happy-dom need not expose CompressionStream). The default codec
 * is exercised separately below.
 */
const codec: Codec = {
  async deflate(bytes) { return new Uint8Array(deflateRawSync(bytes)) },
  async inflate(bytes) { return new Uint8Array(inflateRawSync(bytes)) },
}

const cell = (resource: string, coordinates: Record<string, string>): CellRef => ({ resource, coordinates })

const deuxFigures = (): AtelierState => ({
  v: 1,
  title: 'Mon atelier',
  blocks: [
    { kind: 'prose', id: 'p1', markdown: '## Introduction\nUne **phrase** avec des accents : é, à, ù.' },
    {
      kind: 'figure', id: 'f1', figure: {
        type: 'nuage', level: 'commune',
        population: { departement: ['22'], littoral: ['C'], excluded: 'grey' },
        variables: {
          x: { cell: cell('structure_age', { sex: 'F', detail: '65-79' }) },
          y: { cell: cell('aedar_territorial_aggregate', { typequ: 'D265', horizon: '15', mode: 'bike_lts2', statistic: 'share' }) },
          taille: { cell: cell('densite', {}) },
          couleur: { attribute: 'densite' },
        },
        axisTitles: { x: 'Âge (années)' },
        overlays: [{ type: 'epci', id: '200000001' }],
        diagonal: true,
      },
    },
    {
      kind: 'figure', id: 'f2', figure: {
        type: 'nuage', level: 'epci',
        population: { excluded: 'hide' },
        variables: {
          x: { formula: { expression: 'log(B) − A', operands: { A: cell('densite', {}), B: cell('prix_m2', { year: '2022' }) } } },
          y: { cell: cell('densite', {}) },
        },
        title: 'Densité et prix',
      },
    },
  ],
})

describe('atelier — codec de lien (state → JSON → deflate-raw → base64url)', () => {
  it('place le lien dans le paramètre `c`', () => {
    expect(LINK_PARAM).toBe('c')
  })

  it('fait un aller-retour exact sur une page vide', async () => {
    const page = emptyAtelierState()
    const lien = await encodeAtelierLink(page, codec)
    expect(lien).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(await decodeAtelierLink(lien, codec)).toEqual({ state: page })
  })

  it('fait un aller-retour exact sur deux figures, toutes coordonnées et titres confondus', async () => {
    const page = deuxFigures()
    const lien = await encodeAtelierLink(page, codec)
    const restaure = await decodeAtelierLink(lien, codec)
    expect(restaure.state).toEqual(page)
    expect(restaure.notice).toBeUndefined()
  })

  it('reste compact : une page vide est courte et deux figures restent sous 2 500 caractères', async () => {
    const vide = (await encodeAtelierLink(emptyAtelierState(), codec)).length
    const deux = (await encodeAtelierLink(deuxFigures(), codec)).length
    expect(vide).toBeGreaterThan(10)
    expect(vide).toBeLessThan(300) // la forme décidée est plus courte que le prototype (~230 avec son intro)
    expect(deux).toBeGreaterThan(vide + 300)
    expect(deux).toBeLessThan(2500)
  })

  it('utilise par défaut deflate-raw via CompressionStream, sans injection', async () => {
    const page = deuxFigures()
    const lien = await encodeAtelierLink(page)
    expect((await decodeAtelierLink(lien)).state).toEqual(page)
  })

  it('ouvre une page vide avec une notice sur un lien invalide, sans lever', async () => {
    for (const lien of ['!!!pas-du-base64!!!', 'e30', 'AAAA']) {
      const resultat = await decodeAtelierLink(lien, codec)
      expect(resultat.state).toEqual(emptyAtelierState())
      expect(resultat.notice).toMatch(/invalide|illisible/i)
    }
  })

  it('ouvre une page vide avec une notice sur un lien tronqué', async () => {
    const lien = await encodeAtelierLink(deuxFigures(), codec)
    const resultat = await decodeAtelierLink(lien.slice(0, Math.floor(lien.length / 2)), codec)
    expect(resultat.state).toEqual(emptyAtelierState())
    expect(resultat.notice).toBeTruthy()
  })

  it('ouvre une page vide avec une notice sur une version inconnue', async () => {
    const page = { ...deuxFigures(), v: 2 } as unknown as AtelierState
    const lien = await encodeAtelierLink(page, codec)
    const resultat = await decodeAtelierLink(lien, codec)
    expect(resultat.state).toEqual(emptyAtelierState())
    expect(resultat.notice).toMatch(/version/i)
  })

  it('ne restaure jamais à moitié : un bloc invalide vide toute la page', async () => {
    const page = deuxFigures()
    const figure = page.blocks.find((block) => block.kind === 'figure')
    if (figure && figure.kind === 'figure') (figure.figure as unknown as { type: string }).type = 'carte'
    const lien = await encodeAtelierLink(page, codec)
    const resultat = await decodeAtelierLink(lien, codec)
    expect(resultat.state).toEqual(emptyAtelierState())
    expect(resultat.notice).toBeTruthy()
  })
})
