import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalStorageMock } from '../test/localStorage.mock'
import { bindFlushOnExit, createThrottledJSONStorage } from './throttledStorage'

type Value = { state: { n: number }; version: number }
const v = (n: number): Value => ({ state: { n }, version: 2 })

describe('createThrottledJSONStorage', () => {
  let ls: Storage
  beforeEach(() => {
    vi.useFakeTimers()
    ls = createLocalStorageMock()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('agrupa rajada de escritas numa única gravação com o último valor', () => {
    const spy = vi.spyOn(ls, 'setItem')
    const storage = createThrottledJSONStorage<Value['state']>(() => ls, 500)
    for (let i = 1; i <= 20; i++) storage.setItem('k', v(i))
    expect(spy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(JSON.parse(ls.getItem('k')!)).toEqual(v(20))
  })

  it('escritas contínuas não adiam para sempre: grava no máximo a cada janela', () => {
    const spy = vi.spyOn(ls, 'setItem')
    const storage = createThrottledJSONStorage<Value['state']>(() => ls, 500)
    for (let t = 0; t < 2000; t += 100) {
      storage.setItem('k', v(t))
      vi.advanceTimersByTime(100)
    }
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('getItem enxerga a escrita pendente (lê o que acabou de escrever)', () => {
    const storage = createThrottledJSONStorage<Value['state']>(() => ls, 500)
    storage.setItem('k', v(7))
    expect(storage.getItem('k')).toEqual(v(7))
    expect(ls.getItem('k')).toBeNull()
  })

  it('flush grava na hora e cancela o timer (sem gravação duplicada)', () => {
    const spy = vi.spyOn(ls, 'setItem')
    const storage = createThrottledJSONStorage<Value['state']>(() => ls, 500)
    storage.setItem('k', v(1))
    storage.flush()
    expect(spy).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('removeItem descarta escrita pendente', () => {
    const storage = createThrottledJSONStorage<Value['state']>(() => ls, 500)
    storage.setItem('k', v(1))
    storage.removeItem('k')
    vi.advanceTimersByTime(500)
    expect(ls.getItem('k')).toBeNull()
    expect(storage.getItem('k')).toBeNull()
  })

  it('erro de cota na gravação não explode e é logado', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(ls, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const storage = createThrottledJSONStorage<Value['state']>(() => ls, 500)
    storage.setItem('k', v(1))
    expect(() => vi.advanceTimersByTime(500)).not.toThrow()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('sem storage disponível (modo privado) vira no-op', () => {
    const storage = createThrottledJSONStorage<Value['state']>(() => {
      throw new Error('SecurityError')
    }, 500)
    storage.setItem('k', v(1))
    expect(() => storage.flush()).not.toThrow()
    expect(storage.getItem('k')).toEqual(v(1)) // pendente ainda visível
  })
})

describe('bindFlushOnExit', () => {
  it('pagehide e visibilitychange→hidden disparam flush; visible não', () => {
    const win = new EventTarget()
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState })
    const flush = vi.fn()
    bindFlushOnExit(flush, win, doc)
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(flush).not.toHaveBeenCalled()
    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(flush).toHaveBeenCalledTimes(1)
    win.dispatchEvent(new Event('pagehide'))
    expect(flush).toHaveBeenCalledTimes(2)
  })
})
