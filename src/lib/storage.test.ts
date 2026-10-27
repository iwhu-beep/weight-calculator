import { describe, expect, it } from 'vitest'
import { sanitizeSettings } from './storage'
import { DEFAULT_SETTINGS } from '../constants'

describe('sanitizeSettings', () => {
  it('空对象回退默认值', () => {
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS)
  })

  it('保留合法的目标反算开关', () => {
    expect(sanitizeSettings({ targetModeEnabled: false }).targetModeEnabled).toBe(false)
    expect(sanitizeSettings({ targetModeEnabled: true }).targetModeEnabled).toBe(true)
  })

  it('非法开关回退默认值', () => {
    expect(sanitizeSettings({ targetModeEnabled: 'yes' }).targetModeEnabled)
      .toBe(DEFAULT_SETTINGS.targetModeEnabled)
  })

  it('数值字段钳制到边界', () => {
    const s = sanitizeSettings({ decimalPlaces: 99, maxRows: 999, initialRows: 999, voiceRate: 9 })
    expect(s.decimalPlaces).toBe(4)
    expect(s.maxRows).toBe(50)
    expect(s.initialRows).toBe(50)
    expect(s.voiceRate).toBe(2)
  })

  it('非法单位回退默认值', () => {
    const s = sanitizeSettings({ weightUnit: 'lb', ratioUnit: 'x', resultUnit: 'ton' })
    expect(s.weightUnit).toBe('kg')
    expect(s.ratioUnit).toBe('‰')
    expect(s.resultUnit).toBe('g')
  })
})
