import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import pkg from '../../package.json'

const REPO = 'iwhu-beep/weight-calculator'
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`

interface GitHubAsset {
  name: string
  browser_download_url: string
}

// 检查结果缓存：成功缓存 24 小时，失败只缓存 1 小时（网络恢复后能尽快重试）
const CACHE_KEY = 'wc_update_check'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const FAIL_CACHE_TTL_MS = 60 * 60 * 1000

// 请求超时：GitHub API 在部分网络下会长时间无响应，超时按失败处理，避免按钮卡在「检查中」
const REQUEST_TIMEOUT_MS = 6000

interface CacheEntry {
  at: number
  result: UpdateCheckResult | null
}

export interface UpdateCheckResult {
  current: string
  latest: string
  hasUpdate: boolean
  releaseUrl: string
  downloadUrl: string | null
  name: string | null
  publishedAt: string | null
}

function parseVersion(v: string): number[] {
  return v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0)
}

// 比较语义化版本：a > b 返回 1，a < b 返回 -1，相等返回 0
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da > db) return 1
    if (da < db) return -1
  }
  return 0
}

// 读取缓存：命中且未过期才返回；失败结果用更短的 TTL
function readCache(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheEntry | null
    if (!parsed || typeof parsed.at !== 'number') return null
    const ttl = parsed.result ? CACHE_TTL_MS : FAIL_CACHE_TTL_MS
    return Date.now() - parsed.at < ttl ? parsed : null
  } catch {
    return null
  }
}

function writeCache(result: UpdateCheckResult | null) {
  try {
    const entry: CacheEntry = { at: Date.now(), result }
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry))
  } catch { /* ignore */ }
}

// 检查 GitHub Releases 最新版本；网络异常/无发布时返回 null（不阻塞 App）。
// force 为 true 时跳过缓存（手动检查更新）
export async function checkForUpdate(force = false): Promise<UpdateCheckResult | null> {
  if (!force) {
    const cached = readCache()
    if (cached) {
      // 上次失败：窗口内直接返回，不再发起请求
      if (!cached.result) return null
      const r = cached.result
      return {
        ...r,
        current: pkg.version,
        hasUpdate: compareVersions(r.latest, pkg.version) > 0,
      }
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    })
    if (!res.ok) {
      writeCache(null)
      return null
    }
    const data = await res.json()
    const latest = (data.tag_name as string | undefined)?.replace(/^v/, '')
    if (!latest) {
      writeCache(null)
      return null
    }
    const assets: GitHubAsset[] = Array.isArray(data.assets) ? data.assets as GitHubAsset[] : []
    const downloadAsset = assets.find(a => a.name === 'App.ipa')?.browser_download_url ?? null
    const result: UpdateCheckResult = {
      current: pkg.version,
      latest,
      hasUpdate: compareVersions(latest, pkg.version) > 0,
      releaseUrl: data.html_url || `https://github.com/${REPO}/releases`,
      downloadUrl: downloadAsset,
      name: data.name ?? null,
      publishedAt: data.published_at ?? null,
    }
    writeCache(result)
    return result
  } catch {
    // 超时、断网、解析失败统一按失败处理
    writeCache(null)
    return null
  } finally {
    clearTimeout(timer)
  }
}

// 原生 App 用系统浏览器打开，网页端用 window.open
export async function openExternal(url: string) {
  if (Capacitor.isNativePlatform()) {
    try {
      await Browser.open({ url, presentationStyle: 'fullscreen' })
      return
    } catch { /* fallback */ }
  }
  window.open(url, '_blank')
}
