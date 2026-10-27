import type { HistoryRecord } from '../types'

// CSV 字段转义：含逗号/引号/换行时用双引号包裹，内部引号双写
function escapeField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * 把历史记录导出为 CSV（每种色粉一行），带 BOM 以便 Excel 正确识别中文。
 */
export function buildHistoryCsv(records: HistoryRecord[], decimalPlaces: number): string {
  const rows: string[][] = [
    ['记录时间', '总重量', '重量单位', '色粉名称', '比例', '比例单位', '添加量', '结果单位', '备注'],
  ]

  for (const r of records) {
    const note = typeof r.targetWeight === 'number' && r.targetWeight > 0 ? '目标反算' : ''
    const recipe = r.recipe.length > 0 ? r.recipe : [{ name: '', ratio: 0, amount: 0 }]
    for (const p of recipe) {
      rows.push([
        r.date,
        r.totalWeight.toFixed(decimalPlaces),
        r.weightUnit,
        p.name || '未命名',
        String(p.ratio),
        r.ratioUnit,
        p.amount.toFixed(decimalPlaces),
        r.resultUnit,
        note,
      ])
    }
  }

  // \uFEFF：Excel 打开 UTF-8 CSV 需要 BOM，否则中文乱码
  return '\uFEFF' + rows.map(row => row.map(escapeField).join(',')).join('\r\n')
}
