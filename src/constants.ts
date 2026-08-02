import type { Settings } from './types'

export const DEFAULT_SETTINGS: Settings = {
  soundEnabled: true,
  hapticEnabled: false,
  voiceEnabled: false,
  voiceIndex: 0,
  voiceRate: 1.0,
  decimalPlaces: 2,
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
