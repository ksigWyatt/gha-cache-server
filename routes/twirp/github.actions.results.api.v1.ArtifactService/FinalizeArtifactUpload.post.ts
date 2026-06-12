import { z } from 'zod'
import { getArtifactAuth } from '~/lib/artifact-scope'
import { getStorage } from '~/lib/storage'

const bodySchema = z.object({
  workflow_run_backend_id: z.string(),
  workflow_job_run_backend_id: z.string(),
  name: z.string(),
  size: z.union([z.string(), z.number()]).transform(Number),
  hash: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  await getArtifactAuth(event)

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: `Invalid body: ${parsed.error.message}` })

  const { workflow_run_backend_id, workflow_job_run_backend_id, name, size, hash } = parsed.data
  const storage = await getStorage()

  const result = await storage.finalizeArtifact(
    name,
    workflow_run_backend_id,
    workflow_job_run_backend_id,
    size,
    hash,
  )

  return {
    ok: true,
    artifact_id: result.artifactId,
  }
})
