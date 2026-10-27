import { DECIMAL_PLACES_MAX, DECIMAL_PLACES_MIN, DEFAULT_SETTINGS, MAX_HISTORY, MAX_PRESETS, MAX_ROWS_MAX, MAX_ROWS_MIN, VOICE_RATE_MAX, VOICE_RATE_MIN } from '../constants'
import { RATIO_UNITS, RESULT_UNITS, WEIGHT_UNITS } from '../types'
import type { Draft, HistoryRecord, RatioUnit, RecipeItem, RecipePreset, ResultUnit, Settings, WeightUnit } from '../types'

const KEY_SETTINGS = 'wc_settings'
const KEY_HISTORY = 'wc_history'
const KEY_PRESETS = 'wc_presets'
const KEY_DRAFT = 'wc_draft'

// 宽松取数：任何非有限数字（含 undefined / 字符串 / NaN）都退回 fallback，
// 保证渲染时 toFixed 不会抛错
function toFiniteNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

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

// 记录归一化：迁移旧版单比例格式，并补齐所有渲染必需字段。
// localStorage 读取与备份导入共用，避免导入路径绕过迁移导致历史页崩溃。
export function normalizeHistoryRecord(raw: unknown): HistoryRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.weights)) return null

  let recipe: RecipeItem[]
  if (Array.isArray(r.recipe)) {
    recipe = r.recipe
      .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
      .map(p => ({
        name: typeof p.name === 'string' ? p.name : '',
        ratio: toFiniteNumber(p.ratio),
        amount: toFiniteNumber(p.amount),
      }))
  } else {
    // v1.4 之前的记录只有单个 ratio / colorPowderAmount
    recipe = [{
      name: '',
      ratio: toFiniteNumber(r.ratio),
      amount: toFiniteNumber(r.colorPowderAmount),
    }]
  }

  return {
    id: typeof r.id === 'string' && r.id ? r.id : newHistoryId(),
    date: typeof r.date === 'string' ? r.date : new Date().toLocaleString('zh-CN'),
    savedAt: typeof r.savedAt === 'number' && Number.isFinite(r.savedAt) ? r.savedAt : undefined,
    batchId: typeof r.batchId === 'string' ? r.batchId : undefined,
    weights: r.weights.map(w => (typeof w === 'string' ? w : '')),
    totalWeight: toFiniteNumber(r.totalWeight),
    recipe,
    totalPowderAmount: toFiniteNumber(r.totalPowderAmount, recipe.reduce((s, p) => s + p.amount, 0)),
    weightUnit: typeof r.weightUnit === 'string' ? r.weightUnit : 'kg',
    ratioUnit: typeof r.ratioUnit === 'string' ? r.ratioUnit : '‰',
    resultUnit: typeof r.resultUnit === 'string' ? r.resultUnit : 'g',
  }
}

// 预设归一化：丢弃比例非法项，避免回填时 undefined.toString() 崩溃
export function normalizePreset(raw: unknown): RecipePreset | null {
  if (!isValidPreset(raw)) return null
  const recipe = raw.recipe
    .filter((p): p is { name: string; ratio: number } => !!p && typeof p === 'object')
    .map(p => ({ name: typeof p.name === 'string' ? p.name : '', ratio: toFiniteNumber(p.ratio) }))
  if (recipe.length === 0) return null
  return {
    id: raw.id,
    name: raw.name || '未命名配方',
    recipe,
    createdAt: toFiniteNumber(raw.createdAt, Date.now()),
  }
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
    s.voiceRate = Math.min(VOICE_RATE_MAX, Math.max(VOICE_RATE_MIN, raw.voiceRate))
  }
  if (typeof raw.decimalPlaces === 'number' && Number.isFinite(raw.decimalPlaces)) {
    s.decimalPlaces = Math.min(DECIMAL_PLACES_MAX, Math.max(DECIMAL_PLACES_MIN, Math.floor(raw.decimalPlaces)))
  }
  if (typeof raw.maxRows === 'number' && Number.isFinite(raw.maxRows)) {
    s.maxRows = Math.min(MAX_ROWS_MAX, Math.max(MAX_ROWS_MIN, Math.floor(raw.maxRows)))
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
  if (typeof raw.targetModeEnabled === 'boolean') s.targetModeEnabled = raw.targetModeEnabled
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
      // 逐字段校验并钳制：本地数据被污染时回退默认值，而不是让单位/小数位失效后静默算错
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return sanitizeSettings(parsed as Record<string, unknown>)
      }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS }
}

// localStorage 写入可能因隐私模式或配额耗尽而抛错，这里吞掉，避免打断渲染
export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY_SETTINGS, JSON.stringify(s))
  } catch { /* ignore */ }
}

export function loadHistory(): HistoryRecord[] {
  try {
    const saved = localStorage.getItem(KEY_HISTORY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed)) {
        // 归一化 + 过滤损坏记录，避免渲染时崩溃
        return parsed
          .map(normalizeHistoryRecord)
          .filter((r): r is HistoryRecord => r !== null)
      }
    }
  } catch { /* ignore */ }
  return []
}

export function saveHistory(records: HistoryRecord[]) {
  try {
    localStorage.setItem(KEY_HISTORY, JSON.stringify(records.slice(0, MAX_HISTORY)))
  } catch { /* ignore */ }
}

export function loadPresets(): RecipePreset[] {
  try {
    const saved = localStorage.getItem(KEY_PRESETS)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed)) {
        return parsed
          .map(normalizePreset)
          .filter((p): p is RecipePreset => p !== null)
      }
    }
  } catch { /* ignore */ }
  return []
}

export function savePresets(presets: RecipePreset[]) {
  try {
    localStorage.setItem(KEY_PRESETS, JSON.stringify(presets.slice(0, MAX_PRESETS)))
  } catch { /* ignore */ }
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
  try {
    localStorage.setItem(KEY_DRAFT, JSON.stringify(draft))
  } catch { /* ignore */ }
}

export function clearDraft() {
  try {
    localStorage.removeItem(KEY_DRAFT)
  } catch { /* ignore */ }
}

export function newHistoryId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
