import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import pkg from '../../package.json'

const REPO = 'iwhu-beep/weight-calculator'
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`

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

// 检查 GitHub Releases 最新版本；网络异常/无发布时返回 null（不阻塞 App）
export async function checkForUpdate(): Promise<UpdateCheckResult | null> {
  try {
    const res = await fetch(API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return null
    const data = await res.json()
    const latest = (data.tag_name as string | undefined)?.replace(/^v/, '')
    if (!latest) return null
    const downloadAsset = Array.isArray(data.assets)
      ? (data.assets.find((a: any) => a.name === 'App.ipa')?.browser_download_url ?? null)
      : null
    return {
      current: pkg.version,
      latest,
      hasUpdate: compareVersions(latest, pkg.version) > 0,
      releaseUrl: data.html_url || `https://github.com/${REPO}/releases`,
      downloadUrl: downloadAsset,
      name: data.name ?? null,
      publishedAt: data.published_at ?? null,
    }
  } catch {
    return null
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
