# >_ Sugador de Tokens

> Plugin `ember`: o nome de instalação continua o mesmo.

Um painel preto, com uma chuva de caracteres verdes no estilo Matrix no fundo e um Mario sentado na borda, que fica **logo acima da caixa de mensagem do Claude Code** e mostra o gasto **em tempo real** e quanto dos seus limites já foi usado, como a página de uso do claude.ai.

```
>_ Sugador de Tokens  ● sugando  86 tok/s                       55k tokens   $0.537 gasto
Sessão ━━━━━━━━━━──── 71%  reinicia em 2h10    Semana ━━━━────────── 30%  reinicia em 4d 12h
```

O painel é sempre preto, estilo terminal, só em preto, verde e branco. No terminal fica só o painel em texto, sem chuva e sem Mario.

## O Mario

No app desktop um Mario em pixel art fica sentado no canto de cima da faixa, com uma perna pendurada por cima do painel. Toda vez que Sessão ou Semana vira de dezena (9% → 10%, 19% → 20%, ..., 49% → 50%, ...), ele:

1. sai do canto e desce andando, com os pés alternando a cada passo;
2. pula em cima do número, e é nessa hora que o número antigo vira o novo;
3. pula de volta para o chão e volta andando até o lugar dele.

Enquanto ele não pousa no número, a barra continua mostrando o valor antigo. Uma virada dentro da mesma dezena (por exemplo, 20% → 25%) não faz ele sair do lugar.

> O Mario é personagem da Nintendo; o desenho está aqui só como homenagem de fã, sem fins comerciais.

## O que aparece

| Item | Significado |
| --- | --- |
| **● sugando** | aparece enquanto o Claude está respondendo (a borda acende em verde) |
| **tok/s** | velocidade da resposta que está chegando |
| **tokens** | total da sessão (entrada, cache e saída); fica verde e sobe ao vivo durante a resposta, e é corrigido pelo valor real da API ao final |
| **$ gasto** | custo da sessão em dólares, igual ao `/cost`; atualiza a cada resposta da API |
| **Sessão** | uso da janela de 5 horas da assinatura e quanto falta para reiniciar |
| **Semana** | uso da janela de 7 dias da assinatura e quanto falta para reiniciar |

As barras ficam verdes, amarelas a partir de 60% e vermelhas a partir de 85%. Sessão e Semana só aparecem em contas com assinatura (uso por API key não tem esses limites).

Funciona no **terminal**, no **app desktop** e no **VS Code**. A faixa ocupa a largura toda e se reorganiza conforme o espaço: larga, Sessão e Semana lado a lado com o "reinicia em"; média, sem o "reinicia em"; estreita, uma embaixo da outra; muito estreita, vira texto e o Mario sai de cena. Para recolher a faixa, clique no `[-]` à direita dela (ou `ctrl+x ctrl+a`).

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
- `session.measure` — atualiza custo e limites (com o horário de reset) depois de cada resposta e, quando uma barra vira de dezena, começa a caminhada do Mario;
- `ui.render` em `AbovePrompt` — desenha a faixa: no app e no VS Code como um único SVG com largura e altura explícitas (a largura vem das colunas da faixa, ~7,88 px cada), com o layout recalculado para essa largura; painel, chuva, texto, barras e Mario ficam no mesmo sistema de coordenadas e a troca do número acontece dentro da própria animação. No terminal, em texto;
- `hooks/mario.ts` — os desenhos do Mario (sentado, em pé e no meio do passo) como grades de texto, viradas em SVG.

## Licença

MIT
