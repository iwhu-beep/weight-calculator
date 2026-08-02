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
  weights: string[]
  totalWeight: number
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

export type CalcMode = 'forward' | 'reverseWeight' | 'reverseRatio'

export interface Draft {
  weights: string[]
  recipe: { name: string; ratio: string }[]
  calcMode?: CalcMode
  revPowder?: string
  revRatio?: string
  revWeight?: string
  revAmount?: string
  entryValue?: string
  savedAt: number
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
  maxRows: number
  weightUnit: WeightUnit
  ratioUnit: RatioUnit
  resultUnit: ResultUnit
  screenAlwaysOn: boolean
  darkMode: 'system' | 'light' | 'dark'
}

export type Page = 'home' | 'settings' | 'history'
