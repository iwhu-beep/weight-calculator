import { BATCH_WINDOW_MS } from '../constants'
import type { HistoryRecord, RecipeItem, ResultUnit, RatioUnit, WeightUnit } from '../types'

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
export function calcColorPowder(
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

// 记录内容签名，用于自动保存去重：内容完全相同则不重复保存
export function recordSignature(r: HistoryRecord): string {
  return JSON.stringify([
    r.weights,
    r.recipe.map(p => [p.name, p.ratio, p.amount]),
    r.totalWeight,
    r.weightUnit,
    r.ratioUnit,
    r.resultUnit,
  ])
}

// 同批次判定：单位一致、配方组合一致、且最新记录在时间窗口内
export function isSameBatch(latest: HistoryRecord, current: HistoryRecord): boolean {
  if (
    latest.weightUnit !== current.weightUnit ||
    latest.ratioUnit !== current.ratioUnit ||
    latest.resultUnit !== current.resultUnit
  ) return false
  const recipeSig = (r: RecipeItem[]) => r.map(p => `${p.name}|${p.ratio}`).join(',')
  if (recipeSig(latest.recipe) !== recipeSig(current.recipe)) return false
  const latestAt = latest.savedAt ?? 0
  if (Date.now() - latestAt > BATCH_WINDOW_MS) return false
  return true
}
