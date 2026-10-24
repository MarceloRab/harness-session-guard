// Motor puro de atenção (mod-v2 D-T1…D-T7). Sem `$`: só dados e regras.
import type { Sessao } from '../types'
import type { ConfigResolvida } from './config'

export type Registro = { id: string; ini: number; fim: number }
export type Cor = 'neutra' | 'laranja' | 'vermelha'
export type Medida = { sessaoSeg: number; diaSeg: number; cor: Cor }

// D-T4: uma interação do dev em `t`. Abre sessão nova se não há sessão viva ou se a atenção expirou;
// `abrirTurno` marca o turno do agente (D-T3), que só um `turn.complete` desmarca.
export function aplicarID(s: Sessao | null, t: number, sessionId: string, c: ConfigResolvida, abrirTurno: boolean): Sessao {
  if (s === null || expirou(s, t, c)) {
    return { id: `${sessionId}:${t}`, ini: t, ultimaID: t, turnoAberto: abrirTurno ? t : null }
  }
  return {
    ...s,
    ultimaID: Math.max(s.ultimaID, t),
    turnoAberto: abrirTurno ? (s.turnoAberto ?? t) : s.turnoAberto,
  }
}

// D-T3: `turn.complete` do laço principal desmarca o turno e renova `ultimaID`; nunca abre sessão.
// Uma sessão já expirada (sem turno aberto, passado o prazo) fecha em vez de ser renovada.
export function renovar(s: Sessao | null, t: number, c: ConfigResolvida): Sessao | null {
  if (s === null || expirou(s, t, c)) return null
  return { ...s, ultimaID: Math.max(s.ultimaID, t), turnoAberto: null }
}

// D-T3/D-T4: turno aberto suspende o fim da atenção.
export function expirou(s: Sessao, t: number, c: ConfigResolvida): boolean {
  return s.turnoAberto === null && t - s.ultimaID >= c.fimAtencaoSeg * 1000
}

// D-T4: ao fechar, `fim = ultimaID`.
export function registroFechado(s: Sessao): Registro {
  return { id: s.id, ini: s.ini, fim: s.ultimaID }
}

// D-T7: o registro vivo vai até `agora` com turno aberto, senão até `ultimaID`.
export function registroVivo(s: Sessao, agora: number): Registro {
  return { id: s.id, ini: s.ini, fim: s.turnoAberto !== null ? agora : s.ultimaID }
}

// D-T5: com a sessão viva, `agora − ini`; sem sessão, 0.
export function sessaoSeg(s: Sessao | null, agora: number): number {
  return s === null ? 0 : (agora - s.ini) / 1000
}

// D-T1: vermelha > laranja > neutra; função pura dos dois tempos.
export function corDe(sessao: number, dia: number, c: ConfigResolvida): Cor {
  if (dia >= c.limiteDiaSeg) return 'vermelha'
  if (sessao >= c.limiteSessaoSeg) return 'laranja'
  return 'neutra'
}

export function medir(s: Sessao | null, registros: readonly Registro[], agora: number, c: ConfigResolvida): Medida {
  const sessao = sessaoSeg(s, agora)
  const dia = totalDiaSeg(registros, s, agora)
  return { sessaoSeg: sessao, diaSeg: dia, cor: corDe(sessao, dia, c) }
}

// D-T6: união dos intervalos dos registros (todas as janelas) mais o intervalo vivo desta janela,
// cortada em [00:00 local de `agora`, `agora`]. A sessão viva de outra janela entra só pelo último registro gravado.
export function totalDiaSeg(registros: readonly Registro[], viva: Sessao | null, agora: number): number {
  const intervalos: (readonly [number, number])[] = registros.map(r => [r.ini, r.fim])
  if (viva !== null) intervalos.push([viva.ini, agora])
  return uniaoSeg(intervalos, diaLocalInicio(agora), agora)
}

// Comprimento, em segundos, da união dos intervalos cortados em [de, ate].
export function uniaoSeg(intervalos: readonly (readonly [number, number])[], de: number, ate: number): number {
  const cortados = intervalos
    .map(([a, b]) => [Math.max(a, de), Math.min(b, ate)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0])
  let total = 0
  let alcance = -Infinity
  for (const [a, b] of cortados) {
    total += Math.max(0, b - Math.max(a, alcance))
    alcance = Math.max(alcance, b)
  }
  return total / 1000
}

// 00:00 do dia local de `t`.
export function diaLocalInicio(t: number): number {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

// D-T10: `HhMM` (2h10).
export function formatarRelogio(seg: number): string {
  return `${Math.floor(seg / 3600)}h${String(Math.floor((seg % 3600) / 60)).padStart(2, '0')}`
}
