# ✻ Ember

Uma faixa discreta, no laranja do Claude, que fica **logo acima da caixa de mensagem do Claude Code** e mostra o gasto **em tempo real** e quanto dos seus limites já foi usado, como a página de uso do claude.ai.

```
✻ Ember  ● respondendo  86 tok/s                       55k tokens   $0.537 gasto
Sessão ━━━━━━━━━━──── 71%  reinicia em 2h10    Semana ━━━━────────── 30%  reinicia em 4d 12h
```

As cores vêm do tema do próprio Claude Code (`claude`, `warning`, `error`), então acompanham o modo claro e escuro.

## O que aparece

| Item | Significado |
| --- | --- |
| **● respondendo / ○ ocioso** | se o Claude está respondendo agora (a borda fica laranja enquanto trabalha) |
| **tok/s** | velocidade da resposta que está chegando |
| **tokens** | total da sessão (entrada, cache e saída); fica laranja e sobe ao vivo durante a resposta, e é corrigido pelo valor real da API ao final |
| **$ gasto** | custo da sessão em dólares, igual ao `/cost`; atualiza a cada resposta da API |
| **Sessão** | uso da janela de 5 horas da assinatura e quanto falta para reiniciar |
| **Semana** | uso da janela de 7 dias da assinatura e quanto falta para reiniciar |

As barras ficam laranja, amarelas a partir de 60% e vermelhas a partir de 85%. Sessão e Semana só aparecem em contas com assinatura (uso por API key não tem esses limites).

Funciona no **terminal** e no **app desktop**. Em telas estreitas os rótulos e o "reinicia em" somem e as barras encolhem. Para recolher a faixa, clique no `[-]` à direita dela (ou `ctrl+x ctrl+a`).

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
- `session.measure` — atualiza custo e limites (com o horário de reset) depois de cada resposta;
- `ui.render` em `AbovePrompt` — desenha a faixa.

## Licença

MIT
