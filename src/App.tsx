import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { KeepAwake } from '@capacitor-community/keep-awake'
import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'

const SettingsPage = lazy(() => import('./components/SettingsPage'))
const HistoryPage = lazy(() => import('./components/HistoryPage'))
import { DEFAULT_SETTINGS, MAX_RECIPE_ROWS } from './constants'

import { calcColorPowder, convertWeight, createDefaultWeights, isSameBatch, recordSignature } from './lib/calc'
import { playHaptic, playKeySound, speakNumber } from './lib/media'
import { checkForUpdate } from './lib/updater'
import type { UpdateCheckResult } from './lib/updater'
import {
  clearDraft,
  isValidHistoryRecord,
  isValidPreset,
  loadDraft,
  loadHistory,
  loadPresets,
  loadSettings,
  newHistoryId,
  sanitizeSettings,
  saveDraft,
  saveHistory,
  savePresets,
  saveSettings,
  } from './lib/storage'
import { RATIO_UNITS, RESULT_UNITS, WEIGHT_UNITS } from './types'
import type {
  Draft,
  HistoryRecord,
  Page,
  RecipeEntry,
  RecipePreset,
  ResultUnit,
  RatioUnit,
  Settings,
  VoiceOption,
  WeightEntry,
  WeightUnit,
} from './types'
import pkg from '../package.json'

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
  const [presets, setPresets] = useState<RecipePreset[]>(loadPresets)
  const [history, setHistory] = useState<HistoryRecord[]>(loadHistory)
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [voicesLoaded, setVoicesLoaded] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [namingPreset, setNamingPreset] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateChecked, setUpdateChecked] = useState(false)
  const prevWeightUnitRef = useRef(initialSettings.weightUnit)
  const nextIdRef = useRef(initialDraft ? initialDraft.weights.length + 1 : initialSettings.initialRows + 1)
  const nextRecipeIdRef = useRef(initialDraft && initialDraft.recipe.length > 0 ? initialDraft.recipe.length + 1 : 2)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const voiceTimerRef = useRef<number | null>(null)
  const saveDraftTimerRef = useRef<number | null>(null)
  const saveHistoryTimerRef = useRef<number | null>(null)
  const weightInputRefs = useRef<(HTMLInputElement | null)[]>([])
  const recipeRatioInputRefs = useRef<(HTMLInputElement | null)[]>([])
  const resultCardRef = useRef<HTMLDivElement | null>(null)
  const historyRef = useRef<HistoryRecord[]>(history)
  historyRef.current = history
  const presetsRef = useRef<RecipePreset[]>(presets)
  presetsRef.current = presets

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

  // 原始输入值（按 weightUnit），用 useMemo 避免输入时重复遍历
  const totalWeightRaw = useMemo(() => weights.reduce((sum, w) => sum + (parseFloat(w.value) || 0), 0), [weights])
  const filledCount = useMemo(() => weights.filter(w => w.value !== '').length, [weights])
  const powderResults = useMemo(() => recipe.map(r => {
    const ratioValue = parseFloat(r.ratio) || 0
    return {
      name: r.name.trim(),
      ratio: ratioValue,
      amount: ratioValue > 0
        ? calcColorPowder(totalWeightRaw, ratioValue, settings.weightUnit, settings.ratioUnit, settings.resultUnit)
        : 0,
    }
  }), [recipe, totalWeightRaw, settings.weightUnit, settings.ratioUnit, settings.resultUnit])
  const activeResults = useMemo(() => powderResults.filter(p => p.ratio > 0), [powderResults])
  const hasAnyRatio = activeResults.length > 0
  const totalPowderAmount = useMemo(() => activeResults.reduce((s, p) => s + p.amount, 0), [activeResults])

  // 镜像 ref：供页面隐藏/关闭时强制 flush 防抖保存使用
  const weightsRef = useRef(weights)
  weightsRef.current = weights
  const recipeRef = useRef(recipe)
  recipeRef.current = recipe
  const totalWeightRef = useRef(totalWeightRaw)
  totalWeightRef.current = totalWeightRaw
  const hasAnyRatioRef = useRef(hasAnyRatio)
  hasAnyRatioRef.current = hasAnyRatio

  // 加载语音列表 - 仅中文
  useEffect(() => {
    const speechSynth = ('speechSynthesis' in window && window.speechSynthesis) || null
    const loadVoices = () => {
      const allVoices = speechSynth ? speechSynth.getVoices() : []
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
    if (speechSynth) speechSynth.onvoiceschanged = loadVoices
    return () => {
      if (speechSynth) speechSynth.onvoiceschanged = null
      if (voiceTimerRef.current !== null) {
        window.clearTimeout(voiceTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  // 最大行数减小后，裁剪已存在的超出行
  useEffect(() => {
    if (weights.length <= settings.maxRows) return
    const next = weights.slice(0, settings.maxRows)
    setWeights(next)
    nextIdRef.current = next.length + 1
  }, [settings.maxRows, weights])

  // 手动切换称重单位时，将已输入重量按新单位换算（kg↔g），避免数据失真
  useEffect(() => {
    const prev = prevWeightUnitRef.current
    if (prev === settings.weightUnit) return
    prevWeightUnitRef.current = settings.weightUnit
    setWeights(prevWeights =>
      prevWeights.map(w => ({ ...w, value: convertWeight(w.value, prev, settings.weightUnit) }))
    )
  }, [settings.weightUnit])

  // 版本自检：手动检查更新（manual=true 时显示失败/结果状态）
  const checkUpdate = useCallback(async (manual: boolean) => {
    setCheckingUpdate(true)
    const info = await checkForUpdate(manual)
    setUpdateInfo(info)
    setCheckingUpdate(false)
    if (manual) setUpdateChecked(true)
  }, [])

  // 启动后静默检查一次，有新版时设置页与首页角标提示
  useEffect(() => {
    const t = window.setTimeout(() => { void checkUpdate(false) }, 4000)
    return () => window.clearTimeout(t)
  }, [checkUpdate])

  // 主题：跟随系统 / 浅色 / 深色，设置 html[data-theme]
  useEffect(() => {
    const root = document.documentElement
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = settings.darkMode === 'dark' || (settings.darkMode === 'system' && mq.matches)
      root.setAttribute('data-theme', dark ? 'dark' : 'light')
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings.darkMode])

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
    const changed = weightsRef.current.some(w => w.id === id && w.value !== value)
    if (!changed) return
    handleInput(value)
    setWeights(prev => prev.map(w => w.id === id ? { ...w, value } : w))
  }, [handleInput])

  const handleRecipeRatioChange = useCallback((id: number, value: string) => {
    if (value !== '' && !/^\d*\.?\d*$/.test(value)) return
    const changed = recipeRef.current.some(r => r.id === id && r.ratio !== value)
    if (!changed) return
    handleInput(value)
    setRecipe(prev => prev.map(r => r.id === id ? { ...r, ratio: value } : r))
  }, [handleInput])

  const handleRecipeNameChange = useCallback((id: number, value: string) => {
    setRecipe(prev => prev.map(r => r.id === id ? { ...r, name: value } : r))
  }, [])

  const savePreset = useCallback(() => {
    const ratios = recipe.filter(r => (parseFloat(r.ratio) || 0) > 0)
    if (ratios.length === 0) {
      window.alert('请先输入至少一个色粉比例')
      return
    }
    // iOS WKWebView 不支持 window.prompt，改用应用内联输入
    setPresetName('')
    setNamingPreset(true)
  }, [recipe])

  const confirmSavePreset = useCallback((name: string) => {
    const ratios = recipe.filter(r => (parseFloat(r.ratio) || 0) > 0)
    if (ratios.length === 0) return
    const finalName = name.trim() || `配方 ${presetsRef.current.length + 1}`
    const preset: RecipePreset = {
      id: newHistoryId(),
      name: finalName,
      recipe: ratios.map(r => ({ name: r.name.trim(), ratio: parseFloat(r.ratio) || 0 })),
      createdAt: Date.now(),
    }
    const newPresets = [preset, ...presetsRef.current]
    setPresets(newPresets)
    savePresets(newPresets)
    setNamingPreset(false)
    setPresetName('')
  }, [recipe])

  const applyPreset = useCallback((preset: RecipePreset) => {
    const entries: RecipeEntry[] = preset.recipe.map((r, i) => ({
      id: i + 1,
      name: r.name,
      ratio: r.ratio > 0 ? r.ratio.toString() : '',
    }))
    setRecipe(entries)
    nextRecipeIdRef.current = entries.length + 1
  }, [])

  const deletePreset = useCallback((id: string) => {
    if (!window.confirm('确定删除这个配方预设吗？')) return
    const newPresets = presetsRef.current.filter(p => p.id !== id)
    setPresets(newPresets)
    savePresets(newPresets)
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

  const buildRecord = useCallback((): HistoryRecord | null => {
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
    return {
      id: newHistoryId(),
      date: new Date().toLocaleString('zh-CN'),
      savedAt: Date.now(),
      weights: weights.map(w => w.value),
      totalWeight: totalWeightRaw,
      recipe: storedRecipe,
      totalPowderAmount: storedRecipe.reduce((s, p) => s + p.amount, 0),
      weightUnit: settings.weightUnit,
      ratioUnit: settings.ratioUnit,
      resultUnit: settings.resultUnit,
    }
  }, [weights, totalWeightRaw, recipe, settings.weightUnit, settings.ratioUnit, settings.resultUnit])

  // 通过 ref 取最新的 buildRecord，避免历史防抖被无关重渲染重置
  const buildRecordRef = useRef(buildRecord)
  buildRecordRef.current = buildRecord

  // 统一持久化入口：完全相同的记录跳过；同批次（配方/单位相同且在时间窗口内）更新最新一条；否则新增
  const persistRecord = useCallback((record: HistoryRecord) => {
    const latest = historyRef.current[0]
    // 内容完全相同则跳过，避免与自动保存重复
    if (latest && recordSignature(latest) === recordSignature(record)) return
    if (latest && isSameBatch(latest, record)) {
      // 同批次合并：保留原 id，刷新内容与时间
      const merged: HistoryRecord = {
        ...record,
        id: latest.id,
        savedAt: Date.now(),
      }
      const newHistory = [merged, ...historyRef.current.slice(1)].slice(0, 50)
      setHistory(newHistory)
      saveHistory(newHistory)
      return
    }
    // 新批次：直接新增
    const newHistory = [record, ...historyRef.current].slice(0, 50)
    setHistory(newHistory)
    saveHistory(newHistory)
  }, [])

  const saveRecord = useCallback(() => {
    if (filledCount === 0) return
    const record = buildRecord()
    if (!record) return
    persistRecord(record)
    clearDraft()
  }, [filledCount, buildRecord, persistRecord])

  // 自动保存历史记录（防抖）：配比有有效结果时自动存档。
  // 通过 buildRecordRef 取最新构建函数，避免防抖被无关重渲染重置
  useEffect(() => {
    if (totalWeightRaw <= 0 || !hasAnyRatio) return
    if (saveHistoryTimerRef.current !== null) {
      window.clearTimeout(saveHistoryTimerRef.current)
    }
    saveHistoryTimerRef.current = window.setTimeout(() => {
      saveHistoryTimerRef.current = null
      const record = buildRecordRef.current()
      if (!record) return
      persistRecord(record)
    }, 1000)
    return () => {
      if (saveHistoryTimerRef.current !== null) {
        window.clearTimeout(saveHistoryTimerRef.current)
      }
    }
  }, [weights, recipe, totalWeightRaw, hasAnyRatio, settings.weightUnit, settings.ratioUnit, settings.resultUnit, persistRecord])

  // 页面隐藏/关闭时强制 flush 挂起的防抖保存，避免最后输入丢失
  useEffect(() => {
    const flushPending = () => {
      if (saveDraftTimerRef.current !== null) {
        window.clearTimeout(saveDraftTimerRef.current)
        saveDraftTimerRef.current = null
        saveDraft({
          weights: weightsRef.current.map(w => w.value),
          recipe: recipeRef.current.map(r => ({ name: r.name, ratio: r.ratio })),
          savedAt: Date.now(),
        })
      }
      if (saveHistoryTimerRef.current !== null) {
        window.clearTimeout(saveHistoryTimerRef.current)
        saveHistoryTimerRef.current = null
        if (totalWeightRef.current > 0 && hasAnyRatioRef.current) {
          const record = buildRecordRef.current()
          if (record) persistRecord(record)
        }
      }
    }
    const handleVisibilityHidden = () => {
      if (document.visibilityState === 'hidden') flushPending()
    }
    window.addEventListener('pagehide', flushPending)
    document.addEventListener('visibilitychange', handleVisibilityHidden)
    return () => {
      window.removeEventListener('pagehide', flushPending)
      document.removeEventListener('visibilitychange', handleVisibilityHidden)
    }
  }, [persistRecord])

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
    // 采用记录自带单位（非法值回退当前），记录数值本身即按该单位录入，无需换算
    const recWeightUnit: WeightUnit = (WEIGHT_UNITS as readonly string[]).includes(record.weightUnit)
      ? record.weightUnit as WeightUnit
      : settings.weightUnit
    const recRatioUnit: RatioUnit = (RATIO_UNITS as readonly string[]).includes(record.ratioUnit)
      ? record.ratioUnit as RatioUnit
      : settings.ratioUnit
    const recResultUnit: ResultUnit = (RESULT_UNITS as readonly string[]).includes(record.resultUnit)
      ? record.resultUnit as ResultUnit
      : settings.resultUnit
    // 单位切换 effect 会换算已输入数值，这里同步 ref，避免对记录原始值二次换算
    prevWeightUnitRef.current = recWeightUnit
    setSettings(prev => ({
      ...prev,
      weightUnit: recWeightUnit,
      ratioUnit: recRatioUnit,
      resultUnit: recResultUnit,
    }))
    setPage('home')
  }, [settings.maxRows, settings.weightUnit])

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

  // 滚动到详细结果卡片
  const scrollToResult = useCallback(() => {
    resultCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // 导出全部配置（设置、历史、配方预设）为 JSON 文件
  const exportBackup = useCallback(async () => {
    try {
      const data = {
        app: 'weight-calculator',
        version: pkg.version,
        exportedAt: new Date().toISOString(),
        settings,
        history: historyRef.current,
        presets: presetsRef.current,
      }
      const json = JSON.stringify(data, null, 2)
      const filename = `weight-calculator-backup-${new Date().toISOString().slice(0, 10)}.json`
      // 原生 App：写入临时文件后调起系统分享面板（iOS 选择「存储到文件」即可导出）
      if (Capacitor.isNativePlatform()) {
        try {
          await Filesystem.writeFile({
            path: filename,
            data: json,
            directory: Directory.Cache,
            encoding: Encoding.UTF8,
          })
          const uriResult = await Filesystem.getUri({
            directory: Directory.Cache,
            path: filename,
          })
          await Share.share({
            title: '称重色粉计算器备份',
            files: [uriResult.uri],
            dialogTitle: '导出配置备份',
          })
          return
        } catch (err) {
          console.warn('native share failed, fallback to clipboard', err)
          // 原生分享不可用时降级为复制到剪贴板
        }
      }
      // 降级：复制 JSON 到剪贴板并提示保存
      try {
        await navigator.clipboard.writeText(json)
        window.alert('配置已复制到剪贴板，请粘贴保存为 ' + filename)
        return
      } catch (err) {
        console.warn('clipboard failed, fallback to download', err)
      }
      // 最终降级：网页下载
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      window.alert('导出失败，请重试')
    }
  }, [settings])

  // 导入配置备份文件并覆盖当前数据
  const importBackup = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result))
        if (!data || data.app !== 'weight-calculator') {
          window.alert('无效的备份文件')
          return
        }
        if (!window.confirm('导入将覆盖当前全部设置、历史记录与配方预设，确定继续？')) return
        let importedSettings: Settings = { ...DEFAULT_SETTINGS }
        if (data.settings && typeof data.settings === 'object') {
          importedSettings = sanitizeSettings(data.settings as Record<string, unknown>)
          setSettings(importedSettings)
          saveSettings(importedSettings)
        }
        if (Array.isArray(data.history)) {
          const recs: HistoryRecord[] = data.history.filter(isValidHistoryRecord)
          setHistory(recs)
          saveHistory(recs)
        }
        if (Array.isArray(data.presets)) {
          const ps: RecipePreset[] = data.presets.filter(isValidPreset)
          setPresets(ps)
          savePresets(ps)
        }
        // 导入即覆盖：清空草稿并按导入设置重置输入区
        clearDraft()
        setWeights(createDefaultWeights(importedSettings.initialRows))
        nextIdRef.current = importedSettings.initialRows + 1
        setRecipe([{ id: 1, name: '', ratio: '' }])
        nextRecipeIdRef.current = 2
        window.alert('导入成功')
      } catch {
        window.alert('备份文件解析失败')
      }
    }
    reader.readAsText(file)
  }, [])

  if (page === 'settings') {
    return (
      <Suspense fallback={<div className="app safe-top"><div className="page-header"><h2>加载中...</h2></div></div>}>
        <SettingsPage
          settings={settings}
          setSettings={setSettings}
          voices={voices}
          voicesLoaded={voicesLoaded}
          testVoice={testVoice}
          exportBackup={exportBackup}
          importBackup={importBackup}
          updateInfo={updateInfo}
          checkingUpdate={checkingUpdate}
          updateChecked={updateChecked}
          checkUpdate={checkUpdate}
          onBack={() => setPage('home')}
        />
      </Suspense>
    )
  }

  if (page === 'history') {
    return (
      <Suspense fallback={<div className="app safe-top"><div className="page-header"><h2>加载中...</h2></div></div>}>
        <HistoryPage
          history={history}
          decimalPlaces={settings.decimalPlaces}
          loadRecord={loadRecord}
          deleteRecord={deleteRecord}
          clearHistory={clearHistory}
          onBack={() => setPage('home')}
        />
      </Suspense>
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
        <div className="header-actions">
          <button className="header-btn" onClick={() => setPage('history')} title="历史记录">📋</button>
          <button className="header-btn" onClick={() => setPage('settings')} title="设置">⚙️
            {updateInfo?.hasUpdate && <span className="header-badge">1</span>}
          </button>
        </div>
      </div>

      {/* 实时结果预览横幅：结果有效时吸顶常驻，点击滚动到详细结果 */}
      {totalWeightRaw > 0 && hasAnyRatio && (
        <div className="result-banner" onClick={scrollToResult}>
          <span className="result-banner-item result-banner-total">⚖️ {totalWeightRaw.toFixed(settings.decimalPlaces)} {settings.weightUnit}</span>
          <span className="result-banner-item">🎨 {activeResults.length} 种</span>
          <span className="result-banner-item result-banner-amount">✅ 合计 {totalPowderAmount.toFixed(settings.decimalPlaces)} {settings.resultUnit}</span>
          <span className="result-banner-arrow">▾</span>
        </div>
      )}

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
          <span key={totalWeightRaw} className="total-value">{totalWeightRaw.toFixed(settings.decimalPlaces)}</span>
          <span className="total-unit">{settings.weightUnit}</span>
        </div>
        <div className="total-detail">
          已录入 {filledCount} 次
        </div>
      </div>

      {/* Ratio Input Card */}
      <div className="card">
        <div className="card-title">
          <span className="card-title-icon">🎨</span>
          色粉配比
        </div>
        <div className="preset-section">
          <div className="preset-header">
            <span className="preset-title">配方预设</span>
            {namingPreset ? (
              <div className="preset-save-inline">
                <input
                  className="preset-name-input"
                  type="text"
                  placeholder="请输入配方名称"
                  maxLength={12}
                  autoFocus
                  value={presetName}
                  onChange={e => setPresetName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') confirmSavePreset(presetName)
                    else if (e.key === 'Escape') setNamingPreset(false)
                  }} />
                <button className="preset-save-btn" onClick={() => confirmSavePreset(presetName)}>确定</button>
                <button className="preset-save-btn" onClick={() => setNamingPreset(false)}>取消</button>
              </div>
            ) : (
              <button className="preset-save-btn" onClick={savePreset}>💾 保存当前</button>
            )}
          </div>
          {presets.length === 0 ? (
            <div className="preset-empty">暂无配方，可保存当前色粉配比</div>
          ) : (
            <div className="preset-list">
              {presets.map(p => (
                <div key={p.id} className="preset-chip" onClick={() => applyPreset(p)}>
                  <span className="preset-name">{p.name}</span>
                  <button className="preset-delete"
                    onClick={e => { e.stopPropagation(); deletePreset(p.id) }} title="删除配方">✕</button>
                </div>
              ))}
            </div>
          )}
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
        <div ref={resultCardRef} className="result-card result-card-sticky">
          <div className="card-title">
            <span className="card-title-icon">✅</span>
            色粉添加量
          </div>
          <div className="result-list">
            {activeResults.map((p, i) => (
              <div key={i} className="result-row">
                <span className="result-powder-name">{p.name || `色粉${i + 1}`}</span>
                <span className="result-powder-ratio">{p.ratio} {settings.ratioUnit}</span>
                <span className="result-powder-amount">{p.amount.toFixed(settings.decimalPlaces)} {settings.resultUnit}</span>
              </div>
            ))}
          </div>
          {activeResults.length > 1 && (
            <div className="result-total">
              <span>合计</span>
              <span>{totalPowderAmount.toFixed(settings.decimalPlaces)} {settings.resultUnit}</span>
            </div>
          )}
          <div className="result-formula">
            总重量 {totalWeightRaw.toFixed(settings.decimalPlaces)} {settings.weightUnit} · 共 {activeResults.length} 种色粉
          </div>
        </div>
      )}
      <div className="auto-save-hint">💾 结果有效时会自动保存到历史记录（输入停止后 1 秒）</div>

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
