import type { Settings } from '@/domain/types'
import { di } from './di'
import { seedSettings } from '@/data/seed'

// DEV-only convenience: seed BYOK keys/URLs/models from .env.local into
// SecretStore(localStorage 'llm:key'/'stt:key') + Settings(Dexie) on boot, so
// any device loading the dev bundle (e.g. phone over a cloudflared tunnel)
// auto-gets the keys without manual entry on each device. `.env.local` is
// gitignored (`*.local`) → never pushed; and this whole path is DEV-gated so
// production builds never inline keys into the live path (still, drop
// `.env.local` before any real deploy).
//
// Idempotent seed-once: keys/settings are written only when absent / still at
// seed default — a value the user later sets via the Settings UI sticks and is
// not clobbered on reboot. To rotate a key, clear it in Settings UI (or wipe
// the device's localStorage) and reboot the dev server.
export async function seedDevDefaults(): Promise<void> {
  if (!import.meta.env.DEV) return
  const llmKey = import.meta.env.VITE_LLM_KEY as string | undefined
  const sttKey = import.meta.env.VITE_STT_KEY as string | undefined
  const llmUrl = import.meta.env.VITE_LLM_URL as string | undefined
  const llmModel = import.meta.env.VITE_LLM_MODEL as string | undefined
  const sttModel = import.meta.env.VITE_STT_MODEL as string | undefined
  if (!llmKey && !sttKey && !llmUrl && !llmModel && !sttModel) return

  if (llmKey) {
    const existing = await di.secrets.get('llm:key')
    if (!existing) await di.secrets.set('llm:key', llmKey)
  }
  if (sttKey) {
    const existing = await di.secrets.get('stt:key')
    if (!existing) await di.secrets.set('stt:key', sttKey)
  }

  const s = await di.storage.getSettings()
  const patch: Partial<Settings> = {}
  if (llmUrl && s.llmUrl === seedSettings.llmUrl) patch.llmUrl = llmUrl
  if (llmModel && s.llmModel === seedSettings.llmModel) patch.llmModel = llmModel
  if (sttModel && s.sttModel === seedSettings.sttModel) patch.sttModel = sttModel
  if (llmKey && !s.apiKeyRef) patch.apiKeyRef = 'llm:key'
  if (sttKey && !s.sttKeyRef) patch.sttKeyRef = 'stt:key'
  if (Object.keys(patch).length > 0) await di.storage.saveSettings({ ...s, ...patch })
}
