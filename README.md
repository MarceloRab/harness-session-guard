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

- **Terminal e app desktop**: as bolinhas T e C na faixa acima do prompt. O resultado de cada `/hsg` aparece no feed do chat, na linha do comando.
- A linha rica da C no feed (com botões de voto e de sugestão) foi testada no terminal; no VS Code e no mobile ela não foi verificada.
- **VS Code e mobile**: sem bolinhas (essas superfícies não desenham a faixa acima do prompt). Use `/hsg`.

### Clique nas bolinhas

- Clique na **C**: escreve `/hsg avaliar` na caixa do prompt vazia; você aperta Enter.
- Clique na **T**: escreve `/hsg` na caixa vazia; você aperta Enter.
- Com texto na caixa, nada é escrito e aparece um aviso esmaecido ao lado das bolinhas (`caixa com texto: envie ou apague e clique de novo (ou digite /hsg avaliar)`); se a caixa não puder ser lida ou escrita, o aviso diz `caixa indisponível` com o motivo. A próxima execução de `/hsg` limpa o aviso.
- O clique conta como interação (T), mesmo quando só mostra o aviso.

## Comandos

Os mesmos do `/hsg` sem argumento reconhecido:

| Comando | O que faz |
| --- | --- |
| `/hsg` | detalhes da sessão de atenção |
| `/hsg objetivo` | mostra o objetivo e o DoD abertos |
| `/hsg objetivo abrir [timebox=<min>] <texto>` | abre um objetivo |
| `/hsg objetivo trocar [timebox=<min>] <texto>` | fecha o atual como troca e abre outro |
| `/hsg objetivo dod <texto>` | define o DoD do objetivo aberto |
| `/hsg objetivo fechar` | fecha o objetivo (conta como avanço) |
| `/hsg avaliar` | avalia (camada 1 e juiz) e mostra no feed |
| `/hsg entrada` | mostra no feed a entrada exata do juiz |
| `/hsg apagar-dados` | explica o que é apagado |
| `/hsg apagar-dados confirmar` | apaga os dados do harness-session-guard |

O `timebox` é um inteiro ≥ 1. `apagar-dados confirmar` também encerra o objetivo aberto.

### O que o modelo lê de cada `/hsg`

- `/hsg avaliar` e `/hsg entrada`: só a linha curta com id, `avaliação C id <n> exibida ao dev; o resultado fica fora do contexto do modelo` e `entrada do juiz id <n> exibida ao dev; o conteúdo fica fora do contexto do modelo`. A árvore desenhada no feed (resultado, botões, blocos da entrada) não entra no contexto. Sem avaliação possível ou sem entrada montada, a linha é o texto curto de sempre (`Indisponível: … · /hsg`, `Avaliação em andamento.`, `Nenhuma entrada montada…`).
- `/hsg` (T) e os demais comandos entram como texto: horários e durações, sem conteúdo da conversa.
- Uma linha de uma avaliação mais antiga, ou de antes de reiniciar o Claude Code, mostra o texto guardado esmaecido e "Detalhes fora da memória", sem botões.

### Limites

- Um `/hsg` digitado durante um turno do agente espera o fim do turno.
- A linha do `/hsg avaliar` aparece depois da resposta do juiz (até 180 s); sem turno novo, o juiz não é chamado e a linha aparece logo.
- Não há gatilho automático nem nova tentativa.
- Limite conhecido: depois de reiniciar ou de zerar a memória da sessão, o juiz recebe os achados já apontados no objetivo e pode deixar de repetir um achado que ainda vale.

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
- **Cor da T**: esmaecida (neutra); laranja quando a sessão chega a `limiteSessaoMin`; vermelha quando o dia chega a `limiteDiaMin`. Vermelha prevalece sobre laranja. Os detalhes em `/hsg` acrescentam "Veja a qualidade no tempo em C." quando a cor não é neutra.
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

Só `/hsg avaliar` avalia (o clique na C apenas o escreve na caixa). Não há gatilho automático, nova tentativa automática nem recuo.

**Camada 1 (sem tokens, sem modelo)**, por objetivo ou, sem objetivo, pela sessão viva: tempo ativo, commits na janela (assuntos), ciclos de refinamento ("pelo menos"), tempo desde o último avanço (commit ou fechamento), timebox, turnos do dev, edições ("pelo menos"), compactações do contexto. A linha mostra numa linha só o escopo, o tempo ativo, o número de commits, o último avanço, os ciclos e o timebox; os demais fatos (assuntos, turnos, edições) vão ao juiz. Uma fonte que falha aparece como "<fato> indisponível (motivo)" na posição do fato, nunca como zero.

**Juiz cego** (só com objetivo **e** DoD): uma chamada a `claude-sonnet-5-5`, esforço médio, sem histórico, com a rubrica **v2**. Quatro dimensões, cada uma com nível 0, 1 ou 2: DoD, suposição, tangente e afirmação sem lastro. Cada achado vem com uma citação literal, que o mod confere contra a evidência enviada; achado com citação não encontrada é descartado e contado. O juiz não produz sugestão: só nível e citação. Cada achado (nível 1 ou 2, não descartado) tem votos (útil, não se aplica, errado). Um achado já apontado antes, no mesmo objetivo, aparece como "já apontado".

**Sugestões de prompt** (sem modelo e sem custo): a avaliação é ruim quando alguma dimensão fica em nível 2 depois da conferência da citação. Então a linha mostra "Sugestões de prompt (escrevem na caixa, não enviam):" e um botão por dimensão em nível 2: **Melhorar DoD** (DoD), **Preencher lacunas** (suposição), **Exigir lastro** (sem lastro), **Voltar ao DoD** (tangente). Nível 1 aparece só com votos, sem botão.

- Cada botão acrescenta à caixa um texto de template fixo (versão `s1`) com o objetivo, o DoD e a citação (cortada em 300 caracteres).
- Nunca apaga o rascunho: com texto na caixa, acrescenta uma linha em branco e o template depois dele. Nunca envia: você revisa e aperta Enter.
- Se o template não puder ser escrito, a linha mostra "Aviso: o prompt não foi preenchido" com o motivo.

**Juiz só com turno novo.** O juiz só é chamado quando há turno novo desde a última avaliação ok do mesmo objetivo; a avaliação seguinte pede que ele avalie a partir do turno seguinte ao último avaliado.

- Sem turno novo, a linha diz `Sem turnos novos desde a avaliação das HH:MM: resultado do juiz mantido, sem nova chamada.`: o resultado anterior continua na tela, sem custo novo e sem gravar nada no armazenamento.
- Um commit sem turno novo atualiza só a camada 1: o juiz avalia os turnos do agente.
- Uma avaliação feita com um turno do agente em andamento julga esse turno, que volta a ser avaliado na próxima.
- Depois de reiniciar o Claude Code (objetivo reaberto), ou quando a memória da sessão foi zerada, a primeira avaliação chama o juiz desde o primeiro turno do objetivo: o resultado do juiz não é guardado no armazenamento.
- Uma avaliação com erro não conta: pode ser pedida de novo com `/hsg avaliar`. Não há nova tentativa automática.
- Antes da regra do turno novo vale um caso estreito: entrada idêntica à da última chamada (o mesmo hash) com o resultado ok ainda na memória; então a linha diz "Resultado guardado, sem custo: a entrada não mudou desde a última avaliação.".
- Um `/hsg avaliar` durante uma chamada em andamento responde "Avaliação em andamento." e não dispara outra.

**A linha do `/hsg avaliar` no feed**, de cima para baixo:

1. A camada 1 numa linha; abaixo, esmaecidas, só quando houver: histórico compactado, prompts sem mensagem correspondente, mensagens do dev sem registro. Depois, as linhas de estado (aviso, avaliação em andamento, resultado guardado, sem turnos novos, gravação recusada).
2. Os eixos **DoD**, **Suposição**, **Tangente** e **Sem lastro**, cada um na sua cor, com o nível, um resumo fixo do nível, a citação curta (até 160 caracteres) embaixo e os votos (`útil`, `não se aplica`, `errado`) quando há achado.
3. O laudo, em negrito: `Laudo: ruim · nível 2 em …`, `Laudo: atenção · indício em …`, `Laudo: sem apontamentos` ou `Laudo: indisponível · <motivo>` (entrada não montada, juiz com erro ou sem resposta).
4. As sugestões de prompt, quando a avaliação é ruim.
5. O rodapé esmaecido: `Custo do juiz às HH:MM: input … · cache_read … · cache_creation … · output … · fora do /usage · não vê CLAUDE.md nem skills · não determinístico` (sem juiz na tela, só o aviso fixo) e o contexto da sessão.

- O juiz **não vê CLAUDE.md nem skills**: um DoD que remete a eles não é verificável.
- A chamada **não entra no custo da sessão nem no `/usage`**.
- **O resultado não é determinístico**: o modelo julga a conversa.
- `/hsg entrada` mostra no feed a entrada exata enviada (os blocos e o hash); o hash só aparece ali. Sem objetivo e DoD, a entrada não é montada e a linha diz o motivo.

## Privacidade

**Mudança de natureza em relação à versão anterior**, que não saía da máquina: ao rodar `/hsg avaliar` (o clique na C só o escreve na caixa), a entrada do juiz **sai ao modelo**, pela mesma conexão e credenciais do seu Claude Code. Ela contém: os prompts que você digitou, o texto das respostas do agente, um resumo das chamadas de ferramenta (nome, arquivo e ok/erro), os fatos da camada 1 (inclusive os assuntos dos commits), o objetivo e o DoD. Até 40 KB de evidência; acima disso, os turnos mais antigos são omitidos e a entrada diz quantos.

- `git log` roda **localmente**, com argumentos fixos e sem shell, no diretório da sessão; só os assuntos dos commits são lidos.
- O mod não tem sandbox (veja abaixo).
- Não há telemetria nem rede além da chamada ao modelo.
- O **armazenamento do mod** (`$.store`, um arquivo JSON no diretório de configuração do Claude Code) guarda só horários, contagens, hashes, `usage`, votos e eventos de objetivo **sem texto**:
  - `livro`: id, início e fim de cada sessão de atenção, dos últimos 30 dias;
  - `objetivos`: eventos `abrir`, `trocar`, `fechar` e `timebox` com horário e id, sem texto nem DoD;
  - `avaliacoes`: ids curtos de achados (hash da citação), números da camada 1, hash e `usage` de cada chamada, e votos.
- **Nunca** é guardado no armazenamento texto de prompt, de objetivo, de DoD, de citação, de commit ou do resultado do juiz, nem caminho de arquivo.
- Na memória da sessão (some ao reiniciar) ficam o texto e o DoD do objetivo (e os da última avaliação, para as sugestões), o resultado do juiz, a entrada enviada, o aviso da faixa e, para casar suas mensagens com o histórico, o tamanho e o hash de cada prompt digitado.

### `/hsg apagar-dados confirmar`

Remove `livro`, `objetivos`, `avaliacoes` e os dados da versão anterior (`silencio`, `explicado`, `diario`), e encerra o objetivo aberto. A sessão de atenção aberta continua sendo medida.

## Sem sandbox

O Claude Code roda mods **sem sandbox**: o código deste mod tem o mesmo acesso que o próprio Claude Code. Leia o código antes de instalar; ele está todo em `hooks/`.

## Migração

Um `livro` no formato 1 é migrado sozinho para o formato 2. As configurações antigas (`inicio`, `fim`, `dias`, `intensidade`, `pausaMinMin`) são ignoradas. Dados antigos sem uso (`silencio`, `explicado`, `diario`) aparecem em `/hsg` até você apagá-los.

## Depuração

Com a variável de ambiente `HSG_DEBUG=1`, o início da sessão registra `harness-session-guard tz=<minutos>` (o fuso local) e cada gravação em `objetivos` e `avaliacoes` registra só o tipo (`abrir`, `trocar`, `fechar`, `timebox`; `clique`, `achado`, `feedback`). Sem a variável, nada vai para o log.
