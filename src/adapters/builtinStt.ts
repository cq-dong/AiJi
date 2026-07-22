// src/adapters/builtinStt.ts
// Slice B 内置 key 代理 STT 适配器：实现 SttPort，所有调用代理到后端 POST /api/stt/transcribe。
// 后端注入真实 STT key 并扣配额；前端只持 JWT（network 账号会话）。
// 与 paraformerStreamStt/whisperRestStt（BYOK）共存——后续 sttProxy 按 settings.keySource 路由。
//
// 流程（镜像 builtinLlm.chat 的 JWT-refresh-retry）：assertNetwork → getMedia →
// session 检查 → FormData POST（Authorization: Bearer <jwt>）→ 401 refresh 重试一次 →
// 成功 bumpStt 配额 → 返回 trim 后的 text。
import type { SttPort } from '@/ports'
import { SessionExpiredError, NotNetworkError } from '@/ports'
import { di } from '@/app/di'
import { localSession } from '@/app/session'
import { useAccountStore } from '@/app/accountStore'
import { useQuotaStore } from '@/app/quotaStore'

const BASE = import.meta.env.VITE_AIJI_BACKEND_BASE ?? ''

export const builtinStt: SttPort = {
  async transcribe(ref) {
    const a = useAccountStore.getState().account
    if (!a || a.type !== 'network') throw new NotNetworkError()
    const blob = await di.storage.getMedia(ref)
    if (!blob) throw new Error('音频 blob 未找到: ' + ref)
    const session = localSession.get()
    if (!session) throw new SessionExpiredError()

    const doFetch = (jwt: string) => {
      const form = new FormData()
      form.append('file', blob, 'audio.webm')
      return fetch(`${BASE}/api/stt/transcribe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}` },
        body: form,
      })
    }

    let res = await doFetch(session.jwt)
    if (res.status === 401) {
      let newSession
      try {
        newSession = await di.auth.refresh()
        localSession.set(newSession)
      } catch {
        localSession.clear()
        throw new SessionExpiredError()
      }
      res = await doFetch(newSession.jwt)
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`builtinStt HTTP ${res.status}: ${t.slice(0, 200)}`)
    }
    // 乐观递增：前端不知实际时长，按保守 5 秒计（后端按 wav 字节估的真实 duration 扣权威值，
    // 下次 quotaStore.refresh 修正显示）。
    useQuotaStore.getState().consume('stt', 5)
    // 服务端契约 c.json({text})——必须按 JSON 解析；按纯文本读会把 '{"text":"..."}' 写进条目正文。
    const data = (await res.json().catch(() => null)) as { text?: string } | null
    if (!data || typeof data.text !== 'string') throw new Error('builtinStt 响应格式异常')
    return data.text.trim()
  },
}
