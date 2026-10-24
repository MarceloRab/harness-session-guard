// Objetivo explícito (mod-v2 D-O1…D-O4, D-T7c). Puro: sem `$`, só comando, transições e tempo ativo.
import type { Objetivo } from '../types'
import { uniaoSeg } from './atencao'

export type EventoObjetivo = {
  t: number
  tipo: 'abrir' | 'trocar' | 'fechar' | 'timebox'
  objetivoId: string
  timeboxMin?: number
  motivo?: 'reinicio' // só leitura de legado (D-O3): o T não escreve mais este motivo
}

export type ComandoObjetivo =
  | { tipo: 'ver' }
  | { tipo: 'abrir' | 'trocar'; texto: string; timeboxMin: number | null }
  | { tipo: 'dod'; texto: string }
  | { tipo: 'fechar' }

export type Mutacao = Exclude<ComandoObjetivo, { tipo: 'ver' }>

// `eventos` vão ao livro de objetivos (só se houver); `objetivo` é o novo valor do atom, aplicado depois de gravar.
export type Transicao =
  | { ok: true; eventos: EventoObjetivo[]; objetivo: Objetivo | null; mensagem: string }
  | { ok: false; mensagem: string }

// D-O2: `resto` é o que vem depois de `objetivo`. `null` = argumento fora do conjunto exato (o chamador devolve o uso).
// Só o primeiro token, e só no formato `timebox=<dígitos>`, é timebox; qualquer outro texto é o objetivo.
// Dígitos que não formam um inteiro ≥ 1 (ex.: `timebox=0`) chegam à transição, que os recusa com mensagem.
export function parsearObjetivo(resto: string): ComandoObjetivo | null {
  const limpo = resto.trim()
  if (limpo === '') return { tipo: 'ver' }
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(limpo)
  if (m === null) return null
  const sub = m[1]
  const corpo = m[2] ?? ''
  switch (sub) {
    case 'fechar':
      return corpo === '' ? { tipo: 'fechar' } : null
    case 'dod':
      return corpo === '' ? null : { tipo: 'dod', texto: corpo }
    case 'abrir':
    case 'trocar': {
      const tb = /^timebox=(\d+)(?:\s+([\s\S]*))?$/.exec(corpo)
      const timeboxMin = tb === null ? null : Number(tb[1])
      const texto = tb === null ? corpo : (tb[2] ?? '')
      return texto === '' ? null : { tipo: sub, texto, timeboxMin }
    }
    default:
      return null
  }
}

// D-O2/D-O3: valida a transição contra o objetivo atual e devolve os eventos e o novo atom; não toca em estado.
export function aplicarTransicao(atual: Objetivo | null, c: Mutacao, t: number, sessionId: string): Transicao {
  switch (c.tipo) {
    case 'abrir':
      if (atual !== null) return recusa('Já há um objetivo aberto. Use /hsg objetivo trocar ou /hsg objetivo fechar.')
      return abrir(c.texto, c.timeboxMin, t, sessionId, [], 'Objetivo aberto')
    case 'trocar':
      if (atual === null) return recusa('Nenhum objetivo aberto para trocar. Use /hsg objetivo abrir.')
      return abrir(c.texto, c.timeboxMin, t, sessionId, [{ t, tipo: 'trocar', objetivoId: atual.id }], 'Objetivo trocado')
    case 'dod':
      if (atual === null) return recusa('Nenhum objetivo aberto para definir o DoD. Use /hsg objetivo abrir.')
      return { ok: true, eventos: [], objetivo: { ...atual, dod: c.texto }, mensagem: 'DoD definido.' }
    case 'fechar':
      if (atual === null) return recusa('Nenhum objetivo aberto para fechar.')
      return {
        ok: true,
        eventos: [{ t, tipo: 'fechar', objetivoId: atual.id }],
        objetivo: null,
        mensagem: 'Objetivo fechado.',
      }
  }
}

// D-T7c: o evento `timebox` é único por objetivo.
export function temTimebox(eventos: readonly EventoObjetivo[], objetivoId: string): boolean {
  return eventos.some(e => e.tipo === 'timebox' && e.objetivoId === objetivoId)
}

// D-T7c: tempo ativo = união dos intervalos, cortada em [ini, fim] (ms), em segundos.
export function tempoAtivoSeg(intervalos: readonly (readonly [number, number])[], ini: number, fim: number): number {
  return uniaoSeg(intervalos, ini, fim)
}

function abrir(
  texto: string,
  timeboxMin: number | null,
  t: number,
  sessionId: string,
  antes: EventoObjetivo[],
  mensagem: string,
): Transicao {
  if (timeboxMin !== null && !(Number.isSafeInteger(timeboxMin) && timeboxMin >= 1)) {
    return recusa('timebox inválido: use timebox=<min> com um inteiro maior ou igual a 1.')
  }
  const id = `${sessionId}:${t}`
  const objetivo: Objetivo = { id, texto, dod: null, abertoEm: t, timeboxMin }
  const novo: EventoObjetivo =
    timeboxMin === null ? { t, tipo: 'abrir', objetivoId: id } : { t, tipo: 'abrir', objetivoId: id, timeboxMin }
  return {
    ok: true,
    eventos: [...antes, novo],
    objetivo,
    mensagem: `${mensagem}${timeboxMin === null ? '' : ` (timebox ${timeboxMin} min)`}.`,
  }
}

function recusa(mensagem: string): Transicao {
  return { ok: false, mensagem }
}
