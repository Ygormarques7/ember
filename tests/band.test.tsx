import { expect, test } from 'claude-code/testing'

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

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })

    expect((await ui.find({ type: 'Text', text: /Ember/ }))?.text).toBe('Ember')
    expect((await ui.find({ type: 'Text', text: /^\$0\.537$/ }))?.text).toBe('$0.537')
    expect((await ui.find({ type: 'Text', text: /^Sessão$/ }))?.text).toBe('Sessão')
    expect((await ui.find({ type: 'Text', text: /^71%$/ }))?.text).toBe('71%')
    expect((await ui.find({ type: 'Text', text: /^reinicia em 2h10$/ }))?.text).toBe('reinicia em 2h10')
    expect((await ui.find({ type: 'Text', text: /^Semana$/ }))?.text).toBe('Semana')
    expect((await ui.find({ type: 'Text', text: /^30%$/ }))?.text).toBe('30%')
    expect((await ui.find({ type: 'Text', text: /^reinicia em 4d 12h$/ }))?.text).toBe('reinicia em 4d 12h')
    await ui.unmount()
  }
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

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })

    // 1200 entrada + 300 escrita de cache + 50k leitura de cache + 3400 saída
    expect((await ui.find({ type: 'Text', text: /^55k$/ }))?.text).toBe('55k')
    await ui.unmount()
  }
})
