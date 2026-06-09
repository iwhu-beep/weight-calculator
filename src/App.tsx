import { useState, useCallback, useEffect, useRef } from 'react'
import { KeepAwake } from '@capacitor-community/keep-awake'

interface WeightEntry {
  id: number
  value: string
}

interface HistoryRecord {
  id: string
  date: string
  weights: string[]
  totalWeight: number
  ratio: number
  colorPowderAmount: number
  weightUnit: string
  ratioUnit: string
  resultUnit: string
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
      return { ...DEFAULT_SETTINGS, ...parsed, voiceRate: parsed.voiceRate ?? 1.0 }
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
    if (saved) return JSON.parse(saved)
  } catch { /* ignore */ }
  return []
}

function saveHistory(records: HistoryRecord[]) {
  localStorage.setItem('wc_history', JSON.stringify(records.slice(0, 50)))
}

function createDefaultWeights(count: number): WeightEntry[] {
  return Array.from({ length: count }, (_, i) => ({ id: i + 1, value: '' }))
}

// 按键音
function playKeySound() {
  try {
    const ctx = new AudioContext()
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
  const [page, setPage] = useState<Page>('home')
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [weights, setWeights] = useState<WeightEntry[]>(() => createDefaultWeights(loadSettings().initialRows))
  const [ratio, setRatio] = useState('')
  const [history, setHistory] = useState<HistoryRecord[]>(loadHistory)
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const nextIdRef = useRef(settings.initialRows + 1)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  // 屏幕常亮 - 优先使用 Capacitor KeepAwake，其次 Wake Lock API
  useEffect(() => {
    const enableKeepAwake = async () => {
      try {
        await KeepAwake.keepAwake()
        console.log('KeepAwake enabled')
      } catch (e) {
        // Capacitor 插件不可用时，尝试浏览器 Wake Lock API
        try {
          if ('wakeLock' in navigator) {
            const wakeLock = await navigator.wakeLock.request('screen')
            wakeLockRef.current = wakeLock
            console.log('Wake Lock acquired')
          }
        } catch { /* ignore */ }
      }
    }
    const disableKeepAwake = async () => {
      try {
        await KeepAwake.allowSleep()
        console.log('KeepAwake disabled')
      } catch { /* ignore */ }
      try {
        if (wakeLockRef.current) {
          await wakeLockRef.current.release()
          wakeLockRef.current = null
          console.log('Wake Lock released')
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
      if (document.visibilityState === 'visible' && settings.screenAlwaysOn) {
        enableKeepAwake()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      disableKeepAwake()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [settings.screenAlwaysOn])

  // 原始输入值（按 weightUnit）
  const totalWeightRaw = weights.reduce((sum, w) => sum + (parseFloat(w.value) || 0), 0)
  const filledCount = weights.filter(w => w.value !== '').length
  const ratioValue = parseFloat(ratio) || 0
  const colorPowderAmount = calcColorPowder(totalWeightRaw, ratioValue, settings.weightUnit, settings.ratioUnit, settings.resultUnit)

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
    }
    loadVoices()
    window.speechSynthesis.onvoiceschanged = loadVoices
    return () => { window.speechSynthesis.onvoiceschanged = null }
  }, [])

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  const getVoice = useCallback((): SpeechSynthesisVoice | null => {
    if (voices.length === 0) return null
    const idx = Math.min(settings.voiceIndex, voices.length - 1)
    return voices[idx]?.voice ?? null
  }, [voices, settings.voiceIndex])

  const handleInput = useCallback((value: string) => {
    if (settings.soundEnabled) playKeySound()
    if (settings.voiceEnabled && value) {
      speakNumber(value, getVoice(), settings.voiceRate)
    }
  }, [settings.soundEnabled, settings.voiceEnabled, settings.voiceRate, getVoice])

  const handleWeightChange = useCallback((id: number, value: string) => {
    if (value !== '' && !/^\d*\.?\d*$/.test(value)) return
    handleInput(value)
    setWeights(prev => prev.map(w => w.id === id ? { ...w, value } : w))
  }, [handleInput])

  const handleRatioChange = useCallback((value: string) => {
    if (value !== '' && !/^\d*\.?\d*$/.test(value)) return
    handleInput(value)
    setRatio(value)
  }, [handleInput])

  const addRow = useCallback(() => {
    if (weights.length >= settings.maxRows) return
    setWeights(prev => [...prev, { id: nextIdRef.current++, value: '' }])
  }, [weights.length, settings.maxRows])

  const removeRow = useCallback((id: number) => {
    if (weights.length <= 1) return
    setWeights(prev => prev.filter(w => w.id !== id))
  }, [weights.length])

  const resetAll = useCallback(() => {
    setWeights(createDefaultWeights(settings.initialRows))
    nextIdRef.current = settings.initialRows + 1
    setRatio('')
  }, [settings.initialRows])

  const saveRecord = useCallback(() => {
    if (filledCount === 0) return
    const record: HistoryRecord = {
      id: Date.now().toString(),
      date: new Date().toLocaleString('zh-CN'),
      weights: weights.map(w => w.value),
      totalWeight: totalWeightRaw,
      ratio: ratioValue,
      colorPowderAmount,
      weightUnit: settings.weightUnit,
      ratioUnit: settings.ratioUnit,
      resultUnit: settings.resultUnit,
    }
    const newHistory = [record, ...history]
    setHistory(newHistory)
    saveHistory(newHistory)
  }, [weights, totalWeightRaw, ratioValue, colorPowderAmount, filledCount, history, settings.weightUnit, settings.ratioUnit, settings.resultUnit])

  const loadRecord = useCallback((record: HistoryRecord) => {
    setWeights(record.weights.map((v, i) => ({ id: i + 1, value: v })))
    nextIdRef.current = record.weights.length + 1
    setRatio(record.ratio > 0 ? record.ratio.toString() : '')
    // 加载记录时也切换单位
    setSettings(prev => ({
      ...prev,
      weightUnit: (record.weightUnit as WeightUnit) || prev.weightUnit,
      ratioUnit: (record.ratioUnit as RatioUnit) || prev.ratioUnit,
      resultUnit: (record.resultUnit as ResultUnit) || prev.resultUnit,
    }))
    setPage('home')
  }, [])

  const deleteRecord = useCallback((id: string) => {
    const newHistory = history.filter(r => r.id !== id)
    setHistory(newHistory)
    saveHistory(newHistory)
  }, [history])

  const clearHistory = useCallback(() => {
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
                  {voices.length === 0 && <option value={0}>加载中...</option>}
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
                onClick={() => setSettings(prev => ({ ...prev, maxRows: Math.max(5, prev.maxRows - 5), initialRows: Math.min(prev.initialRows, Math.max(5, prev.maxRows - 5)) }))}>−</button>
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
              <span>v1.3.0</span>
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
                  {record.ratio > 0 && (
                    <div className="history-item">
                      <span className="history-item-label">添加比例</span>
                      <span className="history-item-value">{record.ratio} {record.ratioUnit || '‰'}</span>
                    </div>
                  )}
                  {record.colorPowderAmount > 0 && (
                    <div className="history-item">
                      <span className="history-item-label">色粉添加量</span>
                      <span className="history-item-value highlight">{record.colorPowderAmount.toFixed(1)} {record.resultUnit || 'g'}</span>
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
                  className={`weight-input ${w.value !== '' ? 'weight-input-filled' : ''}`}
                  placeholder={`输入重量(${settings.weightUnit})`}
                  value={w.value}
                  onChange={e => handleWeightChange(w.id, e.target.value)} />
                <span className="weight-unit">{settings.weightUnit}</span>
              </div>
              {weights.length > 1 && (
                <button className="remove-row-btn" onClick={() => removeRow(w.id)} title="删除此行">✕</button>
              )}
            </div>
          ))}
        </div>
        <button className="add-row-btn" onClick={addRow} disabled={weights.length >= settings.maxRows}>
          + 添加一行（{weights.length}/{settings.maxRows}）
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
          色粉添加比例
        </div>
        <div className="ratio-section">
          <div className="ratio-input-row">
            <span className="ratio-label">添加比例</span>
            <div className="ratio-input-wrap">
              <input type="text" inputMode="decimal" className="ratio-input"
                placeholder={`输入比例(${settings.ratioUnit})`}
                value={ratio} onChange={e => handleRatioChange(e.target.value)} />
              <span className="ratio-unit">{settings.ratioUnit}</span>
            </div>
          </div>
          {totalWeightRaw === 0 && (
            <div className="empty-hint">请先输入称重数据</div>
          )}
        </div>
      </div>

      {/* Result Card */}
      {ratioValue > 0 && totalWeightRaw > 0 && (
        <div className="result-card">
          <div className="card-title">
            <span className="card-title-icon">✅</span>
            色粉添加量
          </div>
          <div>
            <span className="result-value">{colorPowderAmount.toFixed(1)}</span>
            <span className="result-unit">{settings.resultUnit}</span>
          </div>
          <div className="result-formula">
            {totalWeightRaw.toFixed(settings.decimalPlaces)} {settings.weightUnit} × {ratioValue} {settings.ratioUnit} = {colorPowderAmount.toFixed(1)} {settings.resultUnit}
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
