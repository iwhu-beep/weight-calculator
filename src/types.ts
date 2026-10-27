export interface WeightEntry {
  id: number
  value: string
}

export interface RecipeItem {
  name: string
  ratio: number
  amount: number
}

export interface HistoryRecord {
  id: string
  date: string
  savedAt?: number
  // 批次身份：同一次称重录入内保持相同，重置/回填时更换。
  // 旧记录可能没有该字段，此时退化为「时间窗口」判定。
  batchId?: string
  weights: string[]
  totalWeight: number
  // 反算模式下记录的目标总重（无则为普通称重记录）
  targetWeight?: number
  recipe: RecipeItem[]
  totalPowderAmount: number
  weightUnit: string
  ratioUnit: string
  resultUnit: string
}

export interface RecipeEntry {
  id: number
  name: string
  ratio: string
}

export interface RecipePreset {
  id: string
  name: string
  recipe: { name: string; ratio: number }[]
  createdAt: number
}

export interface Draft {
  weights: string[]
  recipe: { name: string; ratio: string }[]
  savedAt: number
  // 草稿所属批次：恢复草稿后继续编辑仍归入同一批次，不会被拆成两条记录
  batchId?: string
  // 目标总重输入值（空字符串表示未启用反算）
  targetWeight?: string
}

export interface VoiceOption {
  voice: SpeechSynthesisVoice
  label: string
}

export const WEIGHT_UNITS = ['kg', 'g'] as const
export type WeightUnit = typeof WEIGHT_UNITS[number]

export const RATIO_UNITS = ['‰', '%'] as const
export type RatioUnit = typeof RATIO_UNITS[number]

export const RESULT_UNITS = ['g', 'mg', 'kg'] as const
export type ResultUnit = typeof RESULT_UNITS[number]

export interface Settings {
  soundEnabled: boolean
  hapticEnabled: boolean
  voiceEnabled: boolean
  voiceIndex: number
  voiceRate: number
  decimalPlaces: number
  initialRows: number
  maxRows: number
  weightUnit: WeightUnit
  ratioUnit: RatioUnit
  resultUnit: ResultUnit
  screenAlwaysOn: boolean
  darkMode: 'system' | 'light' | 'dark'
  // 是否在首页显示「目标重量反算」卡片；关闭后即使有目标值也按称重合计计算
  targetModeEnabled: boolean
}

export type Page = 'home' | 'settings' | 'history'
