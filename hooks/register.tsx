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

// No desktop (app e VS Code) a faixa inteira é UM SVG em fluxo normal, sem
// nada sobreposto por posição absoluta (o VS Code empilha o que é absoluto e
// o app corta o que passa da altura): um espaço no topo onde o Mario fica
// sentado, o painel com borda e chuva, o texto e o Mario, tudo no mesmo
// sistema de coordenadas, então o Mario sabe o caminho exato até cada número.
//
// A faixa é responsiva: a largura em pixels sai das colunas que a superfície
// dá à faixa (bodyColumns) e o desenho se reorganiza conforme ela. Com espaço,
// Sessão e Semana ficam lado a lado; mais estreita, uma embaixo da outra;
// estreita demais, a faixa vira texto (o mesmo do terminal). O SVG leva
// largura e altura explícitas: sem elas o app o desenha num quadro de 300x150.
//
// O SVG só muda quando muda o que ele mostra, e a troca do número durante a
// caminhada acontece dentro da própria animação, para ela nunca reiniciar.

// Pixels por coluna da faixa em cada superfície. No app, medido: 95 colunas
// ocupam 749px dentro do quadro cinza da faixa (7,88px cada). A largura sai
// arredondada para baixo e com 2px de folga para nunca passar da borda.
const CELL_PX: Record<string, number> = { desktop: 7.88, vscode: 7.88, mobile: 7.88 }
const bandWidthFor = (surface: string, columns: number) => Math.floor(columns * (CELL_PX[surface] ?? 7.88)) - 2
// Abaixo disto o desenho não cabe e a faixa vira texto.
const MIN_BAND_WIDTH = 330

const MARIO_WIDTH = 18
const SIT_HEIGHT = Math.round(spriteHeight(SIT, MARIO_WIDTH))
// Quanto do Mario sentado desce por cima do painel: a perna inteira e a
// bota. Quanto mais ele desce, menos espaço vazio sobra acima do painel.
const MARIO_OVERLAP = 14
const TOP = SIT_HEIGHT - MARIO_OVERLAP
const PAD = 14
const ROW_HEIGHT = 26
const FIRST_ROW = 27
// Letra dos valores (título, números) e dos rótulos.
const BIG = 15
const SMALL = 12
const BAR_H = 8

const FONT = `font-family="system-ui, 'Segoe UI', sans-serif"`
const MONO = `font-family="ui-monospace, Consolas, monospace"`

// Partes de um medidor: rótulo, barra, número e "reinicia em".
const LABEL_W = 58
const PERCENT_W = 40
const RESET_W = 122
const GAP = 10

type MeterBox = { kind: string; x: number; y: number; barWidth: number; showReset: boolean }

// Onde cada coisa fica numa faixa de largura "width": as linhas, os
// medidores (no máximo dois, Sessão e Semana) e a altura total.
const layoutFor = (width: number, kinds: string[]) => {
  const ordered = [...kinds].sort((a, b) => LIMIT_ORDER.indexOf(a) - LIMIT_ORDER.indexOf(b)).slice(0, 2)
  const inner = width - PAD * 2
  // Lado a lado só se cada medidor ainda tiver uma barra de 90px.
  const sideBySide = ordered.length < 2 || inner >= 2 * (LABEL_W + 90 + PERCENT_W + GAP * 2) + 24
  const columnWidth = sideBySide && ordered.length === 2 ? (inner - 24) / 2 : inner
  const barFor = (showReset: boolean) =>
    Math.max(40, Math.min(160, columnWidth - LABEL_W - PERCENT_W - GAP * 2 - (showReset ? RESET_W : 0)))
  const showReset = columnWidth - LABEL_W - PERCENT_W - GAP * 2 - RESET_W >= 60
  const meters: MeterBox[] = ordered.map((kind, i) => ({
    kind,
    x: PAD + (sideBySide ? i * (columnWidth + 24) : 0),
    y: TOP + FIRST_ROW + ROW_HEIGHT * (sideBySide ? 1 : i + 1),
    barWidth: barFor(showReset),
    showReset,
  }))
  const rows = 1 + (ordered.length === 0 ? 0 : sideBySide ? 1 : ordered.length)
  const panelHeight = FIRST_ROW + ROW_HEIGHT * (rows - 1) + 14
  return { meters, panelHeight, height: TOP + panelHeight + 2 }
}

const percentX = (m: MeterBox) => m.x + LABEL_W + m.barWidth + GAP

// A cada dezena (9→10, 19→20, ... 49→50 ...) o Mario vai trocar o número.
const crossedTen = (from: number, to: number) => Math.floor(to / 10) > Math.floor(from / 10)

// Os tempos da caminhada, em segundos, iguais em qualquer largura (numa faixa
// larga ele só anda mais rápido): assim os timers do session.measure, que não
// sabem a largura, batem com a animação.
const WALK = (() => {
  const walk = 3
  const land = walk + 0.45
  const ground = land + 0.4 + 0.38
  return { walk, up: walk + 0.22, land, leave: land + 0.4, down: land + 0.58, ground, end: ground + walk }
})()

// O caminho do Mario até o número e de volta. Ele desce andando na diagonal
// do canto de cima até o chão ao lado do número, pula em cima dele (o número
// troca quando ele pousa), pula de volta ao chão e volta andando até o canto.
const walkPlan = (width: number, panelHeight: number, meter: MeterBox) => {
  const walkerH = spriteHeight(STAND, MARIO_WIDTH)
  const numX = percentX(meter)
  const home = { x: width - 40, y: SIT_HEIGHT - walkerH }
  const ground = { x: numX + 40, y: Math.min(TOP + panelHeight - walkerH - 2, meter.y + 6 - walkerH) }
  const onNumber = { x: numX + 5, y: meter.y - 12 - walkerH }
  const apexUp = { x: numX + 22, y: onNumber.y - 12 }
  const apexDown = { x: numX + 28, y: onNumber.y - 8 }
  const keys = [0, WALK.walk, WALK.up, WALK.land, WALK.leave, WALK.down, WALK.ground, WALK.end]
  const points = [home, ground, apexUp, onNumber, onNumber, apexDown, ground, home]
  return { keys, points, tLand: WALK.land, tGround: WALK.ground, tEnd: WALK.end, t1: WALK.walk }
}

const secs = (t: number) => `${t.toFixed(3)}s`

// O Mario. Parado: sentado no canto, com a perna sobre o painel. Andando:
// os pés alternam entre o passo fechado e o aberto enquanto ele anda (nunca
// desliza parado), ele vira de frente para onde vai e segue o caminho.
const marioLayer = (width: number, plan: ReturnType<typeof walkPlan> | null) => {
  if (plan === null) {
    return sprite(SIT, width - 40, 0, MARIO_WIDTH)
  }
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
  return (
    `<g><animateTransform attributeName="transform" type="translate" values="${values}" ` +
    `keyTimes="${keyTimes}" dur="${secs(plan.tEnd)}" fill="freeze"/>` +
    // Indo: de frente para a esquerda, como o desenho. Voltando: espelhado.
    `<g><set attributeName="display" to="none" begin="${secs(plan.tGround)}"/>${frames}</g>` +
    `<g display="none"><set attributeName="display" to="inline" begin="${secs(plan.tGround)}"/>` +
    `<g transform="translate(${MARIO_WIDTH} 0) scale(-1 1)">${frames}</g></g>` +
    `</g>`
  )
}

const svgText = (x: number, y: number, body: string, attrs: string, font = FONT) =>
  `<text x="${x}" y="${y}" ${font} ${attrs}>${escapeXml(body)}</text>`

// Barra e número de um medidor. Com "swap", é o medidor que o Mario vai
// trocar: mostra o valor antigo até ele pousar (swap.at segundos depois do
// começo da caminhada) e o novo dali em diante, tudo dentro da animação.
const meterSvg = (m: MeterBox, label: string, percent: number, reset: string | null, swap?: { to: number; at: number }) => {
  const barX = m.x + LABEL_W
  const reading = (pct: number) => {
    const fill = Math.max(6, Math.round((m.barWidth * Math.min(pct, 100)) / 100))
    return (
      `<rect x="${barX}" y="${m.y - 10}" width="${m.barWidth}" height="${BAR_H}" rx="4" fill="${heat(pct)}" fill-opacity="0.18"/>` +
      `<rect x="${barX}" y="${m.y - 10}" width="${fill}" height="${BAR_H}" rx="4" fill="${heat(pct)}"/>` +
      svgText(percentX(m), m.y, `${pct}%`, `font-size="${BIG}" font-weight="700" fill="${heat(pct)}"`)
    )
  }
  const readings = swap
    ? `<g>${reading(percent)}<set attributeName="display" to="none" begin="${secs(swap.at)}"/></g>` +
      `<g display="none">${reading(swap.to)}<set attributeName="display" to="inline" begin="${secs(swap.at)}"/></g>`
    : reading(percent)
  return (
    svgText(m.x, m.y, label, `font-size="${SMALL}" fill="${C.dim}"`) +
    readings +
    (reset === null || !m.showReset
      ? ''
      : svgText(percentX(m) + PERCENT_W + GAP, m.y, `reinicia em ${reset}`, `font-size="${SMALL}" fill="${C.dim}"`))
  )
}

type BandInput = {
  width: number
  tokens: number
  usd: string | null
  isWorking: boolean
  limits: { kind: string; percent: number; reset: string | null }[]
  walking: { kind: string; from: number } | null
}

// A faixa do desktop numa largura dada: o SVG, sua altura e o texto
// alternativo que diz o que ele mostra.
const bandSvg = ({ width, tokens, usd, isWorking, limits, walking }: BandInput) => {
  const W = Math.round(width)
  const { meters, panelHeight, height } = layoutFor(W, limits.map(l => l.kind))
  const valueOf = (kind: string) => limits.find(l => l.kind === kind)
  const target = walking === null ? undefined : meters.find(m => m.kind === walking.kind)
  const plan = target ? walkPlan(W, panelHeight, target) : null
  const name = (kind: string) => LIMIT_NAMES[kind] ?? kind
  const row1 = TOP + FIRST_ROW
  // Com pouca largura o "● sugando" sai antes de encostar no gasto.
  const roomForStatus = W >= 520
  const body =
    `<defs>${OUTLINE_FILTER}<clipPath id="panel"><rect width="${W - 1}" height="${panelHeight}" rx="10"/></clipPath></defs>` +
    `<g transform="translate(0.5 ${TOP + 0.5})" clip-path="url(#panel)">${codeRain(W - 1, panelHeight)}</g>` +
    `<rect x="0.5" y="${TOP + 0.5}" width="${W - 1}" height="${panelHeight}" rx="10" fill="none" ` +
    `stroke="${isWorking ? C.green : C.border}"/>` +
    svgText(PAD, row1, '>_', `font-size="${BIG}" font-weight="700" fill="${C.code}"`, MONO) +
    svgText(PAD + 24, row1, 'Sugador de Tokens', `font-size="${BIG}" font-weight="700" fill="${C.text}"`) +
    (isWorking && roomForStatus ? svgText(PAD + 172, row1, '● sugando', `font-size="${SMALL}" fill="${C.green}"`) : '') +
    svgText(W - (usd === null ? 58 : 162), row1, fmt(tokens), `font-size="${BIG}" font-weight="700" text-anchor="end" fill="${C.text}"`) +
    svgText(W - (usd === null ? 54 : 158), row1, 'tokens', `font-size="${SMALL}" fill="${C.dim}"`) +
    (usd === null
      ? ''
      : svgText(W - 56, row1, usd, `font-size="${BIG}" font-weight="700" text-anchor="end" fill="${C.text}"`) +
        svgText(W - 52, row1, 'gasto', `font-size="${SMALL}" fill="${C.dim}"`)) +
    meters
      .map(m => {
        const limit = valueOf(m.kind)
        const percent = limit?.percent ?? 0
        const reset = limit?.reset ?? null
        return m === target && walking !== null && plan !== null
          ? meterSvg(m, name(m.kind), walking.from, reset, { to: percent, at: plan.tLand })
          : meterSvg(m, name(m.kind), percent, reset)
      })
      .join('') +
    marioLayer(W, plan)
  const alt = [
    `Sugador de Tokens${isWorking ? ', sugando' : ''}`,
    `${fmt(tokens)} tokens`,
    ...(usd === null ? [] : [`${usd} gasto`]),
    ...meters.map(m => {
      const limit = valueOf(m.kind)
      const percent = limit?.percent ?? 0
      const value = m === target && walking !== null ? `${walking.from}% → ${percent}%` : `${percent}%`
      return `${name(m.kind)} ${value}${limit?.reset ? ` (reinicia em ${limit.reset})` : ''}`
    }),
    target ? 'Mario indo trocar o número' : 'Mario sentado na borda',
  ].join(', ')
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">${body}</svg>`
  return { source, alt, width: W, height }
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
    if (crossed && current === null) {
      const old = before.limits.find(o => o.kind === crossed.kind)
      await update($, walk, () => ({ kind: crossed.kind, from: old?.percentUsed ?? 0, isSwapped: false }))
      $.clock.after(Math.round(WALK.land * 1000), () => void update($, walk, w => (w ? { ...w, isSwapped: true } : w)))
      $.clock.after(Math.round(WALK.end * 1000), () => void update($, walk, () => null))
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

    // Desktop: a faixa inteira num SVG só, na largura da faixa (veja o
    // comentário de CELL_PX); estreita demais, cai no texto lá embaixo.
    const bandWidth = bandWidthFor(e.surface, e.props.bodyColumns)
    if (svg && bandWidth >= MIN_BAND_WIDTH) {
      const band = bandSvg({
        width: bandWidth,
        tokens,
        usd,
        isWorking,
        limits: limits.map(l => ({ kind: l.kind, percent: l.percentUsed, reset: resetIn(l.resetsAt, now) })),
        walking: walking === null ? null : { kind: walking.kind, from: walking.from },
      })
      return (
        <Box>
          <svg.Svg source={band.source} alt={band.alt} width={band.width} height={band.height} isInteractive />
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
