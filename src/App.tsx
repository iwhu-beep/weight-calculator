import { useState, useCallback, useEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { KeepAwake } from '@capacitor-community/keep-awake'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import pkg from '../package.json'

interface WeightEntry {
  id: number
  value: string
}

interface RecipeItem {
  name: string
  ratio: number
  amount: number
}

interface HistoryRecord {
  id: string
  date: string
  weights: string[]
  totalWeight: number
  recipe: RecipeItem[]
  totalPowderAmount: number
  weightUnit: string
  ratioUnit: string
  resultUnit: string
}

interface RecipeEntry {
  id: number
  name: string
  ratio: string
}

interface Draft {
  weights: string[]
  recipe: { name: string; ratio: string }[]
  savedAt: number
}

interface VoiceOption {
  voice: SpeechSynthesisVoice
  label: string
}

// 重量单位选项
const WEIGHT_UNITS = ['kg', 'g'] as const
type WeightUnit = typeof WEIGHT_UNITS[number]

// 比例单位选项
const RATIO_UNITS = ['‰', '%'] as const
type RatioUnit = typeof RATIO_UNITS[number]

// 结果单位选项
const RESULT_UNITS = ['g', 'mg', 'kg'] as const
type ResultUnit = typeof RESULT_UNITS[number]

interface Settings {
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
}

const DEFAULT_SETTINGS: Settings = {
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
}

function loadSettings(): Settings {
  try {
    const saved = localStorage.getItem('wc_settings')
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

function saveSettings(s: Settings) {
  localStorage.setItem('wc_settings', JSON.stringify(s))
}

function loadHistory(): HistoryRecord[] {
  try {
    const saved = localStorage.getItem('wc_history')
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

function saveHistory(records: HistoryRecord[]) {
  localStorage.setItem('wc_history', JSON.stringify(records.slice(0, 50)))
}

function newHistoryId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// 草稿自动保存 - 防止刷新/退出丢失已输入数据
function loadDraft(): Draft | null {
  try {
    const saved = localStorage.getItem('wc_draft')
    if (saved) {
      const parsed = JSON.parse(saved)
      if (parsed && Array.isArray(parsed.weights) && Array.isArray(parsed.recipe)) {
        return parsed as Draft
      }
    }
  } catch { /* ignore */ }
  return null
}

function saveDraft(draft: Draft) {
  localStorage.setItem('wc_draft', JSON.stringify(draft))
}

function clearDraft() {
  localStorage.removeItem('wc_draft')
}

const MAX_RECIPE_ROWS = 10

function createDefaultWeights(count: number): WeightEntry[] {
  return Array.from({ length: count }, (_, i) => ({ id: i + 1, value: '' }))
}

// 按键音 - 复用单例 AudioContext，避免每次按键都新建导致内存累积
let audioCtx: AudioContext | null = null

function getAudioCtx(): AudioContext | null {
  try {
    if (!audioCtx) audioCtx = new AudioContext()
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {})
    }
    return audioCtx
  } catch { /* ignore */ }
  return null
}

function playKeySound() {
  const ctx = getAudioCtx()
  if (!ctx) return
  try {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 1200
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.08, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.06)
  } catch { /* ignore */ }
}

// 触觉反馈 - 依赖 Capacitor 原生插件，浏览器中自动忽略
async function playHaptic() {
  try {
    await Haptics.impact({ style: ImpactStyle.Light })
  } catch { /* ignore */ }
}

// 语音读数
function speakNumber(text: string, voice: SpeechSynthesisVoice | null, rate: number) {
  try {
    window.speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    if (voice) utter.voice = voice
    utter.lang = voice?.lang ?? 'zh-CN'
    utter.rate = rate
    utter.pitch = 1.0
    window.speechSynthesis.speak(utter)
  } catch { /* ignore */ }
}

/**
 * 计算色粉添加量
 * 用户输入的重量单位为 weightUnit，比例单位为 ratioUnit，结果单位为 resultUnit
 *
 * 核心公式（均基于 kg 和 ‰）：
 *   色粉添加量(g) = 总重量(kg) × 比例(‰)
 *
 * 单位换算后：
 *   - 重量 kg→g: ×1000;  g→kg: ÷1000
 *   - 比例 ‰→%: ÷10;  %→‰: ×10
 *   - 结果 g→mg: ×1000;  g→kg: ÷1000
 */
function calcColorPowder(
  totalWeight: number,
  ratioValue: number,
  weightUnit: WeightUnit,
  ratioUnit: RatioUnit,
  resultUnit: ResultUnit,
): number {
  // 先统一转成 kg
  let weightKg = totalWeight
  if (weightUnit === 'g') weightKg = totalWeight / 1000

  // 先统一转成 ‰
  let ratioPermille = ratioValue
  if (ratioUnit === '%') ratioPermille = ratioValue * 10

  // 色粉添加量(g) = 总重量(kg) × 比例(‰)
  let resultG = weightKg * ratioPermille

  // 转换到目标结果单位
  if (resultUnit === 'mg') return resultG * 1000
  if (resultUnit === 'kg') return resultG / 1000
  return resultG // g
}

type Page = 'home' | 'settings' | 'history'

function App() {
  // 惰性初始化，只读取一次 localStorage
  const initialRef = useRef<Settings | null>(null)
  if (initialRef.current === null) {
    initialRef.current = loadSettings()
  }
  const initialSettings = initialRef.current
  const initialDraftRef = useRef<Draft | null>(null)
  if (initialDraftRef.current === null) {
    initialDraftRef.current = loadDraft()
  }
  const initialDraft = initialDraftRef.current
  const [page, setPage] = useState<Page>('home')
  const [settings, setSettings] = useState<Settings>(initialSettings)
  const [weights, setWeights] = useState<WeightEntry[]>(() =>
    initialDraft
      ? initialDraft.weights.slice(0, initialSettings.maxRows).map((v, i) => ({ id: i + 1, value: v }))
      : createDefaultWeights(initialSettings.initialRows)
  )
  const [recipe, setRecipe] = useState<RecipeEntry[]>(() =>
    initialDraft && initialDraft.recipe.length > 0
      ? initialDraft.recipe.map((r, i) => ({ id: i + 1, name: r.name, ratio: r.ratio }))
      : [{ id: 1, name: '', ratio: '' }]
  )
  const [history, setHistory] = useState<HistoryRecord[]>(loadHistory)
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [voicesLoaded, setVoicesLoaded] = useState(false)
  const nextIdRef = useRef(initialDraft ? initialDraft.weights.length + 1 : initialSettings.initialRows + 1)
  const nextRecipeIdRef = useRef(initialDraft && initialDraft.recipe.length > 0 ? initialDraft.recipe.length + 1 : 2)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const voiceTimerRef = useRef<number | null>(null)
  const saveDraftTimerRef = useRef<number | null>(null)
  const weightInputRefs = useRef<(HTMLInputElement | null)[]>([])
  const recipeRatioInputRefs = useRef<(HTMLInputElement | null)[]>([])
  const historyRef = useRef<HistoryRecord[]>(history)
  historyRef.current = history

  // 屏幕常亮 - 优先使用 Capacitor KeepAwake，其次 Wake Lock API
  useEffect(() => {
    // disposed 标记防止 effect 清理后异步操作仍生效（如 StrictMode 双重挂载）
    let disposed = false

    const enableKeepAwake = async () => {
      try {
        await KeepAwake.keepAwake()
      } catch {
        if (disposed) return
        // Capacitor 插件不可用时，尝试浏览器 Wake Lock API
        try {
          if ('wakeLock' in navigator) {
            const wakeLock = await navigator.wakeLock.request('screen')
            if (disposed) {
              wakeLock.release().catch(() => {})
              return
            }
            wakeLockRef.current = wakeLock
          }
        } catch { /* ignore */ }
      }
    }
    const disableKeepAwake = async () => {
      try {
        await KeepAwake.allowSleep()
      } catch { /* ignore */ }
      try {
        if (wakeLockRef.current) {
          await wakeLockRef.current.release()
          wakeLockRef.current = null
        }
      } catch { /* ignore */ }
    }

    if (settings.screenAlwaysOn) {
      enableKeepAwake()
    } else {
      disableKeepAwake()
    }

    // 页面可见性变化时重新获取锁
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && settings.screenAlwaysOn && !disposed) {
        enableKeepAwake()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      disposed = true
      disableKeepAwake()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [settings.screenAlwaysOn])

  // 原始输入值（按 weightUnit）
  const totalWeightRaw = weights.reduce((sum, w) => sum + (parseFloat(w.value) || 0), 0)
  const filledCount = weights.filter(w => w.value !== '').length
  const powderResults = recipe.map(r => {
    const ratioValue = parseFloat(r.ratio) || 0
    return {
      name: r.name.trim(),
      ratio: ratioValue,
      amount: ratioValue > 0
        ? calcColorPowder(totalWeightRaw, ratioValue, settings.weightUnit, settings.ratioUnit, settings.resultUnit)
        : 0,
    }
  })
  const hasAnyRatio = powderResults.some(p => p.ratio > 0)
  const totalPowderAmount = powderResults.reduce((s, p) => s + p.amount, 0)

  // 加载语音列表 - 仅中文
  useEffect(() => {
    const loadVoices = () => {
      const allVoices = window.speechSynthesis.getVoices()
      const zhVoices = allVoices.filter(v => v.lang.startsWith('zh'))

      const formatLabel = (v: SpeechSynthesisVoice) => {
        const langMap: Record<string, string> = {
          'zh-CN': '普通话', 'zh-TW': '繁體中文', 'zh-HK': '粵語',
          'zh': '中文', 'zh-Hans': '简体中文', 'zh-Hant': '繁体中文',
        }
        const langName = langMap[v.lang] || v.lang
        const cleanName = v.name.replace(/Microsoft |Google |Apple |Samsung |Ting-Ting /g, '')
        return `🇨🇳 ${langName} - ${cleanName}`
      }

      const sorted: VoiceOption[] = zhVoices.map(v => ({ voice: v, label: formatLabel(v) }))
      setVoices(sorted)
      setVoicesLoaded(true)
      // 语音列表变化时钳制 voiceIndex，避免越界
      setSettings(prev => {
        if (sorted.length === 0 || prev.voiceIndex < sorted.length) return prev
        return { ...prev, voiceIndex: sorted.length - 1 }
      })
    }
    loadVoices()
    window.speechSynthesis.onvoiceschanged = loadVoices
    return () => {
      window.speechSynthesis.onvoiceschanged = null
      if (voiceTimerRef.current !== null) {
        window.clearTimeout(voiceTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  // 关闭语音读数时取消尚未触发的防抖朗读
  useEffect(() => {
    if (!settings.voiceEnabled && voiceTimerRef.current !== null) {
      window.clearTimeout(voiceTimerRef.current)
      voiceTimerRef.current = null
    }
  }, [settings.voiceEnabled])

  // 自动保存草稿（防抖），输入变化 300ms 后写入 localStorage
  useEffect(() => {
    if (saveDraftTimerRef.current !== null) {
      window.clearTimeout(saveDraftTimerRef.current)
    }
    saveDraftTimerRef.current = window.setTimeout(() => {
      saveDraft({
        weights: weights.map(w => w.value),
        recipe: recipe.map(r => ({ name: r.name, ratio: r.ratio })),
        savedAt: Date.now(),
      })
      saveDraftTimerRef.current = null
    }, 300)
    return () => {
      if (saveDraftTimerRef.current !== null) {
        window.clearTimeout(saveDraftTimerRef.current)
      }
    }
  }, [weights, recipe])

  const getVoice = useCallback((): SpeechSynthesisVoice | null => {
    if (voices.length === 0) return null
    const idx = Math.min(settings.voiceIndex, voices.length - 1)
    return voices[idx]?.voice ?? null
  }, [voices, settings.voiceIndex])

  // 语音读数加防抖，停止输入后再朗读，避免逐键朗读
  const speakDebounced = useCallback((value: string) => {
    if (voiceTimerRef.current !== null) {
      window.clearTimeout(voiceTimerRef.current)
    }
    if (value === '') return
    voiceTimerRef.current = window.setTimeout(() => {
      speakNumber(value, getVoice(), settings.voiceRate)
      voiceTimerRef.current = null
    }, 600)
  }, [getVoice, settings.voiceRate])

  const handleInput = useCallback((value: string) => {
    if (settings.soundEnabled) playKeySound()
    if (settings.hapticEnabled) void playHaptic()
    if (settings.voiceEnabled) speakDebounced(value)
  }, [settings.soundEnabled, settings.hapticEnabled, settings.voiceEnabled, speakDebounced])

  // 键盘快捷键：Enter 跳到下一个输入框，快速连续录入
  const handleWeightKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const next = weightInputRefs.current[index + 1]
    if (next) {
      next.focus()
    } else if (recipeRatioInputRefs.current[0]) {
      recipeRatioInputRefs.current[0].focus()
    }
  }, [])

  const handleRecipeNameKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    recipeRatioInputRefs.current[index]?.focus()
  }, [])

  const handleRecipeRatioKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const next = recipeRatioInputRefs.current[index + 1]
    if (next) {
      next.focus()
    } else if (weightInputRefs.current[0]) {
      weightInputRefs.current[0].focus()
    }
  }, [])

  const handleWeightChange = useCallback((id: number, value: string) => {
    if (value !== '' && !/^\d*\.?\d*$/.test(value)) return
    handleInput(value)
    setWeights(prev => prev.map(w => w.id === id ? { ...w, value } : w))
  }, [handleInput])

  const handleRecipeRatioChange = useCallback((id: number, value: string) => {
    if (value !== '' && !/^\d*\.?\d*$/.test(value)) return
    handleInput(value)
    setRecipe(prev => prev.map(r => r.id === id ? { ...r, ratio: value } : r))
  }, [handleInput])

  const handleRecipeNameChange = useCallback((id: number, value: string) => {
    setRecipe(prev => prev.map(r => r.id === id ? { ...r, name: value } : r))
  }, [])

  const addRecipeRow = useCallback(() => {
    if (recipe.length >= MAX_RECIPE_ROWS) return
    const id = nextRecipeIdRef.current++
    setRecipe(prev => [...prev, { id, name: '', ratio: '' }])
  }, [recipe.length])

  const removeRecipeRow = useCallback((id: number) => {
    if (recipe.length <= 1) return
    setRecipe(prev => prev.filter(r => r.id !== id))
  }, [recipe.length])

  const addRow = useCallback(() => {
    if (weights.length >= settings.maxRows) return
    const id = nextIdRef.current++
    setWeights(prev => [...prev, { id, value: '' }])
  }, [weights.length, settings.maxRows])

  const removeRow = useCallback((id: number) => {
    if (weights.length <= 1) return
    setWeights(prev => prev.filter(w => w.id !== id))
  }, [weights.length])

  const resetAll = useCallback(() => {
    setWeights(createDefaultWeights(settings.initialRows))
    nextIdRef.current = settings.initialRows + 1
    setRecipe([{ id: 1, name: '', ratio: '' }])
    nextRecipeIdRef.current = 2
    clearDraft()
  }, [settings.initialRows])

  const saveRecord = useCallback(() => {
    if (filledCount === 0) return
    const storedRecipe = recipe
      .filter(r => (parseFloat(r.ratio) || 0) > 0)
      .map(r => {
        const ratio = parseFloat(r.ratio) || 0
        return {
          name: r.name.trim(),
          ratio,
          amount: calcColorPowder(totalWeightRaw, ratio, settings.weightUnit, settings.ratioUnit, settings.resultUnit),
        }
      })
    const totalAmount = storedRecipe.reduce((s, p) => s + p.amount, 0)
    const record: HistoryRecord = {
      id: newHistoryId(),
      date: new Date().toLocaleString('zh-CN'),
      weights: weights.map(w => w.value),
      totalWeight: totalWeightRaw,
      recipe: storedRecipe,
      totalPowderAmount: totalAmount,
      weightUnit: settings.weightUnit,
      ratioUnit: settings.ratioUnit,
      resultUnit: settings.resultUnit,
    }
    // 用 historyRef 读取最新记录，避免连续保存时 stale closure 丢失记录
    const newHistory = [record, ...historyRef.current].slice(0, 50)
    setHistory(newHistory)
    saveHistory(newHistory)
  }, [weights, totalWeightRaw, recipe, filledCount, settings.weightUnit, settings.ratioUnit, settings.resultUnit])

  const loadRecord = useCallback((record: HistoryRecord) => {
    // 钳制到 maxRows，避免行数超出上限
    const rows = record.weights.slice(0, settings.maxRows).map((v, i) => ({ id: i + 1, value: v }))
    setWeights(rows)
    nextIdRef.current = rows.length + 1
    const loadedRecipe: RecipeEntry[] = record.recipe.length > 0
      ? record.recipe.map((p, i) => ({ id: i + 1, name: p.name, ratio: p.ratio > 0 ? p.ratio.toString() : '' }))
      : [{ id: 1, name: '', ratio: '' }]
    setRecipe(loadedRecipe)
    nextRecipeIdRef.current = loadedRecipe.length + 1
    // 加载记录时也切换单位
    setSettings(prev => ({
      ...prev,
      weightUnit: (record.weightUnit as WeightUnit) || prev.weightUnit,
      ratioUnit: (record.ratioUnit as RatioUnit) || prev.ratioUnit,
      resultUnit: (record.resultUnit as ResultUnit) || prev.resultUnit,
    }))
    setPage('home')
  }, [settings.maxRows])

  const deleteRecord = useCallback((id: string) => {
    if (!historyRef.current.some(r => r.id === id)) return
    if (!window.confirm('确定删除这条记录吗？此操作不可恢复。')) return
    const newHistory = historyRef.current.filter(r => r.id !== id)
    setHistory(newHistory)
    saveHistory(newHistory)
  }, [])

  const clearHistory = useCallback(() => {
    const count = historyRef.current.length
    if (count === 0) return
    if (!window.confirm(`确定清空全部 ${count} 条历史记录吗？此操作不可恢复。`)) return
    setHistory([])
    saveHistory([])
  }, [])

  const testVoice = useCallback(() => {
    const voice = getVoice()
    speakNumber('123.45', voice, settings.voiceRate)
  }, [getVoice, settings.voiceRate])

  // 设置页面
  if (page === 'settings') {
    return (
      <div className="app safe-top">
        <div className="page-header">
          <button className="back-btn" onClick={() => setPage('home')}>← 返回</button>
          <h2>设置</h2>
          <div style={{ width: 60 }} />
        </div>

        <div className="card">
          <div className="card-title">
            <span className="card-title-icon">🔊</span>
            声音与语音
          </div>
          <div className="setting-row">
            <div>
              <div className="setting-label">按键声音</div>
              <div className="setting-desc">输入数字时播放按键音效</div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={settings.soundEnabled}
                onChange={e => setSettings(prev => ({ ...prev, soundEnabled: e.target.checked }))} />
              <span className="toggle-slider" />
            </label>
          </div>
          <div className="setting-row">
            <div>
              <div className="setting-label">触觉反馈</div>
              <div className="setting-desc">输入数字时马达震动反馈（需原生 App）</div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={settings.hapticEnabled}
                onChange={e => setSettings(prev => ({ ...prev, hapticEnabled: e.target.checked }))} />
              <span className="toggle-slider" />
            </label>
          </div>
          <div className="setting-row">
            <div>
              <div className="setting-label">语音读数</div>
              <div className="setting-desc">输入数字时自动朗读数值</div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={settings.voiceEnabled}
                onChange={e => setSettings(prev => ({ ...prev, voiceEnabled: e.target.checked }))} />
              <span className="toggle-slider" />
            </label>
          </div>
          {settings.voiceEnabled && (
            <>
              <div className="setting-row">
                <div>
                  <div className="setting-label">语音选择</div>
                  <div className="setting-desc">选择中文朗读语音</div>
                </div>
              </div>
              <div className="voice-select-wrap">
                <select className="voice-select" value={settings.voiceIndex}
                  onChange={e => setSettings(prev => ({ ...prev, voiceIndex: parseInt(e.target.value) }))}>
                  {!voicesLoaded && <option value={0}>加载中...</option>}
                  {voicesLoaded && voices.length === 0 && <option value={0}>无可用中文语音</option>}
                  {voices.map((v, i) => (
                    <option key={i} value={i}>{v.label}</option>
                  ))}
                </select>
                <button className="btn-test-voice" onClick={testVoice}>🔊 试听</button>
              </div>
              <div className="setting-row">
                <div>
                  <div className="setting-label">语速</div>
                  <div className="setting-desc">
                    {settings.voiceRate <= 0.5 ? '慢速' : settings.voiceRate <= 0.75 ? '较慢' : settings.voiceRate <= 1.0 ? '正常' : settings.voiceRate <= 1.5 ? '较快' : '快速'}
                  </div>
                </div>
                <div className="stepper">
                  <button className="stepper-btn"
                    onClick={() => setSettings(prev => ({ ...prev, voiceRate: Math.max(0.5, +(prev.voiceRate - 0.25).toFixed(2)) }))}>−</button>
                  <span className="stepper-value">{settings.voiceRate}x</span>
                  <button className="stepper-btn"
                    onClick={() => setSettings(prev => ({ ...prev, voiceRate: Math.min(2.0, +(prev.voiceRate + 0.25).toFixed(2)) }))}>+</button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="card">
          <div className="card-title">
            <span className="card-title-icon">📐</span>
            输入设置
          </div>
          <div className="setting-row">
            <div>
              <div className="setting-label">初始显示行数</div>
              <div className="setting-desc">打开时默认显示的输入行数</div>
            </div>
            <div className="stepper">
              <button className="stepper-btn"
                onClick={() => setSettings(prev => ({ ...prev, initialRows: Math.max(1, prev.initialRows - 1) }))}>−</button>
              <span className="stepper-value">{settings.initialRows}</span>
              <button className="stepper-btn"
                onClick={() => setSettings(prev => ({ ...prev, initialRows: Math.min(prev.maxRows, prev.initialRows + 1) }))}>+</button>
            </div>
          </div>
          <div className="setting-row">
            <div>
              <div className="setting-label">最大输入行数</div>
              <div className="setting-desc">允许添加的最大行数（5~50）</div>
            </div>
            <div className="stepper">
                <button className="stepper-btn"
                  onClick={() => setSettings(prev => {
                    const newMax = Math.max(5, prev.maxRows - 5)
                    return { ...prev, maxRows: newMax, initialRows: Math.min(prev.initialRows, newMax) }
                  })}>−</button>
              <span className="stepper-value">{settings.maxRows}</span>
              <button className="stepper-btn"
                onClick={() => setSettings(prev => ({ ...prev, maxRows: Math.min(50, prev.maxRows + 5) }))}>+</button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <span className="card-title-icon">📏</span>
            单位设置
          </div>
          <div className="setting-row">
            <div>
              <div className="setting-label">称重单位</div>
              <div className="setting-desc">称重数据的输入单位</div>
            </div>
            <div className="unit-toggle-group">
              {WEIGHT_UNITS.map(u => (
                <button key={u} className={`unit-btn ${settings.weightUnit === u ? 'unit-btn-active' : ''}`}
                  onClick={() => setSettings(prev => ({ ...prev, weightUnit: u }))}>{u}</button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <div>
              <div className="setting-label">比例单位</div>
              <div className="setting-desc">色粉添加比例的单位</div>
            </div>
            <div className="unit-toggle-group">
              {RATIO_UNITS.map(u => (
                <button key={u} className={`unit-btn ${settings.ratioUnit === u ? 'unit-btn-active' : ''}`}
                  onClick={() => setSettings(prev => ({ ...prev, ratioUnit: u }))}>{u}</button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <div>
              <div className="setting-label">结果单位</div>
              <div className="setting-desc">色粉添加量的输出单位</div>
            </div>
            <div className="unit-toggle-group">
              {RESULT_UNITS.map(u => (
                <button key={u} className={`unit-btn ${settings.resultUnit === u ? 'unit-btn-active' : ''}`}
                  onClick={() => setSettings(prev => ({ ...prev, resultUnit: u }))}>{u}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <span className="card-title-icon">📱</span>
            屏幕设置
          </div>
          <div className="setting-row">
            <div>
              <div className="setting-label">屏幕常亮</div>
              <div className="setting-desc">录入数据时防止屏幕自动熄灭</div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={settings.screenAlwaysOn}
                onChange={e => setSettings(prev => ({ ...prev, screenAlwaysOn: e.target.checked }))} />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <span className="card-title-icon">🔢</span>
            显示设置
          </div>
          <div className="setting-row">
            <div>
              <div className="setting-label">小数位数</div>
              <div className="setting-desc">总重量显示的小数位数</div>
            </div>
            <div className="stepper">
              <button className="stepper-btn"
                onClick={() => setSettings(prev => ({ ...prev, decimalPlaces: Math.max(0, prev.decimalPlaces - 1) }))}>−</button>
              <span className="stepper-value">{settings.decimalPlaces}</span>
              <button className="stepper-btn"
                onClick={() => setSettings(prev => ({ ...prev, decimalPlaces: Math.min(4, prev.decimalPlaces + 1) }))}>+</button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <span className="card-title-icon">ℹ️</span>
            关于
          </div>
          <div className="about-info">
            <div className="about-row">
              <span>应用名称</span>
              <span>称重色粉计算器</span>
            </div>
            <div className="about-row">
              <span>版本</span>
              <span>v{pkg.version}</span>
            </div>
            <div className="about-row">
              <span>用途</span>
              <span>工业称重与色粉配比</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 历史记录页面
  if (page === 'history') {
    return (
      <div className="app safe-top">
        <div className="page-header">
          <button className="back-btn" onClick={() => setPage('home')}>← 返回</button>
          <h2>历史记录</h2>
          <div style={{ width: 60 }} />
        </div>

        {history.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <span className="empty-icon">📋</span>
              <p>暂无历史记录</p>
              <p className="empty-sub">计算完成后点击"保存记录"即可保存</p>
            </div>
          </div>
        ) : (
          <>
            <div className="history-actions">
              <span className="history-count">共 {history.length} 条记录</span>
              <button className="btn-clear" onClick={clearHistory}>清空全部</button>
            </div>
            {history.map(record => (
              <div key={record.id} className="card history-card" onClick={() => loadRecord(record)}>
                <div className="history-header">
                  <span className="history-date">{record.date}</span>
                  <button className="remove-row-btn"
                    onClick={e => { e.stopPropagation(); deleteRecord(record.id) }} title="删除记录">✕</button>
                </div>
                <div className="history-body">
                  <div className="history-item">
                    <span className="history-item-label">总重量</span>
                    <span className="history-item-value">{record.totalWeight.toFixed(settings.decimalPlaces)} {record.weightUnit || 'kg'}</span>
                  </div>
                  {record.recipe.map((p, i) => (
                    <div className="history-item" key={i}>
                      <span className="history-item-label">{p.name || `色粉${i + 1}`}</span>
                      <span className="history-item-value highlight">{p.amount.toFixed(1)} {record.resultUnit || 'g'}</span>
                    </div>
                  ))}
                  {record.recipe.length > 1 && record.totalPowderAmount > 0 && (
                    <div className="history-item">
                      <span className="history-item-label">合计</span>
                      <span className="history-item-value highlight">{record.totalPowderAmount.toFixed(1)} {record.resultUnit || 'g'}</span>
                    </div>
                  )}
                </div>
                <div className="history-weight-tags">
                  {record.weights.filter(w => w !== '').map((w, i) => (
                    <span key={i} className="weight-tag">{w}{record.weightUnit || 'kg'}</span>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    )
  }

  // 主页面
  return (
    <div className="app safe-top">
      {/* Header */}
      <div className="header">
        <h1>
          <span className="header-icon">⚖️</span>
          称重色粉计算器
        </h1>
        <p>记录称重数据 · 计算色粉添加量</p>
        <div className="header-actions">
          <button className="header-btn" onClick={() => setPage('history')} title="历史记录">📋</button>
          <button className="header-btn" onClick={() => setPage('settings')} title="设置">⚙️</button>
        </div>
      </div>

      {/* Weight Input Card */}
      <div className="card">
        <div className="card-title">
          <span className="card-title-icon">📦</span>
          称重数据录入
        </div>
        <div className="weight-rows">
          {weights.map((w, index) => (
            <div key={w.id} className={`weight-row ${w.value !== '' ? 'weight-row-filled' : ''}`}>
              <span className={`weight-label ${w.value !== '' ? 'weight-label-filled' : ''}`}>
                第{index + 1}次
              </span>
              <div className="weight-input-wrap">
                <input type="text" inputMode="decimal"
                  ref={el => { weightInputRefs.current[index] = el }}
                  className={`weight-input ${w.value !== '' ? 'weight-input-filled' : ''}`}
                  placeholder={`输入重量(${settings.weightUnit})`}
                  value={w.value}
                  onChange={e => handleWeightChange(w.id, e.target.value)}
                  onKeyDown={e => handleWeightKeyDown(e, index)} />
                <span className="weight-unit">{settings.weightUnit}</span>
              </div>
              {weights.length > 1 && (
                <button className="remove-row-btn" onClick={() => removeRow(w.id)} title="删除此行">✕</button>
              )}
            </div>
          ))}
        </div>
        <button className="add-row-btn" onClick={addRow} disabled={weights.length >= settings.maxRows}>
          {weights.length >= settings.maxRows
            ? `已达上限（${settings.maxRows} 行）`
            : `+ 添加一行（${weights.length}/${settings.maxRows}）`}
        </button>
      </div>

      {/* Total Weight Card */}
      <div className="total-card">
        <div className="card-title">
          <span className="card-title-icon">📊</span>
          总重量
        </div>
        <div>
          <span className="total-value">{totalWeightRaw.toFixed(settings.decimalPlaces)}</span>
          <span className="total-unit">{settings.weightUnit}</span>
        </div>
        <div className="total-detail">
          已录入 {filledCount} 次 · 共 {weights.length} 行
        </div>
      </div>

      {/* Ratio Input Card */}
      <div className="card">
        <div className="card-title">
          <span className="card-title-icon">🎨</span>
          色粉配比
        </div>
        <div className="ratio-section">
          {recipe.map((r, index) => (
            <div key={r.id} className="ratio-row">
              <span className="ratio-label">色粉{index + 1}</span>
              <input type="text" className="ratio-name-input"
                placeholder="名称(可选)" maxLength={12}
                value={r.name}
                onChange={e => handleRecipeNameChange(r.id, e.target.value)}
                onKeyDown={e => handleRecipeNameKeyDown(e, index)} />
              <div className="ratio-input-wrap">
                <input type="text" inputMode="decimal" className="ratio-input"
                  ref={el => { recipeRatioInputRefs.current[index] = el }}
                  placeholder="比例" value={r.ratio}
                  onChange={e => handleRecipeRatioChange(r.id, e.target.value)}
                  onKeyDown={e => handleRecipeRatioKeyDown(e, index)} />
                <span className="ratio-unit">{settings.ratioUnit}</span>
              </div>
              {recipe.length > 1 && (
                <button className="remove-row-btn" onClick={() => removeRecipeRow(r.id)} title="删除此色粉">✕</button>
              )}
            </div>
          ))}
          <button className="add-row-btn" onClick={addRecipeRow} disabled={recipe.length >= MAX_RECIPE_ROWS}>
            {recipe.length >= MAX_RECIPE_ROWS ? '已达上限（10 种色粉）' : '+ 添加色粉'}
          </button>
          {totalWeightRaw === 0 && (
            <div className="empty-hint">请先输入称重数据</div>
          )}
        </div>
      </div>

      {/* Result Card */}
      {totalWeightRaw > 0 && hasAnyRatio && (
        <div className="result-card">
          <div className="card-title">
            <span className="card-title-icon">✅</span>
            色粉添加量
          </div>
          <div className="result-list">
            {powderResults.filter(p => p.ratio > 0).map((p, i) => (
              <div key={i} className="result-row">
                <span className="result-powder-name">{p.name || `色粉${i + 1}`}</span>
                <span className="result-powder-ratio">{p.ratio} {settings.ratioUnit}</span>
                <span className="result-powder-amount">{p.amount.toFixed(1)} {settings.resultUnit}</span>
              </div>
            ))}
          </div>
          {powderResults.filter(p => p.ratio > 0).length > 1 && (
            <div className="result-total">
              <span>合计</span>
              <span>{totalPowderAmount.toFixed(1)} {settings.resultUnit}</span>
            </div>
          )}
          <div className="result-formula">
            总重量 {totalWeightRaw.toFixed(settings.decimalPlaces)} {settings.weightUnit} · 共 {powderResults.filter(p => p.ratio > 0).length} 种色粉
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="actions">
        <button className="btn btn-primary" onClick={saveRecord} disabled={filledCount === 0}>
          💾 保存记录
        </button>
        <button className="btn btn-outline" onClick={resetAll}>
          重置数据
        </button>
      </div>
    </div>
  )
}

export default App
