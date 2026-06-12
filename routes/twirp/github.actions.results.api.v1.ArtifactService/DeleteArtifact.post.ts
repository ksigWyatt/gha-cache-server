import { z } from 'zod'
import { getArtifactAuth } from '~/lib/artifact-scope'
import { getDatabase } from '~/lib/db'

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
  const db = await getDatabase()

  const artifact = await db
    .selectFrom('artifacts')
    .select('id')
    .where('workflowRunBackendId', '=', workflow_run_backend_id)
    .where('workflowJobRunBackendId', '=', workflow_job_run_backend_id)
    .where('name', '=', name)
    .executeTakeFirst()

  if (!artifact) throw createError({ statusCode: 404, message: 'Artifact not found' })

  await db.deleteFrom('artifacts').where('id', '=', artifact.id).execute()

  return { artifact_id: artifact.id }
})
