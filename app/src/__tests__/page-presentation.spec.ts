import { describe, expect, it } from 'vitest'

import { presentationPageIndicateur } from '../indicateurs/pagePresentation'
import { CONTENU_CATALOGUE_INDICATEURS } from '../indicateurs/catalogueContent'
import { LIBELLES_INDICATEURS_APP } from '../fiche/content/libellesAffichage'
import { FAMILLES_FIGURE, THEMES_CANONIQUES } from '../payload/types'
import { nativeResources } from './helpers/semanticApiFixtures'

describe('présentation éditoriale des Pages d’indicateur', () => {
  it('réutilise titre et regroupement du catalogue sans embarquer de faits de page', () => {
    expect(presentationPageIndicateur(
      'milieux', 'artif_par_habitant', 'Intensité état', 'trajectory', 'trajectory',
    )).toEqual({
      theme: 'milieux',
      themeLabel: 'Milieux',
      resourceKey: 'artif_par_habitant',
      title: 'Intensité état',
      subgroupKey: 'artificialisation',
      subgroupLabel: 'L’artificialisation',
      href: '/indicateurs/milieux/artif_par_habitant',
      layoutFamily: 'trajectory',
      figureFamily: 'trajectory',
    })

    expect(presentationPageIndicateur(
      'demographie', 'densite', 'Libellé producteur modifié', 'scalar', 'scalar',
    )?.title).toBe('Densité de population')
  })

  it('keeps every existing page-family/layout identity distinct, including profile and sparse collection', () => {
    const families = [...FAMILLES_FIGURE, 'profile', 'sparse-collection'] as const
    for (const family of families) {
      const page = presentationPageIndicateur('demographie', 'densite', 'Libellé natif', family, 'scalar')
      expect(page?.layoutFamily).toBe(family)
    }

    const profileResource = nativeResources('demographie')
      .find((resource) => resource.resource_id === 'structure_age')
    const collectionResource = nativeResources('programmes')
      .find((resource) => resource.resource_id === 'subventions_par_domaine')
    expect(profileResource?.shapes).toContain('declared_profile')
    expect(collectionResource?.shapes).toContain('period_detail')

    expect(presentationPageIndicateur('demographie', 'structure_age', 'Structure par âge', 'profile', 'pyramid'))
      .toMatchObject({ layoutFamily: 'profile', figureFamily: 'pyramid' })
    expect(presentationPageIndicateur(
      'programmes', 'subventions_par_domaine', 'Subventions par domaine', 'sparse-collection', 'list',
    )).toMatchObject({ layoutFamily: 'sparse-collection', figureFamily: 'list' })
    expect(presentationPageIndicateur(
      'programmes', 'subventions_par_domaine', 'Subventions par domaine', 'list', 'list',
    )).toMatchObject({ layoutFamily: 'list', figureFamily: 'list' })
  })

  it('binds editorial page keys only to identities currently present in API discovery', () => {
    const apiKeys = new Set(THEMES_CANONIQUES.flatMap((theme) =>
      nativeResources(theme)
        .filter((resource) => resource.resource_kind === 'indicator')
        .map((resource) => `${theme}/${resource.resource_id}`),
    ))
    const presentationKeys = CONTENU_CATALOGUE_INDICATEURS.flatMap((group) =>
      group.sousGroupes.flatMap((subgroup) =>
        subgroup.pages.map(({ resourceKey }) => `${group.theme}/${resourceKey}`),
      ),
    )

    expect(new Set(presentationKeys).size).toBe(presentationKeys.length)
    for (const key of presentationKeys) expect(apiKeys.has(key), key).toBe(true)
    expect(presentationKeys).not.toContain('mobilite/raccordement_reference')
    expect(presentationPageIndicateur(
      'mobilite', 'raccordement_reference', 'Référence raccordement', 'trajectory', 'trajectory',
    )).toBeNull()
  })

  it('does not infer page availability from editorial content', () => {
    const editorial = presentationPageIndicateur(
      'programmes', 'subventions_par_domaine', 'Subventions régionales par domaine', 'sparse-collection', 'list',
    )

    expect(editorial).toMatchObject({
      resourceKey: 'subventions_par_domaine', layoutFamily: 'sparse-collection', figureFamily: 'list',
    })
    expect(Object.keys(editorial ?? {}).sort()).toEqual([
      'figureFamily', 'href', 'layoutFamily', 'resourceKey', 'subgroupKey', 'subgroupLabel', 'theme', 'themeLabel', 'title',
    ])
    expect(editorial).not.toHaveProperty('unit')
    expect(editorial).not.toHaveProperty('direction')
    expect(editorial).not.toHaveProperty('levels')
    expect(editorial).not.toHaveProperty('axes')
    expect(editorial).not.toHaveProperty('sources')
    expect(editorial).not.toHaveProperty('availability')
  })

  it.each([
    ['mobilite', 'offre_tc', 'Part des bâtiments près d’un arrêt (à 500 m)', 'scalar'],
    ['mobilite', 'raccordement_tc', 'Population bretonne joignable en 90 minutes en TC', 'scalar'],
    ['demographie', 'evolution_1968', 'Évolution de la population depuis 1968', 'scalar'],
  ] as const)('keeps mixed factual heading %s/%s bound to its native label', (theme, key, nativeLabel, family) => {
    expect(presentationPageIndicateur(theme, key, nativeLabel, family, 'scalar')?.title).toBe(nativeLabel)
    expect(LIBELLES_INDICATEURS_APP[theme]).not.toHaveProperty(key)
  })
})
