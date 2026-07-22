// 平台分流的文件保存（D10 修复核心）。
// Android WebView 中 <a download>.click() 程序化下载不可靠，故按能力降级：
//   1. Web Share API with files（Android WebView 支持，拉起系统分享/保存面板，体验最佳）
//   2. @capacitor/filesystem 写入 Directory.Documents/AiJi/<name>（原生壳公开目录，文件管理器可见）
//   3. Web PWA fallback：<a download>.click()（桌面浏览器仍可靠）
//
// saveBlob 返回 SaveResult，让调用方按 method/path 给出针对性反馈。
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'

export interface SaveResult {
  ok: boolean
  method: 'share' | 'filesystem' | 'download' | 'none'
  path?: string // 保存路径（filesystem 方式返回 content/file uri）
  error?: string
}

// canShareFiles(): Web Share API with files 是否可用。Android WebView + secure context
// (Capacitor androidScheme:https) 下可用；桌面 Chrome 多无 canShare（返回 false → 走 download）。
// 不能只检查 navigator.share——某些环境有 share 但不支持 files 字段；canShare({files}) 才是
// 严格 gate。但部分 Android WebView 只暴露 share 不暴露 canShare——saveBlob 里再兜一次。
export function canShareFiles(): boolean {
  if (typeof navigator === 'undefined') return false
  if (typeof File === 'undefined') return false
  const nav = navigator as unknown as { share?: unknown; canShare?: unknown }
  return typeof nav.share === 'function'
}

// blob → base64（去 data: 前缀）。Filesystem.writeFile 原生端只接受 base64 字符串（Web 端
// 才接 Blob）。读 media 可能较大，但导出 zip 通常 < 100MB，base64 内存成本可接受。
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const r = reader.result
      if (typeof r !== 'string') {
        reject(new Error('FileReader 返回非字符串'))
        return
      }
      const comma = r.indexOf(',')
      resolve(comma >= 0 ? r.slice(comma + 1) : r)
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader 失败'))
    reader.readAsDataURL(blob)
  })
}

// 保存 Blob 到用户可访问的位置。按平台能力降级，详见文件头注释。
export async function saveBlob(blob: Blob, suggestedName: string): Promise<SaveResult> {
  // 1. Web Share API with files
  if (canShareFiles()) {
    try {
      const file = new File([blob], suggestedName, {
        type: blob.type || 'application/octet-stream',
      })
      const shareData = { files: [file] }
      const nav = navigator as unknown as {
        canShare?: (d?: { files?: File[] }) => boolean
        share?: (d: { files: File[] }) => Promise<void>
      }
      const canShareOk = typeof nav.canShare === 'function' ? nav.canShare(shareData) : true
      if (canShareOk && typeof nav.share === 'function') {
        await nav.share(shareData)
        return { ok: true, method: 'share' }
      }
    } catch (e) {
      // 用户取消分享面板——不算失败也不算成功，返回 none 让 UI 静默处理。
      // 哨兵 'CANCELLED' 是协议值非文案（i18n：不做本地化，UI 按 === 比较拦截）。
      if (e instanceof DOMException && e.name === 'AbortError') {
        return { ok: false, method: 'none', error: 'CANCELLED' }
      }
      // 其他错误 → 降级到 filesystem/download
    }
  }

  // 2. Capacitor 原生壳：写文件到公开 Documents 目录
  if (Capacitor.isNativePlatform()) {
    try {
      const base64 = await blobToBase64(blob)
      const path = `AiJi/${suggestedName}`
      const writeResult = await Filesystem.writeFile({
        path,
        data: base64,
        directory: Directory.Documents,
        recursive: true,
      })
      // getUri 返回 file:// content URI，对用户更可读（文件管理器路径）。
      let uri = writeResult.uri
      try {
        const uriResult = await Filesystem.getUri({ path, directory: Directory.Documents })
        uri = uriResult.uri
      } catch {
        // getUri 失败时沿用 writeFile 返回的 uri
      }
      return { ok: true, method: 'filesystem', path: uri }
    } catch (e) {
      return {
        ok: false,
        method: 'none',
        error: e instanceof Error ? e.message : String(e),
      }
    }
  }

  // 3. Web PWA fallback：<a download>.click()
  try {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = suggestedName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    return { ok: true, method: 'download' }
  } catch (e) {
    return {
      ok: false,
      method: 'none',
      error: e instanceof Error ? e.message : String(e),
    }
  }
}
