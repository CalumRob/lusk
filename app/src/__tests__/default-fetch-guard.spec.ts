import { expect, it } from 'vitest'

it('keeps semantic catalogue discovery fail-closed unless a spec opts into an API fixture', async () => {
  const response = await fetch('/api/resources')
  expect(response.ok).toBe(false)
  expect(response.status).toBe(404)
})

it('keeps an otherwise valid semantic read-batch fail-closed by default', async () => {
  const response = await fetch('/api/resources/read-batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items: [{
      id: 'default-guard', resource: 'mix_logements',
      target: { kind: 'territory', type: 'commune', id: '22001' },
      intent: { kind: 'facts' },
    }] }),
  })
  expect(response.ok).toBe(false)
  expect(response.status).toBe(404)
})
