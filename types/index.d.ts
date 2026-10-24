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
export type EntradaC = { t: number } & ({ ok: true; blocos: Bloco[]; hash: string } | { ok: false; motivo: string })

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
      // shape 'resultadoC-1' (D-C-UI): último cálculo da camada 1; null = nenhum ainda.
      resultadoC: Shaped<Calculo | null>
      // shape 'entradaC-1' (D-P4): última entrada do juiz montada pelo clique na C ou por `/hsg avaliar`.
      entradaC: Shaped<EntradaC | null>
    }
  }
}
