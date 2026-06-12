import { z } from 'zod'
import { getArtifactAuth } from '~/lib/artifact-scope'
import { getStorage } from '~/lib/storage'

const bodySchema = z.object({
  workflow_run_backend_id: z.string().optional(),
  workflow_job_run_backend_id: z.string().optional(),
  name_filter: z.string().optional(),
  id_filter: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  await getArtifactAuth(event)

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: `Invalid body: ${parsed.error.message}` })

  const { workflow_run_backend_id, workflow_job_run_backend_id, name_filter } = parsed.data
  if (!workflow_run_backend_id)
    throw createError({ statusCode: 400, message: 'workflow_run_backend_id is required' })

  const storage = await getStorage()
  const artifacts = await storage.listArtifacts(
    workflow_run_backend_id,
    workflow_job_run_backend_id,
    name_filter,
  )

  return {
    artifacts: artifacts.map((a) => ({
      workflow_run_backend_id: a.workflowRunBackendId,
      workflow_job_run_backend_id: a.workflowJobRunBackendId,
      database_id: a.id,
      name: a.name,
      size: String(a.size),
    })),
  }
})
