import type { HistoryRecord } from '../types'

interface HistoryPageProps {
  history: HistoryRecord[]
  decimalPlaces: number
  loadRecord: (record: HistoryRecord) => void
  deleteRecord: (id: string) => void
  clearHistory: () => void
  onBack: () => void
}

export default function HistoryPage({
  history,
  decimalPlaces,
  loadRecord,
  deleteRecord,
  clearHistory,
  onBack,
}: HistoryPageProps) {
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
          <div className="history-actions">
            <span className="history-count">共 {history.length} 条记录 · 点击卡片回填</span>
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
                  <span className="history-item-value">{record.totalWeight.toFixed(decimalPlaces)} {record.weightUnit || 'kg'}</span>
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
