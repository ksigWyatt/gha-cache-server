import { z } from 'zod'
import { getArtifactAuth } from '~/lib/artifact-scope'
import { getStorage } from '~/lib/storage'

const bodySchema = z.object({
  workflow_run_backend_id: z.string(),
  workflow_job_run_backend_id: z.string(),
  name: z.string(),
})

export default defineEventHandler(async (event) => {
  await getArtifactAuth(event)

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: `Invalid body: ${parsed.error.message}` })

  const { workflow_run_backend_id, workflow_job_run_backend_id, name } = parsed.data
  const storage = await getStorage()
  const url = await storage.getArtifactDownloadUrl(
    workflow_run_backend_id,
    workflow_job_run_backend_id,
    name,
  )

  if (!url) throw createError({ statusCode: 404, message: 'Artifact not found' })

  return { signed_url: url }
})
