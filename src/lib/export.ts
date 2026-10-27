import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'

/**
 * 保存文本文件。
 * 原生 App：写入缓存目录后调起系统分享面板（iOS 选「存储到文件」即可导出）。
 * 网页端：直接触发浏览器下载。
 * 返回 false 表示两种方式都失败，由调用方决定降级方案。
 */
export async function saveTextFile(filename: string, text: string, mime: string): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    try {
      await Filesystem.writeFile({
        path: filename,
        data: text,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      })
      const { uri } = await Filesystem.getUri({ directory: Directory.Cache, path: filename })
      await Share.share({
        title: filename,
        files: [uri],
        dialogTitle: '导出文件',
      })
      return true
    } catch (err) {
      // WKWebView 不支持 a[download]，原生分享失败时直接交给调用方降级
      console.warn('native share failed', err)
      return false
    }
  }

  try {
    const blob = new Blob([text], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  } catch (err) {
    console.warn('download failed', err)
    return false
  }
}
