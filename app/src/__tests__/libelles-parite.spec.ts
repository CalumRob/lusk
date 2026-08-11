import { describe, expect, it } from 'vitest'

import { libelleDetail, libelleIndicateur, libelleParam } from '../fiche/libelles'
import {
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  metadonneesThemesFixtures,
  territoiresFixture,
} from '../payload/fixtures'
import type { Payload } from '../payload/types'
import { PayloadError, verifierPariteLibelles } from '../payload/validate'

/**
 * The payload-owned label contract (issue #318) — the regression guards that
 * prove labels live in the theme metadata and old app-side dictionaries
 * cannot return:
 *  - verifierPariteLibelles : the BIDIRECTIONAL guard the loader runs at
 *    assembly — every payload (key, detail) row has its label (indicator_
 *    labels / detail_labels), and no declared detail label is dead (every
 *    declared detail is published). A payload with an unlabeled row or a
 *    label for a detail never published FAILS LOUD, never a raw key rendered.
 *  - the label lookups (fiche/libelles.ts) read the metadata maps and throw
 *    on a missing label — there is no raw-key fallback anywhere.
 */

const payloadDemographie: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: histoiresDemographieFixture,
  apercu: null,
  runReport: null,
  vintages: null,
  programmes: null,
  themeMetadata: { demographie: metadonneesThemesFixtures.demographie },
}

describe('verifierPariteLibelles — la garde bidirectionnelle du loader', () => {
  it('accepte un payload dont chaque (key, detail) publié a son libellé (et aucun libellé mort)', () => {
    expect(() => verifierPariteLibelles(payloadDemographie)).not.toThrow()
  })

  it('rejette un détail publié sans libellé (payload → métadonnées)', () => {
    const payload = {
      ...payloadDemographie,
      indicateurs: [
        ...indicateursDemographieFixture,
        {
          ...indicateursDemographieFixture[0],
          key: 'structure_age',
          detail: '90+',
        },
      ],
    }
    expect(() => verifierPariteLibelles(payload)).toThrow(PayloadError)
    try {
      verifierPariteLibelles(payload)
    } catch (e) {
      expect((e as PayloadError).message).toMatch(/détail « 90\+ » de « structure_age »/)
    }
  })

  it('rejette un libellé mort — un détail déclaré jamais publié (métadonnées → payload)', () => {
    const meta = JSON.parse(JSON.stringify(metadonneesThemesFixtures.demographie)) as typeof metadonneesThemesFixtures.demographie
    meta.detail_labels.structure_age['90+'] = '90 ans et plus'
    const payload = { ...payloadDemographie, themeMetadata: { demographie: meta } }
    expect(() => verifierPariteLibelles(payload)).toThrow(/jamais publié/)
  })

  it('rejette un indicateur publié sans libellé (indicator_labels)', () => {
    const payload = {
      ...payloadDemographie,
      indicateurs: [{ ...indicateursDemographieFixture[0], key: 'densite_2' }],
    }
    expect(() => verifierPariteLibelles(payload)).toThrow(/sans libellé/)
  })

  it('accepte un payload sans métadonnées (l’état pré-seam, jamais une erreur)', () => {
    const { themeMetadata: _meta, ...sansMetadonnees } = payloadDemographie
    expect(() => verifierPariteLibelles(sansMetadonnees)).not.toThrow()
  })

  it('rejette une classification publiée sans libellé — jamais la clé brute dans le texte (#362)', () => {
    // une valeur hors de la carte (le quadrant inconnu) ne peut pas fuir :
    // la lecture deviendrait indisponible, pas une clé brute rendue
    const histoires = histoiresDemographieFixture.map((h) =>
      h.territoire === '22001' ? { ...h, classification: 'attire-meurt-bis' } : h,
    )
    const payload = { ...payloadDemographie, histoires }
    expect(() => verifierPariteLibelles(payload)).toThrow(PayloadError)
    try {
      verifierPariteLibelles(payload)
    } catch (e) {
      expect((e as PayloadError).message).toMatch(/classification « attire-meurt-bis »/)
    }
  })

  it('accepte une carte de classifications qui couvre les valeurs publiées — les libellés au-delà restent légitimes (#362)', () => {
    // la direction unique : le vocabulaire complet du thème (les quatre
    // lectures) garde ses libellés même si un quadrant est vide dans les
    // données actuelles — contrairement à la bijection des detail_labels
    const meta = JSON.parse(JSON.stringify(metadonneesThemesFixtures.demographie)) as typeof metadonneesThemesFixtures.demographie
    const payload = {
      ...payloadDemographie,
      histoires: histoiresDemographieFixture.filter((h) => h.classification !== 'vide-meurt'),
      themeMetadata: { demographie: meta },
    }
    expect(() => verifierPariteLibelles(payload)).not.toThrow()
  })
})

describe('les lookups payload-owned (fiche/libelles.ts) — jamais une clé brute', () => {
  const meta = metadonneesThemesFixtures.demographie

  it('lisent les libellés depuis les cartes de la métadonnée', () => {
    expect(libelleIndicateur(meta, 'densite')).toBe('Densité de population')
    expect(libelleDetail(meta, 'structure_age', '<15')).toBe('Moins de 15 ans')
    expect(libelleParam(meta, 'taux_solde_naturel')).toBe('Solde naturel (‰/an)')
  })

  it('échouent FORT sur un libellé absent — il n’y a PAS de repli sur la clé', () => {
    expect(() => libelleIndicateur(meta, 'densite_inconnue')).toThrow(/n['’]a pas de libellé/)
    expect(() => libelleDetail(meta, 'structure_age', '90+')).toThrow(/n['’]a pas de libellé/)
    expect(() => libelleParam(meta, 'parametre_inconnu')).toThrow(/n['’]a pas de libellé/)
  })
})
