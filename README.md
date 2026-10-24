# harness-session-guard

Mod do Claude Code que mede o seu tempo de atenção com o agente e mostra, acima do prompt, uma bolinha **T** com a cor do nível: esmaecida (neutro), laranja (atenção) ou vermelha (alerta). Pressionar a bolinha abre um painel com os detalhes da sessão e a tendência dos últimos 30 dias. O comando `/hsg` mostra os mesmos detalhes em texto.

Não há toast, som nem alerta repetido: a cor só muda quando o nível sobe.

## Instalação

Versão testada: **Claude Code 2.1.310**. O mod recusa versões anteriores e mostra o erro em `/hsg`.

- No terminal, dentro do Claude Code:
  `/plugin install harness-session-guard --marketplace MarceloRab/harness-session-guard`
- No shell:
  `claude plugin install harness-session-guard --marketplace MarceloRab/harness-session-guard`
- No app desktop (onde `/plugin` não roda): clique em **+** ao lado do prompt → **Plugins** → **Add marketplace** com `MarceloRab/harness-session-guard` → **Add plugin**.

Depois da linha de instalação, responda `y` para adicionar o marketplace e escolha o escopo.

## Onde aparece

- **Terminal e app desktop**: a bolinha T na faixa acima do prompt e o painel de detalhes.
- **VS Code e mobile**: sem bolinha (essas superfícies não desenham a faixa acima do prompt). Use `/hsg`.

## Comandos

| Comando | O que faz |
| --- | --- |
| `/hsg` | Detalhes da sessão de atenção em texto |
| `/hsg silenciar 1h` | Silencia por 1 hora |
| `/hsg silenciar amanha` | Silencia até amanhã, na hora de início do expediente |
| `/hsg reativar` | Encerra o silêncio |
| `/hsg apagar-dados` | Explica o que é apagado |
| `/hsg apagar-dados confirmar` | Apaga todos os dados guardados pelo mod |

Silenciado, a bolinha fica esmaecida com `silenciado até HH:MM`, e a medição continua.

## Configuração

No `/config`, linhas do `harness-session-guard`:

| Campo | Padrão | Valores |
| --- | --- | --- |
| `inicio` | 6 | hora de início do expediente, 0–23 |
| `fim` | 22 | hora de fim do expediente, 1–24, maior que `inicio` |
| `dias` | `seg-sex` | `seg-sex`, `seg-sab`, `todos` |
| `intensidade` | `padrao` | `discreto`, `padrao`, `rigido` |
| `fimAtencaoMin` | 60 | minutos sem interação que encerram a sessão de atenção |
| `pausaMinMin` | 15 | minutos sem interação que contam como pausa (menor que `fimAtencaoMin`) |

Configuração inválida não é corrigida por palpite: o mod para de medir e mostra o campo com erro na bolinha, no status e em `/hsg`.

### Limites provisórios

Os limites de "sem pausa" e de "sessão longa" de cada intensidade são provisórios e podem mudar:

| Intensidade | Sem pausa | Longa |
| --- | --- | --- |
| `discreto` | 3h00 | 4h30 |
| `padrao` | 2h00 | 3h00 |
| `rigido` | 1h30 | 2h15 |

Atenção = sessão sem pausa **ou** interação fora do expediente. Alerta = sessão longa, **ou** sem pausa e fora do expediente.

## Como mede

- **Fora do expediente** é avaliado com o expediente vigente na hora da interação. Mudar o expediente não reclassifica interações antigas.
- **Cada janela do Claude Code mede a própria sessão**; a tendência de 30 dias soma todas.
- **Convivência com o laudo**: o laudo de excesso de trabalho usa 45 min entre commits; o mod usa `fimAtencaoMin` entre interações. Os números não são comparáveis.

## Privacidade

- **Nada sai da sua máquina.** O mod não usa `$.telemetry`, não faz chamadas de rede nem chamadas ao modelo.
- O que fica guardado, no armazenamento do próprio mod (`$.store`, um arquivo JSON no diretório de configuração do Claude Code):
  - horários de início e fim de cada sessão de atenção, contagens de interações, maior pausa e os dias (AAAA-MM-DD), dos últimos 30 dias;
  - o estado do silêncio (até quando);
  - se a explicação inicial já foi mostrada;
  - um diário de eventos **sem texto**: horário, tipo (`nivel`, `detalhes`, `silenciar`, `reativar`, `erro`), nível e um código de uma lista fechada.
- **Nunca** é guardado texto de prompt, de conversa, de comando digitado nem caminho de arquivo.
- `/hsg apagar-dados confirmar` apaga tudo isso.

## Sem sandbox

O Claude Code roda mods **sem sandbox**: o código deste mod tem o mesmo acesso que o próprio Claude Code. Leia o código antes de instalar; ele está todo em `hooks/`.

## Depuração

Com a variável de ambiente `HSG_DEBUG=1`, cada evento do diário também aparece como linha no transcript, e o início da sessão registra `harness-session-guard tz=<minutos>` (o fuso local). Sem a variável, nada vai para o transcript.
