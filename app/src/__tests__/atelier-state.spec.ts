import { describe, expect, it } from 'vitest'

import { nextBlockId, type AtelierBlock } from '../atelier'

/** L'identifiant d'un nouveau bloc doit être inédit dans l'état fourni. */
const blocs = (...ids: string[]): AtelierBlock[] =>
  ids.map((id) => ({ kind: 'prose', id, markdown: '' }))

describe('atelier — identifiant du prochain bloc', () => {
  it('commence à b1 sur une page vide', () => {
    expect(nextBlockId([])).toBe('b1')
  })

  it('suit le dernier id sur des ids contigus', () => {
    expect(nextBlockId(blocs('b1', 'b2', 'b3'))).toBe('b4')
  })

  it('suit le suffixe maximal sur des ids non contigus', () => {
    // b1 a été supprimé avant le partage : le nombre de blocs ne suffit pas.
    expect(nextBlockId(blocs('b2', 'b3'))).toBe('b4')
  })

  it('ignore les ids qui ne suivent pas b<n>', () => {
    expect(nextBlockId(blocs('p1', 'b2', 'figure-x'))).toBe('b3')
    expect(nextBlockId(blocs('b', 'b02', 'autre'))).toBe('b3')
  })

  it('garde le chemin compact b<n> pour un suffixe élevé mais sûr', () => {
    expect(nextBlockId(blocs('b999999'))).toBe('b1000000')
  })

  it('échappe à un suffixe non sûr dont le successeur serait un id existant', () => {
    // À 2^53, suffixe + 1 === suffixe : le chemin compact renverrait l'id déjà
    // présent, et le bloc ajouté entrerait en collision avec lui.
    const existants = blocs('b9007199254740992')
    const suivant = nextBlockId(existants)
    expect(suivant).not.toBe('b9007199254740992')
    expect(existants.some((bloc) => bloc.id === suivant)).toBe(false)
    expect(suivant).toMatch(/^b-[0-9a-f-]{36}$/u)

    // L'échappatoire reste valable pour un second ajout.
    const apresAjout = [...existants, { kind: 'prose' as const, id: suivant, markdown: '' }]
    expect(nextBlockId(apresAjout)).not.toBe(suivant)
  })

  it('ne modifie pas les blocs reçus', () => {
    const existants = blocs('b2', 'b3')
    nextBlockId(existants)
    expect(existants.map((bloc) => bloc.id)).toEqual(['b2', 'b3'])
  })
})
