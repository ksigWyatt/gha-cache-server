import fs from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, test } from 'vitest'
import { FileSystemAdapter } from '~/lib/storage'
import { TEST_TEMP_DIR } from './setup'

describe(`folderSizeBytes (filesystem adapter)`, () => {
  test(`sums file sizes recursively`, async () => {
    const rootFolder = path.join(TEST_TEMP_DIR, 'folder-size-recursive')
    const folderName = 'entry'
    const folderPath = path.join(rootFolder, folderName)
    await fs.mkdir(path.join(folderPath, 'nested'), { recursive: true })

    await fs.writeFile(path.join(folderPath, 'a.bin'), Buffer.alloc(100))
    await fs.writeFile(path.join(folderPath, 'b.bin'), Buffer.alloc(250))
    await fs.writeFile(path.join(folderPath, 'nested', 'c.bin'), Buffer.alloc(650))

    const adapter = new FileSystemAdapter({ rootFolder })

    expect(await adapter.folderSizeBytes(folderName)).toBe(1000)
  })

  test(`returns 0 for a missing folder`, async () => {
    const rootFolder = path.join(TEST_TEMP_DIR, 'folder-size-missing')
    await fs.mkdir(rootFolder, { recursive: true })

    const adapter = new FileSystemAdapter({ rootFolder })

    expect(await adapter.folderSizeBytes('does-not-exist')).toBe(0)
  })
})
