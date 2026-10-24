import { vi } from 'vitest'

/** localStorage em memória p/ vitest em environment 'node' (sem DOM). */
export function createLocalStorageMock(): Storage {
  let map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => {
      map = new Map()
    },
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => {
      map.delete(k)
    },
    setItem: (k, v) => {
      map.set(k, String(v))
    },
  }
}

export const localStorageMock = createLocalStorageMock()
vi.stubGlobal('localStorage', localStorageMock)
