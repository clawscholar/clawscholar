import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAuthHashError } from '../../src/lib/authHash.js'
import { adaptLiveAgentRecord, adaptLivePublicationRecord } from '../../src/lib/liveApi.js'

test('parseAuthHashError returns null when hash has no auth error fields', () => {
  assert.equal(parseAuthHashError(''), null)
  assert.equal(parseAuthHashError('#section=top'), null)
})

test('parseAuthHashError maps otp_expired to a user-friendly message', () => {
  const parsed = parseAuthHashError('#error=access_denied&error_code=otp_expired&error_description=Email+link+expired')
  assert.equal(parsed.code, 'otp_expired')
  assert.equal(parsed.description, 'Email link expired')
  assert.match(parsed.message, /expired|fresh claim link/i)
})

test('adaptLiveAgentRecord supplies owner dashboard defaults for live API records', () => {
  const adapted = adaptLiveAgentRecord({
    agent_id: 'agent_live_123',
    handle: 'live-agent',
    name: 'Live Agent',
    description: 'Live description',
    claim_status: 'claimed',
  })

  assert.equal(adapted.id, 'agent_live_123')
  assert.equal(adapted.claimStatus, 'claimed')
  assert.equal(adapted.publishPolicy.mode, 'publish_anything_requested')
  assert.deepEqual(adapted.publishPolicy.selectedArtifactTypes, [])
})

test('adaptLivePublicationRecord maps artifact descriptions and commit fallback', () => {
  const adapted = adaptLivePublicationRecord({
    publication_id: 'pub_live_123',
    slug: 'live-publication',
    title: 'Live publication',
    primary_result: 'Primary result text',
    evidence: {
      commit_sha: 'f3b26a3',
    },
    extras: {
      hardware: {
        gpu: 'Tesla T4',
        vram_gb: 15,
      },
      figures: [
        {
          url: 'https://example.com/progress.png',
          description: 'Validation progress chart',
        },
      ],
    },
    artifacts: [
      {
        type: 'results',
        url: 'https://github.com/org/repo/blob/main/results.tsv',
        description: 'Full experiment ledger.',
      },
    ],
    published_at: '2026-03-17T00:00:00.000Z',
    agent: {
      agent_id: 'agent_live_123',
      handle: 'live-agent',
      name: 'Live Agent',
      claim_status: 'unclaimed',
    },
  })

  assert.equal(adapted.commitHistory.length, 1)
  assert.equal(adapted.commitHistory[0].sha, 'f3b26a3')
  assert.equal(adapted.publicArtifacts.length, 1)
  assert.equal(adapted.publicArtifacts[0].label, 'results.tsv')
  assert.equal(adapted.publicArtifacts[0].note, 'Full experiment ledger.')
  assert.equal(adapted.provenance.hardware, 'Tesla T4 · 15 GB VRAM')
  assert.equal(adapted.figures[0].caption, 'Validation progress chart')
})
