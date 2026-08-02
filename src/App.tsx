import { useState, useCallback, useEffect, useRef } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { KeepAwake } from '@capacitor-community/keep-awake'
import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import HistoryPage from './components/HistoryPage'
import SettingsPage from './components/SettingsPage'
import { DEFAULT_SETTINGS, MAX_RECIPE_ROWS } from './constants'
import { calcColorPowder, isSameBatch, recordSignature } from './lib/calc'
import { playHaptic, playKeySound, speakNumber } from './lib/media'
import {
  clearDraft,
  loadDraft,
  loadHistory,
  loadPresets,
  loadSettings,
  newHistoryId,
  saveDraft,
  saveHistory,
  savePresets,
  saveSettings,
} from './lib/storage'
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
      : []
  )
  const [entryValue, setEntryValue] = useState(initialDraft?.entryValue ?? '')
  const [recipe, setRecipe] = useState<RecipeEntry[]>(() =>
    initialDraft && initialDraft.recipe.length > 0
      ? initialDraft.recipe.map((r, i) => ({ id: i + 1, name: r.name, ratio: r.ratio }))
      : [{ id: 1, name: '', ratio: '' }]
  )
  const [presets, setPresets] = useState<RecipePreset[]>(loadPresets)
  const [history, setHistory] = useState<HistoryRecord[]>(loadHistory)
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [voicesLoaded, setVoicesLoaded] = useState(false)
  const nextIdRef = useRef(initialDraft ? initialDraft.weights.length + 1 : 1)
  const nextRecipeIdRef = useRef(initialDraft && initialDraft.recipe.length > 0 ? initialDraft.recipe.length + 1 : 2)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const voiceTimerRef = useRef<number | null>(null)
  const saveDraftTimerRef = useRef<number | null>(null)
  const saveHistoryTimerRef = useRef<number | null>(null)
  const weightInputRefs = useRef<(HTMLInputElement | null)[]>([])
  const recipeRatioInputRefs = useRef<(HTMLInputElement | null)[]>([])
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

  // 原始输入值（按 weightUnit）
  const totalWeightRaw = weights.reduce((sum, w) => sum + (parseFloat(w.value) || 0), 0)
  const filledCount = weights.length
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
        entryValue,
        savedAt: Date.now(),
      })
      saveDraftTimerRef.current = null
    }, 300)
    return () => {
      if (saveDraftTimerRef.current !== null) {
        window.clearTimeout(saveDraftTimerRef.current)
      }
    }
  }, [weights, recipe, entryValue])

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

  const addWeightEntry = useCallback(() => {
    const v = entryValue.trim()
    if (v === '' || parseFloat(v) <= 0) return
    if (weights.length >= settings.maxRows) {
      window.alert(`已达上限（${settings.maxRows} 行）`)
      return
    }
    const id = nextIdRef.current++
    setWeights(prev => [...prev, { id, value: v }])
    setEntryValue('')
    weightInputRefs.current[0]?.focus()
  }, [entryValue, weights.length, settings.maxRows])

  // 表单提交：iOS 数字键盘 Done 键与网页回车都会触发 submit
  const handleEntrySubmit = useCallback((e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    addWeightEntry()
  }, [addWeightEntry])

  // 输入框失焦时记录：iOS 数字键盘 Done 键触发 blur 但不触发 submit
  const handleEntryBlur = useCallback(() => {
    if (entryValue !== '') addWeightEntry()
  }, [entryValue, addWeightEntry])

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

  const handleEntryChange = useCallback((value: string) => {
    if (value !== '' && !/^\d*\.?\d*$/.test(value)) return
    handleInput(value)
    setEntryValue(value)
  }, [handleInput])

  const handleRecipeRatioChange = useCallback((id: number, value: string) => {
    if (value !== '' && !/^\d*\.?\d*$/.test(value)) return
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
    const inputName = window.prompt('请输入配方名称', '')?.trim()
    if (inputName === null) return
    const name = inputName || `配方 ${presetsRef.current.length + 1}`
    const preset: RecipePreset = {
      id: newHistoryId(),
      name,
      recipe: ratios.map(r => ({ name: r.name.trim(), ratio: parseFloat(r.ratio) || 0 })),
      createdAt: Date.now(),
    }
    const newPresets = [preset, ...presetsRef.current]
    setPresets(newPresets)
    savePresets(newPresets)
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

  const removeRow = useCallback((id: number) => {
    setWeights(prev => prev.filter(w => w.id !== id))
  }, [])

  const resetAll = useCallback(() => {
    setWeights([])
    setEntryValue('')
    nextIdRef.current = 1
    setRecipe([{ id: 1, name: '', ratio: '' }])
    nextRecipeIdRef.current = 2
    clearDraft()
  }, [])

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
  }, [filledCount, buildRecord, persistRecord])

  // 自动保存历史记录（防抖）：配比有有效结果时自动存档
  useEffect(() => {
    if (totalWeightRaw <= 0 || !hasAnyRatio) return
    if (saveHistoryTimerRef.current !== null) {
      window.clearTimeout(saveHistoryTimerRef.current)
    }
    saveHistoryTimerRef.current = window.setTimeout(() => {
      saveHistoryTimerRef.current = null
      const record = buildRecord()
      if (!record) return
      persistRecord(record)
    }, 1000)
    return () => {
      if (saveHistoryTimerRef.current !== null) {
        window.clearTimeout(saveHistoryTimerRef.current)
      }
    }
  }, [totalWeightRaw, hasAnyRatio, buildRecord, persistRecord])

  const loadRecord = useCallback((record: HistoryRecord) => {
    // 钳制到 maxRows，避免行数超出上限，并过滤空值
    const vals = record.weights.filter(v => v !== '')
    const rows = vals.slice(0, settings.maxRows).map((v, i) => ({ id: i + 1, value: v }))
    setWeights(rows)
    setEntryValue('')
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
        if (data.settings && typeof data.settings === 'object') {
          const merged: Settings = { ...DEFAULT_SETTINGS, ...data.settings, voiceRate: data.settings.voiceRate ?? 1.0 }
          setSettings(merged)
          saveSettings(merged)
        }
        if (Array.isArray(data.history)) {
          const recs: HistoryRecord[] = data.history.filter((r: any) =>
            r && typeof r.id === 'string' && Array.isArray(r.weights))
          setHistory(recs)
          saveHistory(recs)
        }
        if (Array.isArray(data.presets)) {
          const ps: RecipePreset[] = data.presets.filter((p: any) =>
            p && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.recipe))
          setPresets(ps)
          savePresets(ps)
        }
        window.alert('导入成功')
      } catch {
        window.alert('备份文件解析失败')
      }
    }
    reader.readAsText(file)
  }, [])

  if (page === 'settings') {
    return (
      <SettingsPage
        settings={settings}
        setSettings={setSettings}
        voices={voices}
        voicesLoaded={voicesLoaded}
        testVoice={testVoice}
        exportBackup={exportBackup}
        importBackup={importBackup}
        onBack={() => setPage('home')}
      />
    )
  }

  if (page === 'history') {
    return (
      <HistoryPage
        history={history}
        decimalPlaces={settings.decimalPlaces}
        loadRecord={loadRecord}
        deleteRecord={deleteRecord}
        clearHistory={clearHistory}
        onBack={() => setPage('home')}
      />
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
          <button className="header-btn" onClick={() => setPage('settings')} title="设置">⚙️</button>
        </div>
      </div>

      {/* Weight Entry：单输入框 + 回车记录，下方列出已记录数据 */}
      <div className="card">
        <div className="card-title">
          <span className="card-title-icon">📦</span>
          称重数据录入
        </div>
        <form className="weight-entry-row" onSubmit={handleEntrySubmit}>
          <div className="weight-input-wrap">
            <input type="text" inputMode="decimal"
              ref={el => { weightInputRefs.current[0] = el }}
              className={`weight-input weight-entry-input ${entryValue !== '' ? 'weight-input-filled' : ''}`}
              placeholder={`输入重量(${settings.weightUnit})后回车`}
              value={entryValue}
              onChange={e => handleEntryChange(e.target.value)}
              onBlur={handleEntryBlur} />
            <span className="weight-unit">{settings.weightUnit}</span>
          </div>
          <button type="submit" className="btn btn-primary btn-sm weight-entry-btn"
            onMouseDown={e => e.preventDefault()}
            disabled={entryValue === ''}>
            记录
          </button>
        </form>
        <div className="weight-list-meta">
          <span>已记录 {weights.length} / {settings.maxRows} 次</span>
          {weights.length > 0 && (
            <button className="btn-link-danger" onClick={() => setWeights([])}>清空</button>
          )}
        </div>
        {weights.length > 0 ? (
          <div className="weight-grid">
            {weights.map((w, index) => (
              <div key={w.id} className="weight-cell">
                <span className="weight-cell-label">第{index + 1}次</span>
                <div className="weight-cell-value-wrap">
                  <span className="weight-cell-value">{w.value}</span>
                  <span className="weight-cell-unit">{settings.weightUnit}</span>
                </div>
                <button className="weight-cell-delete" onClick={() => removeRow(w.id)} title="删除此行">✕</button>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-hint">输入重量后按回车记录，录入数据将自动累加为总重量</div>
        )}
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
            <button className="preset-save-btn" onClick={savePreset}>💾 保存当前</button>
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
        <div className="result-card result-card-sticky">
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
