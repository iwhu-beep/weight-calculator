import { describe, expect, it } from 'vitest'
import { buildHistoryCsv } from './csv'
import { ratioToPermille, sumRatioPermille } from './calc'
import type { HistoryRecord } from '../types'

const base: HistoryRecord = {
  id: 'r1',
  date: '2026/10/27 10:00:00',
  savedAt: Date.parse('2026-10-27T10:00:00'),
  weights: ['100', '50'],
  totalWeight: 150,
  recipe: [
    { name: '红粉', ratio: 5, amount: 750 },
    { name: '黄粉', ratio: 2.5, amount: 375 },
  ],
  totalPowderAmount: 1125,
  weightUnit: 'kg',
  ratioUnit: '‰',
  resultUnit: 'g',
}

describe('buildHistoryCsv', () => {
  it('带 BOM 与表头', () => {
    const csv = buildHistoryCsv([base], 2)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv.split('\r\n')[0]).toContain('记录时间,总重量,重量单位')
  })

  it('每种色粉一行', () => {
    const lines = buildHistoryCsv([base], 2).replace('\uFEFF', '').split('\r\n')
    expect(lines).toHaveLength(3) // 表头 + 2 种色粉
    expect(lines[1]).toContain('红粉')
    expect(lines[2]).toContain('黄粉')
  })

  it('按小数位设置格式化数值', () => {
    const lines = buildHistoryCsv([base], 1).replace('\uFEFF', '').split('\r\n')
    expect(lines[1]).toContain('150.0')
    expect(lines[1]).toContain('750.0')
  })

  it('目标反算记录带备注', () => {
    const csv = buildHistoryCsv([{ ...base, targetWeight: 150 }], 2)
    expect(csv).toContain('目标反算')
  })

  it('转义逗号与引号', () => {
    const tricky: HistoryRecord = {
      ...base,
      recipe: [{ name: '红,粉"特"', ratio: 5, amount: 750 }],
      totalPowderAmount: 750,
    }
    const lines = buildHistoryCsv([tricky], 2).replace('\uFEFF', '').split('\r\n')
    expect(lines[1]).toContain('"红,粉""特"""')
  })
})

describe('比例合计', () => {
  it('‰ 原样返回，% 乘 10', () => {
    expect(ratioToPermille(5, '‰')).toBe(5)
    expect(ratioToPermille(0.5, '%')).toBe(5)
  })

  it('合计用于超阈值提示', () => {
    expect(sumRatioPermille([5, 2.5], '‰')).toBe(7.5)
    expect(sumRatioPermille([10, 10], '%')).toBe(200)
  })
})
