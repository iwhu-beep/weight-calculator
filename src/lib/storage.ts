import { DEFAULT_SETTINGS, MAX_HISTORY, MAX_PRESETS } from '../constants'
import type { Draft, HistoryRecord, RecipePreset, Settings } from '../types'

const KEY_SETTINGS = 'wc_settings'
const KEY_HISTORY = 'wc_history'
const KEY_PRESETS = 'wc_presets'
const KEY_DRAFT = 'wc_draft'

export function loadSettings(): Settings {
  try {
    const saved = localStorage.getItem(KEY_SETTINGS)
    if (saved) {
      const parsed = JSON.parse(saved)
      const merged: Settings = { ...DEFAULT_SETTINGS, ...parsed, voiceRate: parsed.voiceRate ?? 1.0 }
      return merged
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(KEY_SETTINGS, JSON.stringify(s))
}

export function loadHistory(): HistoryRecord[] {
  try {
    const saved = localStorage.getItem(KEY_HISTORY)
    if (saved) {
      const parsed = JSON.parse(saved)
      // 过滤结构损坏的记录，避免渲染时崩溃
      if (Array.isArray(parsed)) {
        return parsed
          .filter(r =>
            r && typeof r === 'object' &&
            typeof r.id === 'string' &&
            Array.isArray(r.weights)
          )
          .map(r => {
            // 旧版记录迁移：只有单个 ratio / colorPowderAmount
            if (!Array.isArray((r as HistoryRecord).recipe)) {
              const ratio = typeof (r as any).ratio === 'number' ? (r as any).ratio : 0
              const amount = typeof (r as any).colorPowderAmount === 'number' ? (r as any).colorPowderAmount : 0
              return {
                ...r,
                recipe: [{ name: '', ratio, amount }],
                totalPowderAmount: amount,
              } as HistoryRecord
            }
            return r as HistoryRecord
          })
      }
    }
  } catch { /* ignore */ }
  return []
}

export function saveHistory(records: HistoryRecord[]) {
  localStorage.setItem(KEY_HISTORY, JSON.stringify(records.slice(0, MAX_HISTORY)))
}

export function loadPresets(): RecipePreset[] {
  try {
    const saved = localStorage.getItem(KEY_PRESETS)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed)) {
        return parsed.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.recipe))
      }
    }
  } catch { /* ignore */ }
  return []
}

export function savePresets(presets: RecipePreset[]) {
  localStorage.setItem(KEY_PRESETS, JSON.stringify(presets.slice(0, MAX_PRESETS)))
}

// 草稿自动保存 - 防止刷新/退出丢失已输入数据
export function loadDraft(): Draft | null {
  try {
    const saved = localStorage.getItem(KEY_DRAFT)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (parsed && Array.isArray(parsed.weights) && Array.isArray(parsed.recipe)) {
        return parsed as Draft
      }
    }
  } catch { /* ignore */ }
  return null
}

export function saveDraft(draft: Draft) {
  localStorage.setItem(KEY_DRAFT, JSON.stringify(draft))
}

export function clearDraft() {
  localStorage.removeItem(KEY_DRAFT)
}

export function newHistoryId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
