#!/usr/bin/env node
// Faithful artifact verification: drives the REAL @actions/artifact client
// (the exact library upload-artifact@v4 runs) against a locally-run cache
// server. This exercises the true runner upload path — CreateArtifact (Twirp)
// -> @azure/storage-blob BlockBlobClient block uploads (?comp=block&blockid=...
// with real Azure block IDs) -> commit block list -> FinalizeArtifact -> then
// the real download path.
//
// A large INCOMPRESSIBLE file is included so the produced zip exceeds the 8 MB
// block size and forces a genuine MULTI-BLOCK upload, exercising the server's
// getChunkIndexFromBlockId parsing and multi-part merge — the path a simplified
// single-PUT probe never touches.
//
// Run the server first (SKIP_TOKEN_VALIDATION=true), then:
//   node scripts/faithful-artifact-test.mjs
// Requires @actions/artifact installed in the cwd's node_modules.

import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'

const BASE = (process.env.BASE || 'http://localhost:3456').replace(/\/$/, '')
const runId = `run-${Date.now()}`
const jobId = 'job-1'
const WORK = '/tmp/artifact-faithful'
const PAYLOAD = `${WORK}/payload`
const DL = `${WORK}/dl`

// --- craft the runtime token exactly as the runner would carry it. The real
// @actions/artifact client extracts the backend ids from the `scp` claim
// (`Actions.Results:<runId>:<jobId>`); our server's getArtifactAuth needs
// `repository_id`. Unsigned — the server runs with SKIP_TOKEN_VALIDATION. ---
function b64url(o) { return Buffer.from(JSON.stringify(o)).toString('base64url') }
const token = [
  b64url({ alg: 'none', typ: 'JWT' }),
  b64url({
    iss: 'https://token.actions.githubusercontent.com',
    repository_id: '42',
    scp: `Actions.Results:${runId}:${jobId}`,
  }),
  '',
].join('.')

process.env.ACTIONS_RUNTIME_TOKEN = token
process.env.ACTIONS_RESULTS_URL = `${BASE}/`

let pass = 0, fail = 0
const check = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`) }

async function main() {
  console.log(`\n=== faithful @actions/artifact round-trip — ${BASE} ===\n`)

  // fresh payload
  rmSync(WORK, { recursive: true, force: true })
  mkdirSync(PAYLOAD, { recursive: true })
  const smallText = `hello from the real @actions/artifact client ${new Date().toISOString()}\n`
  writeFileSync(`${PAYLOAD}/hello.txt`, smallText)
  // 18 MB of incompressible random bytes → zip stays ~18 MB → multiple 8 MB blocks
  const bigBytes = randomBytes(18 * 1024 * 1024)
  writeFileSync(`${PAYLOAD}/big.bin`, bigBytes)
  console.log(`  payload: hello.txt (${smallText.length} B) + big.bin (${bigBytes.length} B, incompressible)\n`)

  const { DefaultArtifactClient } = await import('@actions/artifact')
  const client = new DefaultArtifactClient()

  // ---- UPLOAD (the path that previously ECONNRESET'd) ----
  console.log('[upload] real client → CreateArtifact → block uploads → FinalizeArtifact')
  let uploadInfo
  try {
    uploadInfo = await client.uploadArtifact(
      'diag-hello',
      [`${PAYLOAD}/hello.txt`, `${PAYLOAD}/big.bin`],
      PAYLOAD,
    )
    check('uploadArtifact resolved (no ECONNRESET)', true, `id=${uploadInfo.id} size=${uploadInfo.size}`)
    check('reported size > 8 MB (forced multi-block)', (uploadInfo.size ?? 0) > 8 * 1024 * 1024, `${uploadInfo.size} B`)
  } catch (e) {
    check('uploadArtifact resolved (no ECONNRESET)', false, e.message)
    return summarize()
  }

  // ---- DOWNLOAD (the real client's download path) ----
  console.log('\n[download] real client → resolve URL → stream → unzip')
  try {
    mkdirSync(DL, { recursive: true })
    const res = await client.downloadArtifact(uploadInfo.id, { path: DL })
    const dir = res.downloadPath
    check('downloadArtifact resolved', !!dir, dir)
    const back = readFileSync(`${dir}/hello.txt`, 'utf8')
    check('hello.txt extracted + byte-exact', back === smallText)
    const bigBack = readFileSync(`${dir}/big.bin`)
    check('big.bin extracted + byte-exact', Buffer.compare(bigBack, bigBytes) === 0, `${bigBack.length} B`)
  } catch (e) {
    check('artifact extracted + byte-exact', false, e.message)
  }

  summarize()
}

function summarize() {
  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error('FATAL', e); process.exit(2) })
