# ✻ Ember

Uma faixa discreta, no laranja do Claude, que fica **logo acima da caixa de mensagem do Claude Code** e mostra o gasto de tokens **em tempo real**.

```
╭──────────────────────────────────────────────────────────────────────────────────────────╮
│ ✻ Ember ● respondendo 86 tok/s         ↑ 12.4k entrada  ↓ 3.1k saída  ⟳ 184k cache        │
│                                        ◔ ████░░░░░░ 42% contexto  $ 0.537 gasto  ◷ 23% 5h │
╰──────────────────────────────────────────────────────────────────────────────────────────╯
```

As cores vêm do tema do próprio Claude Code (`claude`, `warning`, `error`), então acompanham o modo claro e escuro.

## O que aparece

| Item | Significado |
| --- | --- |
| **● respondendo / ○ ocioso** | se o Claude está respondendo agora (a borda fica laranja enquanto trabalha) |
| **tok/s** | velocidade da resposta que está chegando |
| **↑ entrada** | tokens enviados ao modelo (inclui escrita de cache) |
| **↓ saída** | tokens gerados — sobe ao vivo durante a resposta e é corrigido pelo valor real da API ao final |
| **⟳ cache** | tokens lidos do cache de prompt (mais baratos) |
| **◔ contexto** | quanto da janela de contexto está ocupada (laranja normal; amarelo a partir de 60% e vermelho a partir de 85%) |
| **$ gasto** | custo da sessão em dólares, igual ao `/cost` |
| **◷ 5h / 7d** | uso das janelas de limite da assinatura |

Funciona no **terminal** e no **app desktop**. Em telas estreitas os rótulos somem e só ficam ícones e números. Para recolher a faixa, clique no `[-]` à direita dela (ou `ctrl+x ctrl+a`).

## Instalação

No prompt de uma sessão do Claude Code no terminal:

```
/plugin install ember --marketplace Ygormarques7/ember
```

Responda `y` para adicionar o marketplace e depois escolha o escopo (aperte Enter para o escopo de usuário). A faixa aparece na hora.

Pelo shell:

```
claude plugin install ember --marketplace Ygormarques7/ember
```

No app desktop (onde `/plugin` não roda): clique em **+** ao lado da caixa de mensagem → **Plugins** → **Add marketplace** com `Ygormarques7/ember` → **Add plugin**.

## Desenvolvimento

```
claude plugin validate .   # confere manifesto e hooks
claude plugin test .       # roda os testes em tests/
claude --plugin-dir .      # abre uma sessão com o mod carregado desta pasta
```

O código fica em `hooks/register.tsx`:

- `turn.step` — lê a resposta do modelo enquanto ela chega, estima os tokens de saída ao vivo (~4 caracteres por token) e, no fim, soma os valores reais que a API devolveu;
- `session.measure` — atualiza contexto, custo e limites depois de cada turno;
- `ui.render` em `AbovePrompt` — desenha a faixa.

## Licença

MIT
