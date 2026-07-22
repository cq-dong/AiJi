// 内存级 IP rate limit（单机够用，MVP 不引 redis）。
// 滑动窗口：每 IP 在 windowMs 内最多 max 次。超限返 429。
const buckets = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (b.count >= max) return false
  b.count++
  return true
}

// 周期清理过期 bucket 防 memory leak（启动时 setInterval）。
let cleanerStarted = false
export function startRateLimitCleaner(): void {
  if (cleanerStarted) return
  cleanerStarted = true
  setInterval(() => {
    const now = Date.now()
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k)
    }
  }, 60_000).unref()
}
