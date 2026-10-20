import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { MarioWalk, Pulse } from '../types'

import { OUTLINE_FILTER, SIT, STAND, STRIDE, sprite, spriteHeight } from './mario'

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

// A caminhada do Mario em andamento: qual barra, o número de antes, e se ele
// já chegou e trocou o número. null quando ele está parado em cima da faixa.
const walk = atom({ plugin: 'ember', key: 'walk' } as const, null as MarioWalk | null)

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

// Painel preto de terminal só em preto, verde e branco. O texto da frente
// é forte (verde vivo e branco puro) e o código do fundo é bem apagado, para
// as letras saltarem. Cores fixas, iguais no tema claro e no escuro.
const C = {
  bg: '#000000',
  border: '#1d2b22',
  green: '#2ee87f',
  code: '#2ee87f',
  text: '#ffffff',
  dim: '#c3cec7',
  warning: '#e3b341',
  error: '#f85149',
} as const

// Verde é o normal; só vira aviso/erro quando o número pede atenção.
const heat = (percent: number) => (percent >= 85 ? C.error : percent >= 60 ? C.warning : C.green)

// Chuva de caracteres no estilo Matrix: katakana de meia largura, dígitos e
// letras, em colunas verticais que caem com a cabeça clara e a cauda sumindo.
const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789ABCDEFZ:.=*+<>'

const escapeXml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Sorteio com semente fixa: o desenho sai igual a cada redesenho da faixa,
// então a animação não reinicia quando um número muda.
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}

const COLUMN_GAP = 9
const LINE_HEIGHT = 11
const RAIN_HEAD = '#d9ffe8'

// Cada coluna desce de acima da faixa até sumir embaixo; comprimento,
// velocidade e atraso sorteados para as colunas nunca andarem juntas.
// Algumas colunas caem duas vezes no mesmo ciclo (em fases opostas) para
// a chuva ficar cheia. A faixa raramente passa de ~1100px, então só
// desenha colunas até lá. A cauda some pelo degradê "tail" do texto todo,
// o que mantém o SVG pequeno mesmo com muitas colunas.
const codeRain = (width: number, height: number) => {
  const rand = seeded(42)
  const columns = Math.ceil(Math.min(width, 1100) / COLUMN_GAP)
  const drop = (x: number) => {
    const length = 5 + Math.floor(rand() * 11)
    const tail = length * LINE_HEIGHT
    const dur = (1.6 + rand() * 3).toFixed(2)
    const delay = (rand() * 6).toFixed(2)
    const glyphs = Array.from({ length }, (_, i) => {
      const ch = escapeXml(GLYPHS[Math.floor(rand() * GLYPHS.length)])
      const head = i === length - 1 ? ` fill="${RAIN_HEAD}"` : ''
      return `<tspan x="${x}" dy="${LINE_HEIGHT}"${head}>${ch}</tspan>`
    }).join('')
    return (
      `<text y="0" fill="url(#tail)">${glyphs}` +
      `<animateTransform attributeName="transform" type="translate" from="0 ${-tail}" to="0 ${height + 4}" ` +
      `dur="${dur}s" begin="-${delay}s" repeatCount="indefinite"/></text>`
    )
  }
  const rows = Array.from({ length: columns }, (_, c) => {
    const x = c * COLUMN_GAP + Math.round(rand() * 3)
    return rand() < 0.45 ? drop(x) + drop(x) : drop(x)
  }).join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMin slice">` +
    // Degradê que apaga a cauda e brilho (o texto borrado sob o nítido).
    `<defs><linearGradient id="tail" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${C.code}" stop-opacity="0.05"/>` +
    `<stop offset="1" stop-color="${C.code}" stop-opacity="0.9"/></linearGradient>` +
    `<filter id="glow" x="-5%" y="-50%" width="110%" height="200%">` +
    `<feGaussianBlur stdDeviation="1.3" result="b"/>` +
    `<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>` +
    `<rect width="${width}" height="${height}" fill="${C.bg}"/>` +
    `<g fill="${C.code}" opacity="0.6" filter="url(#glow)" font-size="10" font-family="ui-monospace, Consolas, 'MS Gothic', monospace">` +
    rows +
    `</g></svg>`
  )
}

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

// No desktop a faixa é desenhada em camadas de SVG com posições em pixels
// conhecidas, para o Mario saber o caminho exato do topo até cada número:
// um espaço acima do painel (onde o Mario fica sentado), o painel com a
// chuva, e por cima o texto e o palco do Mario. O texto da direita e o palco
// ficam presos à borda direita da faixa, com a mesma largura, então o número
// e o Mario vivem no mesmo sistema de coordenadas.
const MARIO_WIDTH = 16
const SIT_HEIGHT = Math.round(spriteHeight(SIT, MARIO_WIDTH))
// Quanto do Mario sentado desce por cima do painel: a canela e a bota.
const MARIO_OVERLAP = 8
const TOP = SIT_HEIGHT - MARIO_OVERLAP
const PANEL_HEIGHT = 50
const STAGE_HEIGHT = TOP + PANEL_HEIGHT + 4
const ROW1_Y = TOP + 21
const ROW2_Y = TOP + 41
const RIGHT_WIDTH = 580
const LEFT_WIDTH = 330
// Onde o Mario fica sentado: no canto direito, em cima da borda.
const HOME_X = RIGHT_WIDTH - 40
// Onde começa cada medidor (Sessão, Semana) no SVG da direita.
const METER_X = [RIGHT_WIDTH - 570, RIGHT_WIDTH - 290]
// Dentro de cada medidor: rótulo, barra, número e "reinicia em".
const BAR_DX = 48
const BAR_WIDTH = 90
const PERCENT_DX = 146
const RESET_DX = 178

const FONT = `font-family="system-ui, 'Segoe UI', sans-serif"`

const svgDoc = (width: number, height: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`

const SPACER = svgDoc(1, TOP, '')
const PANEL_SIZER = svgDoc(1, PANEL_HEIGHT, '')

// Quais barras aparecem e onde: no máximo duas, na ordem Sessão, Semana.
const meterSlots = (kinds: string[]) =>
  [...kinds]
    .sort((a, b) => LIMIT_ORDER.indexOf(a) - LIMIT_ORDER.indexOf(b))
    .slice(0, METER_X.length)
    .map((kind, i) => ({ kind, x: METER_X[i] }))

// A cada dezena (9→10, 19→20, ... 49→50 ...) o Mario vai trocar o número.
const crossedTen = (from: number, to: number) => Math.floor(to / 10) > Math.floor(from / 10)

// O caminho do Mario até o número de uma barra e de volta, com os tempos em
// segundos. Ele desce andando na diagonal do topo até o chão ao lado do
// número, pula em cima dele (o número troca quando ele pousa), pula de volta
// ao chão e volta andando até o topo.
const WALK_SPEED = 95
const walkPlan = (meterX: number) => {
  const walkerH = spriteHeight(STAND, MARIO_WIDTH)
  const numX = meterX + PERCENT_DX
  const home = { x: HOME_X, y: SIT_HEIGHT - walkerH }
  const ground = { x: numX + 40, y: TOP + PANEL_HEIGHT - walkerH - 2 }
  const onNumber = { x: numX + 4, y: ROW2_Y - 10 - walkerH }
  const apexUp = { x: numX + 22, y: onNumber.y - 12 }
  const apexDown = { x: numX + 28, y: onNumber.y - 8 }
  const walkS = Math.hypot(home.x - ground.x, home.y - ground.y) / WALK_SPEED
  const t1 = walkS
  const tUp = t1 + 0.22
  const tLand = t1 + 0.45
  const tLeave = tLand + 0.4
  const tDown = tLeave + 0.18
  const tGround = tLeave + 0.38
  const tEnd = tGround + walkS
  const keys = [0, t1, tUp, tLand, tLeave, tDown, tGround, tEnd]
  const points = [home, ground, apexUp, onNumber, onNumber, apexDown, ground, home]
  return { keys, points, tLand, tGround, tEnd, t1 }
}

const secs = (t: number) => `${t.toFixed(3)}s`

// O palco do Mario. Parado: sentado no canto, com a perna sobre o painel.
// Andando: os pés alternam entre o passo fechado e o aberto enquanto ele
// anda (nunca desliza parado), ele vira de frente para onde vai e segue o
// caminho do plano.
const marioStage = (walkingAt: number | null) => {
  const defs = `<defs>${OUTLINE_FILTER}</defs>`
  if (walkingAt === null) {
    return svgDoc(RIGHT_WIDTH, STAGE_HEIGHT, defs + sprite(SIT, HOME_X, 0, MARIO_WIDTH))
  }
  const plan = walkPlan(walkingAt)
  const keyTimes = plan.keys.map(k => (k / plan.tEnd).toFixed(4)).join(';')
  const values = plan.points.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(';')
  const walking = (visibleFirst: boolean) =>
    [
      [0, plan.t1],
      [plan.tGround, plan.tEnd],
    ]
      .map(
        ([from, to]) =>
          `<animate attributeName="visibility" values="${visibleFirst ? 'visible;hidden' : 'hidden;visible'}" ` +
          `calcMode="discrete" dur="0.26s" begin="${secs(from)}" end="${secs(to)}" repeatCount="indefinite"/>`,
      )
      .join('')
  const frames =
    `<g>${walking(true)}${sprite(STAND, 0, 0, MARIO_WIDTH)}</g>` +
    `<g visibility="hidden">${walking(false)}${sprite(STRIDE, 0, 0, MARIO_WIDTH)}</g>`
  return svgDoc(
    RIGHT_WIDTH,
    STAGE_HEIGHT,
    defs +
      `<g><animateTransform attributeName="transform" type="translate" values="${values}" ` +
      `keyTimes="${keyTimes}" dur="${secs(plan.tEnd)}" fill="freeze"/>` +
      // Indo: de frente para a esquerda, como o desenho. Voltando: espelhado.
      `<g><set attributeName="display" to="none" begin="${secs(plan.tGround)}"/>${frames}</g>` +
      `<g display="none"><set attributeName="display" to="inline" begin="${secs(plan.tGround)}"/>` +
      `<g transform="translate(${MARIO_WIDTH} 0) scale(-1 1)">${frames}</g></g>` +
      `</g>`,
  )
}

// Barra de uso dentro do SVG do texto, com fundo apagado e preenchimento.
const meterRect = (x: number, percent: number, width: number) => {
  const color = heat(percent)
  const fill = Math.max(6, Math.round((width * Math.min(percent, 100)) / 100))
  const y = ROW2_Y - 9
  return (
    `<rect x="${x}" y="${y}" width="${width}" height="6" rx="3" fill="${color}" fill-opacity="0.18"/>` +
    `<rect x="${x}" y="${y}" width="${fill}" height="6" rx="3" fill="${color}"/>`
  )
}

const MONO = `font-family="ui-monospace, Consolas, monospace"`

const svgText = (x: number, y: number, body: string, attrs: string, font = FONT) =>
  `<text x="${x}" y="${y}" ${font} ${attrs}>${escapeXml(body)}</text>`

const fromUsage = (p: Pulse, u: Omit<SessionUsage, 'startedAt'>): Pulse => ({
  ...p,
  contextTokens: u.context.tokens ?? p.contextTokens,
  contextWindow: u.context.window,
  contextPercent: u.context.percent ?? p.contextPercent,
  usd: u.cost?.usd ?? p.usd,
  limits: u.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
})

const meterBar = (percent: number, width: number) => {
  const color = heat(percent)
  const fill = Math.max(6, Math.round((width * Math.min(percent, 100)) / 100))
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="6" viewBox="0 0 ${width} 6">` +
    `<rect width="${width}" height="6" rx="3" fill="${color}" fill-opacity="0.18"/>` +
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
    const before = await read($, pulse)
    const current = await read($, walk)
    await update($, pulse, p => fromUsage(p ?? empty, e))

    // Uma barra virou de dezena (9→10, 19→20, ...): o Mario sai de cima, vai
    // até o número, pula nele para trocar e volta. Uma virada por vez.
    const crossed = e.rateLimits.find(l => {
      const old = before.limits.find(o => o.kind === l.kind)
      return old !== undefined && crossedTen(old.percentUsed, l.percentUsed)
    })
    const slot = crossed && meterSlots(e.rateLimits.map(l => l.kind)).find(m => m.kind === crossed.kind)
    if (crossed && slot && current === null) {
      const old = before.limits.find(o => o.kind === crossed.kind)
      const plan = walkPlan(slot.x)
      await update($, walk, () => ({ kind: crossed.kind, from: old?.percentUsed ?? 0, isSwapped: false }))
      $.clock.after(Math.round(plan.tLand * 1000), () => void update($, walk, w => (w ? { ...w, isSwapped: true } : w)))
      $.clock.after(Math.round(plan.tEnd * 1000), () => void update($, walk, () => null))
    }

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
    const walking = await read($, walk)
    const now = await $.clock.now()
    const elements = $.ui.resolve(e)
    const { Box, Text } = elements
    // O terminal não desenha SVG (a tabela dele só tem um substituto vazio).
    const svg = e.surface !== 'terminal' && 'Svg' in elements ? elements : null
    const isWorking = e.props.isWorking
    const isNarrow = e.props.bodyColumns < 70
    const tokens = p.input + p.cacheWrite + p.cacheRead + p.output + p.live
    const limits = [...p.limits].sort((a, b) => LIMIT_ORDER.indexOf(a.kind) - LIMIT_ORDER.indexOf(b.kind))

    // Enquanto o Mario não pousa no número, a barra mostra o número de antes.
    const shownPercent = (l: Pulse['limits'][number]) =>
      walking !== null && walking.kind === l.kind && !walking.isSwapped ? walking.from : l.percentUsed
    const live = isWorking && p.live > 0
    const usd = p.usd === null ? null : `$${p.usd.toFixed(p.usd < 1 ? 3 : 2)}`

    // Desktop: camadas de SVG com posições em pixels (veja o comentário de TOP),
    // e o Mario sentado na borda ou fazendo a caminhada.
    if (svg && !isNarrow) {
      const meters = meterSlots(limits.map(l => l.kind)).flatMap(slot => {
        const l = limits.find(m => m.kind === slot.kind)
        return l ? [{ ...slot, shown: shownPercent(l), reset: resetIn(l.resetsAt, now) }] : []
      })
      const left =
        svgText(12, ROW1_Y, '>_', `font-size="13" font-weight="700" fill="${C.code}"`, MONO) +
        svgText(32, ROW1_Y, 'Sugador de Tokens', `font-size="13" font-weight="700" fill="${C.text}"`) +
        (isWorking ? svgText(162, ROW1_Y, '● sugando', `font-size="11" fill="${C.green}"`) : '') +
        (live ? svgText(226, ROW1_Y, `${Math.round(p.rate)} tok/s`, `font-size="11" fill="${C.dim}"`) : '')
      const right =
        svgText(RIGHT_WIDTH - 154, ROW1_Y, fmt(tokens), `font-size="13" font-weight="700" text-anchor="end" fill="${live ? C.green : C.text}"`) +
        svgText(RIGHT_WIDTH - 150, ROW1_Y, 'tokens', `font-size="11" fill="${C.dim}"`) +
        (usd === null
          ? ''
          : svgText(RIGHT_WIDTH - 54, ROW1_Y, usd, `font-size="13" font-weight="700" text-anchor="end" fill="${C.text}"`) +
            svgText(RIGHT_WIDTH - 50, ROW1_Y, 'gasto', `font-size="11" fill="${C.dim}"`)) +
        meters
          .map(
            m =>
              svgText(m.x, ROW2_Y, LIMIT_NAMES[m.kind] ?? m.kind, `font-size="11" fill="${C.dim}"`) +
              meterRect(m.x + BAR_DX, m.shown, BAR_WIDTH) +
              svgText(m.x + PERCENT_DX, ROW2_Y, `${m.shown}%`, `font-size="13" font-weight="700" fill="${heat(m.shown)}"`) +
              (m.reset === null ? '' : svgText(m.x + RESET_DX, ROW2_Y, `reinicia em ${m.reset}`, `font-size="11" fill="${C.dim}"`)),
          )
          .join('')
      const summary = [
        `${fmt(tokens)} tokens`,
        ...(usd === null ? [] : [`${usd} gasto`]),
        ...meters.map(m => `${LIMIT_NAMES[m.kind] ?? m.kind} ${m.shown}%${m.reset === null ? '' : ` (reinicia em ${m.reset})`}`),
      ].join(', ')
      const walkingAt = walking === null ? null : (meters.find(m => m.kind === walking.kind)?.x ?? null)

      return (
        <Box flexDirection="column" position="relative">
          <svg.Svg source={SPACER} alt="" width={1} height={TOP} />
          <Box
            position="relative"
            overflow="hidden"
            borderStyle="round"
            borderColor={isWorking ? C.green : C.border}
            backgroundColor={C.bg}
          >
            <Box key="rain" position="absolute" top={0} left={0} right={0} bottom={0}>
              <svg.Svg source={codeRain(1600, 72)} alt="" height={72} isInteractive />
            </Box>
            <svg.Svg source={PANEL_SIZER} alt="" width={1} height={PANEL_HEIGHT} />
          </Box>
          <Box position="absolute" top={0} left={0}>
            <svg.Svg
              source={svgDoc(LEFT_WIDTH, STAGE_HEIGHT, left)}
              alt={isWorking ? 'Sugador de Tokens, sugando' : 'Sugador de Tokens'}
              width={LEFT_WIDTH}
              height={STAGE_HEIGHT}
            />
          </Box>
          <Box position="absolute" top={0} right={0}>
            <svg.Svg source={svgDoc(RIGHT_WIDTH, STAGE_HEIGHT, right)} alt={summary} width={RIGHT_WIDTH} height={STAGE_HEIGHT} />
          </Box>
          <Box position="absolute" top={0} right={0}>
            <svg.Svg
              source={marioStage(walkingAt)}
              alt={walkingAt === null ? 'Mario sentado na borda' : 'Mario indo trocar o número'}
              width={RIGHT_WIDTH}
              height={STAGE_HEIGHT}
              isInteractive
            />
          </Box>
        </Box>
      )
    }

    // Terminal (e desktop estreito): a faixa em texto, sem o Mario.
    const meter = (l: Pulse['limits'][number]) => {
      const reset = resetIn(l.resetsAt, now)
      const shown = shownPercent(l)
      return (
        <Box key={`limit-${l.kind}`} flexDirection="row" gap="xs" alignItems="center">
          <Text color={C.dim} size="footnote">
            {LIMIT_NAMES[l.kind] ?? l.kind}
          </Text>
          {svg ? (
            <svg.Svg
              source={meterBar(shown, 64)}
              alt={`${LIMIT_NAMES[l.kind] ?? l.kind} ${shown}% usado`}
              width={64}
              height={6}
            />
          ) : (
            <Text color={heat(shown)}>{blockBar(shown, isNarrow ? 8 : 14)}</Text>
          )}
          <Text bold tabular color={heat(shown)}>
            {`${shown}%`}
          </Text>
          {reset === null || isNarrow ? null : (
            <Text color={C.dim} size="footnote">
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
        borderColor={isWorking ? C.green : C.border}
        backgroundColor={C.bg}
      >
        <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" alignItems="center" columnGap="md">
          <Box flexDirection="row" gap="xs" alignItems="center">
            <Text color={C.code} bold>
              {'>_'}
            </Text>
            <Text color={C.text} weight="semibold" bold>
              Sugador de Tokens
            </Text>
            {isWorking ? (
              <Text color={C.green} size="footnote">
                ● sugando
              </Text>
            ) : null}
            {live ? (
              <Text color={C.dim} tabular size="footnote">
                {`${Math.round(p.rate)} tok/s`}
              </Text>
            ) : null}
          </Box>
          <Box flexDirection="row" gap="md" alignItems="center">
            <Box flexDirection="row" gap="xs">
              <Text bold tabular color={live ? C.green : C.text}>
                {fmt(tokens)}
              </Text>
              <Text color={C.dim} size="footnote">
                tokens
              </Text>
            </Box>
            {usd === null ? null : (
              <Box flexDirection="row" gap="xs">
                <Text bold tabular color={C.text}>
                  {usd}
                </Text>
                <Text color={C.dim} size="footnote">
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
