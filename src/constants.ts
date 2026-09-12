import type { Settings } from './types'

export const DEFAULT_SETTINGS: Settings = {
  soundEnabled: true,
  hapticEnabled: false,
  voiceEnabled: false,
  voiceIndex: 0,
  voiceRate: 1.0,
  decimalPlaces: 2,
  initialRows: 10,
  maxRows: 20,
  weightUnit: 'kg',
  ratioUnit: '‰',
  resultUnit: 'g',
  screenAlwaysOn: false,
  darkMode: 'system',
}

export const MAX_RECIPE_ROWS = 10
export const MAX_HISTORY = 50
export const MAX_PRESETS = 20

// 同批次判定：单位一致、配方组合一致、且最新记录在 10 分钟窗口内
export const BATCH_WINDOW_MS = 10 * 60 * 1000

// 防抖延迟（ms）
export const DEBOUNCE_DRAFT_MS = 300
export const DEBOUNCE_VOICE_MS = 600
export const DEBOUNCE_HISTORY_MS = 1000
export const STARTUP_CHECK_DELAY_MS = 4000

// 设置项边界值
export const VOICE_RATE_MIN = 0.5
export const VOICE_RATE_MAX = 2.0
export const VOICE_RATE_STEP = 0.25
export const MAX_ROWS_MIN = 5
export const MAX_ROWS_MAX = 50
export const MAX_ROWS_STEP = 5
export const DECIMAL_PLACES_MIN = 0
export const DECIMAL_PLACES_MAX = 4
