import type { PersistStorage, StorageValue } from 'zustand/middleware'

type SyncStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface ThrottledStorage<S> extends PersistStorage<S> {
  /** Grava agora o que estiver pendente (saída da página, testes). */
  flush: () => void
}

/**
 * PersistStorage do zustand que AGRUPA gravações: o custo de uma escrita é
 * JSON.stringify do estado inteiro + localStorage.setItem (O(total de dados)), então
 * uma rajada de ações (arrastar cards, notas, automações) vira uma gravação só.
 *
 * - Throttle de janela fixa: a 1ª escrita agenda a gravação para daqui a `waitMs`;
 *   as seguintes só trocam o valor pendente. Escritas contínuas não adiam para sempre.
 * - O valor guardado é a referência do estado (barato); o stringify só ocorre no flush.
 * - getItem enxerga o pendente (lê o que acabou de escrever).
 * - Falha de gravação (cota cheia, storage indisponível) é logada e o valor segue
 *   pendente; a próxima escrita reagenda. Nunca lança dentro da ação do store.
 * Janela de risco: fechar o processo à força (crash) perde até `waitMs` de escritas;
 * saída normal da página é coberta por bindFlushOnExit.
 */
export function createThrottledJSONStorage<S>(getStorage: () => SyncStorage, waitMs = 500): ThrottledStorage<S> {
  const pending = new Map<string, StorageValue<S>>()
  let timer: ReturnType<typeof setTimeout> | null = null

  const storage = (): SyncStorage | undefined => {
    try {
      return getStorage()
    } catch {
      return undefined // modo privado / sem DOM: persistência vira no-op
    }
  }

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    const s = storage()
    if (!s) return
    for (const [name, value] of pending) {
      try {
        s.setItem(name, JSON.stringify(value))
        pending.delete(name)
      } catch (e) {
        console.error(`[crm] falha ao gravar "${name}" no armazenamento local`, e)
      }
    }
  }

  return {
    getItem: (name) => {
      if (pending.has(name)) return pending.get(name)!
      const raw = storage()?.getItem(name) ?? null
      return raw === null ? null : (JSON.parse(raw) as StorageValue<S>)
    },
    setItem: (name, value) => {
      pending.set(name, value)
      if (timer === null) timer = setTimeout(flush, waitMs)
    },
    removeItem: (name) => {
      pending.delete(name)
      storage()?.removeItem(name)
    },
    flush,
  }
}

type Listenable = Pick<EventTarget, 'addEventListener'>

/**
 * Grava o pendente quando a página sai de cena. `pagehide` cobre fechar/navegar
 * (inclusive bfcache); `visibilitychange`→hidden cobre troca de aba e mobile, onde
 * `beforeunload`/`unload` não são confiáveis.
 */
export function bindFlushOnExit(
  flush: () => void,
  win: Listenable,
  doc: Listenable & { visibilityState: DocumentVisibilityState },
) {
  win.addEventListener('pagehide', flush)
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') flush()
  })
}
