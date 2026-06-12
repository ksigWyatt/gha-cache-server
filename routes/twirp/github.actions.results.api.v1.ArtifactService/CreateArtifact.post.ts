import { z } from 'zod'
import { env } from '~/lib/env'
import { getArtifactAuth } from '~/lib/artifact-scope'
import { getStorage } from '~/lib/storage'

const bodySchema = z.object({
  workflow_run_backend_id: z.string(),
  workflow_job_run_backend_id: z.string(),
  name: z.string(),
  version: z.number().optional(),
})

export default defineEventHandler(async (event) => {
  await getArtifactAuth(event)

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: `Invalid body: ${parsed.error.message}` })

  const { workflow_run_backend_id, workflow_job_run_backend_id, name } = parsed.data
  const storage = await getStorage()
  const upload = await storage.createArtifactUpload(
    name,
    workflow_run_backend_id,
    workflow_job_run_backend_id,
  )

  return {
    ok: true,
    signed_upload_url: `${env.API_BASE_URL}/devstoreaccount1/upload/${upload.id}`,
  }
})
