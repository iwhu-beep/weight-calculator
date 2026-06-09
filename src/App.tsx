import { useState, useCallback } from 'react'

interface WeightEntry {
  id: number
  value: string
}

function App() {
  const [weights, setWeights] = useState<WeightEntry[]>([
    { id: 1, value: '' },
    { id: 2, value: '' },
    { id: 3, value: '' },
    { id: 4, value: '' },
    { id: 5, value: '' },
    { id: 6, value: '' },
    { id: 7, value: '' },
    { id: 8, value: '' },
    { id: 9, value: '' },
    { id: 10, value: '' },
  ])
  const [ratio, setRatio] = useState('')
  const nextId = useState(11)[0]

  const totalWeight = weights.reduce((sum, w) => sum + (parseFloat(w.value) || 0), 0)
  const filledCount = weights.filter(w => w.value !== '').length
  const ratioValue = parseFloat(ratio) || 0
  const colorPowderAmount = totalWeight * ratioValue // kg × ‰ = g

  const handleWeightChange = useCallback((id: number, value: string) => {
    // 只允许数字和小数点
    if (value !== '' && !/^\d*\.?\d*$/.test(value)) return
    setWeights(prev => prev.map(w => w.id === id ? { ...w, value } : w))
  }, [])

  const handleRatioChange = useCallback((value: string) => {
    if (value !== '' && !/^\d*\.?\d*$/.test(value)) return
    setRatio(value)
  }, [])

  const addRow = useCallback(() => {
    if (weights.length >= 20) return
    setWeights(prev => [...prev, { id: nextId + prev.length, value: '' }])
  }, [weights.length, nextId])

  const removeRow = useCallback((id: number) => {
    if (weights.length <= 1) return
    setWeights(prev => prev.filter(w => w.id !== id))
  }, [weights.length])

  const resetAll = useCallback(() => {
    setWeights([
      { id: 1, value: '' },
      { id: 2, value: '' },
      { id: 3, value: '' },
      { id: 4, value: '' },
      { id: 5, value: '' },
      { id: 6, value: '' },
      { id: 7, value: '' },
      { id: 8, value: '' },
      { id: 9, value: '' },
      { id: 10, value: '' },
    ])
    setRatio('')
  }, [])

  return (
    <div className="app">
      {/* Header */}
      <div className="header">
        <h1>
          <span className="header-icon">⚖️</span>
          称重色粉计算器
        </h1>
        <p>记录称重数据 · 计算色粉添加量</p>
      </div>

      {/* Weight Input Card */}
      <div className="card">
        <div className="card-title">
          <span className="card-title-icon">📦</span>
          称重数据录入
        </div>
        <div className="weight-rows">
          {weights.map((w, index) => (
            <div key={w.id} className="weight-row">
              <span className="weight-label">第{index + 1}次</span>
              <div className="weight-input-wrap">
                <input
                  type="text"
                  inputMode="decimal"
                  className="weight-input"
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
          <span className="total-value">{totalWeight.toFixed(2)}</span>
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
            计算公式：{totalWeight.toFixed(2)} kg × {ratioValue} ‰ = {colorPowderAmount.toFixed(1)} g
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="actions">
        <button className="btn btn-outline" onClick={resetAll}>
          重置数据
        </button>
      </div>
    </div>
  )
}

export default App
