// Motor puro de atenção (mod.md §4; design M2 D3–D6, D13). Sem `$`: só dados e regras.
import type { Nivel, Sessao } from '../types'
import type { ConfigResolvida, Dias } from './config'

export type Registro = Omit<Sessao, 'ultimaID' | 'nivelMax'>

export type Sinal = { nome: string; valor: string; limite: string; ativo: boolean }
export type Tendencia =
  | { semDados: true }
  | { semDados: false; nivel: 'Baixo' | 'Moderado' | 'Crítico'; sinais: Sinal[] }

export type Aplicado = { atual: Sessao; fechada: Sessao | null }

const DIA_MS = 86_400_000
const TRINTA_DIAS_MS = 30 * DIA_MS
const ORDEM: Record<Nivel, number> = { neutro: 0, atencao: 1, alerta: 2 }
const DIAS_TRABALHO: Record<Dias, readonly number[]> = {
  'seg-sex': [1, 2, 3, 4, 5],
  'seg-sab': [1, 2, 3, 4, 5, 6],
  todos: [0, 1, 2, 3, 4, 5, 6],
}

// D2/D4: uma interação do dev em `t`. Abre sessão nova se não há sessão aberta ou se a atenção expirou.
export function aplicarID(s: Sessao | null, t: number, sessionId: string, c: ConfigResolvida): Aplicado {
  const fora = foraDoExpediente(t, c) ? 1 : 0
  if (s === null || expirou(s, t, c)) {
    const nova: Sessao = {
      id: `${sessionId}:${t}`,
      ini: t,
      fim: t,
      ultimaID: t,
      n: 1,
      nFora: fora,
      maiorLacunaSeg: 0,
      dias: [diaLocal(t)],
      nivelMax: 'neutro',
    }
    return { atual: { ...nova, nivelMax: nivelDe(nova, c) }, fechada: s }
  }
  const dia = diaLocal(t)
  const atual: Sessao = {
    ...s,
    fim: Math.max(s.fim, t),
    ultimaID: Math.max(s.ultimaID, t),
    n: s.n + 1,
    nFora: s.nFora + fora,
    maiorLacunaSeg: Math.max(s.maiorLacunaSeg, (t - s.ultimaID) / 1000),
    dias: s.dias.includes(dia) ? s.dias : [...s.dias, dia],
  }
  return { atual: subir(atual, c), fechada: null }
}

// D3: atividade do agente em `t` estende o fim só dentro da janela de atenção; nunca abre sessão.
export function aplicarAA(s: Sessao | null, t: number, c: ConfigResolvida): Sessao | null {
  if (s === null || expirou(s, t, c)) return s
  return subir({ ...s, fim: Math.max(s.fim, t) }, c)
}

export function expirou(s: Sessao, t: number, c: ConfigResolvida): boolean {
  return t - s.ultimaID >= c.fimAtencaoSeg * 1000
}

// D6: Atenção = sem pausa ou fora do expediente; Alerta = longa ou as duas condições de Atenção.
export function nivelDe(s: Registro, c: ConfigResolvida): Nivel {
  const { semPausa, fora, longa } = condicoes(s, c)
  if (longa || (semPausa && fora)) return 'alerta'
  if (semPausa || fora) return 'atencao'
  return 'neutro'
}

export function condicoes(s: Registro, c: ConfigResolvida): { semPausa: boolean; fora: boolean; longa: boolean } {
  const dur = duracaoSeg(s)
  return {
    semPausa: dur >= c.semPausaSeg && s.maiorLacunaSeg < c.pausaMinSeg,
    fora: s.nFora >= 1,
    longa: dur >= c.longaSeg,
  }
}

export function duracaoSeg(s: Registro): number {
  return (s.fim - s.ini) / 1000
}

export function paraRegistro(s: Sessao): Registro {
  const { ultimaID: _u, nivelMax: _n, ...r } = s
  return r
}

// D5: hora local fora de [inicio, fim) ou dia local fora dos dias de trabalho.
export function foraDoExpediente(t: number, c: ConfigResolvida): boolean {
  const d = new Date(t)
  const hora = d.getHours()
  return hora < c.inicio || hora >= c.fim || !DIAS_TRABALHO[c.dias].includes(d.getDay())
}

export function diaLocal(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`
}

// ssot.md §4.5
export function formatarDuracao(seg: number): string {
  return `${Math.floor(seg / 3600)}h${String(Math.floor((seg % 3600) / 60)).padStart(2, '0')}min`
}

// D13: os 5 sinais do laudo sobre os registros dos últimos 30 dias, com os limites atuais.
export function tendencia(registros: readonly Registro[], agora: number, c: ConfigResolvida): Tendencia {
  const janela = registros.filter(r => r.fim >= agora - TRINTA_DIAS_MS)
  if (janela.length === 0) return { semDados: true }

  const longas = janela.filter(r => condicoes(r, c).longa).length
  const semPausa = janela.filter(r => condicoes(r, c).semPausa).length
  const n = janela.reduce((a, r) => a + r.n, 0)
  const nFora = janela.reduce((a, r) => a + r.nFora, 0)
  const pct = n > 0 ? Math.round((nFora / n) * 100) : 0
  const dias = [...new Set(janela.flatMap(r => r.dias))].map(indiceDia).sort((a, b) => a - b)
  const seq = maiorSequencia(dias)
  const foraDosDias = dias.filter(i => !DIAS_TRABALHO[c.dias].includes(new Date(i * DIA_MS).getUTCDay())).length

  const sinais: Sinal[] = [
    { nome: 'Sessões longas', valor: String(longas), limite: `≥ 1 (≥ ${formatarDuracao(c.longaSeg)})`, ativo: longas >= 1 },
    { nome: 'Sessões sem pausa', valor: String(semPausa), limite: `≥ 1 (≥ ${formatarDuracao(c.semPausaSeg)})`, ativo: semPausa >= 1 },
    { nome: 'Interações fora do expediente', valor: `${pct}%`, limite: '≥ 20%', ativo: n > 0 && pct >= 20 },
    { nome: 'Maior sequência de dias', valor: String(seq), limite: '≥ 7', ativo: seq >= 7 },
    { nome: 'Dias fora dos dias de trabalho', valor: String(foraDosDias), limite: '≥ 2', ativo: foraDosDias >= 2 },
  ]
  const pontos = sinais.filter(s => s.ativo).length
  return { semDados: false, nivel: pontos >= 3 ? 'Crítico' : pontos === 2 ? 'Moderado' : 'Baixo', sinais }
}

function subir(s: Sessao, c: ConfigResolvida): Sessao {
  const nivel = nivelDe(s, c)
  return ORDEM[nivel] > ORDEM[s.nivelMax] ? { ...s, nivelMax: nivel } : s
}

// "AAAA-MM-DD" → dias desde a epoch (a data como dia de calendário, sem fuso).
function indiceDia(dia: string): number {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number]
  return Date.UTC(a, m - 1, d) / DIA_MS
}

function maiorSequencia(diasOrdenados: readonly number[]): number {
  let maior = 0
  let atual = 0
  for (let i = 0; i < diasOrdenados.length; i++) {
    atual = i > 0 && diasOrdenados[i] === (diasOrdenados[i - 1] as number) + 1 ? atual + 1 : 1
    maior = Math.max(maior, atual)
  }
  return maior
}

function dois(n: number): string {
  return String(n).padStart(2, '0')
}
