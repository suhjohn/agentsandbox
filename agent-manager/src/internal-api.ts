export type InternalApiFetch = (request: Request) => Response | PromiseLike<Response>

let internalApiFetch: InternalApiFetch | null = null

export function setInternalApiFetch(fetchFn: InternalApiFetch): void {
  internalApiFetch = fetchFn
}

export function clearInternalApiFetch(): void {
  internalApiFetch = null
}

export function getInternalApiFetch(): InternalApiFetch | null {
  return internalApiFetch
}
