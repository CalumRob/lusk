import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const canonicalDir = join(process.cwd(), '..', 'pipeline', 'inst', 'extdata', 'theme-metadata')

type ReadingMetadata = { key: string; reading?: { story_key?: string } }

function readingGroups(theme: string): Array<{ group: string; story: string | undefined }> {
  const metadata = JSON.parse(readFileSync(join(canonicalDir, `theme_${theme}.json`), 'utf-8')) as {
    subgroups: ReadingMetadata[]
  }
  return metadata.subgroups.flatMap(({ key, reading }) => reading
    ? [{ group: key, story: reading.story_key }]
    : [])
}

describe('producer-owned reading declarations', () => {
  it('keeps each reading attached to its canonical subgroup and story identity', () => {
    expect(readingGroups('demographie')).toEqual([{
      group: 'trajectoire-demographique', story: 'trajectoire-demographique',
    }])
    expect(readingGroups('habitat')).toEqual([{
      group: 'etat-energetique-du-parc', story: 'etat-energetique-du-parc',
    }])
  })
})
