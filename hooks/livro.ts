// Persistência v1 no `$.store` (design M2 D14–D16, D19). Único arquivo que toca `$.store`.
// Regras puras (validação, poda, upsert, medida) primeiro; I/O depois.
import type { EngineInterface } from 'claude-code'

import type { Nivel } from '../types'
import type { Registro } from './atencao'
import type { CampoConfig } from './config'

export type Chave = 'livro' | 'silencio' | 'explicado' | 'diario'
export type Livro = { formato: 1; sessoes: Registro[] }
export type Silencio = { formato: 1; ate: number | null }
export type Explicado = { formato: 1; t: boolean }
export type TipoEvento = 'nivel' | 'detalhes' | 'silenciar' | 'reativar' | 'erro'
export type Codigo =
  | 'versao'
  | `config:${CampoConfig}`
  | `dados-incompativeis:${Chave}`
  | 'livro-cheio'
  | 'diario-cheio'
  | 'store-recusou'
  | 'silenciado'
  | '1h'
  | 'amanha'
export type Evento = { t: number; tipo: TipoEvento; nivel?: Nivel; codigo?: Codigo }
export type Diario = { formato: 1; eventos: Evento[] }
export type ErroDados = { codigo: Codigo; detalhe: string | null }

const DIA_MS = 86_400_000
const TRINTA_DIAS_MS = 30 * DIA_MS
const HORA_MS = 3_600_000
const ORCAMENTO = 1_048_576
const INTERVALO_GRAVACAO_MS = 60_000

const CHAVES: readonly Chave[] = ['livro', 'silencio', 'explicado', 'diario']
const CAMPOS_CONFIG: readonly CampoConfig[] = ['inicio', 'fim', 'dias', 'intensidade', 'fimAtencaoMin', 'pausaMinMin']
const TIPOS: readonly TipoEvento[] = ['nivel', 'detalhes', 'silenciar', 'reativar', 'erro']
const NIVEIS: readonly Nivel[] = ['neutro', 'atencao', 'alerta']
const CODIGOS: readonly string[] = [
  'versao',
  ...CAMPOS_CONFIG.map(c => `config:${c}`),
  ...CHAVES.map(c => `dados-incompativeis:${c}`),
  'livro-cheio',
  'diario-cheio',
  'store-recusou',
  'silenciado',
  '1h',
  'amanha',
]

type Desc<V> = {
  chave: Chave
  validar: (x: unknown) => x is V
  vazio: () => V
  podar: (v: V, agora: number) => V
  cheio: Codigo | null
}

const LIVRO: Desc<Livro> = {
  chave: 'livro',
  validar: validarLivro,
  vazio: () => ({ formato: 1, sessoes: [] }),
  podar: (v, agora) => ({ ...v, sessoes: v.sessoes.filter(r => r.fim >= agora - TRINTA_DIAS_MS) }),
  cheio: 'livro-cheio',
}
const SILENCIO: Desc<Silencio> = {
  chave: 'silencio',
  validar: validarSilencio,
  vazio: () => ({ formato: 1, ate: null }),
  podar: v => v,
  cheio: null,
}
const EXPLICADO: Desc<Explicado> = {
  chave: 'explicado',
  validar: validarExplicado,
  vazio: () => ({ formato: 1, t: false }),
  podar: v => v,
  cheio: null,
}
const DIARIO: Desc<Diario> = {
  chave: 'diario',
  validar: validarDiario,
  vazio: () => ({ formato: 1, eventos: [] }),
  podar: (v, agora) => ({ ...v, eventos: v.eventos.filter(e => e.t >= agora - TRINTA_DIAS_MS) }),
  cheio: 'diario-cheio',
}

// Estado do módulo: recomeça a cada reload e é refeito em session.start (`iniciarLivro`).
let erro: ErroDados | null = null
let debug = false
let ultimaGravacao: number | null = null

// ---------- API (track 04 e register.tsx) ----------

// D19: lê `HSG_DEBUG` e, com `1`, registra o fuso local no log (prova de R3; não vai para o store).
export async function iniciarLivro($: EngineInterface): Promise<void> {
  debug = (await $.env.get('HSG_DEBUG')) === '1'
  if (debug) $.ui.log(`harness-session-guard tz=${new Date().getTimezoneOffset()}`)
}

export function erroCorrente(): ErroDados | null {
  return erro
}

// D16: grava se nunca gravou neste módulo ou se passaram 60 s desde a última gravação.
export function gravacaoVencida(agora: number): boolean {
  return ultimaGravacao === null || agora - ultimaGravacao >= INTERVALO_GRAVACAO_MS
}

export async function lerLivro($: EngineInterface): Promise<Livro | null> {
  return ler($, LIVRO)
}

export async function lerSilencio($: EngineInterface): Promise<Silencio | null> {
  return ler($, SILENCIO)
}

export async function lerExplicado($: EngineInterface): Promise<Explicado | null> {
  return ler($, EXPLICADO)
}

// D16: upsert do registro pelo `id`, relendo o livro antes da gravação.
export async function gravarRegistro($: EngineInterface, r: Registro, agora: number): Promise<void> {
  if (await gravar($, LIVRO, agora, v => upsert(v, r))) ultimaGravacao = agora
}

// D8: silenciar 1h ou até o dia local seguinte à hora `inicio`.
export async function silenciar(
  $: EngineInterface,
  modo: '1h' | 'amanha',
  agora: number,
  inicio: number,
): Promise<void> {
  const ate = modo === '1h' ? agora + HORA_MS : amanhaAs(agora, inicio)
  if (await gravar($, SILENCIO, agora, v => ({ ...v, ate }))) {
    await registrarEvento($, { t: agora, tipo: 'silenciar', codigo: modo })
  }
}

export async function reativar($: EngineInterface, agora: number): Promise<void> {
  if (await gravar($, SILENCIO, agora, v => ({ ...v, ate: null }))) {
    await registrarEvento($, { t: agora, tipo: 'reativar' })
  }
}

// D18: `explicado.t` vira `true` depois da primeira explicação.
export async function marcarExplicado($: EngineInterface, agora: number): Promise<void> {
  await gravar($, EXPLICADO, agora, v => ({ ...v, t: true }))
}

// D19: com HSG_DEBUG=1 o evento também vai para `$.ui.log`.
export async function registrarEvento($: EngineInterface, e: Evento): Promise<void> {
  if (debug) $.ui.log(`harness-session-guard ${e.tipo}${e.nivel ? ` ${e.nivel}` : ''}${e.codigo ? ` ${e.codigo}` : ''}`)
  await gravar($, DIARIO, e.t, v => ({ ...v, eventos: [...v.eventos, e] }))
}

// `/hsg apagar-dados confirmar`: remove as 4 chaves e limpa o erro de dados.
export async function apagarDados($: EngineInterface): Promise<void> {
  for (const chave of CHAVES) await $.store.delete(chave)
  erro = null
  ultimaGravacao = null
  $.ui.status(undefined)
}

// Erro de origem externa ao store (versão, configuração): vira o erro corrente e um evento do diário.
export async function registrarErro($: EngineInterface, codigo: Codigo, agora: number): Promise<void> {
  await falhar($, codigo, null, agora, true)
}

// ---------- Regras puras ----------

export function silenciado(s: Silencio, agora: number): boolean {
  return s.ate !== null && agora < s.ate
}

export function amanhaAs(agora: number, inicio: number): number {
  const d = new Date(agora)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, inicio, 0, 0, 0).getTime()
}

export function upsert(v: Livro, r: Registro): Livro {
  const i = v.sessoes.findIndex(s => s.id === r.id)
  if (i < 0) return { ...v, sessoes: [...v.sessoes, r] }
  const sessoes = [...v.sessoes]
  sessoes[i] = r
  return { ...v, sessoes }
}

export function validarLivro(x: unknown): x is Livro {
  return (
    objetoCom(x, ['formato', 'sessoes']) &&
    x.formato === 1 &&
    Array.isArray(x.sessoes) &&
    x.sessoes.every(validarRegistro)
  )
}

export function validarSilencio(x: unknown): x is Silencio {
  return objetoCom(x, ['formato', 'ate']) && x.formato === 1 && (x.ate === null || numero(x.ate))
}

export function validarExplicado(x: unknown): x is Explicado {
  return objetoCom(x, ['formato', 't']) && x.formato === 1 && typeof x.t === 'boolean'
}

export function validarDiario(x: unknown): x is Diario {
  return (
    objetoCom(x, ['formato', 'eventos']) &&
    x.formato === 1 &&
    Array.isArray(x.eventos) &&
    x.eventos.every(validarEvento)
  )
}

function validarRegistro(x: unknown): x is Registro {
  return (
    objetoCom(x, ['id', 'ini', 'fim', 'n', 'nFora', 'maiorLacunaSeg', 'dias']) &&
    typeof x.id === 'string' &&
    numero(x.ini) &&
    numero(x.fim) &&
    numero(x.n) &&
    numero(x.nFora) &&
    numero(x.maiorLacunaSeg) &&
    Array.isArray(x.dias) &&
    x.dias.every(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
  )
}

function validarEvento(x: unknown): x is Evento {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false
  const o = x as Record<string, unknown>
  const chaves = Object.keys(o)
  return (
    chaves.every(k => k === 't' || k === 'tipo' || k === 'nivel' || k === 'codigo') &&
    numero(o.t) &&
    TIPOS.includes(o.tipo as TipoEvento) &&
    (!('nivel' in o) || NIVEIS.includes(o.nivel as Nivel)) &&
    (!('codigo' in o) || CODIGOS.includes(o.codigo as string))
  )
}

// Objeto simples com exatamente estas chaves.
function objetoCom<K extends string>(x: unknown, chaves: readonly K[]): x is Record<K, unknown> {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false
  const k = Object.keys(x)
  return k.length === chaves.length && chaves.every(c => k.includes(c))
}

function numero(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x)
}

// ---------- I/O ----------

// Matriz: ausente → forma v1 vazia; v1 válida → usar; qualquer outra → erro `dados-incompativeis:<chave>`.
async function ler<V>($: EngineInterface, d: Desc<V>): Promise<V | null> {
  const bruto = await $.store.get(d.chave)
  if (bruto === undefined) return d.vazio()
  if (d.validar(bruto)) return bruto
  await falhar($, `dados-incompativeis:${d.chave}`, null, null, d.chave !== 'diario')
  return null
}

// D15: get → validar → podar → mudar → medir → set. Devolve `true` só se gravou.
async function gravar<V>($: EngineInterface, d: Desc<V>, agora: number, mudar: (v: V) => V): Promise<boolean> {
  const atual = await ler($, d)
  if (atual === null) return false
  const novo = mudar(d.podar(atual, agora))
  if (d.cheio !== null && JSON.stringify(novo).length > ORCAMENTO) {
    await falhar($, d.cheio, null, agora, d.chave !== 'diario')
    return false
  }
  const recusa = await $.store.set(d.chave, novo).then(
    () => null,
    (r: unknown) => (r instanceof Error ? r.message : String(r)),
  )
  if (recusa !== null) {
    await falhar($, 'store-recusou', recusa, agora, d.chave !== 'diario')
    return false
  }
  return true
}

// O erro mais recente fica no módulo e no status; a mensagem da recusa nunca vai para o store.
// `noDiario` é falso quando o erro vem do próprio diário (gravar nele de novo repetiria a falha).
async function falhar(
  $: EngineInterface,
  codigo: Codigo,
  detalhe: string | null,
  agora: number | null,
  noDiario: boolean,
): Promise<void> {
  erro = { codigo, detalhe }
  $.ui.status(`harness-session-guard: ${codigo}${detalhe === null ? '' : `: ${detalhe}`} · /hsg`)
  if (noDiario) await registrarEvento($, { t: agora ?? (await $.clock.now()), tipo: 'erro', codigo })
}
