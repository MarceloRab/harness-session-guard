// Contrato do $.state do harness-session-guard.

export type Nivel = 'neutro' | 'atencao' | 'alerta'

// Sessão de atenção viva (D4): horários em ms desde a epoch; `dias` em AAAA-MM-DD locais.
export type Sessao = {
  id: string
  ini: number
  fim: number
  ultimaID: number
  n: number
  nFora: number
  maiorLacunaSeg: number
  dias: string[]
  nivelMax: Nivel
}

declare module 'claude-code' {
  interface PluginState {
    'harness-session-guard': { atencao: Shaped<Sessao | null> }
  }
}
