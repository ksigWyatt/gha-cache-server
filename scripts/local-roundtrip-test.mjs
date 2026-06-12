#!/usr/bin/env node
// Local end-to-end verification for the cache server.
//
// Exercises the exact request sequence a runner makes, against a locally-run
// container, to prove two things WITHOUT touching production:
//   1. CacheService/GetCacheEntryDownloadURL returns a graceful miss ({ok:false})
//      on a cold key — never a connection reset (failure mode #1).
//   2. ArtifactService/* is implemented end-to-end: CreateArtifact -> upload
//      blocks -> FinalizeArtifactUpload -> ListArtifacts -> download returns the
//      bytes we uploaded (failure mode #2 — previously ECONNRESET / 404).
//
// The server must be started with SKIP_TOKEN_VALIDATION=true so the crafted
// (unsigned) OIDC token is accepted; decodeJwt only reads the claims.
//
// Usage: BASE=http://localhost:3456 node scripts/local-roundtrip-test.mjs

import { Buffer } from 'node:buffer'

const BASE = (process.env.BASE || 'http://localhost:3456').replace(/\/$/, '')

// --- craft an unsigned GitHub Actions OIDC token with the claims both auth
// paths require: `ac` (cache scopes JSON) for CacheService, `repository_id`
// for ArtifactService. ---
function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}
const TOKEN = [
  b64url({ alg: 'none', typ: 'JWT' }),
  b64url({
    iss: 'https://token.actions.githubusercontent.com',
    repository_id: '42',
    ac: JSON.stringify([{ Scope: 'local-test', Permission: 3 }]),
  }),
  '',
].join('.')

const AUTH = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
const CACHE = 'github.actions.results.api.v1.CacheService'
const ARTIFACT = 'github.actions.results.api.v1.ArtifactService'

let pass = 0
let fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

async function postJson(service, method, body) {
  const res = await fetch(`${BASE}/twirp/${service}/${method}`, {
    method: 'POST', headers: AUTH, body: JSON.stringify(body),
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = null }
  return { status: res.status, json, text }
}

async function main() {
  console.log(`\n=== cache-server local round-trip — ${BASE} ===\n`)

  // ---- health ----
  try {
    const h = await fetch(`${BASE}/health`)
    check('server reachable (/health)', h.ok, `HTTP ${h.status}`)
  } catch (e) {
    check('server reachable (/health)', false, e.message)
    console.log('\nServer not reachable — is the container up? Aborting.\n')
    process.exit(1)
  }

  // ---- failure mode #1: graceful cold-cache miss ----
  console.log('\n[1] CacheService graceful miss')
  {
    const r = await postJson(CACHE, 'GetCacheEntryDownloadURL', {
      key: `cold-key-${Date.now()}`, restore_keys: [], version: 'v-cold-123',
    })
    check('GetCacheEntryDownloadURL responds (no reset)', r.status === 200, `HTTP ${r.status}`)
    check('cold key returns ok:false (graceful miss)', r.json?.ok === false, JSON.stringify(r.json))
  }

  // ---- failure mode #2: full artifact round-trip ----
  console.log('\n[2] ArtifactService end-to-end')
  const runId = `run-${Date.now()}`
  const jobId = 'job-1'
  const artifactName = 'diag-hello'
  const content = Buffer.from(`hello from local round-trip ${new Date().toISOString()}\n`)

  // CreateArtifact
  const create = await postJson(ARTIFACT, 'CreateArtifact', {
    workflow_run_backend_id: runId,
    workflow_job_run_backend_id: jobId,
    name: artifactName,
    version: 4,
  })
  check('CreateArtifact responds (no reset / not 404)', create.status === 200, `HTTP ${create.status} ${create.text.slice(0, 120)}`)
  const uploadUrl = create.json?.signed_upload_url
  check('CreateArtifact returns signed_upload_url', !!uploadUrl, uploadUrl)
  if (!uploadUrl) { return summarize() }

  // Upload the content as a single block (bare PUT → part index 0), then commit blocklist.
  {
    const put = await fetch(uploadUrl, { method: 'PUT', body: content })
    check('upload block PUT accepted', put.status === 201, `HTTP ${put.status}`)
    const commit = await fetch(`${uploadUrl}?comp=blocklist`, { method: 'PUT', body: '<BlockList></BlockList>' })
    check('blocklist commit accepted', commit.status === 201, `HTTP ${commit.status}`)
  }

  // FinalizeArtifact
  const finalize = await postJson(ARTIFACT, 'FinalizeArtifact', {
    workflow_run_backend_id: runId,
    workflow_job_run_backend_id: jobId,
    name: artifactName,
    size: content.length,
  })
  check('FinalizeArtifactUpload responds', finalize.status === 200, `HTTP ${finalize.status} ${finalize.text.slice(0, 120)}`)
  check('FinalizeArtifactUpload returns ok + artifact_id', finalize.json?.ok === true && !!finalize.json?.artifact_id, JSON.stringify(finalize.json))

  // ListArtifacts
  const list = await postJson(ARTIFACT, 'ListArtifacts', {
    workflow_run_backend_id: runId,
    workflow_job_run_backend_id: jobId,
  })
  check('ListArtifacts responds', list.status === 200, `HTTP ${list.status}`)
  const found = (list.json?.artifacts || []).find((a) => a.name === artifactName)
  check('ListArtifacts includes our artifact', !!found, JSON.stringify(list.json?.artifacts))

  // GetSignedArtifactURL + download
  const signed = await postJson(ARTIFACT, 'GetSignedArtifactURL', {
    workflow_run_backend_id: runId,
    workflow_job_run_backend_id: jobId,
    name: artifactName,
  })
  check('GetSignedArtifactURL responds', signed.status === 200, `HTTP ${signed.status}`)
  const dlUrl = signed.json?.signed_url
  check('GetSignedArtifactURL returns signed_url', !!dlUrl, dlUrl)
  if (dlUrl) {
    const dl = await fetch(dlUrl)
    const body = Buffer.from(await dl.arrayBuffer())
    check('download succeeds', dl.ok, `HTTP ${dl.status}`)
    check('downloaded bytes match uploaded content', body.equals(content), `${body.length} bytes`)
  }

  summarize()
}

function summarize() {
  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error('FATAL', e); process.exit(2) })
