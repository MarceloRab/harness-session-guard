// Contrato do $.state do harness-session-guard.

// Sessão de atenção viva (D-T4): horários em ms desde a epoch; `turnoAberto` é o `desde` do turno do agente em andamento (D-T3).
export type Sessao = {
  id: string
  ini: number
  ultimaID: number
  turnoAberto: number | null
}

// Erro corrente de dados: `codigo` do conjunto fechado de `livro.ts`; `detalhe` só a mensagem de recusa do store.
export type ErroDados = { codigo: string; detalhe: string | null }

declare module 'claude-code' {
  interface PluginState {
    'harness-session-guard': {
      // shape 'atencao-2' (D-P4): um valor guardado por outro shape é recusado.
      atencao: Shaped<Sessao | null>
      // Instante do último tick de 1 min (D-T7); lido só para redesenhar o relógio.
      pulso: Shaped<number>
      erro: Shaped<ErroDados | null>
    }
  }
}
