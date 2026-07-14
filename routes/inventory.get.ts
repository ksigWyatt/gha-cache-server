import { getDatabase } from '~/lib/db'
import { env } from '~/lib/env'
import { getStorage } from '~/lib/storage'

const SIZE_CONCURRENCY = 8

export default defineEventHandler(async () => {
  if (!env.METRICS_ENABLED) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Metrics endpoint is disabled',
    })
  }

  const db = await getDatabase()
  const storage = await getStorage()

  const rows = await db
    .selectFrom('cache_entries')
    .innerJoin('storage_locations', 'storage_locations.id', 'cache_entries.locationId')
    .select([
      'cache_entries.key',
      'cache_entries.version',
      'cache_entries.updatedAt',
      'storage_locations.folderName',
      'storage_locations.lastDownloadedAt',
    ])
    .execute()

  const entries: {
    key: string
    version: string
    sizeBytes: number
    updatedAt: number
    lastDownloadedAt: number | null
  }[] = []

  for (let i = 0; i < rows.length; i += SIZE_CONCURRENCY) {
    const batch = rows.slice(i, i + SIZE_CONCURRENCY)
    const sizes = await Promise.all(
      batch.map((row) => storage.adapter.folderSizeBytes(row.folderName)),
    )
    for (const [index, row] of batch.entries()) {
      entries.push({
        key: row.key,
        version: row.version,
        sizeBytes: sizes[index],
        updatedAt: row.updatedAt,
        lastDownloadedAt: row.lastDownloadedAt,
      })
    }
  }

  entries.sort((a, b) => b.sizeBytes - a.sizeBytes)

  return {
    generatedAt: new Date().toISOString(),
    entries,
  }
})
