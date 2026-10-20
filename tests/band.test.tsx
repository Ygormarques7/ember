import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'ember',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

// O texto alternativo de cada SVG da faixa do desktop: é ali que ela diz o
// que mostra (o resumo, o título e o que o Mario está fazendo).
type Mounted = Awaited<ReturnType<Parameters<Parameters<typeof test>[1]>[0]['ui']['mount']>>
const alts = async (ui: Mounted) => (await ui.findAll({ type: 'Svg' })).map(el => String(el.props.alt ?? ''))
const altWith = async (ui: Mounted, part: string) => (await alts(ui)).find(alt => alt.includes(part))

test('a faixa mostra sessão, semana e gasto em todo surface', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: Date.parse('2026-10-20T10:00:00Z') }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 84_000, window: 200_000, percent: 42 },
      rateLimits: [
        { kind: 'seven_day', percentUsed: 30, resetsAt: '2026-10-24T22:00:00Z' },
        { kind: 'five_hour', percentUsed: 71, resetsAt: '2026-10-20T12:10:00Z' },
      ],
      cost: { usd: 0.537 },
    },
  }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  // Terminal: a faixa em texto.
  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /Sugador de Tokens/ }))?.text).toBe('Sugador de Tokens')
  expect((await term.find({ type: 'Text', text: /^\$0\.537$/ }))?.text).toBe('$0.537')
  expect((await term.find({ type: 'Text', text: /^Sessão$/ }))?.text).toBe('Sessão')
  expect((await term.find({ type: 'Text', text: /^71%$/ }))?.text).toBe('71%')
  expect((await term.find({ type: 'Text', text: /^reinicia em 2h10$/ }))?.text).toBe('reinicia em 2h10')
  expect((await term.find({ type: 'Text', text: /^30%$/ }))?.text).toBe('30%')
  expect((await term.find({ type: 'Text', text: /^reinicia em 4d 12h$/ }))?.text).toBe('reinicia em 4d 12h')
  await term.unmount()

  // Desktop: camadas de SVG; o que elas mostram vai no texto alternativo.
  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await altWith(desk, 'Sugador de Tokens')).toBeDefined()
  const summary = await altWith(desk, ' tokens')
  expect(summary).toContain('$0.537 gasto')
  expect(summary).toContain('Sessão 71% (reinicia em 2h10)')
  expect(summary).toContain('Semana 30% (reinicia em 4d 12h)')
  expect(await altWith(desk, 'Mario sentado na borda')).toBeDefined()
  await desk.unmount()
})

test('cada resposta do modelo soma os tokens reais na faixa', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  let now = 0
  on('clock.now', () => ({ value: (now += 500) }))
  on('turn.step', async function* (_, e) {
    yield { kind: 'text', index: 0, text: 'x'.repeat(400) }

    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'ok',
      toolUses: [],
      stopReason: 'end_turn',
      usage: {
        model: 'claude-test',
        input_tokens: 1200,
        output_tokens: 3400,
        cache_read_input_tokens: 50_000,
        cache_creation_input_tokens: 300,
      },
    }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-test', messageCount: 1 })
  for await (const _ of stream) {
  }
  await stream.result

  // 1200 entrada + 300 escrita de cache + 50k leitura de cache + 3400 saída
  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /^55k$/ }))?.text).toBe('55k')
  await term.unmount()
  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await altWith(desk, ' tokens')).toContain('55k tokens')
  await desk.unmount()
})

const crossing = async ($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1], kind: string, from: number, to: number) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  const clock = mock.clock(on, { now: Date.parse('2026-10-20T10:00:00Z') })
  const limits = (pct: number) => [
    { kind: 'five_hour', percentUsed: kind === 'five_hour' ? pct : 11 },
    { kind: 'seven_day', percentUsed: kind === 'seven_day' ? pct : 32 },
  ]
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: limits(from) } }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.measure({ context: { window: 200_000 }, rateLimits: limits(to), changed: ['rateLimits'] })
  return clock
}

test('ao virar de dezena (49 → 50) o Mario vai até o número, troca e volta', async ($, on) => {
  const clock = await crossing($, on, 'five_hour', 49, 50)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  // Ele sai de cima; no desktop a troca 49% → 50% acontece dentro da
  // animação, no pouso, sem redesenhar a faixa no meio do caminho.
  expect(await altWith(ui, 'Mario indo trocar o número')).toBeDefined()
  expect(await altWith(ui, ' tokens')).toContain('Sessão 49% → 50%')
  const during = (await ui.findAll({ type: 'Svg' }))[0]?.props.source
  await clock.advance(5000)
  expect((await ui.findAll({ type: 'Svg' }))[0]?.props.source).toBe(during)

  // Terminado o passeio, ele volta a sentar na borda e a barra fica em 50%.
  await clock.advance(15_000)
  expect(await altWith(ui, 'Mario sentado na borda')).toBeDefined()
  expect(await altWith(ui, ' tokens')).toContain('Sessão 50%')
  await ui.unmount()

  // No terminal não há Mario; o número troca na hora do pouso.
  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /^50%$/ }))?.text).toBe('50%')
  await term.unmount()
})

test('a caminhada acontece a cada dezena, não a cada ponto', async ($, on) => {
  const clock = await crossing($, on, 'seven_day', 19, 20)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await altWith(ui, 'Mario indo trocar o número')).toBeDefined()
  await clock.advance(20_000)
  expect(await altWith(ui, ' tokens')).toContain('Semana 20%')

  // 20 → 25 fica na mesma dezena: o Mario não sai do lugar.
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 11 },
      { kind: 'seven_day', percentUsed: 25 },
    ],
    changed: ['rateLimits'],
  })
  expect(await altWith(ui, 'Mario sentado na borda')).toBeDefined()
  expect(await altWith(ui, ' tokens')).toContain('Semana 25%')
  await ui.unmount()
})
