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

// Erro corrente de dados (track 03): `codigo` do conjunto fechado de `livro.ts`; `detalhe` só a mensagem de recusa do store.
export type ErroDados = { codigo: string; detalhe: string | null }

declare module 'claude-code' {
  interface PluginState {
    'harness-session-guard': {
      atencao: Shaped<Sessao | null>
      // U4 (D18): a linha de explicação fica visível até abrir os detalhes ou fechar a sessão.
      explicar: Shaped<boolean>
      erro: Shaped<ErroDados | null>
    }
  }
}
