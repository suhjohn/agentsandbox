/// <reference lib="webworker" />

import { parsePatchFiles } from '@pierre/diffs'
import type { FileDiffMetadata } from '@pierre/diffs'

type DiffKind = 'unstaged' | 'staged' | 'untracked'

type ParsePatch = {
  readonly kind: DiffKind
  readonly path: string
  readonly patch: string
}

type ParseRequest = {
  readonly type: 'parse'
  readonly requestId: number
  readonly generation: number
  readonly workspaceName: string
  readonly patches: ReadonlyArray<ParsePatch>
}

type ParsedFile = {
  readonly id: string
  readonly kind: DiffKind
  readonly path: string
  readonly fileDiff: FileDiffMetadata
}

type ParseResponse = {
  readonly type: 'parsed'
  readonly requestId: number
  readonly generation: number
  readonly workspaceName: string
  readonly files: ReadonlyArray<ParsedFile>
  readonly additions: number
  readonly deletions: number
  readonly parseError: string | null
}

function resolveDiffPath (
  file: FileDiffMetadata,
  fallbackPath: string
): string {
  const currentName = file.name.trim()
  if (currentName.length > 0) return currentName
  const previousName = file.prevName?.trim() ?? ''
  if (previousName.length > 0) return previousName
  return fallbackPath
}

const workerScope = self as DedicatedWorkerGlobalScope

workerScope.addEventListener('message', event => {
  const data = event.data as ParseRequest
  if (!data || data.type !== 'parse') return

  let additions = 0
  let deletions = 0
  let parseError: string | null = null
  const files: ParsedFile[] = []

  for (const patchInfo of data.patches) {
    try {
      const parsed = parsePatchFiles(patchInfo.patch)
      for (const parsedFile of parsed.flatMap(item => item.files)) {
        const path = resolveDiffPath(parsedFile, patchInfo.path)
        const samePathCount = files.filter(
          file => file.kind === patchInfo.kind && file.path === path
        ).length
        const id =
          samePathCount === 0
            ? `${patchInfo.kind}:${path}`
            : `${patchInfo.kind}:${path}:${samePathCount}`

        files.push({
          id,
          kind: patchInfo.kind,
          path,
          fileDiff: parsedFile
        })

        for (const hunk of parsedFile.hunks) {
          additions += hunk.additionCount
          deletions += hunk.deletionCount
        }
      }
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err)
    }
  }

  const response: ParseResponse = {
    type: 'parsed',
    requestId: data.requestId,
    generation: data.generation,
    workspaceName: data.workspaceName,
    files,
    additions,
    deletions,
    parseError
  }

  workerScope.postMessage(response)
})
