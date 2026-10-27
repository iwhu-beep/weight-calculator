import { useMemo, useState } from 'react'
import type { HistoryRecord } from '../types'

interface HistoryPageProps {
  history: HistoryRecord[]
  decimalPlaces: number
  loadRecord: (record: HistoryRecord) => void
  deleteRecord: (id: string) => void
  clearHistory: () => void
  exportHistoryCsv: () => void
  onBack: () => void
}

// 记录所属日期：优先用 savedAt，缺失时回退解析 date 字符串
function dayKey(record: HistoryRecord): string {
  if (typeof record.savedAt === 'number' && Number.isFinite(record.savedAt)) {
    const d = new Date(record.savedAt)
    const month = `${d.getMonth() + 1}`.padStart(2, '0')
    const day = `${d.getDate()}`.padStart(2, '0')
    return `${d.getFullYear()}-${month}-${day}`
  }
  return record.date.split(' ')[0] || '未知日期'
}

// 关键字匹配：日期、色粉名称、称重数值、总重量
function matchesKeyword(record: HistoryRecord, keyword: string): boolean {
  const k = keyword.trim().toLowerCase()
  if (!k) return true
  if (record.date.toLowerCase().includes(k)) return true
  if (record.recipe.some(p => p.name.toLowerCase().includes(k))) return true
  if (record.weights.some(w => w.includes(k))) return true
  if (String(record.totalWeight).includes(k)) return true
  return false
}

export default function HistoryPage({
  history,
  decimalPlaces,
  loadRecord,
  deleteRecord,
  clearHistory,
  exportHistoryCsv,
  onBack,
}: HistoryPageProps) {
  const [keyword, setKeyword] = useState('')

  const filtered = useMemo(
    () => history.filter(r => matchesKeyword(r, keyword)),
    [history, keyword]
  )

  // 按日期分组，保持时间倒序（history 本身已是最新在前）
  const groups = useMemo(() => {
    const map = new Map<string, HistoryRecord[]>()
    for (const record of filtered) {
      const key = dayKey(record)
      const list = map.get(key)
      if (list) list.push(record)
      else map.set(key, [record])
    }
    return Array.from(map.entries())
  }, [filtered])

  return (
    <div className="app safe-top">
      <div className="page-header">
        <button className="back-btn" onClick={onBack}>← 返回</button>
        <h2>历史记录</h2>
        <div style={{ width: 60 }} />
      </div>

      {history.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <span className="empty-icon">📋</span>
            <p>暂无历史记录</p>
            <p className="empty-sub">配比结果有效时会自动保存，无需手动操作</p>
          </div>
        </div>
      ) : (
        <>
          <div className="history-search">
            <input
              className="history-search-input"
              type="search"
              placeholder="搜索色粉名称、日期或重量"
              value={keyword}
              onChange={e => setKeyword(e.target.value)} />
            {keyword !== '' && (
              <button className="history-search-clear" onClick={() => setKeyword('')} title="清除搜索">✕</button>
            )}
          </div>

          <div className="history-actions">
            <span className="history-count">
              {keyword === ''
                ? `共 ${history.length} 条记录 · 点击卡片回填`
                : `找到 ${filtered.length} / ${history.length} 条 · 点击卡片回填`}
            </span>
            <div className="history-actions-right">
              <button className="btn-clear" onClick={exportHistoryCsv}>导出 CSV</button>
              <button className="btn-clear" onClick={clearHistory}>清空全部</button>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <span className="empty-icon">🔍</span>
                <p>没有匹配的记录</p>
                <p className="empty-sub">换个色粉名称、日期或重量试试</p>
              </div>
            </div>
          ) : (
            groups.map(([day, records]) => (
              <div key={day} className="history-group">
                <div className="history-group-title">{day} · {records.length} 条</div>
                {records.map(record => (
                  <div key={record.id} className="card history-card" onClick={() => loadRecord(record)}>
                    <div className="history-header">
                      <span className="history-date">
                        {record.date}
                        {typeof record.targetWeight === 'number' && record.targetWeight > 0 && (
                          <span className="history-target-tag">目标反算</span>
                        )}
                      </span>
                      <button className="remove-row-btn"
                        onClick={e => { e.stopPropagation(); deleteRecord(record.id) }} title="删除记录">✕</button>
                    </div>
                    <div className="history-body">
                      <div className="history-item">
                        <span className="history-item-label">总重量</span>
                        <span className="history-item-value">{record.totalWeight.toFixed(decimalPlaces)} {record.weightUnit || 'kg'}</span>
                      </div>
                      {record.recipe.map((p, i) => (
                        <div className="history-item" key={i}>
                          <span className="history-item-label">{p.name || `色粉${i + 1}`}</span>
                          <span className="history-item-value highlight">{p.amount.toFixed(decimalPlaces)} {record.resultUnit || 'g'}</span>
                        </div>
                      ))}
                      {record.recipe.length > 1 && record.totalPowderAmount > 0 && (
                        <div className="history-item">
                          <span className="history-item-label">合计</span>
                          <span className="history-item-value highlight">{record.totalPowderAmount.toFixed(decimalPlaces)} {record.resultUnit || 'g'}</span>
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
              </div>
            ))
          )}
        </>
      )}
    </div>
  )
}
