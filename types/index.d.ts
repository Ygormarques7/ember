export type Pulse = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  live: number
  rate: number
  requests: number
  model: string | null
  contextTokens: number | null
  contextWindow: number | null
  contextPercent: number | null
  usd: number | null
  limits: { kind: string; percentUsed: number }[]
}

declare module 'claude-code' {
  interface PluginState {
    'token-pulse': { pulse: Pulse }
  }
}
