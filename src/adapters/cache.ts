import { IBaseComponent } from '@well-known-components/interfaces'
import { AppComponents } from '../types'

export interface ICacheComponent extends IBaseComponent {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttlMs: number): Promise<void>
  invalidate(key: string): Promise<void>
  clear(): Promise<void>
}

type CacheEntry<T> = {
  value: T
  expiresAt: number
}

export async function createCacheComponent(
  _components: Pick<AppComponents, 'config'>
): Promise<ICacheComponent> {
  const cache = new Map<string, CacheEntry<any>>()

  async function get<T>(key: string): Promise<T | null> {
    const entry = cache.get(key)

    if (!entry) {
      return null
    }

    const now = Date.now()
    if (now > entry.expiresAt) {
      cache.delete(key)
      return null
    }

    return entry.value as T
  }

  async function set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    const expiresAt = Date.now() + ttlMs
    cache.set(key, { value, expiresAt })
  }

  async function invalidate(key: string): Promise<void> {
    cache.delete(key)
  }

  async function clear(): Promise<void> {
    cache.clear()
  }

  return {
    get,
    set,
    invalidate,
    clear
  }
}
