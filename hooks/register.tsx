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

const LIMIT_NAMES: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  spend_limit: 'limite',
}

const fmt = (n: number) => {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

// Cores do tema do próprio Claude: acompanham claro/escuro sozinhas.
// Laranja é o normal; só vira aviso/erro quando o número pede atenção.
const heat = (percent: number) => (percent >= 85 ? 'error' : percent >= 60 ? 'warning' : 'claude')

// Barra em SVG não lê o tema, então usa o laranja do Claude fixo.
const CLAUDE_ORANGE = '#d97757'

const fromUsage = (p: Pulse, u: Omit<SessionUsage, 'startedAt'>): Pulse => ({
  ...p,
  contextTokens: u.context.tokens ?? p.contextTokens,
  contextWindow: u.context.window,
  contextPercent: u.context.percent ?? p.contextPercent,
  usd: u.cost?.usd ?? p.usd,
  limits: u.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed })),
})

const meterBar = (percent: number, width: number) => {
  const fill = Math.max(6, Math.round((width * Math.min(percent, 100)) / 100))
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="8" viewBox="0 0 ${width} 8">` +
    `<rect width="${width}" height="8" rx="4" fill="${CLAUDE_ORANGE}" fill-opacity="0.18"/>` +
    `<rect width="${fill}" height="8" rx="4" fill="${CLAUDE_ORANGE}"/></svg>`
  )
}

const blockBar = (percent: number, cells: number) => {
  const full = Math.round((cells * Math.min(percent, 100)) / 100)
  return '█'.repeat(full) + '░'.repeat(cells - full)
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
    const elements = $.ui.resolve(e)
    const { Box, Text } = elements
    const svg = 'Svg' in elements ? elements : null
    const isWorking = e.props.isWorking
    const isNarrow = e.props.bodyColumns < 70
    const output = p.output + p.live
    const percent = p.contextPercent

    const chip = (key: string, icon: string, iconColor: string, value: string, label: string) => (
      <Box key={key} flexDirection="row" gap="xs">
        <Text color={iconColor} bold>
          {icon}
        </Text>
        <Text bold tabular>
          {value}
        </Text>
        {isNarrow ? null : (
          <Text dimColor size="footnote">
            {label}
          </Text>
        )}
      </Box>
    )

    const contextMeter =
      percent === null ? null : (
        <Box key="ctx" flexDirection="row" gap="xs" alignItems="center">
          <Text color="claude" bold>
            ◔
          </Text>
          {svg ? (
            <svg.Svg source={meterBar(percent, 72)} alt={`Contexto ${percent}% usado`} width={72} height={8} />
          ) : (
            <Text color={heat(percent)}>{blockBar(percent, 10)}</Text>
          )}
          <Text bold tabular color={heat(percent)}>
            {percent}%
          </Text>
          {isNarrow ? null : (
            <Text dimColor size="footnote">
              contexto
            </Text>
          )}
        </Box>
      )

    return (
      <Box
        flexDirection="row"
        flexWrap="wrap"
        alignItems="center"
        justifyContent="space-between"
        columnGap="md"
        rowGap="xs"
        paddingX={1}
        borderStyle="round"
        borderColor={isWorking ? 'claude' : 'subtle'}
      >
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
              {Math.round(p.rate)} tok/s
            </Text>
          ) : null}
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap="md" alignItems="center">
          {chip('in', '↑', 'claude', fmt(p.input + p.cacheWrite), 'entrada')}
          {chip('out', '↓', 'claude', fmt(output), 'saída')}
          {chip('cache', '⟳', 'claude', fmt(p.cacheRead), 'cache')}
          {contextMeter}
          {p.usd === null ? null : chip('usd', '$', 'claude', p.usd.toFixed(p.usd < 1 ? 3 : 2), 'gasto')}
          {p.limits.map(l =>
            chip(
              `limit-${l.kind}`,
              '◷',
              heat(l.percentUsed),
              `${l.percentUsed}%`,
              LIMIT_NAMES[l.kind] ?? l.kind,
            ),
          )}
        </Box>
      </Box>
    )
  })
}
