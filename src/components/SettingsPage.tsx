import { useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { RATIO_UNITS, RESULT_UNITS, WEIGHT_UNITS } from '../types'
import type { Settings, VoiceOption } from '../types'
import pkg from '../../package.json'

interface SettingsPageProps {
  settings: Settings
  setSettings: Dispatch<SetStateAction<Settings>>
  voices: VoiceOption[]
  voicesLoaded: boolean
  testVoice: () => void
  exportBackup: () => void
  importBackup: (file: File) => void
  onBack: () => void
}

export default function SettingsPage({
  settings,
  setSettings,
  voices,
  voicesLoaded,
  testVoice,
  exportBackup,
  importBackup,
  onBack,
}: SettingsPageProps) {
  const backupFileRef = useRef<HTMLInputElement | null>(null)

  return (
    <div className="app safe-top">
      <div className="page-header">
        <button className="back-btn" onClick={onBack}>← 返回</button>
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
          <span className="card-title-icon">🎨</span>
          外观设置
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-label">深色模式</div>
            <div className="setting-desc">跟随系统或手动切换明暗主题</div>
          </div>
          <div className="unit-toggle-group">
            {([['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']] as const).map(([key, label]) => (
              <button key={key} className={`unit-btn ${settings.darkMode === key ? 'unit-btn-active' : ''}`}
                onClick={() => setSettings(prev => ({ ...prev, darkMode: key }))}>{label}</button>
            ))}
          </div>
        </div>
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
          <span className="card-title-icon">💾</span>
          数据备份
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-label">导出备份</div>
            <div className="setting-desc">App 内调起系统分享面板导出文件，网页直接下载</div>
          </div>
        </div>
        <div className="backup-actions">
          <button className="btn btn-primary btn-sm" onClick={exportBackup}>导出配置</button>
          <button className="btn btn-outline btn-sm" onClick={() => backupFileRef.current?.click()}>导入配置</button>
          <input ref={backupFileRef} type="file" accept="application/json,.json" className="backup-file-input"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) importBackup(f)
              e.target.value = ''
            }} />
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
