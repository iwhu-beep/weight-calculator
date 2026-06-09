import { useState, useCallback, useEffect, useRef } from 'react'

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
}

interface Settings {
  soundEnabled: boolean
  decimalPlaces: number
}

const DEFAULT_WEIGHTS: WeightEntry[] = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, value: '' }))

function loadSettings(): Settings {
  try {
    const saved = localStorage.getItem('wc_settings')
    if (saved) return JSON.parse(saved)
  } catch { /* ignore */ }
  return { soundEnabled: true, decimalPlaces: 2 }
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

// 生成按键音
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

type Page = 'home' | 'settings' | 'history'

function App() {
  const [page, setPage] = useState<Page>('home')
  const [weights, setWeights] = useState<WeightEntry[]>(DEFAULT_WEIGHTS)
  const [ratio, setRatio] = useState('')
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [history, setHistory] = useState<HistoryRecord[]>(loadHistory)
  const nextIdRef = useRef(11)

  const totalWeight = weights.reduce((sum, w) => sum + (parseFloat(w.value) || 0), 0)
  const filledCount = weights.filter(w => w.value !== '').length
  const ratioValue = parseFloat(ratio) || 0
  const colorPowderAmount = totalWeight * ratioValue

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  const handleKeySound = useCallback(() => {
    if (settings.soundEnabled) playKeySound()
  }, [settings.soundEnabled])

  const handleWeightChange = useCallback((id: number, value: string) => {
    if (value !== '' && !/^\d*\.?\d*$/.test(value)) return
    handleKeySound()
    setWeights(prev => prev.map(w => w.id === id ? { ...w, value } : w))
  }, [handleKeySound])

  const handleRatioChange = useCallback((value: string) => {
    if (value !== '' && !/^\d*\.?\d*$/.test(value)) return
    handleKeySound()
    setRatio(value)
  }, [handleKeySound])

  const addRow = useCallback(() => {
    if (weights.length >= 20) return
    setWeights(prev => [...prev, { id: nextIdRef.current++, value: '' }])
  }, [weights.length])

  const removeRow = useCallback((id: number) => {
    if (weights.length <= 1) return
    setWeights(prev => prev.filter(w => w.id !== id))
  }, [weights.length])

  const resetAll = useCallback(() => {
    setWeights(DEFAULT_WEIGHTS.map(w => ({ ...w })))
    nextIdRef.current = 11
    setRatio('')
  }, [])

  const saveRecord = useCallback(() => {
    if (filledCount === 0) return
    const record: HistoryRecord = {
      id: Date.now().toString(),
      date: new Date().toLocaleString('zh-CN'),
      weights: weights.map(w => w.value),
      totalWeight,
      ratio: ratioValue,
      colorPowderAmount,
    }
    const newHistory = [record, ...history]
    setHistory(newHistory)
    saveHistory(newHistory)
  }, [weights, totalWeight, ratioValue, colorPowderAmount, filledCount, history])

  const loadRecord = useCallback((record: HistoryRecord) => {
    setWeights(record.weights.map((v, i) => ({ id: i + 1, value: v })))
    nextIdRef.current = record.weights.length + 1
    setRatio(record.ratio > 0 ? record.ratio.toString() : '')
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

  // 设置页面
  if (page === 'settings') {
    return (
      <div className="app">
        <div className="page-header">
          <button className="back-btn" onClick={() => setPage('home')}>← 返回</button>
          <h2>设置</h2>
          <div style={{ width: 60 }} />
        </div>

        <div className="card">
          <div className="card-title">
            <span className="card-title-icon">🔊</span>
            声音设置
          </div>
          <div className="setting-row">
            <div>
              <div className="setting-label">按键声音</div>
              <div className="setting-desc">输入数字时播放按键音效</div>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.soundEnabled}
                onChange={e => setSettings(prev => ({ ...prev, soundEnabled: e.target.checked }))}
              />
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
              <button
                className="stepper-btn"
                onClick={() => setSettings(prev => ({ ...prev, decimalPlaces: Math.max(0, prev.decimalPlaces - 1) }))}
              >−</button>
              <span className="stepper-value">{settings.decimalPlaces}</span>
              <button
                className="stepper-btn"
                onClick={() => setSettings(prev => ({ ...prev, decimalPlaces: Math.min(4, prev.decimalPlaces + 1) }))}
              >+</button>
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
              <span>v1.1.0</span>
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
      <div className="app">
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
                  <button
                    className="remove-row-btn"
                    onClick={e => { e.stopPropagation(); deleteRecord(record.id) }}
                    title="删除记录"
                  >✕</button>
                </div>
                <div className="history-body">
                  <div className="history-item">
                    <span className="history-item-label">总重量</span>
                    <span className="history-item-value">{record.totalWeight.toFixed(settings.decimalPlaces)} kg</span>
                  </div>
                  {record.ratio > 0 && (
                    <div className="history-item">
                      <span className="history-item-label">添加比例</span>
                      <span className="history-item-value">{record.ratio} ‰</span>
                    </div>
                  )}
                  {record.colorPowderAmount > 0 && (
                    <div className="history-item">
                      <span className="history-item-label">色粉添加量</span>
                      <span className="history-item-value highlight">{record.colorPowderAmount.toFixed(1)} g</span>
                    </div>
                  )}
                </div>
                <div className="history-weight-tags">
                  {record.weights.filter(w => w !== '').map((w, i) => (
                    <span key={i} className="weight-tag">{w}kg</span>
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
    <div className="app">
      {/* Header */}
      <div className="header">
        <h1>
          <span className="header-icon">⚖️</span>
          称重色粉计算器
        </h1>
        <p>记录称重数据 · 计算色粉添加量</p>
        <div className="header-actions">
          <button className="header-btn" onClick={() => setPage('history')} title="历史记录">
            📋
          </button>
          <button className="header-btn" onClick={() => setPage('settings')} title="设置">
            ⚙️
          </button>
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
                <input
                  type="text"
                  inputMode="decimal"
                  className={`weight-input ${w.value !== '' ? 'weight-input-filled' : ''}`}
                  placeholder="输入重量"
                  value={w.value}
                  onChange={e => handleWeightChange(w.id, e.target.value)}
                />
                <span className="weight-unit">kg</span>
              </div>
              {weights.length > 1 && (
                <button
                  className="remove-row-btn"
                  onClick={() => removeRow(w.id)}
                  title="删除此行"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          className="add-row-btn"
          onClick={addRow}
          disabled={weights.length >= 20}
        >
          + 添加一行（{weights.length}/20）
        </button>
      </div>

      {/* Total Weight Card */}
      <div className="total-card">
        <div className="card-title">
          <span className="card-title-icon">📊</span>
          总重量
        </div>
        <div>
          <span className="total-value">{totalWeight.toFixed(settings.decimalPlaces)}</span>
          <span className="total-unit">kg</span>
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
              <input
                type="text"
                inputMode="decimal"
                className="ratio-input"
                placeholder="输入比例"
                value={ratio}
                onChange={e => handleRatioChange(e.target.value)}
              />
              <span className="ratio-unit">‰</span>
            </div>
          </div>
          {totalWeight === 0 && (
            <div className="empty-hint">请先输入称重数据</div>
          )}
        </div>
      </div>

      {/* Result Card */}
      {ratioValue > 0 && totalWeight > 0 && (
        <div className="result-card">
          <div className="card-title">
            <span className="card-title-icon">✅</span>
            色粉添加量
          </div>
          <div>
            <span className="result-value">{colorPowderAmount.toFixed(1)}</span>
            <span className="result-unit">g</span>
          </div>
          <div className="result-formula">
            计算公式：{totalWeight.toFixed(settings.decimalPlaces)} kg × {ratioValue} ‰ = {colorPowderAmount.toFixed(1)} g
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
