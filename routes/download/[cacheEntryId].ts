import { Readable, Transform } from 'node:stream'
import { z } from 'zod'
import { getMetrics } from '~/lib/metrics'
import { getStorage } from '~/lib/storage'

const pathParamsSchema = z.object({
  cacheEntryId: z.string(),
})

export default defineEventHandler(async (event) => {
  const parsedPathParams = pathParamsSchema.safeParse(event.context.params)
  if (!parsedPathParams.success)
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid path parameters: ${parsedPathParams.error.message}`,
    })

  const { cacheEntryId } = parsedPathParams.data

  const storage = await getStorage()
  const stream = await storage.download(cacheEntryId)
  if (!stream)
    throw createError({
      statusCode: 404,
      message: 'Cache file not found',
    })

  // Count downloaded bytes for throughput metrics (cache_bytes_downloaded_total) by tapping
  // the stream. No-op when metrics are disabled; a client abort simply won't record.
  const metrics = await getMetrics()
  let downloadedBytes = 0
  const counted = stream.pipe(
    new Transform({
      transform(chunk, _enc, cb) {
        downloadedBytes += chunk.length
        cb(null, chunk)
      },
    }),
  )
  counted.on('end', () => metrics?.cacheBytesDownloadedTotal.add(downloadedBytes))

  return sendStream(event, Readable.toWeb(counted) as ReadableStream)
})
