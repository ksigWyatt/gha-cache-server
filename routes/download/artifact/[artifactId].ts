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

  // The @actions/artifact download client only auto-extracts when it sees the
  // content is a zip (Content-Type contains "zip", or the URL ends in .zip).
  // Without this header download-artifact@v4 saves the raw zip instead of
  // extracting the user's files.
  setHeader(event, 'content-type', 'application/zip')
  return sendStream(event, Readable.toWeb(stream) as ReadableStream)
})
