import type { ReadableStream } from 'node:stream/web'
import { Readable } from 'node:stream'
import { z } from 'zod'
import { getStorage } from '~/lib/storage'

const pathParamsSchema = z.object({
  artifactId: z.string(),
})

export default defineEventHandler(async (event) => {
  const parsedPathParams = pathParamsSchema.safeParse(event.context.params)
  if (!parsedPathParams.success)
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid path parameters: ${parsedPathParams.error.message}`,
    })

  const { artifactId } = parsedPathParams.data

  const storage = await getStorage()
  const stream = await storage.downloadArtifact(artifactId)
  if (!stream)
    throw createError({
      statusCode: 404,
      message: 'Artifact file not found',
    })

  return sendStream(event, Readable.toWeb(stream) as ReadableStream)
})
