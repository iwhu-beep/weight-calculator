import { DEFAULT_SETTINGS, MAX_HISTORY, MAX_PRESETS } from '../constants'
import { RATIO_UNITS, RESULT_UNITS, WEIGHT_UNITS } from '../types'
import type { Draft, HistoryRecord, RatioUnit, RecipePreset, ResultUnit, Settings, WeightUnit } from '../types'

const KEY_SETTINGS = 'wc_settings'
const KEY_HISTORY = 'wc_history'
const KEY_PRESETS = 'wc_presets'
const KEY_DRAFT = 'wc_draft'

export function isValidHistoryRecord(r: unknown): r is HistoryRecord {
  return !!r && typeof r === 'object' &&
    typeof (r as { id?: unknown }).id === 'string' &&
    Array.isArray((r as { weights?: unknown }).weights)
}

export function isValidPreset(p: unknown): p is RecipePreset {
  return !!p && typeof p === 'object' &&
    typeof (p as { id?: unknown }).id === 'string' &&
    typeof (p as { name?: unknown }).name === 'string' &&
    Array.isArray((p as { recipe?: unknown }).recipe)
}

// 从导入的备份数据中提取合法设置，逐字段校验并钳制取值范围
export function sanitizeSettings(raw: Record<string, unknown>): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS }
  if (typeof raw.soundEnabled === 'boolean') s.soundEnabled = raw.soundEnabled
  if (typeof raw.hapticEnabled === 'boolean') s.hapticEnabled = raw.hapticEnabled
  if (typeof raw.voiceEnabled === 'boolean') s.voiceEnabled = raw.voiceEnabled
  if (typeof raw.voiceIndex === 'number' && Number.isFinite(raw.voiceIndex) && raw.voiceIndex >= 0) {
    s.voiceIndex = Math.floor(raw.voiceIndex)
  }
  if (typeof raw.voiceRate === 'number' && Number.isFinite(raw.voiceRate)) {
    s.voiceRate = Math.min(2.0, Math.max(0.5, raw.voiceRate))
  }
  if (typeof raw.decimalPlaces === 'number' && Number.isFinite(raw.decimalPlaces)) {
    s.decimalPlaces = Math.min(4, Math.max(0, Math.floor(raw.decimalPlaces)))
  }
  if (typeof raw.maxRows === 'number' && Number.isFinite(raw.maxRows)) {
    s.maxRows = Math.min(50, Math.max(5, Math.floor(raw.maxRows)))
  }
  if (typeof raw.initialRows === 'number' && Number.isFinite(raw.initialRows)) {
    s.initialRows = Math.min(s.maxRows, Math.max(1, Math.floor(raw.initialRows)))
  }
  if (typeof raw.weightUnit === 'string' && (WEIGHT_UNITS as readonly string[]).includes(raw.weightUnit)) {
    s.weightUnit = raw.weightUnit as WeightUnit
  }
  if (typeof raw.ratioUnit === 'string' && (RATIO_UNITS as readonly string[]).includes(raw.ratioUnit)) {
    s.ratioUnit = raw.ratioUnit as RatioUnit
  }
  if (typeof raw.resultUnit === 'string' && (RESULT_UNITS as readonly string[]).includes(raw.resultUnit)) {
    s.resultUnit = raw.resultUnit as ResultUnit
  }
  if (raw.screenAlwaysOn === true) s.screenAlwaysOn = true
  if (raw.darkMode === 'light' || raw.darkMode === 'dark' || raw.darkMode === 'system') {
    s.darkMode = raw.darkMode
  }
  return s
}

export function loadSettings(): Settings {
  try {
    const saved = localStorage.getItem(KEY_SETTINGS)
    if (saved) {
      const parsed = JSON.parse(saved)
      const merged: Settings = { ...DEFAULT_SETTINGS, ...parsed, voiceRate: parsed.voiceRate ?? 1.0 }
      // 防御旧数据：initialRows 不能超过 maxRows
      if (merged.initialRows > merged.maxRows) merged.initialRows = merged.maxRows
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
          .filter(isValidHistoryRecord)
          .map(r => {
            // 旧版记录迁移：只有单个 ratio / colorPowderAmount
            if (!Array.isArray(r.recipe)) {
              const legacy = r as HistoryRecord & { ratio?: number; colorPowderAmount?: number }
              const ratio = typeof legacy.ratio === 'number' ? legacy.ratio : 0
              const amount = typeof legacy.colorPowderAmount === 'number' ? legacy.colorPowderAmount : 0
              return {
                ...r,
                recipe: [{ name: '', ratio, amount }],
                totalPowderAmount: amount,
              }
            }
            return r
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
        return parsed.filter(isValidPreset)
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
