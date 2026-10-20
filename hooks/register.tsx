import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { Pulse } from '../types'

const empty: Pulse = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  live: 0,
  rate: 0,
  requests: 0,
  model: null,
  contextTokens: null,
  contextWindow: null,
  contextPercent: null,
  usd: null,
  limits: [],
}

const pulse = atom({ plugin: 'ember', key: 'pulse' } as const, empty)

// ~4 caracteres por token: só uma estimativa enquanto a resposta chega;
// o valor real da API substitui a estimativa quando a resposta termina.
const CHARS_PER_TOKEN = 4
const LIVE_STEP = 8

// Janelas na ordem da página de uso do claude.ai: sessão e depois semana.
const LIMIT_NAMES: Record<string, string> = {
  five_hour: 'Sessão',
  seven_day: 'Semana',
  spend_limit: 'Limite',
}
const LIMIT_ORDER = ['five_hour', 'seven_day', 'spend_limit']

const fmt = (n: number) => {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

// Cores do tema do próprio Claude: acompanham claro/escuro sozinhas.
// Laranja é o normal; só vira aviso/erro quando o número pede atenção.
const heat = (percent: number) => (percent >= 85 ? 'error' : percent >= 60 ? 'warning' : 'claude')

// Barra em SVG não lê o tema, então usa hex fixo nos mesmos tons.
const HEAT_HEX = { claude: '#d97757', warning: '#d4a027', error: '#d0453a' } as const

// Tempo relativo até o reset ("em 2h10", "em 4d 6h"): não depende do fuso.
const resetIn = (resetsAt: string | undefined, now: number) => {
  const at = resetsAt ? Date.parse(resetsAt) : NaN
  if (Number.isNaN(at)) return null
  const minutes = Math.max(0, Math.round((at - now) / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return `${hours}h${String(mins).padStart(2, '0')}`
  return `${mins}min`
}

const fromUsage = (p: Pulse, u: Omit<SessionUsage, 'startedAt'>): Pulse => ({
  ...p,
  contextTokens: u.context.tokens ?? p.contextTokens,
  contextWindow: u.context.window,
  contextPercent: u.context.percent ?? p.contextPercent,
  usd: u.cost?.usd ?? p.usd,
  limits: u.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
})

const meterBar = (percent: number, width: number) => {
  const color = HEAT_HEX[heat(percent)]
  const fill = Math.max(6, Math.round((width * Math.min(percent, 100)) / 100))
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="6" viewBox="0 0 ${width} 6">` +
    `<rect width="${width}" height="6" rx="3" fill="${color}" fill-opacity="0.2"/>` +
    `<rect width="${fill}" height="6" rx="3" fill="${color}"/></svg>`
  )
}

const blockBar = (percent: number, cells: number) => {
  const full = Math.round((cells * Math.min(percent, 100)) / 100)
  return '━'.repeat(full) + '─'.repeat(cells - full)
}

const refresh = async ($: EngineInterface) => {
  const usage = await $.session.usage()
  await update($, pulse, p => fromUsage(p ?? empty, usage))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($)

    return result
  })

  on('session.measure', async ($, e, next) => {
    await update($, pulse, p => fromUsage(p ?? empty, e))

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    const startedAt = await $.clock.now()
    let chars = 0
    let shown = 0

    for await (const chunk of stream) {
      if (chunk.kind === 'text' || chunk.kind === 'thinking') {
        chars += chunk.text.length
      }

      const live = Math.round(chars / CHARS_PER_TOKEN)
      if (live - shown >= LIVE_STEP) {
        shown = live
        const seconds = Math.max(((await $.clock.now()) - startedAt) / 1000, 0.1)
        await update($, pulse, p => ({ ...(p ?? empty), live, rate: live / seconds }))
      }

      yield chunk
    }

    const result = await stream.result
    const usage = result.usage
    await update($, pulse, p => {
      const base = { ...(p ?? empty), live: 0 }

      return usage
        ? {
            ...base,
            input: base.input + usage.input_tokens,
            output: base.output + usage.output_tokens,
            cacheRead: base.cacheRead + usage.cache_read_input_tokens,
            cacheWrite: base.cacheWrite + usage.cache_creation_input_tokens,
            requests: base.requests + 1,
            model: usage.model,
          }
        : base
    })

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const p = await read($, pulse)
    const now = await $.clock.now()
    const elements = $.ui.resolve(e)
    const { Box, Text } = elements
    const svg = 'Svg' in elements ? elements : null
    const isWorking = e.props.isWorking
    const isNarrow = e.props.bodyColumns < 70
    const tokens = p.input + p.cacheWrite + p.cacheRead + p.output + p.live
    const limits = [...p.limits].sort((a, b) => LIMIT_ORDER.indexOf(a.kind) - LIMIT_ORDER.indexOf(b.kind))

    const meter = (l: Pulse['limits'][number]) => {
      const reset = resetIn(l.resetsAt, now)
      return (
        <Box key={`limit-${l.kind}`} flexDirection="row" gap="xs" alignItems="center">
          <Text size="footnote">{LIMIT_NAMES[l.kind] ?? l.kind}</Text>
          {svg ? (
            <svg.Svg
              source={meterBar(l.percentUsed, isNarrow ? 64 : 120)}
              alt={`${LIMIT_NAMES[l.kind] ?? l.kind} ${l.percentUsed}% usado`}
              width={isNarrow ? 64 : 120}
              height={6}
            />
          ) : (
            <Text color={heat(l.percentUsed)}>{blockBar(l.percentUsed, isNarrow ? 8 : 14)}</Text>
          )}
          <Text bold tabular color={heat(l.percentUsed)}>
            {`${l.percentUsed}%`}
          </Text>
          {reset === null || isNarrow ? null : (
            <Text dimColor size="footnote">
              {`reinicia em ${reset}`}
            </Text>
          )}
        </Box>
      )
    }

    return (
      <Box
        flexDirection="column"
        rowGap="xs"
        paddingX={1}
        borderStyle="round"
        borderColor={isWorking ? 'claude' : 'subtle'}
      >
        <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" alignItems="center" columnGap="md">
          <Box flexDirection="row" gap="xs" alignItems="center">
            <Text color="claude" bold>
              ✻
            </Text>
            <Text color="claude" weight="semibold" bold>
              Ember
            </Text>
            <Text color={isWorking ? 'claude' : 'inactive'} size="footnote">
              {isWorking ? '● respondendo' : '○ ocioso'}
            </Text>
            {isWorking && p.live > 0 ? (
              <Text dimColor tabular size="footnote">
                {`${Math.round(p.rate)} tok/s`}
              </Text>
            ) : null}
          </Box>
          <Box flexDirection="row" gap="md" alignItems="center">
            <Box flexDirection="row" gap="xs">
              <Text bold tabular color={isWorking && p.live > 0 ? 'claude' : undefined}>
                {fmt(tokens)}
              </Text>
              <Text dimColor size="footnote">
                tokens
              </Text>
            </Box>
            {p.usd === null ? null : (
              <Box flexDirection="row" gap="xs">
                <Text bold tabular>
                  {`$${p.usd.toFixed(p.usd < 1 ? 3 : 2)}`}
                </Text>
                <Text dimColor size="footnote">
                  gasto
                </Text>
              </Box>
            )}
          </Box>
        </Box>
        {limits.length === 0 ? null : (
          <Box flexDirection="row" flexWrap="wrap" columnGap="lg" rowGap="xs" alignItems="center">
            {limits.map(meter)}
          </Box>
        )}
      </Box>
    )
  })
}
