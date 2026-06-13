#!/usr/bin/env node
// Reproduces the cross-JOB artifact handoff that upload-artifact/download-artifact
// rely on: an artifact uploaded in job A must be retrievable from job B of the
// SAME workflow run (GitHub scopes artifacts to the run, not the job).
//
// Our ArtifactService routes read workflow_run_backend_id / workflow_job_run_backend_id
// from the request body (the real client fills them from the CALLER's token), so we
// simulate cross-job simply by uploading with job A and listing/resolving with job B.
//
// Run the server with SKIP_TOKEN_VALIDATION=true, then:  BASE=http://localhost:PORT node scripts/cross-job-artifact-test.mjs

import { Buffer } from 'node:buffer'

const BASE = (process.env.BASE || 'http://localhost:3499').replace(/\/$/, '')
const RUN = `run-xjob-${Date.now()}`
const JOB_A = 'job-prebuild'   // uploads
const JOB_B = 'job-build'      // downloads (different job, same run)
const NAME = 'ios-prebuild-artifacts'

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const TOKEN = [b64url({ alg: 'none', typ: 'JWT' }), b64url({ repository_id: '42' }), ''].join('.')
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
const ART = 'github.actions.results.api.v1.ArtifactService'

let pass = 0, fail = 0
const check = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`) }
const post = async (m, body) => {
  const r = await fetch(`${BASE}/twirp/${ART}/${m}`, { method: 'POST', headers: H, body: JSON.stringify(body) })
  let j = null; const t = await r.text(); try { j = JSON.parse(t) } catch {}
  return { status: r.status, json: j, text: t }
}

async function main() {
  console.log(`\n=== cross-job artifact handoff — ${BASE} ===`)
  console.log(`    run=${RUN}  upload-job=${JOB_A}  download-job=${JOB_B}\n`)

  // ---- upload in job A ----
  const create = await post('CreateArtifact', { workflow_run_backend_id: RUN, workflow_job_run_backend_id: JOB_A, name: NAME, version: 4 })
  check('CreateArtifact (job A)', create.status === 200 && !!create.json?.signed_upload_url, `HTTP ${create.status}`)
  const url = create.json?.signed_upload_url
  if (!url) return done()
  const content = Buffer.from(`prebuild artifact ${new Date().toISOString()}\n`)
  const put = await fetch(url, { method: 'PUT', body: content })
  const commit = await fetch(`${url}?comp=blocklist`, { method: 'PUT', body: '<BlockList></BlockList>' })
  check('upload block + commit', put.status === 201 && commit.status === 201, `PUT ${put.status} / commit ${commit.status}`)
  const fin = await post('FinalizeArtifact', { workflow_run_backend_id: RUN, workflow_job_run_backend_id: JOB_A, name: NAME, size: content.length })
  check('FinalizeArtifact (job A)', fin.status === 200 && fin.json?.ok, `HTTP ${fin.status} ${fin.text.slice(0,80)}`)

  // ---- control: list/resolve from the SAME job A ----
  const listA = await post('ListArtifacts', { workflow_run_backend_id: RUN, workflow_job_run_backend_id: JOB_A })
  const foundA = (listA.json?.artifacts || []).some((a) => a.name === NAME)
  check('CONTROL ListArtifacts(job A) finds it', foundA, JSON.stringify(listA.json?.artifacts))

  // ---- THE REAL TEST: list/resolve from a DIFFERENT job B (same run) ----
  const listB = await post('ListArtifacts', { workflow_run_backend_id: RUN, workflow_job_run_backend_id: JOB_B })
  const foundB = (listB.json?.artifacts || []).some((a) => a.name === NAME)
  check('CROSS-JOB ListArtifacts(job B) finds it', foundB, JSON.stringify(listB.json?.artifacts))

  const signB = await post('GetSignedArtifactURL', { workflow_run_backend_id: RUN, workflow_job_run_backend_id: JOB_B, name: NAME })
  check('CROSS-JOB GetSignedArtifactURL(job B)', signB.status === 200 && !!signB.json?.signed_url, `HTTP ${signB.status}`)
  if (signB.json?.signed_url) {
    const dl = await fetch(signB.json.signed_url)
    const back = Buffer.from(await dl.arrayBuffer())
    check('CROSS-JOB download bytes match', dl.ok && back.equals(content), `HTTP ${dl.status} ${back.length}B`)
  }

  done()
}
function done() {
  console.log(`\n=== ${pass} passed, ${fail} failed ===`)
  console.log(fail === 0 ? 'CROSS-JOB HANDOFF WORKS' : 'CROSS-JOB HANDOFF BROKEN (download job cannot find the upload artifact)')
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', e); process.exit(2) })
