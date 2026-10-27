import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * 全局错误边界：任何渲染期异常都在这里兜住，避免整页白屏。
 * 数据类崩溃（如历史记录结构异常）最常见，用户至少能重载或把错误信息发出来。
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleCopy = async () => {
    const { error } = this.state
    const text = `${error?.name ?? 'Error'}: ${error?.message ?? ''}\n${error?.stack ?? ''}`
    try {
      await navigator.clipboard.writeText(text)
      window.alert('错误信息已复制，可发给开发者排查')
    } catch {
      window.alert('复制失败，请截图此页面')
    }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="app safe-top">
        <div className="card">
          <div className="card-title">
            <span className="card-title-icon">⚠️</span>
            页面出错了
          </div>
          <div className="empty-state">
            <span className="empty-icon">🛠️</span>
            <p>遇到未预期的问题，数据仍在设备本地，不会丢失</p>
            <p className="empty-sub">{error.message || '未知错误'}</p>
          </div>
          <div className="backup-actions">
            <button className="btn btn-primary btn-sm" onClick={this.handleReload}>重新加载</button>
            <button className="btn btn-outline btn-sm" onClick={this.handleCopy}>复制错误信息</button>
          </div>
        </div>
      </div>
    )
  }
}
