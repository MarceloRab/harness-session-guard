// Contrato do $.state do harness-session-guard.

// Sessão de atenção viva (D-T4): horários em ms desde a epoch; `turnoAberto` é o `desde` do turno do agente em andamento (D-T3).
export type Sessao = {
  id: string
  ini: number
  ultimaID: number
  turnoAberto: number | null
}

// Objetivo aberto (D-O1): vive só no `$.state`; `texto` e `dod` nunca vão para o `$.store`.
export type Objetivo = {
  id: string
  texto: string
  dod: string | null
  abertoEm: number
  timeboxMin: number | null
}

// Erro corrente de dados: `codigo` do conjunto fechado de `livro.ts`; `detalhe` só a mensagem de recusa do store.
export type ErroDados = { codigo: string; detalhe: string | null }

// Camada 1 (D-C1…D-C7): vive só no `$.state`. Uma fonte que falha é `{ ok: false, motivo }`, nunca zero.
export type Dado<V> = { ok: true; valor: V } | { ok: false; motivo: string }

// D-J3: prompt digitado, só `len` e `hash` do texto normalizado (nunca o texto); `k` é a ordem.
export type PromptRegistro = { k: number; t: number; len: number; hash: string }

// D-C2: `t` em ms (horário de época do commit); `assunto` cortado em 200 caracteres.
export type Commit = { hash: string; t: number; assunto: string }

export type Fatos = {
  // null = objetivo não declarado: a janela é a sessão viva.
  objetivo: { abertoEm: number; fechamento: number | null; timeboxMin: number | null; temDod: boolean } | null
  ini: number
  // Fim da janela para as durações: o fechamento ou o último evento (sem relógio).
  fim: Dado<number>
  tempoAtivoSeg: Dado<number>
  commits: Dado<Commit[]>
  desdeAvancoSeg: Dado<number>
  timebox: Dado<{ min: number; atingido: boolean }> | null
  turnos: number
  semMensagem: Dado<number>
  mensagensSemRegistro: Dado<number>
  // Pelo menos: a compactação e os prompts sem registro reduzem o que o T enxerga (D-C6).
  edicoes: Dado<number>
  ciclos: Dado<number>
  compactacoes: number[]
}

export type Calculo = { tipo: 'nada' } | { tipo: 'fatos'; fatos: Fatos }

// D-J4: um bloco do `prompt` do juiz, no formato de `$.model.complete`.
export type Bloco = { text: string; cache?: true }

// D-P4/D-J11: a última entrada do juiz (ou o motivo de não montar); só `$.state`. `t` não entra no hash.
// `evidencia` = os itens de texto (prompt digitado e texto do agente, normalizados) realmente enviados: a base da C1.
export type EntradaC = { t: number } & (
  | { ok: true; blocos: Bloco[]; hash: string; evidencia: string[] }
  | { ok: false; motivo: string }
)

// D-J2/D-J13.
export type Dimensao = 'dod' | 'suposicao' | 'tangente' | 'semLastro'
export type Voto = 'util' | 'nao-se-aplica' | 'errado'
export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

// D-J9: um achado do juiz (nível 1 ou 2, com citação). `h` = 12 hex do SHA-256 da citação normalizada (Y3).
// `descartado` = a C1 não achou a citação na evidência enviada. `voto` = o último U2 deste achado nesta tela.
export type Achado = {
  dim: Dimensao
  h: string
  nivel: 1 | 2
  citacao: string
  estado: 'novo' | 'ja-apontado' | 'descartado'
  voto?: Voto
}

// D-P4: o resultado do juiz; só `$.state`. `reutilizado` = hash igual ao da avaliação anterior, sem chamada.
// `gravacao` = o código do erro se a escrita em `avaliacoes` falhou (a avaliação continua visível).
export type Juiz = {
  hash: string
  t: number
  resultado: 'ok' | 'json-invalido' | 'api-error' | 'empty-reply' | 'aborted'
  achados: Achado[]
  // null = a chamada foi recusada antes de enviar (nenhum custo medido; nada é inventado).
  usage: Usage | null
  motivo?: string
  reutilizado?: true
  gravacao?: string
}

// mod-v2-feed D-F7: objetivo e DoD da avaliação, para preencher as sugestões; só `$.state`.
export type Alvo = { texto: string; dod: string }

// D-C-UI/D-J10: o que a tela da C lê. `andamento` = chamada ao modelo em curso. `contexto` = C6 (informativo).
// `alvo` (D-F7) = null quando a avaliação não tinha objetivo com DoD.
export type ResultadoC = {
  calculo: Calculo
  juiz: Juiz | null
  andamento: boolean
  // Falha da sugestão (prompt não preenchido) ou de U2 (voto não gravado), com o motivo.
  aviso?: string
  contexto: Dado<{ tokens: number | null; window: number; percent: number | null }>
  alvo: Alvo | null
}

declare module 'claude-code' {
  interface PluginState {
    'harness-session-guard': {
      // shape 'atencao-2' (D-P4): um valor guardado por outro shape é recusado.
      atencao: Shaped<Sessao | null>
      // Instante do último tick de 1 min (D-T7); lido só para redesenhar o relógio.
      pulso: Shaped<number>
      // shape 'objetivo-1' (D-O1): no máximo um objetivo aberto por processo.
      objetivo: Shaped<Objetivo | null>
      erro: Shaped<ErroDados | null>
      // shape 'prompts-1' (D-J3): prompts digitados, em ordem de `k`.
      prompts: Shaped<PromptRegistro[]>
      // shape 'compactacoes-1' (D-C6): horário de cada compactação manual, automática ou de plugin.
      compactacoes: Shaped<number[]>
      // shape 'resultadoC-3' (D-C-UI, D-P4, D-F7): camada 1, resultado do juiz, C6 e `alvo`; null = nenhum ainda.
      resultadoC: Shaped<ResultadoC | null>
      // shape 'entradaC-1' (D-P4): última entrada do juiz montada pelo clique na C ou por `/hsg avaliar`.
      entradaC: Shaped<EntradaC | null>
    }
  }
}
