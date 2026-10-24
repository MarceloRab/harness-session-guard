// Resultado do juiz (mod-v2 D-J9). Puro: sem `$`; valida a resposta, confere as citações (C1) e aplica o Y3.
import type { Achado, Dado, Dimensao } from '../types'
import { normalizar } from './fatos'
import { sha256Hex } from './hash'

export const DIMENSOES: readonly Dimensao[] = ['dod', 'suposicao', 'tangente', 'semLastro']

// O que o juiz respondeu, já validado: `citacao` só quando presente.
export type Veredito = { nivel: 0 | 1 | 2; citacao?: string }
export type Resposta = Record<Dimensao, Veredito>

// D-J9: Y3 usa os 12 primeiros hex do SHA-256 da citação normalizada.
export async function hashCurto(citacao: string): Promise<string> {
  return (await sha256Hex(normalizar(citacao))).slice(0, 12)
}

// D-J9: depois de `trim`, um objeto JSON com exatamente as chaves das 4 dimensões, cada uma `{ nivel: 0|1|2,
// citacao?: string }`, com `citacao` não vazia quando `nivel > 0`. Qualquer outra forma
// (inclusive cerca de código e texto fora do JSON) é inválida, com o motivo.
export function parsearResposta(texto: string): Dado<Resposta> {
  let bruto: unknown
  try {
    bruto = JSON.parse(texto.trim())
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e
    return { ok: false, motivo: 'a resposta não é um JSON puro (sem cerca de código nem texto fora do objeto)' }
  }
  if (!objetoSimples(bruto)) return { ok: false, motivo: 'a resposta não é um objeto JSON' }
  const chaves = Object.keys(bruto)
  if (chaves.length !== DIMENSOES.length || !DIMENSOES.every(d => chaves.includes(d))) {
    return { ok: false, motivo: `as chaves devem ser exatamente ${DIMENSOES.join(', ')}` }
  }
  const resposta = {} as Resposta
  for (const dim of DIMENSOES) {
    const v = veredito(bruto[dim])
    if (typeof v === 'string') return { ok: false, motivo: `${dim}: ${v}` }
    resposta[dim] = v
  }
  return { ok: true, valor: resposta }
}

function veredito(x: unknown): Veredito | string {
  if (!objetoSimples(x)) return 'deve ser um objeto'
  if (!Object.keys(x).every(k => k === 'nivel' || k === 'citacao')) return 'chave desconhecida'
  const { nivel, citacao } = x
  if (nivel !== 0 && nivel !== 1 && nivel !== 2) return 'nivel deve ser 0, 1 ou 2'
  if (citacao !== undefined && typeof citacao !== 'string') return 'citacao deve ser texto'
  if (nivel > 0 && (citacao === undefined || normalizar(citacao) === '')) return 'nivel acima de 0 exige citacao não vazia'
  return { nivel, ...(citacao === undefined ? {} : { citacao }) }
}

function objetoSimples(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

// D-J9 (C1): a citação, normalizada, precisa ser substring de um item de texto da evidência enviada; senão o
// achado é descartado e contado. Só as dimensões com nível acima de 0 viram achado.
export async function conferirCitacoes(
  r: Resposta,
  evidencia: readonly string[],
): Promise<{ achados: Omit<Achado, 'estado'>[]; descartados: Set<Dimensao> }> {
  const achados: Omit<Achado, 'estado'>[] = []
  const descartados = new Set<Dimensao>()
  for (const dim of DIMENSOES) {
    const v = r[dim]
    if (v.nivel === 0) continue
    const citacao = normalizar(v.citacao as string)
    if (!evidencia.some(item => item.includes(citacao))) descartados.add(dim)
    achados.push({ dim, h: await hashCurto(citacao), nivel: v.nivel, citacao })
  }
  return { achados, descartados }
}

// D-J9 (Y3): `{dim, h}` já presente nos achados do objetivo = "já apontado" (não é gravado de novo); descartado fica
// descartado; o resto é "novo".
export function aplicarY3(
  achados: readonly Omit<Achado, 'estado'>[],
  descartados: ReadonlySet<Dimensao>,
  jaApontados: readonly { dim: string; h: string }[],
): Achado[] {
  return achados.map(a => {
    if (descartados.has(a.dim)) return { ...a, estado: 'descartado' }
    const repetido = jaApontados.some(j => j.dim === a.dim && j.h === a.h)
    return { ...a, estado: repetido ? 'ja-apontado' : 'novo' }
  })
}
