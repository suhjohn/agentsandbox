import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import { ChevronDown, ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import {
  DIFFS_TAG_NAME,
  FileDiff as DiffsFileDiff,
  areOptionsEqual,
  parsePatchFiles
} from '@pierre/diffs'
import type {
  ExpansionDirections,
  FileContents,
  FileDiff as DiffsFileDiffInstance,
  FileDiffMetadata,
  FileDiffOptions,
  HunkData
} from '@pierre/diffs'
import { readSseStream } from '@/lib/sse'
import { Select } from './ui/select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from './ui/collapsible'
import { Button } from './ui/button'
import { Loader } from './loader'

const MAX_DIFF_CHARS = 500_000
const DIFF_BASIS = 'repo_head'

function applyCssVars (
  element: HTMLElement,
  style: CSSProperties | null | undefined
): void {
  if (!style) return
  for (const [key, value] of Object.entries(style)) {
    if (!key.startsWith('--')) continue
    if (typeof value === 'string' || typeof value === 'number') {
      element.style.setProperty(key, String(value))
    }
  }
}

function splitLinesPreserveNewlines (contents: string): string[] {
  if (contents.length === 0) return []
  const lines: string[] = []
  let start = 0
  for (let i = 0; i < contents.length; i += 1) {
    if (contents[i] !== '\n') continue
    lines.push(contents.slice(start, i + 1))
    start = i + 1
  }
  if (start < contents.length) {
    lines.push(contents.slice(start))
  }
  return lines
}

function formatUnmodifiedLines (count: number): string {
  if (count === 1) return '1 unmodified line'
  return `${count} unmodified lines`
}

function normalizeDiffPath (value: string): string {
  const trimmed = value.trim().replaceAll('\\', '/')
  if (trimmed.length === 0) return ''
  return trimmed
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '')
}

function globPatternToRegExp (value: string): RegExp | null {
  const normalized = normalizeDiffPath(value)
  if (normalized.length === 0) return null

  let out = '^'
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i]
    const next = normalized[i + 1]
    const afterNext = normalized[i + 2]

    if (ch === '*' && next === '*') {
      if (afterNext === '/') {
        out += '(?:.*/)?'
        i += 2
        continue
      }
      out += '.*'
      i += 1
      continue
    }
    if (ch === '*') {
      out += '[^/]*'
      continue
    }
    if (ch === '?') {
      out += '[^/]'
      continue
    }
    if ('\\.^$+{}()|[]'.includes(ch)) {
      out += `\\${ch}`
      continue
    }
    out += ch
  }
  out += '$'

  try {
    return new RegExp(out)
  } catch {
    return null
  }
}

function parseDiffIgnorePatterns (value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value)) return []

  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (typeof raw !== 'string') continue
    const normalized = normalizeDiffPath(raw)
    if (normalized.length === 0) continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function compileDiffIgnoreMatchers (
  patterns: ReadonlyArray<string>
): ReadonlyArray<RegExp> {
  return patterns
    .map(globPatternToRegExp)
    .filter((regex): regex is RegExp => regex !== null)
}

function isDiffIgnoredPath (
  path: string,
  matchers: ReadonlyArray<RegExp>
): boolean {
  const normalized = normalizeDiffPath(path)
  if (normalized.length === 0) return false
  for (const matcher of matchers) {
    if (matcher.test(normalized)) return true
  }
  return false
}

function AnimatedDotsLoader (props: { readonly label?: string }) {
  return (
    <div className='px-3 py-3'>
      <Loader label={props.label} />
    </div>
  )
}

type WorkspaceStatus = {
  readonly hasChanges: boolean
  readonly staged: number
  readonly unstaged: number
  readonly untracked: number
}

type WorkspacesListResponse = {
  readonly workspaces: ReadonlyArray<{
    readonly name: string
    readonly path: string
    readonly isGitRepo: boolean
    readonly status?: WorkspaceStatus
  }>
}

type DiffStreamMeta = {
  readonly name: string
  readonly isGitRepo: boolean
  readonly diffBasis: 'repo_head'
}

type DiffStreamFile = {
  readonly kind: 'unstaged' | 'staged' | 'untracked'
  readonly path: string
  readonly patch: string
}

type DiffStreamDone = {
  readonly truncated: boolean
}

type DiffParseWorkerRequest = {
  readonly type: 'parse'
  readonly requestId: number
  readonly generation: number
  readonly workspaceName: string
  readonly patches: ReadonlyArray<DiffStreamFile>
}

type DiffParseWorkerResponse = {
  readonly type: 'parsed'
  readonly requestId: number
  readonly generation: number
  readonly workspaceName: string
  readonly files: ReadonlyArray<{
    readonly id: string
    readonly kind: DiffStreamFile['kind']
    readonly path: string
    readonly fileDiff: FileDiffMetadata
  }>
  readonly additions: number
  readonly deletions: number
  readonly parseError: string | null
}

type WorkspaceDiffFile = {
  readonly id: string
  readonly kind: DiffStreamFile['kind']
  readonly path: string
  readonly fileDiff: FileDiffMetadata
  readonly isContentsLoading: boolean
  readonly contentsError: string | null
}

type WorkspaceDiff = {
  readonly name: string
  readonly path: string
  readonly isGitRepo: boolean
  readonly status: WorkspaceStatus | null
  readonly files: ReadonlyArray<WorkspaceDiffFile>
  readonly totals: { readonly additions: number; readonly deletions: number }
  readonly isLoading: boolean
  readonly error: string | null
  readonly diffBasis: 'repo_head'
  readonly hasLoadedOnce: boolean
}

type FullContext = {
  readonly oldLines: ReadonlyArray<string>
  readonly newLines: ReadonlyArray<string>
}

function parseWorkspaceStatus (value: unknown): WorkspaceStatus {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Unexpected workspace status')
  }
  const v = value as Record<string, unknown>
  const hasChanges = v.hasChanges
  const staged = v.staged
  const unstaged = v.unstaged
  const untracked = v.untracked
  if (typeof hasChanges !== 'boolean')
    throw new Error('Unexpected workspace status')
  if (!(typeof staged === 'number' && Number.isFinite(staged)))
    throw new Error('Unexpected workspace status')
  if (!(typeof unstaged === 'number' && Number.isFinite(unstaged)))
    throw new Error('Unexpected workspace status')
  if (!(typeof untracked === 'number' && Number.isFinite(untracked)))
    throw new Error('Unexpected workspace status')
  return {
    hasChanges,
    staged: Math.max(0, Math.floor(staged)),
    unstaged: Math.max(0, Math.floor(unstaged)),
    untracked: Math.max(0, Math.floor(untracked))
  }
}

function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFileContents (value: unknown): value is FileContents {
  if (!isRecord(value)) return false
  const name = value.name
  const contents = value.contents
  if (typeof name !== 'string') return false
  if (typeof contents !== 'string') return false
  const cacheKey = value.cacheKey
  const header = value.header
  const lang = value.lang
  if (typeof cacheKey !== 'undefined' && typeof cacheKey !== 'string')
    return false
  if (typeof header !== 'undefined' && typeof header !== 'string') return false
  if (typeof lang !== 'undefined' && typeof lang !== 'string') return false
  return true
}

function parseDiffStreamMeta (value: unknown): DiffStreamMeta | null {
  if (!isRecord(value)) return null
  const name = value.name
  const isGitRepo = value.isGitRepo
  const diffBasis = value.diffBasis
  if (typeof name !== 'string') return null
  if (typeof isGitRepo !== 'boolean') return null
  if (diffBasis !== 'repo_head') return null
  return { name, isGitRepo, diffBasis }
}

function parseDiffStreamFile (value: unknown): DiffStreamFile | null {
  if (!isRecord(value)) return null
  const kind = value.kind
  const path = value.path
  const patch = value.patch
  if (!(kind === 'unstaged' || kind === 'staged' || kind === 'untracked')) {
    return null
  }
  if (typeof path !== 'string') return null
  if (typeof patch !== 'string') return null
  return { kind, path, patch }
}

function parseDiffStreamDone (value: unknown): DiffStreamDone | null {
  if (!isRecord(value)) return null
  const truncated = value.truncated
  if (typeof truncated !== 'boolean') return null
  return { truncated }
}

function parseDiffStreamStatus (value: unknown): WorkspaceStatus | null {
  try {
    return parseWorkspaceStatus(value)
  } catch {
    return null
  }
}

export function WorkspaceDiffPanel (props: {
  readonly agentApiUrl: string | null
  readonly agentAuthToken: string | null
  readonly diffStyle?: 'split' | 'unified'
  readonly onDiffStyleChange?: (style: 'split' | 'unified') => void
  readonly showInlineControls?: boolean
  readonly diffIgnorePatterns?: ReadonlyArray<string>
}) {
  const [error, setError] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<
    WorkspacesListResponse['workspaces']
  >([])
  const [workspaceDiffs, setWorkspaceDiffs] = useState<
    ReadonlyArray<WorkspaceDiff>
  >([])
  const [diffStyleInternal, setDiffStyleInternal] = useState<
    'split' | 'unified'
  >('split')
  const didInitialLoadRef = useRef(false)
  const toolRefreshTimerRef = useRef<number | null>(null)
  const workspacesRef = useRef<WorkspacesListResponse['workspaces']>(workspaces)
  const workspaceDiffsRef = useRef<ReadonlyArray<WorkspaceDiff>>(workspaceDiffs)
  const workspacesLoadPromiseRef = useRef<Promise<
    WorkspacesListResponse['workspaces'] | null
  > | null>(null)
  const reloadNonceRef = useRef(0)
  const streamGenerationRef = useRef(0)
  const activeGitWorkspaceNamesRef = useRef<Set<string>>(new Set())
  const activatedWorkspaceNamesRef = useRef<Set<string>>(new Set())
  const streamAbortsRef = useRef<Map<string, AbortController>>(new Map())
  const pendingPatchesByWorkspaceRef = useRef<Map<string, DiffStreamFile[]>>(
    new Map()
  )
  const flushPendingRafRef = useRef<number | null>(null)
  const diffParserWorkerRef = useRef<Worker | null>(null)
  const diffParserRequestIdRef = useRef(0)
  const fileContentsQueueRef = useRef<
    Array<{
      readonly workspaceName: string
      readonly fileId: string
      readonly kind: DiffStreamFile['kind']
      readonly path: string
    }>
  >([])
  const fileContentsActiveRef = useRef(0)
  const fileContentsAbortsRef = useRef<Map<string, AbortController>>(new Map())
  const fileContentsCacheRef = useRef<Map<string, FullContext>>(new Map())
  const fileContentsPromisesRef = useRef<
    Map<string, Promise<FullContext | null>>
  >(new Map())
  const fileContentsPromiseResolversRef = useRef<
    Map<string, (context: FullContext | null) => void>
  >(new Map())

  const agentApiBase = useMemo(() => {
    if (!props.agentApiUrl) return null
    const base = new URL(props.agentApiUrl)
    if (!base.pathname.endsWith('/')) base.pathname = `${base.pathname}/`
    return base
  }, [props.agentApiUrl])

  const listUrl = useMemo(() => {
    if (!agentApiBase) return null
    const url = new URL('workspaces', agentApiBase.toString())
    return url.toString()
  }, [agentApiBase])

  const agentHeaders = useMemo(() => {
    if (!props.agentAuthToken) return null
    return { 'X-Agent-Auth': `Bearer ${props.agentAuthToken}` }
  }, [props.agentAuthToken])

  const diffStyle = props.diffStyle ?? diffStyleInternal
  const setDiffStyle = props.onDiffStyleChange ?? setDiffStyleInternal
  const showInlineControls = props.showInlineControls ?? true
  const diffIgnoreMatchers = useMemo(
    () => compileDiffIgnoreMatchers(parseDiffIgnorePatterns(props.diffIgnorePatterns)),
    [props.diffIgnorePatterns]
  )

  const loadWorkspaces = useCallback(async () => {
    if (!listUrl || !agentHeaders) return null
    if (workspacesLoadPromiseRef.current) {
      return workspacesLoadPromiseRef.current
    }

    const request = (async () => {
      const abort = new AbortController()
      const timeoutId = window.setTimeout(() => abort.abort(), 20_000)
      try {
        const res = await fetch(listUrl, {
          headers: agentHeaders,
          signal: abort.signal
        })
        const text = await res.text()
        const body =
          text.trim().length > 0 ? (JSON.parse(text) as unknown) : null
        if (!res.ok) {
          const msg =
            typeof body === 'object' &&
            body !== null &&
            'error' in body &&
            typeof (body as { error?: unknown }).error === 'string'
              ? (body as { error: string }).error
              : `Request failed (${res.status})`
          throw new Error(msg)
        }

        if (typeof body !== 'object' || body === null)
          throw new Error('Unexpected workspaces response')
        const raw = (body as { workspaces?: unknown }).workspaces
        if (!Array.isArray(raw))
          throw new Error('Unexpected workspaces response')

        const next = raw
          .map((w): WorkspacesListResponse['workspaces'][number] | null => {
            if (typeof w !== 'object' || w === null) return null
            const ww = w as Record<string, unknown>
            if (typeof ww.name !== 'string') return null
            if (typeof ww.path !== 'string') return null
            if (typeof ww.isGitRepo !== 'boolean') return null
            const status =
              typeof ww.status === 'undefined'
                ? undefined
                : parseWorkspaceStatus(ww.status)
            return {
              name: ww.name,
              path: ww.path,
              isGitRepo: ww.isGitRepo,
              ...(status ? { status } : {})
            }
          })
          .filter((w): w is NonNullable<typeof w> => w !== null)

        setWorkspaces(next)
        setError(null)
        return next
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        return null
      } finally {
        window.clearTimeout(timeoutId)
      }
    })()

    workspacesLoadPromiseRef.current = request
    try {
      return await request
    } finally {
      if (workspacesLoadPromiseRef.current === request) {
        workspacesLoadPromiseRef.current = null
      }
    }
  }, [agentHeaders, listUrl])

  const stopAllStreams = useCallback(() => {
    for (const abort of streamAbortsRef.current.values()) abort.abort()
    streamAbortsRef.current.clear()
    pendingPatchesByWorkspaceRef.current.clear()
    fileContentsQueueRef.current = []
    for (const abort of fileContentsAbortsRef.current.values()) abort.abort()
    fileContentsAbortsRef.current.clear()
    fileContentsActiveRef.current = 0
    for (const resolve of fileContentsPromiseResolversRef.current.values()) {
      resolve(null)
    }
    fileContentsPromiseResolversRef.current.clear()
    fileContentsPromisesRef.current.clear()
    fileContentsCacheRef.current.clear()
    if (flushPendingRafRef.current != null) {
      window.cancelAnimationFrame(flushPendingRafRef.current)
      flushPendingRafRef.current = null
    }
  }, [])

  workspacesRef.current = workspaces
  workspaceDiffsRef.current = workspaceDiffs

  const workspaceInfoByName = useMemo(() => {
    return new Map(workspaces.map(w => [w.name, w] as const))
  }, [workspaces])

  const updateWorkspaceDiff = useCallback(
    (name: string, updater: (prev: WorkspaceDiff) => WorkspaceDiff) => {
      setWorkspaceDiffs(prev => {
        const idx = prev.findIndex(d => d.name === name)
        if (idx === -1) {
          const info = workspaceInfoByName.get(name)
          if (!info) return prev
          const created: WorkspaceDiff = {
            name: info.name,
            path: info.path,
            isGitRepo: info.isGitRepo,
            status: info.status ?? null,
            files: [],
            totals: { additions: 0, deletions: 0 },
            isLoading: true,
            error: null,
            diffBasis: DIFF_BASIS,
            hasLoadedOnce: false,
          }
          return [...prev, updater(created)]
        }
        const next = [...prev]
        next[idx] = updater(prev[idx])
        return next
      })
    },
    [workspaceInfoByName]
  )

  const pumpFileContentsQueue = useCallback(() => {
    if (!agentApiBase || !agentHeaders) return

    const MAX_CONCURRENT = 4
    while (fileContentsActiveRef.current < MAX_CONCURRENT) {
      const task = fileContentsQueueRef.current.shift()
      if (!task) break

      const taskKey = `${task.workspaceName}:${task.kind}:${task.path}`
      if (fileContentsAbortsRef.current.has(taskKey)) continue

      const abort = new AbortController()
      fileContentsAbortsRef.current.set(taskKey, abort)
      fileContentsActiveRef.current += 1

      void (async () => {
        const resolve =
          fileContentsPromiseResolversRef.current.get(taskKey) ?? null
        let didResolve = false
        const finish = (context: FullContext | null) => {
          if (didResolve) return
          didResolve = true
          resolve?.(context)
          fileContentsPromiseResolversRef.current.delete(taskKey)
          fileContentsPromisesRef.current.delete(taskKey)
        }
        try {
          const url = new URL(
            `workspaces/${encodeURIComponent(
              task.workspaceName
            )}/diff/file-contents`,
            agentApiBase.toString()
          )
          url.searchParams.set('basis', DIFF_BASIS)
          url.searchParams.set('kind', task.kind)
          url.searchParams.set('path', task.path)

          const res = await fetch(url.toString(), {
            headers: agentHeaders,
            signal: abort.signal
          })
          const text = await res.text()
          const body = safeJsonParse(text)

          if (!res.ok) {
            const msg =
              isRecord(body) &&
              'error' in body &&
              typeof (body as { error?: unknown }).error === 'string'
                ? (body as { error: string }).error
                : isRecord(body) &&
                  'message' in body &&
                  typeof (body as { message?: unknown }).message === 'string'
                ? (body as { message: string }).message
                : `Request failed (${res.status})`
            throw new Error(msg)
          }

          if (!body || typeof body !== 'object') {
            throw new Error('Unexpected file contents response')
          }

          const oldFile = (body as { oldFile?: unknown }).oldFile
          const newFile = (body as { newFile?: unknown }).newFile
          if (!isFileContents(oldFile) || !isFileContents(newFile)) {
            throw new Error('Unexpected file contents response')
          }

          const oldLines = splitLinesPreserveNewlines(oldFile.contents)
          const newLines = splitLinesPreserveNewlines(newFile.contents)
          const context: FullContext = { oldLines, newLines }
          fileContentsCacheRef.current.set(taskKey, context)

          updateWorkspaceDiff(task.workspaceName, prev => ({
            ...prev,
            files: prev.files.map(f =>
              f.id === task.fileId
                ? {
                    ...f,
                    fileDiff: {
                      ...f.fileDiff,
                      oldLines,
                      newLines
                    },
                    isContentsLoading: false,
                    contentsError: null
                  }
                : f
            )
          }))
          finish(context)
        } catch (err) {
          if (!abort.signal.aborted) {
            updateWorkspaceDiff(task.workspaceName, prev => ({
              ...prev,
              files: prev.files.map(f =>
                f.id === task.fileId
                  ? {
                      ...f,
                      isContentsLoading: false,
                      contentsError:
                        err instanceof Error ? err.message : String(err)
                    }
                  : f
              )
            }))
          }
          finish(null)
        } finally {
          if (fileContentsAbortsRef.current.get(taskKey) === abort) {
            fileContentsAbortsRef.current.delete(taskKey)
          }
          fileContentsActiveRef.current = Math.max(
            0,
            fileContentsActiveRef.current - 1
          )
          if (!didResolve) finish(null)
          pumpFileContentsQueue()
        }
      })()
    }
  }, [agentApiBase, agentHeaders, updateWorkspaceDiff])

  const enqueueFileContentsFetch = useCallback(
    (task: {
      readonly workspaceName: string
      readonly fileId: string
      readonly kind: DiffStreamFile['kind']
      readonly path: string
    }): Promise<FullContext | null> => {
      if (!agentApiBase || !agentHeaders) {
        return Promise.resolve(null)
      }
      const taskKey = `${task.workspaceName}:${task.kind}:${task.path}`
      const cached = fileContentsCacheRef.current.get(taskKey) ?? null
      if (cached) return Promise.resolve(cached)

      const existing = fileContentsPromisesRef.current.get(taskKey)
      if (existing) return existing

      const promise = new Promise<FullContext | null>(resolve => {
        fileContentsPromiseResolversRef.current.set(taskKey, resolve)
      })
      fileContentsPromisesRef.current.set(taskKey, promise)

      if (
        fileContentsQueueRef.current.some(
          queued =>
            `${queued.workspaceName}:${queued.kind}:${queued.path}` ===
            taskKey
        )
      ) {
        return promise
      }

      updateWorkspaceDiff(task.workspaceName, prev => ({
        ...prev,
        files: prev.files.map(f =>
          f.id === task.fileId
            ? {
                ...f,
                isContentsLoading: true,
                contentsError: null
              }
            : f
        )
      }))

      fileContentsQueueRef.current.push(task)
      pumpFileContentsQueue()
      return promise
    },
    [agentApiBase, agentHeaders, pumpFileContentsQueue, updateWorkspaceDiff]
  )

  const applyParsedWorkspacePatches = useCallback(
    (result: DiffParseWorkerResponse) => {
      if (result.generation !== streamGenerationRef.current) return
      if (result.files.length === 0 && !result.parseError) return

      updateWorkspaceDiff(result.workspaceName, prev => ({
        ...prev,
        files: prev.files.concat(
          result.files.map(file => ({
            id: file.id,
            kind: file.kind,
            path: file.path,
            fileDiff: file.fileDiff,
            isContentsLoading: false,
            contentsError: null
          }))
        ),
        totals: {
          additions: prev.totals.additions + result.additions,
          deletions: prev.totals.deletions + result.deletions
        },
        error: result.parseError
          ? `Failed to parse diff: ${result.parseError}`
          : prev.error
      }))
    },
    [updateWorkspaceDiff]
  )

  useEffect(() => {
    if (typeof Worker === 'undefined') return
    const worker = new Worker(
      new URL('../workers/workspace-diff-parser.worker.ts', import.meta.url),
      { type: 'module' }
    )
    diffParserWorkerRef.current = worker

    const onMessage = (event: MessageEvent<DiffParseWorkerResponse>) => {
      const data = event.data
      if (!data || data.type !== 'parsed') return
      applyParsedWorkspacePatches(data)
    }

    worker.addEventListener('message', onMessage)
    return () => {
      worker.removeEventListener('message', onMessage)
      worker.terminate()
      if (diffParserWorkerRef.current === worker) {
        diffParserWorkerRef.current = null
      }
    }
  }, [applyParsedWorkspacePatches])

  const flushPendingPatches = useCallback(() => {
    if (flushPendingRafRef.current != null) {
      window.cancelAnimationFrame(flushPendingRafRef.current)
      flushPendingRafRef.current = null
    }

    const pendingEntries = Array.from(
      pendingPatchesByWorkspaceRef.current.entries()
    )
    pendingPatchesByWorkspaceRef.current.clear()

    for (const [workspaceName, patches] of pendingEntries) {
      if (patches.length === 0) continue
      const worker = diffParserWorkerRef.current
      if (worker) {
        const request: DiffParseWorkerRequest = {
          type: 'parse',
          requestId: (diffParserRequestIdRef.current += 1),
          generation: streamGenerationRef.current,
          workspaceName,
          patches
        }
        worker.postMessage(request)
        continue
      }

      // Worker is unavailable. Keep fallback behavior functional.
      let nextFiles: WorkspaceDiffFile[] = []
      let additions = 0
      let deletions = 0
      let parseError: string | null = null

      for (const patchInfo of patches) {
        try {
          const parsed = parsePatchFiles(patchInfo.patch)
          const files = parsed.flatMap(p => p.files)
          const next: WorkspaceDiffFile[] = files.map((file, idx) => {
            const resolvedPath =
              file.name.trim().length > 0
                ? file.name
                : file.prevName?.trim().length
                ? file.prevName
                : patchInfo.path
            const baseId = `${patchInfo.kind}:${resolvedPath}`
            const id = idx === 0 ? baseId : `${baseId}:${idx}`
            return {
              id,
              kind: patchInfo.kind,
              path: resolvedPath,
              fileDiff: file,
              isContentsLoading: false,
              contentsError: null
            }
          })
          nextFiles = nextFiles.concat(next)
          for (const file of files) {
            for (const hunk of file.hunks) {
              additions += hunk.additionCount
              deletions += hunk.deletionCount
            }
          }
        } catch (err) {
          parseError = err instanceof Error ? err.message : String(err)
        }
      }

      if (nextFiles.length === 0 && !parseError) continue
      updateWorkspaceDiff(workspaceName, prev => ({
        ...prev,
        files: prev.files.concat(nextFiles),
        totals: {
          additions: prev.totals.additions + additions,
          deletions: prev.totals.deletions + deletions
        },
        error: parseError ? `Failed to parse diff: ${parseError}` : prev.error
      }))
    }
  }, [updateWorkspaceDiff])

  const enqueueWorkspacePatch = useCallback(
    (workspaceName: string, patch: DiffStreamFile) => {
      const pending = pendingPatchesByWorkspaceRef.current.get(workspaceName)
      if (pending) {
        pending.push(patch)
      } else {
        pendingPatchesByWorkspaceRef.current.set(workspaceName, [patch])
      }

      if (flushPendingRafRef.current != null) return
      flushPendingRafRef.current = window.requestAnimationFrame(() => {
        flushPendingPatches()
      })
    },
    [flushPendingPatches]
  )

  const loadWorkspaceStream = useCallback(
    async (workspaceName: string, generation: number) => {
      if (!agentApiBase || !agentHeaders) return
      if (generation !== streamGenerationRef.current) return
      if (!activeGitWorkspaceNamesRef.current.has(workspaceName)) return

      const existingAbort = streamAbortsRef.current.get(workspaceName)
      if (existingAbort) {
        existingAbort.abort()
      }

      const url = new URL(
        `workspaces/${encodeURIComponent(workspaceName)}/diff/stream`,
        agentApiBase.toString()
      )
      url.searchParams.set('basis', DIFF_BASIS)
      url.searchParams.set('maxChars', String(MAX_DIFF_CHARS))

      const abort = new AbortController()
      streamAbortsRef.current.set(workspaceName, abort)

      updateWorkspaceDiff(workspaceName, prev => ({
        ...prev,
        files: [],
        totals: { additions: 0, deletions: 0 },
        error: null,
        isLoading: true,
        hasLoadedOnce: false,
        diffBasis: DIFF_BASIS,
        status: prev.status
      }))

      let didReceiveDone = false

      try {
        const res = await fetch(url.toString(), {
          headers: agentHeaders,
          signal: abort.signal
        })
        if (!res.ok) {
          const text = await res.text()
          const body =
            text.trim().length > 0 ? (JSON.parse(text) as unknown) : null
          const msg =
            typeof body === 'object' &&
            body !== null &&
            'error' in body &&
            typeof (body as { error?: unknown }).error === 'string'
              ? (body as { error: string }).error
              : `Request failed (${res.status})`
          throw new Error(msg)
        }

        await readSseStream(
          res,
          evt => {
            if (abort.signal.aborted) return
            if (generation !== streamGenerationRef.current) return

            if (evt.event === 'meta') {
              const data = parseDiffStreamMeta(safeJsonParse(evt.data))
              if (!data) return
              updateWorkspaceDiff(workspaceName, prev => ({
                ...prev,
                isGitRepo: data.isGitRepo,
                diffBasis: data.diffBasis
              }))
              return
            }

            if (evt.event === 'status') {
              const status = parseDiffStreamStatus(safeJsonParse(evt.data))
              if (!status) return
              updateWorkspaceDiff(workspaceName, prev => ({
                ...prev,
                status
              }))
              return
            }

            if (evt.event === 'file') {
              const data = parseDiffStreamFile(safeJsonParse(evt.data))
              if (!data) return
              if (data.patch.trim().length === 0) return
              enqueueWorkspacePatch(workspaceName, data)
              return
            }

            if (evt.event === 'done') {
              const data = parseDiffStreamDone(safeJsonParse(evt.data))
              if (!data) return
              didReceiveDone = true
              flushPendingPatches()
              updateWorkspaceDiff(workspaceName, prev => ({
                ...prev,
                isLoading: false,
                hasLoadedOnce: true
              }))
              if (streamAbortsRef.current.get(workspaceName) === abort) {
                streamAbortsRef.current.delete(workspaceName)
              }
              return
            }

            if (evt.event === 'error') {
              const raw = safeJsonParse(evt.data)
              const message =
                raw && typeof raw === 'object' && 'error' in raw
                  ? (raw as { error?: unknown }).error
                  : null
              updateWorkspaceDiff(workspaceName, prev => ({
                ...prev,
                error:
                  typeof message === 'string' && message.trim().length > 0
                    ? message
                    : 'Diff stream failed',
                isLoading: false,
                hasLoadedOnce: true
              }))
              if (streamAbortsRef.current.get(workspaceName) === abort) {
                streamAbortsRef.current.delete(workspaceName)
              }
            }
          },
          { signal: abort.signal }
        )

        if (!abort.signal.aborted && !didReceiveDone) {
          throw new Error('Diff stream disconnected')
        }
      } catch (err) {
        if (!abort.signal.aborted) {
          updateWorkspaceDiff(workspaceName, prev => ({
            ...prev,
            error: err instanceof Error ? err.message : String(err),
            isLoading: false,
            hasLoadedOnce: true
          }))
        }
      } finally {
        if (streamAbortsRef.current.get(workspaceName) === abort) {
          streamAbortsRef.current.delete(workspaceName)
        }
      }
    },
    [
      agentApiBase,
      agentHeaders,
      enqueueWorkspacePatch,
      flushPendingPatches,
      updateWorkspaceDiff
    ]
  )

  const startStreamsForWorkspaces = useCallback(
    (workspaceList: WorkspacesListResponse['workspaces']) => {
      if (!agentApiBase || !agentHeaders) return

      stopAllStreams()
      streamGenerationRef.current += 1
      const generation = streamGenerationRef.current
      const gitWorkspaces = workspaceList.filter(w => w.isGitRepo)
      activeGitWorkspaceNamesRef.current = new Set(gitWorkspaces.map(w => w.name))
      activatedWorkspaceNamesRef.current = new Set(
        Array.from(activatedWorkspaceNamesRef.current).filter(name =>
          activeGitWorkspaceNamesRef.current.has(name)
        )
      )
      if (activatedWorkspaceNamesRef.current.size === 0 && gitWorkspaces.length > 0) {
        activatedWorkspaceNamesRef.current.add(gitWorkspaces[0].name)
      }

      setWorkspaceDiffs(
        gitWorkspaces.map(w => ({
          name: w.name,
          path: w.path,
          isGitRepo: w.isGitRepo,
          status: w.status ?? null,
          files: [],
          totals: { additions: 0, deletions: 0 },
          isLoading: false,
          error: null,
          diffBasis: DIFF_BASIS,
          hasLoadedOnce: false
        }))
      )

      for (const workspaceName of activatedWorkspaceNamesRef.current) {
        void loadWorkspaceStream(workspaceName, generation)
      }
    },
    [agentApiBase, agentHeaders, loadWorkspaceStream, stopAllStreams]
  )

  const ensureWorkspaceStream = useCallback(
    (workspaceName: string) => {
      activatedWorkspaceNamesRef.current.add(workspaceName)
      if (!agentApiBase || !agentHeaders) return
      if (!activeGitWorkspaceNamesRef.current.has(workspaceName)) return
      if (streamAbortsRef.current.has(workspaceName)) return

      const current = workspaceDiffsRef.current.find(d => d.name === workspaceName)
      if (!current) return
      if (current.isLoading || current.hasLoadedOnce) return

      void loadWorkspaceStream(workspaceName, streamGenerationRef.current)
    },
    [agentApiBase, agentHeaders, loadWorkspaceStream]
  )

  const reloadWorkspacesAndDiff = useCallback(async () => {
    const reloadId = (reloadNonceRef.current += 1)
    const nextWorkspaces = await loadWorkspaces()
    if (!nextWorkspaces) return
    if (reloadId !== reloadNonceRef.current) return
    startStreamsForWorkspaces(nextWorkspaces)
  }, [loadWorkspaces, startStreamsForWorkspaces])

  const fileDiffOptions = useMemo(
    () => ({
      diffStyle,
      overflow: 'scroll' as const,
      themeType: 'system' as const,
      disableFileHeader: true,
      hunkSeparators: 'line-info' as const,
      unsafeCSS: `
        :host {
          font-size: 12px;
        }

        [data-type='split'][data-overflow='scroll'] {
          gap: 0;
        }

        /* Recreate a split divider without introducing a gap. This is drawn as a
           background so separator/line backgrounds can cover it when needed. */
        [data-type='split'][data-overflow='scroll'] [data-code][data-additions] {
          background-image: linear-gradient(
            to right,
            var(--color-border, var(--diffs-fg-number)) 0 1px,
            transparent 1px
          );
          background-repeat: no-repeat;
          background-size: 1px 100%;
          background-position: left top;
        }

        [data-separator='custom'] {
          background: var(--color-info-bg, var(--diffs-bg-separator));
          border-block: 1px solid var(--color-info-border, transparent);
          min-height: 32px;
          align-items: center;
        }

        [data-separator='custom'] > slot {
          display: block;
          grid-column: 1 / -1;
          min-height: 32px;
        }

        [data-separator='line-info'] [data-separator-wrapper] {
          justify-content: center;
        }

        [data-separator='line-info'] [data-separator-content] {
          opacity: 0.85;
        }

        [data-separator='line-info'] [data-expand-button] {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 3px 8px;
          border-radius: 999px;
          border: 1px solid color-mix(in lab, var(--diffs-bg) 80%, var(--diffs-fg));
          background: var(--diffs-bg-separator);
          color: var(--diffs-fg-number);
          cursor: pointer;
          user-select: none;
        }

        [data-separator='line-info'] [data-expand-button]:hover {
          background: var(--diffs-bg-hover);
        }

        [data-separator='line-info'] [data-expand-button] > svg {
          width: 14px;
          height: 14px;
          flex: 0 0 auto;
        }

        [data-separator='line-info'] [data-expand-button]::after {
          content: 'Expand';
          font-size: 12px;
          line-height: 1;
        }

        [data-separator='line-info'] [data-expand-button][data-expand-up]::after {
          content: 'Expand up';
        }

        [data-separator='line-info'] [data-expand-button][data-expand-down]::after {
          content: 'Expand down';
        }
      `,
      theme: {
        dark: 'github-dark-default',
        light: 'github-light-default'
      }
    }),
    [diffStyle]
  )

  const diffsStyle = useMemo(
    () =>
      ({
        '--diffs-addition-color-override': 'var(--color-success)',
        '--diffs-deletion-color-override': 'var(--color-destructive)',
        '--diffs-modified-color-override': 'var(--color-warning)',

        '--diffs-bg-addition-override': 'var(--color-success-bg)',
        '--diffs-bg-addition-number-override': 'var(--color-success-bg)',
        '--diffs-bg-deletion-override': 'var(--color-destructive-bg)',
        '--diffs-bg-deletion-number-override': 'var(--color-destructive-bg)',

        '--diffs-bg-buffer-override': 'var(--color-surface-1)',
        '--diffs-bg-context-override': 'var(--color-surface-1)',
        '--diffs-bg-separator-override': 'var(--color-surface-2)',
        '--diffs-bg-hover-override': 'var(--color-hover)'
      } as CSSProperties),
    []
  )

  useEffect(() => {
    // Prevent duplicate network calls in React 18 StrictMode dev (effect runs twice).
    if (!didInitialLoadRef.current) {
      if (!agentHeaders || !listUrl) {
        // Wait until sandbox access is available before starting the initial load.
      } else {
        didInitialLoadRef.current = true
        void reloadWorkspacesAndDiff()
      }
    }

    const onRefresh = () => {
      if (toolRefreshTimerRef.current != null) {
        window.clearTimeout(toolRefreshTimerRef.current)
      }
      toolRefreshTimerRef.current = window.setTimeout(() => {
        void reloadWorkspacesAndDiff()
      }, 400)
    }
    window.addEventListener('workspace-diff:refresh', onRefresh)
    return () => {
      window.removeEventListener('workspace-diff:refresh', onRefresh)
      if (toolRefreshTimerRef.current != null) {
        window.clearTimeout(toolRefreshTimerRef.current)
        toolRefreshTimerRef.current = null
      }
    }
  }, [
    agentHeaders,
    listUrl,
    reloadWorkspacesAndDiff
  ])

  useEffect(() => {
    return () => {
      if (toolRefreshTimerRef.current != null) {
        window.clearTimeout(toolRefreshTimerRef.current)
        toolRefreshTimerRef.current = null
      }
      stopAllStreams()
    }
  }, [stopAllStreams])

  if (!props.agentApiUrl || !props.agentAuthToken) {
    return (
      <div className='h-full flex flex-col min-h-0'>
        <div className='flex-1 min-h-0 overflow-auto bg-surface-1'>
          <AnimatedDotsLoader label='Loading sandbox access' />
        </div>
      </div>
    )
  }

  return (
    <div className='h-full flex flex-col min-h-0'>
      {error ? (
        <div className='px-3 py-2 text-xs border-b border-[var(--color-destructive-border)] bg-[var(--color-destructive-bg)] text-[var(--color-destructive-foreground)]'>
          {error}
        </div>
      ) : null}
      {showInlineControls ? (
        <div className='flex items-center justify-end gap-2'>
          <Select
            value={diffStyle}
            variant='borderless'
            onChange={e =>
              setDiffStyle(e.target.value === 'unified' ? 'unified' : 'split')
            }
            className='h-9 w-[120px] border-none'
            aria-label='Diff style'
          >
            <option value='split'>Split</option>
            <option value='unified'>Unified</option>
          </Select>
        </div>
      ) : null}
      <div className='flex-1 min-h-0 overflow-auto bg-surface-1'>
        <AllWorkspacesDiff
          workspaces={workspaces}
          workspaceDiffs={workspaceDiffs}
          fileDiffOptions={fileDiffOptions}
          diffsStyle={diffsStyle}
          diffIgnoreMatchers={diffIgnoreMatchers}
          enqueueFileContentsFetch={enqueueFileContentsFetch}
          onWorkspaceVisible={ensureWorkspaceStream}
        />
      </div>
    </div>
  )
}

function AllWorkspacesDiff (props: {
  readonly workspaces: WorkspacesListResponse['workspaces']
  readonly workspaceDiffs: ReadonlyArray<WorkspaceDiff>
  readonly fileDiffOptions: {
    readonly diffStyle: 'split' | 'unified'
    readonly overflow: 'scroll'
    readonly themeType: 'system'
    readonly disableFileHeader: boolean
    readonly theme: { readonly dark: string; readonly light: string }
  }
  readonly diffsStyle: CSSProperties
  readonly diffIgnoreMatchers: ReadonlyArray<RegExp>
  readonly enqueueFileContentsFetch: (task: {
    readonly workspaceName: string
    readonly fileId: string
    readonly kind: DiffStreamFile['kind']
    readonly path: string
  }) => Promise<FullContext | null>
  readonly onWorkspaceVisible: (workspaceName: string) => void
}) {
  const gitWorkspaces = useMemo(() => {
    return props.workspaces.filter(w => w.isGitRepo)
  }, [props.workspaces])

  const diffsByName = useMemo(() => {
    return new Map(props.workspaceDiffs.map(d => [d.name, d]))
  }, [props.workspaceDiffs])

  const visible = useMemo(() => {
    return gitWorkspaces
      .map(w => {
        const diff = diffsByName.get(w.name) ?? null
        return { workspace: w, diff }
      })
      .filter(({ diff }) => diff !== null)
  }, [diffsByName, gitWorkspaces])

  if (gitWorkspaces.length === 0) {
    return <div className='text-sm text-text-secondary'>No git workspaces.</div>
  }

  if (props.workspaceDiffs.length === 0) {
    return <AnimatedDotsLoader label='Loading diff' />
  }

  return (
    <div className='flex flex-col h-full'>
      {visible.map(({ workspace, diff }) => {
        if (!diff) return null
        return (
          <WorkspaceDiffSection
            key={workspace.name}
            workspace={workspace}
            diff={diff}
            fileDiffOptions={props.fileDiffOptions}
            diffsStyle={props.diffsStyle}
            diffIgnoreMatchers={props.diffIgnoreMatchers}
            enqueueFileContentsFetch={props.enqueueFileContentsFetch}
            onWorkspaceVisible={props.onWorkspaceVisible}
          />
        )
      })}
    </div>
  )
}

function WorkspaceDiffSection (props: {
  readonly workspace: WorkspacesListResponse['workspaces'][number]
  readonly diff: WorkspaceDiff
  readonly fileDiffOptions: {
    readonly diffStyle: 'split' | 'unified'
    readonly overflow: 'scroll'
    readonly themeType: 'system'
    readonly disableFileHeader: boolean
    readonly theme: { readonly dark: string; readonly light: string }
  }
  readonly diffsStyle: CSSProperties
  readonly diffIgnoreMatchers: ReadonlyArray<RegExp>
  readonly enqueueFileContentsFetch: (task: {
    readonly workspaceName: string
    readonly fileId: string
    readonly kind: DiffStreamFile['kind']
    readonly path: string
  }) => Promise<FullContext | null>
  readonly onWorkspaceVisible: (workspaceName: string) => void
}) {
  const [filesKeySeed, setFilesKeySeed] = useState(0)
  const [filesDefaultOpen, setFilesDefaultOpen] = useState(true)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (typeof IntersectionObserver === 'undefined') {
      props.onWorkspaceVisible(props.workspace.name)
      return
    }

    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting && entry.intersectionRatio <= 0) continue
          props.onWorkspaceVisible(props.workspace.name)
          observer.disconnect()
          break
        }
      },
      {
        root: null,
        rootMargin: '240px 0px 240px 0px',
        threshold: 0
      }
    )
    observer.observe(root)
    return () => {
      observer.disconnect()
    }
  }, [props.onWorkspaceVisible, props.workspace.name])

  const hasPatch = props.diff.files.length > 0

  return (
    <div ref={rootRef} className='border border-border overflow-auto h-full'>
      <div className='px-3 py-1 border-b bg-surface-4 flex items-center gap-2'>
        <Button
          type='button'
          variant='icon'
          size='icon'
          className='h-7 w-7'
          title={filesDefaultOpen ? 'Collapse all' : 'Expand all'}
          onClick={() => {
            setFilesDefaultOpen(prev => !prev)
            setFilesKeySeed(v => v + 1)
          }}
        >
          {filesDefaultOpen ? (
            <ChevronsDownUp className='h-4 w-4' />
          ) : (
            <ChevronsUpDown className='h-4 w-4' />
          )}
        </Button>
        <div className='flex-1'>
          <div className='text-xs text-text-secondary break-all'>
            {props.workspace.path}
          </div>
        </div>
        <div className='flex items-center gap-2 text-xs text-text-secondary whitespace-nowrap'>
          <span style={{ color: 'var(--color-destructive)' }}>
            -{props.diff.totals.deletions}
          </span>{' '}
          <span style={{ color: 'var(--color-success)' }}>
            +{props.diff.totals.additions}
          </span>
        </div>
      </div>
      {props.diff.error ? (
        <div className='px-3 py-2 text-xs border-b border-[var(--color-destructive-border)] bg-[var(--color-destructive-bg)] text-[var(--color-destructive-foreground)]'>
          {props.diff.error}
        </div>
      ) : null}
      <>
        {props.diff.isLoading && !hasPatch ? (
          <AnimatedDotsLoader label='Loading diff' />
        ) : !props.diff.hasLoadedOnce ? (
          <div className='text-sm text-text-secondary px-3 py-2'>
            Waiting to load diff…
          </div>
        ) : !hasPatch ? (
          <div className='text-sm text-text-secondary px-3 py-2'>No changes.</div>
        ) : (
          <div className='flex flex-col h-full'>
            {props.diff.files.map(file => (
              <CollapsibleFileDiff
                key={`${filesKeySeed}:${file.id}`}
                diffFile={file}
                workspaceName={props.workspace.name}
                defaultOpen={filesDefaultOpen}
                fileDiffOptions={props.fileDiffOptions}
                diffsStyle={props.diffsStyle}
                diffIgnoreMatchers={props.diffIgnoreMatchers}
                enqueueFileContentsFetch={props.enqueueFileContentsFetch}
              />
            ))}
          </div>
        )}
      </>
    </div>
  )
}

function safeJsonParse (input: string): unknown {
  try {
    return JSON.parse(input) as unknown
  } catch {
    return null
  }
}

function CollapsibleFileDiff (props: {
  readonly diffFile: WorkspaceDiffFile
  readonly workspaceName: string
  readonly defaultOpen: boolean
  readonly fileDiffOptions: {
    readonly diffStyle: 'split' | 'unified'
    readonly overflow: 'scroll'
    readonly themeType: 'system'
    readonly disableFileHeader: boolean
    readonly theme: { readonly dark: string; readonly light: string }
  }
  readonly diffsStyle: CSSProperties
  readonly diffIgnoreMatchers: ReadonlyArray<RegExp>
  readonly enqueueFileContentsFetch: (task: {
    readonly workspaceName: string
    readonly fileId: string
    readonly kind: DiffStreamFile['kind']
    readonly path: string
  }) => Promise<FullContext | null>
}) {
  const [open, setOpen] = useState(props.defaultOpen)

  const fileDiff = props.diffFile.fileDiff
  const filePath = props.diffFile.path.trim().length > 0
    ? props.diffFile.path
    : fileDiff.name
  const label =
    fileDiff.prevName && fileDiff.prevName !== fileDiff.name
      ? `${fileDiff.prevName} → ${fileDiff.name}`
      : fileDiff.name

  const totals = useMemo(() => {
    let additions = 0
    let deletions = 0
    for (const hunk of fileDiff.hunks) {
      additions += hunk.additionCount
      deletions += hunk.deletionCount
    }
    return { additions, deletions }
  }, [fileDiff.hunks])

  const isIgnoredByDiffignore = useMemo(
    () => isDiffIgnoredPath(filePath, props.diffIgnoreMatchers),
    [filePath, props.diffIgnoreMatchers]
  )
  const [showIgnoredDiffContent, setShowIgnoredDiffContent] = useState(
    () => !isIgnoredByDiffignore
  )
  useEffect(() => {
    setShowIgnoredDiffContent(!isIgnoredByDiffignore)
  }, [isIgnoredByDiffignore, props.diffFile.id])

  const contentsStateRef = useRef<{
    isLoading: boolean
    hasFullContext: boolean
    error: string | null
  }>({ isLoading: false, hasFullContext: false, error: null })

  const hasFullContextFromProps = Boolean(
    fileDiff.oldLines && fileDiff.newLines
  )
  const stateFromRef = contentsStateRef.current
  const computedHasFullContext =
    hasFullContextFromProps || stateFromRef.hasFullContext
  contentsStateRef.current = {
    isLoading:
      props.diffFile.isContentsLoading ||
      (stateFromRef.isLoading && !computedHasFullContext),
    hasFullContext: computedHasFullContext,
    error: props.diffFile.contentsError
  }

  const hunkSeparatorRenderer = useMemo(() => {
    return (hunk: HunkData, instance: DiffsFileDiffInstance) => {
      const isSplitSecondaryPane =
        props.fileDiffOptions.diffStyle === 'split' && hunk.type === 'additions'

      if (isSplitSecondaryPane) {
        // Keep the separator row (blue background) in the additions pane, but
        // render the controls/label only once on the deletions side. Still
        // return a minimal node so the row height stays consistent across panes.
        const filler = document.createElement('div')
        filler.setAttribute('aria-hidden', 'true')
        filler.style.width = '100%'
        filler.style.height = '32px'
        filler.style.padding = '4px 1ch'
        filler.style.paddingLeft =
          'calc(var(--diffs-column-number-width, 0px) + 1ch)'
        return filler
      }

      const root = document.createElement('div')
      root.style.display = 'flex'
      root.style.alignItems = 'center'
      root.style.width = '100%'
      root.style.height = '32px'
      root.style.padding = '4px 1ch'
      root.style.paddingLeft =
        'calc(var(--diffs-column-number-width, 0px) + 1ch)'

      const content = document.createElement('div')
      content.style.display = 'inline-flex'
      content.style.alignItems = 'center'
      content.style.gap = '8px'
      content.style.opacity = '0.85'
      content.style.margin = '0'
      content.style.padding = '0'
      content.style.lineHeight = '1'

      const { error } = contentsStateRef.current

      const makeButton = (params: {
        direction: ExpansionDirections
        label: string
      }) => {
        const makeIcon = (direction: ExpansionDirections) => {
          const svg = document.createElementNS(
            'http://www.w3.org/2000/svg',
            'svg'
          )
          svg.setAttribute('width', '14')
          svg.setAttribute('height', '14')
          svg.setAttribute('viewBox', '0 0 16 16')
          svg.setAttribute('fill', 'none')
          svg.setAttribute('stroke', 'currentColor')
          svg.setAttribute('stroke-width', '1.8')
          svg.setAttribute('stroke-linecap', 'round')
          svg.setAttribute('stroke-linejoin', 'round')

          const makePath = (d: string) => {
            const path = document.createElementNS(
              'http://www.w3.org/2000/svg',
              'path'
            )
            path.setAttribute('d', d)
            return path
          }

          if (direction === 'up') {
            svg.appendChild(makePath('M4 10L8 6l4 4'))
          } else if (direction === 'down') {
            svg.appendChild(makePath('M4 6l4 4 4-4'))
          } else {
            svg.appendChild(makePath('M4 6l4-4 4 4'))
            svg.appendChild(makePath('M4 10l4 4 4-4'))
          }
          return svg
        }

        const btn = document.createElement('button')
        btn.type = 'button'
        const initialState = contentsStateRef.current
        btn.disabled = initialState.isLoading && !initialState.hasFullContext
        btn.title = params.label
        btn.setAttribute('aria-label', params.label)
        btn.style.margin = '0'
        btn.style.display = 'inline-flex'
        btn.style.alignItems = 'center'
        btn.style.gap = '6px'
        btn.style.padding = '2px 8px'
        btn.style.borderRadius = '999px'
        btn.style.border =
          '1px solid color-mix(in lab, var(--diffs-bg) 80%, var(--diffs-fg))'
        btn.style.background =
          'color-mix(in lab, var(--color-info-bg) 75%, transparent)'
        btn.style.color =
          'var(--diffs-fg-number, var(--diffs-fg, currentColor))'
        btn.style.cursor = 'pointer'
        btn.style.userSelect = 'none'
        btn.style.fontSize = '12px'
        btn.style.lineHeight = '1'
        btn.style.opacity = btn.disabled ? '0.5' : '1'
        btn.appendChild(makeIcon(params.direction))

        btn.addEventListener('click', () => {
          void (async () => {
            const state = contentsStateRef.current
            if (state.isLoading && !state.hasFullContext) return

            btn.disabled = true
            btn.style.opacity = '0.6'
            contentsStateRef.current = {
              ...state,
              isLoading: !state.hasFullContext
            }

            if (!state.hasFullContext) {
              const context = await props.enqueueFileContentsFetch({
                workspaceName: props.workspaceName,
                fileId: props.diffFile.id,
                kind: props.diffFile.kind,
                path: props.diffFile.path
              })
              if (!context) {
                contentsStateRef.current = {
                  ...contentsStateRef.current,
                  isLoading: false
                }
                btn.disabled = false
                btn.style.opacity = '1'
                return
              }

              contentsStateRef.current = {
                isLoading: false,
                hasFullContext: true,
                error: null
              }

              instance.render({
                fileDiff: {
                  ...props.diffFile.fileDiff,
                  oldLines: [...context.oldLines],
                  newLines: [...context.newLines]
                },
                forceRender: true
              })
            }
            instance.expandHunk(hunk.hunkIndex, params.direction)

            if (btn.isConnected) {
              btn.disabled = false
              btn.style.opacity = '1'
            }
          })()
        })

        return btn
      }

      const expandable = hunk.expandable
      if (expandable?.chunked) {
        if (expandable.up) {
          content.appendChild(
            makeButton({
              direction: 'up',
              label: error ? 'Retry' : 'Expand up'
            })
          )
        }
        if (expandable.down) {
          content.appendChild(
            makeButton({
              direction: 'down',
              label: error ? 'Retry' : 'Expand down'
            })
          )
        }
      } else if (expandable) {
        const direction: ExpansionDirections = expandable.up
          ? expandable.down
            ? 'both'
            : 'up'
          : 'down'
        const label =
          direction === 'both'
            ? 'Expand'
            : direction === 'up'
            ? 'Expand up'
            : 'Expand down'
        content.appendChild(
          makeButton({ direction, label: error ? 'Retry' : label })
        )
      } else {
        content.appendChild(
          makeButton({
            direction: 'both',
            label: error ? 'Retry' : 'Expand'
          })
        )
      }

      const linesLabel = document.createElement('span')
      linesLabel.textContent = formatUnmodifiedLines(hunk.lines)
      linesLabel.style.fontSize = '12px'
      linesLabel.style.lineHeight = '1'
      linesLabel.style.color =
        'var(--diffs-fg-number, var(--diffs-fg, currentColor))'
      content.appendChild(linesLabel)

      root.appendChild(content)
      return root
    }
  }, [
    props.diffFile.id,
    props.diffFile.kind,
    props.diffFile.path,
    props.enqueueFileContentsFetch,
    props.fileDiffOptions.diffStyle,
    props.workspaceName
  ])

  const fileDiffOptions = useMemo(() => {
    return {
      ...props.fileDiffOptions,
      hunkSeparators: hunkSeparatorRenderer
    }
  }, [hunkSeparatorRenderer, props.fileDiffOptions])

  return (
    <Collapsible open={open} onOpenChange={setOpen} className='group'>
      <div className='overflow-hidden bg-surface-1'>
        <div className='w-full flex items-center gap-2 px-3 py-0 bg-surface-2 hover:bg-[var(--color-hover)] text-left'>
          <CollapsibleTrigger asChild>
            <Button variant='icon' size='icon' className='h-7 w-7'>
              <ChevronDown className='h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180' />
            </Button>
          </CollapsibleTrigger>
          <div className='min-w-0 flex-1'>
            <div className='text-xs font-mono break-all'>{label}</div>
          </div>
          <div className='flex items-center gap-2 text-xs text-text-secondary whitespace-nowrap'>
            <span style={{ color: 'var(--color-destructive)' }}>
              -{totals.deletions}
            </span>{' '}
            <span style={{ color: 'var(--color-success)' }}>
              +{totals.additions}
            </span>
            {props.diffFile.isContentsLoading ? (
              <span className='ml-1 text-text-secondary'>
                Loading full context…
              </span>
            ) : props.diffFile.contentsError ? (
              <span className='ml-1 text-[var(--color-destructive)]'>
                Context failed
              </span>
            ) : null}
          </div>
        </div>
        <CollapsibleContent
          style={
            {
              contentVisibility: 'auto',
              containIntrinsicSize: '900px'
            } as CSSProperties
          }
        >
          {isIgnoredByDiffignore && !showIgnoredDiffContent ? (
            <div className='px-3 py-3 text-xs text-text-secondary space-y-2'>
              <div>Content hidden by diffignore settings.</div>
              <div className='text-text-tertiary break-all'>{filePath}</div>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => setShowIgnoredDiffContent(true)}
              >
                Show content
              </Button>
            </div>
          ) : (
            <ManagedFileDiff
              fileDiff={fileDiff}
              options={fileDiffOptions}
              style={props.diffsStyle}
            />
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

function ManagedFileDiff (props: {
  readonly fileDiff: FileDiffMetadata
  readonly options: FileDiffOptions<unknown>
  readonly style: CSSProperties
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLElement | null>(null)
  const instanceRef = useRef<DiffsFileDiff<unknown> | null>(null)

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return

    const container = document.createElement(DIFFS_TAG_NAME)
    applyCssVars(container, props.style)
    wrapper.appendChild(container)
    containerRef.current = container

    const instance = new DiffsFileDiff<unknown>(props.options)
    instanceRef.current = instance
    instance.render({ fileDiff: props.fileDiff, fileContainer: container })

    return () => {
      instance.cleanUp()
      instanceRef.current = null
      containerRef.current = null
    }
    // Intentional: only create/destroy once for each mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const container = containerRef.current
    const instance = instanceRef.current
    if (!container || !instance) return

    applyCssVars(container, props.style)
    const forceRender = !areOptionsEqual(instance.options, props.options)
    instance.setOptions(props.options)
    instance.render({
      fileDiff: props.fileDiff,
      fileContainer: container,
      forceRender
    })
  }, [props.fileDiff, props.options, props.style])

  return <div ref={wrapperRef} />
}
