# harness-session-guard

Mod do Claude Code que faz duas coisas, sempre sob o seu comando:

- **T** mede o seu tempo de atenção com o agente e o mostra acima do prompt como `● T 2h10 · 6h40` (sessão de atenção · total do dia).
- **C** avalia, quando você pede, se o trabalho do agente está no rumo do objetivo e do DoD que você declarou: primeiro com fatos medidos sem tokens (a camada 1) e depois com um juiz cego (um modelo).

A bolinha **C** (`● C`) fica ao lado da T e nunca muda de cor. Nada é avaliado sozinho.

O comando `/hsg` mostra os detalhes em texto.

## Instalação

Requisito: **Claude Code 2.1.310 ou superior** (testado em 2.1.310). O mod recusa versões anteriores, não mede e mostra o erro em `/hsg`.

- No terminal, dentro do Claude Code:
  `/plugin install harness-session-guard --marketplace MarceloRab/harness-session-guard`
- No shell:
  `claude plugin install harness-session-guard --marketplace MarceloRab/harness-session-guard`
- No app desktop (onde `/plugin` não roda): clique em **+** ao lado do prompt → **Plugins** → **Add marketplace** com `MarceloRab/harness-session-guard` → **Add plugin**.

Depois da linha de instalação, responda `y` para adicionar o marketplace e escolha o escopo.

## Onde aparece

- **Terminal e app desktop**: as bolinhas T e C na faixa acima do prompt e os painéis (clique na T: detalhes; clique na C: avaliação).
- **VS Code e mobile**: sem bolinhas (essas superfícies não desenham a faixa acima do prompt). Use `/hsg`.

## Comandos

| Comando | O que faz |
| --- | --- |
| `/hsg` | Detalhes da sessão de atenção em texto |
| `/hsg objetivo` | Mostra o objetivo e o DoD abertos |
| `/hsg objetivo abrir [timebox=<min>] <texto>` | Abre um objetivo (com timebox opcional, inteiro ≥ 1) |
| `/hsg objetivo trocar [timebox=<min>] <texto>` | Encerra o atual como troca e abre outro |
| `/hsg objetivo dod <texto>` | Define o DoD do objetivo aberto |
| `/hsg objetivo fechar` | Fecha o objetivo; conta como avanço |
| `/hsg avaliar` | Calcula a camada 1 e, com objetivo e DoD, chama o juiz (o mesmo que clicar na C) |
| `/hsg entrada` | Mostra a entrada exata do último cálculo e o hash, sem chamar o modelo |
| `/hsg apagar-dados` | Explica o que é apagado |
| `/hsg apagar-dados confirmar` | Apaga os dados guardados pelo mod e encerra o objetivo aberto |

## Configuração

No `/config`, linhas do `harness-session-guard`:

| Campo | Padrão | Valores |
| --- | --- | --- |
| `limiteSessaoMin` | 120 | minutos da sessão de atenção em que a T fica laranja, inteiro ≥ 1 |
| `limiteDiaMin` | 480 | minutos de atenção no dia em que a T fica vermelha, inteiro maior que `limiteSessaoMin` |
| `fimAtencaoMin` | 60 | minutos sem interação que encerram a sessão de atenção, inteiro ≥ 1 |

Configuração inválida não é corrigida por palpite: o mod para de medir e mostra o campo com erro na faixa, no status e em `/hsg`.

## T: o que mede

- **Sessão de atenção**: começa numa interação sua e termina quando passam `fimAtencaoMin` sem interação. Interações que contam: o envio de um prompt (composer ou bridge), qualquer execução de `/hsg` e o clique nas bolinhas.
- **Turno aberto suspende o fim da atenção**: enquanto o agente trabalha num turno seu, a sessão não fecha; o fim do turno renova a atenção.
- **Total do dia**: a união dos intervalos de todas as janelas do Claude Code, cortada na meia-noite local.
- **Cor da T**: esmaecida (neutra); laranja quando a sessão chega a `limiteSessaoMin`; vermelha quando o dia chega a `limiteDiaMin`. Vermelha prevalece sobre laranja. Os detalhes em `/hsg` e no painel acrescentam "Veja a qualidade no tempo em C." quando a cor não é neutra.
- **Cada janela mede a própria sessão**: o total do dia une todas, e a sessão viva de outra janela entra nele só pelo último registro gravado (atualizado a cada minuto).

### O relógio é um piso

O relógio mostra "pelo menos" o tempo de atenção. Ao fechar, a sessão termina na última interação, então o relógio pode recuar até `fimAtencaoMin`. O total do dia também é "pelo menos".

Limites conhecidos: um turno que nunca recebe o seu fim mantém a sessão aberta até o encerramento do Claude Code (`/hsg` mostra "Turno aberto desde HH:MM").

## Objetivo

`/hsg objetivo abrir [timebox=<min>] <texto>` declara o que você quer do agente; `dod <texto>` define o critério de pronto; `trocar` encerra o atual como troca e abre outro; `fechar` o encerra e conta como avanço.

- O **texto e o DoD ficam só na memória da sessão**, nunca no armazenamento do mod.
- O objetivo é **do processo**: após reiniciar o Claude Code, usar `--resume` ou abrir outra janela, ele não existe e precisa ser reaberto. Um objetivo aberto de um processo encerrado fica no histórico sem fechamento: não é fechado, não é reaproveitado e não conta tempo. Abrir uma segunda janela não fecha o objetivo da primeira.
- Com `timebox`, o mod registra uma única vez, no tick de 1 minuto, quando o tempo ativo do objetivo chega ao timebox. Não há aviso na tela; a C mostra se o timebox foi atingido.
- `/hsg apagar-dados confirmar` também encerra o objetivo aberto; reabra com `/hsg objetivo abrir`.

## C: avaliação manual

Só o clique na bolinha C ou `/hsg avaliar` avaliam. Não há gatilho automático, nova tentativa automática nem recuo.

**Camada 1 (sem tokens, sem modelo)**, por objetivo ou, sem objetivo, pela sessão viva: tempo ativo, commits na janela (assuntos), ciclos de refinamento ("pelo menos"), tempo desde o último avanço (commit ou fechamento), timebox, turnos do dev, edições ("pelo menos"), compactações do contexto. Uma fonte que falha aparece como "indisponível (motivo)" na linha do fato, nunca como zero.

**Juiz cego** (só com objetivo **e** DoD): uma chamada a `claude-sonnet-5-5`, esforço médio, sem histórico, com a rubrica v1. Quatro dimensões, cada uma com nível 0, 1 ou 2: DoD, suposição, tangente e afirmação sem lastro. Cada achado vem com uma citação literal, que o mod confere contra a evidência enviada; achado com citação não encontrada é descartado e contado. A sugestão só existe no nível 2; o botão **usar sugestão** escreve o texto no campo do prompt e nunca o envia. Cada achado tem votos (útil, não se aplica, errado). Um achado já apontado antes, no mesmo objetivo, aparece como "já apontado".

- Com a mesma entrada da avaliação anterior e o resultado ainda na memória, o mod mostra o resultado guardado, sem chamar o modelo ("resultado guardado, sem custo").
- Um clique durante uma chamada em andamento não dispara outra.
- O juiz **não vê CLAUDE.md nem skills**: um DoD que remete a eles não é verificável.
- A chamada **não entra no custo da sessão nem no `/usage`**; a tela mostra o custo da última avaliação (`input`, `cache_read`, `cache_creation`, `output`) e o uso do contexto da sessão.
- **O resultado não é determinístico**: o modelo julga a conversa.
- `/hsg entrada` mostra a entrada exata enviada. Sem objetivo e DoD, a entrada não é montada e a tela diz "defina objetivo e DoD".

## Privacidade

**Mudança de natureza em relação à versão anterior**, que não saía da máquina: ao clicar na C (ou `/hsg avaliar`), a entrada do juiz **sai ao modelo**, pela mesma conexão e credenciais do seu Claude Code. Ela contém: os prompts que você digitou, o texto das respostas do agente, um resumo das chamadas de ferramenta (nome, arquivo e ok/erro), os fatos da camada 1 (inclusive os assuntos dos commits), o objetivo e o DoD. Até 40 KB de evidência; acima disso, os turnos mais antigos são omitidos e a entrada diz quantos.

- `git log` roda **localmente**, com argumentos fixos e sem shell, no diretório da sessão; só os assuntos dos commits são lidos.
- O mod não tem sandbox (veja abaixo).
- Não há telemetria nem rede além da chamada ao modelo.
- O **armazenamento do mod** (`$.store`, um arquivo JSON no diretório de configuração do Claude Code) guarda só horários, contagens, hashes, `usage`, votos e eventos de objetivo **sem texto**:
  - `livro`: id, início e fim de cada sessão de atenção, dos últimos 30 dias;
  - `objetivos`: eventos `abrir`, `trocar`, `fechar` e `timebox` com horário e id, sem texto nem DoD;
  - `avaliacoes`: ids curtos de achados (hash da citação), números da camada 1, hash e `usage` de cada chamada, e votos.
- **Nunca** é guardado no armazenamento texto de prompt, de objetivo, de DoD, de citação, de commit ou do resultado do juiz, nem caminho de arquivo.
- Na memória da sessão (some ao reiniciar) ficam o texto e o DoD do objetivo, o resultado do juiz, a entrada enviada e, para casar suas mensagens com o histórico, o tamanho e o hash de cada prompt digitado.

### `/hsg apagar-dados confirmar`

Remove `livro`, `objetivos`, `avaliacoes` e os dados da versão anterior (`silencio`, `explicado`, `diario`), e encerra o objetivo aberto. A sessão de atenção aberta continua sendo medida.

## Sem sandbox

O Claude Code roda mods **sem sandbox**: o código deste mod tem o mesmo acesso que o próprio Claude Code. Leia o código antes de instalar; ele está todo em `hooks/`.

## Migração

Um `livro` no formato 1 é migrado sozinho para o formato 2. As configurações antigas (`inicio`, `fim`, `dias`, `intensidade`, `pausaMinMin`) são ignoradas. Dados antigos sem uso (`silencio`, `explicado`, `diario`) aparecem em `/hsg` até você apagá-los.

## Depuração

Com a variável de ambiente `HSG_DEBUG=1`, o início da sessão registra `harness-session-guard tz=<minutos>` (o fuso local) e cada gravação em `objetivos` e `avaliacoes` registra só o tipo (`abrir`, `trocar`, `fechar`, `timebox`; `clique`, `achado`, `feedback`). Sem a variável, nada vai para o log.
