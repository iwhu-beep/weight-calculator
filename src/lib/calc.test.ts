import { describe, expect, it } from 'vitest'
import { calcColorPowder, convertWeight, isSameBatch } from './calc'
import { normalizeHistoryRecord, normalizePreset } from './storage'
import type { HistoryRecord } from '../types'

function makeRecord(over: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    id: 'r1',
    date: '2026/10/27 10:00:00',
    savedAt: Date.now(),
    weights: ['100'],
    totalWeight: 100,
    recipe: [{ name: 'A', ratio: 5, amount: 500 }],
    totalPowderAmount: 500,
    weightUnit: 'kg',
    ratioUnit: '‰',
    resultUnit: 'g',
    ...over,
  }
}

describe('calcColorPowder', () => {
  it('100kg × 5‰ = 500g', () => {
    expect(calcColorPowder(100, 5, 'kg', '‰', 'g')).toBe(500)
  })

  it('按结果单位换算', () => {
    expect(calcColorPowder(100, 5, 'kg', '‰', 'mg')).toBe(500_000)
    expect(calcColorPowder(100, 5, 'kg', '‰', 'kg')).toBe(0.5)
  })

  it('g 与 % 单位归一', () => {
    // 100000g = 100kg；0.5% = 5‰ → 500g
    expect(calcColorPowder(100_000, 0.5, 'g', '%', 'g')).toBe(500)
  })
})

describe('convertWeight', () => {
  it('kg↔g 往返不产生浮点噪声', () => {
    expect(convertWeight('1.25', 'kg', 'g')).toBe('1250')
    expect(convertWeight('1250', 'g', 'kg')).toBe('1.25')
  })

  it('空值与非法值原样返回', () => {
    expect(convertWeight('', 'kg', 'g')).toBe('')
    expect(convertWeight('abc', 'kg', 'g')).toBe('abc')
  })
})

describe('isSameBatch', () => {
  const base = makeRecord({ batchId: 'B1' })

  it('同批次即使超过时间窗口仍合并', () => {
    const latest = makeRecord({ batchId: 'B1', savedAt: Date.now() - 60 * 60 * 1000 })
    expect(isSameBatch(latest, base)).toBe(true)
  })

  it('不同批次一律不合并（防止新批次覆盖上一条记录）', () => {
    const latest = makeRecord({ batchId: 'B1' })
    const next = makeRecord({ batchId: 'B2', weights: ['120'], totalWeight: 120 })
    expect(isSameBatch(latest, next)).toBe(false)
  })

  it('旧记录无 batchId 时退化为时间窗口判定', () => {
    const fresh = makeRecord({ batchId: undefined })
    const stale = makeRecord({ batchId: undefined, savedAt: Date.now() - 60 * 60 * 1000 })
    const current = makeRecord({ batchId: undefined })
    expect(isSameBatch(fresh, current)).toBe(true)
    expect(isSameBatch(stale, current)).toBe(false)
  })

  it('配方不同不合并', () => {
    const other = makeRecord({ batchId: 'B1', recipe: [{ name: 'B', ratio: 5, amount: 500 }] })
    expect(isSameBatch(base, other)).toBe(false)
  })
})

describe('normalizeHistoryRecord', () => {
  it('迁移 v1.4 之前的单比例记录', () => {
    const legacy = { id: 'x', date: '2026/1/1', weights: ['10'], totalWeight: 10, ratio: 3, colorPowderAmount: 30 }
    const r = normalizeHistoryRecord(legacy)
    expect(r).not.toBeNull()
    expect(r!.recipe).toEqual([{ name: '', ratio: 3, amount: 30 }])
    expect(r!.totalPowderAmount).toBe(30)
  })

  it('缺 recipe 字段的记录不会让渲染崩溃', () => {
    const broken = { id: 'x', weights: ['10'], totalWeight: 10 }
    const r = normalizeHistoryRecord(broken)
    expect(r).not.toBeNull()
    expect(Array.isArray(r!.recipe)).toBe(true)
    expect(typeof r!.totalWeight).toBe('number')
  })

  it('数值字段非法时回退为 0，字符串数组做类型过滤', () => {
    const dirty = {
      id: 'x', weights: ['10', 20, null], totalWeight: 'abc',
      recipe: [{ name: 'A', ratio: 'oops', amount: undefined }],
    }
    const r = normalizeHistoryRecord(dirty)!
    expect(r.totalWeight).toBe(0)
    expect(r.weights).toEqual(['10', '', ''])
    expect(r.recipe[0]).toEqual({ name: 'A', ratio: 0, amount: 0 })
  })

  it('完全无效的输入返回 null', () => {
    expect(normalizeHistoryRecord(null)).toBeNull()
    expect(normalizeHistoryRecord({ id: 'x' })).toBeNull()
    expect(normalizeHistoryRecord('nope')).toBeNull()
  })
})

describe('normalizePreset', () => {
  it('过滤掉比例非法的条目', () => {
    const p = normalizePreset({ id: 'p1', name: '配方A', recipe: [{ name: 'A', ratio: 2 }, { name: 'B' }], createdAt: 1 })
    expect(p!.recipe).toEqual([{ name: 'A', ratio: 2 }, { name: 'B', ratio: 0 }])
  })

  it('配方为空则丢弃', () => {
    expect(normalizePreset({ id: 'p1', name: 'x', recipe: [] })).toBeNull()
  })
})
