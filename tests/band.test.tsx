import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'token-pulse',
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

test('a faixa mostra contexto, gasto e limites em todo surface', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 84_000, window: 200_000, percent: 42 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 23 }],
      cost: { usd: 0.537 },
    },
  }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })

    expect((await ui.find({ type: 'Text', text: /Token Pulse/ }))?.text).toBe('Token Pulse')
    expect((await ui.find({ type: 'Text', text: /^42%$/ }))?.text).toBe('42%')
    expect((await ui.find({ type: 'Text', text: /^0\.537$/ }))?.text).toBe('0.537')
    expect((await ui.find({ type: 'Text', text: /^23%$/ }))?.text).toBe('23%')
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

    expect((await ui.find({ type: 'Text', text: /^1\.5k$/ }))?.text).toBe('1.5k')
    expect((await ui.find({ type: 'Text', text: /^3\.4k$/ }))?.text).toBe('3.4k')
    expect((await ui.find({ type: 'Text', text: /^50k$/ }))?.text).toBe('50k')
    await ui.unmount()
  }
})
