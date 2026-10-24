// Persistência v2 no `$.store` (mod-v2 D-P1…D-P3, D-J13). Único arquivo que toca `$.store`.
// Regras puras (validação, poda, upsert, migração) primeiro; I/O depois.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Dimensao, ErroDados, Usage, Voto } from '../types'
import type { Registro } from './atencao'
import type { CampoConfig } from './config'
import type { EventoObjetivo } from './objetivo'

export type Chave = 'livro' | 'objetivos' | 'avaliacoes'
export type Livro = { formato: 2; sessoes: Registro[] }
export type Objetivos = { formato: 1; eventos: EventoObjetivo[] }

// D-J13: só números, ids curtos (`h`), hashes e votos; nenhum texto (S5).
export type Avaliacoes = {
  formato: 1
  achados: { dim: Dimensao; h: string; t: number }[]
  objetivos: { t: number; objetivoId: string; tAtivoSeg: number; ciclos: number; commits: number; semAvancoSeg: number }[]
  cliques: {
    t: number
    hash: string
    usage: Usage
    resultado: 'ok' | 'json-invalido' | 'api-error' | 'empty-reply' | 'aborted'
    citacoesDescartadas: number
    status?: number | null
  }[]
  feedback: { dim: Dimensao; h: string; voto: Voto; t: number }[]
}
export type Codigo =
  | 'versao'
  | `config:${CampoConfig}`
  | `dados-incompativeis:${Chave}`
  | 'livro-cheio'
  | 'objetivos-cheio'
  | 'avaliacoes-cheio'
  | 'store-recusou'
export type Leitura<V> = { ok: true; valor: V } | { ok: false; codigo: Codigo }

// Formato 1 do M2: o registro tinha mais campos; a migração (D-P2) os descarta.
type RegistroV1 = Registro & { n: number; nFora: number; maiorLacunaSeg: number; dias: string[] }
type LivroV1 = { formato: 1; sessoes: RegistroV1[] }

const DIA_MS = 86_400_000
const TRINTA_DIAS_MS = 30 * DIA_MS
const ORCAMENTO = 1_048_576

// D-P3: chaves do formato antigo, sem uso. `/hsg` as avisa; `apagar-dados confirmar` as remove com as do formato 2.
export const CHAVES_LEGADAS = ['silencio', 'explicado', 'diario'] as const
export const CHAVES_APAGAR = ['livro', 'objetivos', 'avaliacoes', ...CHAVES_LEGADAS] as const

export type Desc<V> = {
  chave: Chave
  validar: (x: unknown) => x is V
  // Converte um formato anterior válido; `null` se `x` não é um formato anterior conhecido.
  migrar: ((x: unknown) => V | null) | null
  vazio: () => V
  podar: (v: V, agora: number) => V
  cheio: Codigo | null
}

const LIVRO: Desc<Livro> = {
  chave: 'livro',
  validar: validarLivro,
  migrar: x => (validarLivroV1(x) ? migrarLivroV1(x) : null),
  vazio: () => ({ formato: 2, sessoes: [] }),
  podar: (v, agora) => ({ ...v, sessoes: v.sessoes.filter(r => r.fim >= agora - TRINTA_DIAS_MS) }),
  cheio: 'livro-cheio',
}

// D-O3: eventos de objetivo, sem texto. Poda: os eventos de um objetivo saem quando o último deles tem mais de 30 dias.
const OBJETIVOS: Desc<Objetivos> = {
  chave: 'objetivos',
  validar: validarObjetivos,
  migrar: null,
  vazio: () => ({ formato: 1, eventos: [] }),
  podar: (v, agora) => {
    const ultimo = new Map<string, number>()
    for (const e of v.eventos) ultimo.set(e.objetivoId, Math.max(ultimo.get(e.objetivoId) ?? e.t, e.t))
    return { ...v, eventos: v.eventos.filter(e => (ultimo.get(e.objetivoId) as number) >= agora - TRINTA_DIAS_MS) }
  },
  cheio: 'objetivos-cheio',
}

// D-J13: achados (Y3), números da camada 1 por clique, cliques do juiz e votos. Poda: cada item sai com mais de 30 dias.
const AVALIACOES: Desc<Avaliacoes> = {
  chave: 'avaliacoes',
  validar: validarAvaliacoes,
  migrar: null,
  vazio: () => ({ formato: 1, achados: [], objetivos: [], cliques: [], feedback: [] }),
  podar: (v, agora) => {
    const recente = (i: { t: number }) => i.t >= agora - TRINTA_DIAS_MS
    return {
      ...v,
      achados: v.achados.filter(recente),
      objetivos: v.objetivos.filter(recente),
      cliques: v.cliques.filter(recente),
      feedback: v.feedback.filter(recente),
    }
  },
  cheio: 'avaliacoes-cheio',
}

// Erro corrente num atom: a faixa o lê e redesenha quando ele muda. Zerado em `iniciarLivro`.
const erroAtom = atom({ plugin: 'harness-session-guard', key: 'erro' } as const, null, { shape: 'erro-1' })

// Estado do módulo: refeito em `iniciarLivro` (session.start).
let debug = false

// ---------- API (register.tsx e tracks seguintes) ----------

// D-P6: com `HSG_DEBUG=1`, registra o fuso local no log (não vai para o store).
export async function iniciarLivro($: EngineInterface): Promise<void> {
  debug = (await $.env.get('HSG_DEBUG')) === '1'
  if (debug) $.ui.log(`harness-session-guard tz=${new Date().getTimezoneOffset()}`)
  await update($, erroAtom, () => null)
}

export async function erroCorrente($: EngineInterface): Promise<ErroDados | null> {
  return read($, erroAtom)
}

// Em session.start: o livro e os objetivos são lidos e, se rejeitados, relatados fora do desenho.
// Um livro formato 1 válido é persistido como formato 2 aqui (D-P2).
export async function verificarDados($: EngineInterface): Promise<void> {
  if (validarLivroV1(await $.store.get(LIVRO.chave))) await gravar($, LIVRO, await $.clock.now(), v => v)
  else await ler($, LIVRO)
  await ler($, OBJETIVOS)
}

// D-P3: as chaves do formato antigo presentes no store, para o aviso do `/hsg`.
export async function chavesAntigas($: EngineInterface): Promise<string[]> {
  const todas = await $.store.keys()
  return CHAVES_LEGADAS.filter(k => todas.includes(k))
}

// Para o `ui.render`: leitura sem relatar (o desenho não grava).
export async function espiarLivro($: EngineInterface): Promise<Leitura<Livro>> {
  return lerSemRelatar($, LIVRO)
}

export async function lerLivro($: EngineInterface): Promise<Livro | null> {
  return ler($, LIVRO)
}

// Upsert do registro pelo `id`, relendo o livro antes da gravação.
export async function gravarRegistro($: EngineInterface, r: Registro, agora: number): Promise<void> {
  await gravar($, LIVRO, agora, v => upsert(v, r))
}

export async function lerObjetivos($: EngineInterface): Promise<Objetivos | null> {
  return ler($, OBJETIVOS)
}

// D-J13: fora do desenho a rejeição vira o erro corrente.
export async function lerAvaliacoes($: EngineInterface): Promise<Avaliacoes | null> {
  return ler($, AVALIACOES)
}

// Para o `ui.render`: leitura sem relatar.
export async function espiarAvaliacoes($: EngineInterface): Promise<Leitura<Avaliacoes>> {
  return lerSemRelatar($, AVALIACOES)
}

// D-J13 (escrita): só números, hashes, `usage` e votos. Cada gravação devolve `true` só se gravou; recusa
// (`avaliacoes-cheio`, `store-recusou`, `dados-incompativeis:avaliacoes`) fica no erro corrente.
// D-P6: com `HSG_DEBUG=1`, só o tipo da gravação vai ao log.
export type CliqueAvaliacao = Avaliacoes['cliques'][number]
export type ObjetivoAvaliado = Avaliacoes['objetivos'][number]
export type AchadoGravado = Avaliacoes['achados'][number]
export type FeedbackGravado = Avaliacoes['feedback'][number]

export async function gravarClique(
  $: EngineInterface,
  clique: CliqueAvaliacao,
  objetivo: ObjetivoAvaliado | null,
  agora: number,
): Promise<boolean> {
  return gravarAvaliacoes($, 'clique', agora, v => ({
    ...v,
    cliques: [...v.cliques, clique],
    objetivos: objetivo === null ? v.objetivos : [...v.objetivos, objetivo],
  }))
}

export async function gravarAchados($: EngineInterface, achados: readonly AchadoGravado[], agora: number): Promise<boolean> {
  return gravarAvaliacoes($, 'achado', agora, v => ({ ...v, achados: [...v.achados, ...achados] }))
}

export async function gravarFeedback($: EngineInterface, feedback: FeedbackGravado, agora: number): Promise<boolean> {
  return gravarAvaliacoes($, 'feedback', agora, v => ({ ...v, feedback: [...v.feedback, feedback] }))
}

async function gravarAvaliacoes(
  $: EngineInterface,
  tipo: 'clique' | 'achado' | 'feedback',
  agora: number,
  mudar: (v: Avaliacoes) => Avaliacoes,
): Promise<boolean> {
  const gravou = await gravar($, AVALIACOES, agora, mudar)
  if (gravou && debug) $.ui.log(`harness-session-guard avaliacoes ${tipo}`)
  return gravou
}

// D-O3: acrescenta os eventos de uma transição num único `gravar`. Devolve `true` só se gravou.
// D-P6: com `HSG_DEBUG=1`, só o `tipo` de cada evento vai ao log.
export async function gravarEventosObjetivo(
  $: EngineInterface,
  eventos: readonly EventoObjetivo[],
  agora: number,
): Promise<boolean> {
  const gravou = await gravar($, OBJETIVOS, agora, v => ({ ...v, eventos: [...v.eventos, ...eventos] }))
  if (gravou && debug) $.ui.log(`harness-session-guard objetivos ${eventos.map(e => e.tipo).join(',')}`)
  return gravou
}

// `/hsg apagar-dados confirmar`: remove as chaves de `CHAVES_APAGAR` e limpa o erro de dados.
export async function apagarDados($: EngineInterface): Promise<void> {
  for (const chave of CHAVES_APAGAR) await $.store.delete(chave)
  await update($, erroAtom, () => null)
  $.ui.status(undefined)
}

// Erro de origem externa ao store (versão, configuração): vira o erro corrente.
export async function registrarErro($: EngineInterface, codigo: Codigo): Promise<void> {
  await falhar($, codigo, null)
}

// ---------- Regras puras ----------

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
    x.formato === 2 &&
    Array.isArray(x.sessoes) &&
    x.sessoes.every(validarRegistro)
  )
}

// D-P2: a forma exata do M2.
export function validarLivroV1(x: unknown): x is LivroV1 {
  return (
    objetoCom(x, ['formato', 'sessoes']) &&
    x.formato === 1 &&
    Array.isArray(x.sessoes) &&
    x.sessoes.every(validarRegistroV1)
  )
}

export function validarObjetivos(x: unknown): x is Objetivos {
  return (
    objetoCom(x, ['formato', 'eventos']) &&
    x.formato === 1 &&
    Array.isArray(x.eventos) &&
    x.eventos.every(validarEventoObjetivo)
  )
}

const DIMENSOES = ['dod', 'suposicao', 'tangente', 'semLastro']
const RESULTADOS = ['ok', 'json-invalido', 'api-error', 'empty-reply', 'aborted']
const VOTOS = ['util', 'nao-se-aplica', 'errado']

export function validarAvaliacoes(x: unknown): x is Avaliacoes {
  return (
    objetoCom(x, ['formato', 'achados', 'objetivos', 'cliques', 'feedback']) &&
    x.formato === 1 &&
    listaDe(x.achados, validarAchado) &&
    listaDe(x.objetivos, validarObjetivoAvaliado) &&
    listaDe(x.cliques, validarClique) &&
    listaDe(x.feedback, validarFeedback)
  )
}

function listaDe(x: unknown, valido: (i: unknown) => boolean): boolean {
  return Array.isArray(x) && x.every(valido)
}

function validarAchado(x: unknown): boolean {
  return objetoCom(x, ['dim', 'h', 't']) && DIMENSOES.includes(x.dim as string) && idCurto(x.h) && numero(x.t)
}

function validarObjetivoAvaliado(x: unknown): boolean {
  return (
    objetoCom(x, ['t', 'objetivoId', 'tAtivoSeg', 'ciclos', 'commits', 'semAvancoSeg']) &&
    numero(x.t) &&
    typeof x.objetivoId === 'string' &&
    numero(x.tAtivoSeg) &&
    numero(x.ciclos) &&
    numero(x.commits) &&
    numero(x.semAvancoSeg)
  )
}

// `status` é opcional: o do `api-error` (número HTTP, ou null quando a resposta não trouxe um).
function validarClique(x: unknown): boolean {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false
  const o = x as Record<string, unknown>
  const obrigatorias = ['t', 'hash', 'usage', 'resultado', 'citacoesDescartadas']
  return (
    Object.keys(o).every(k => obrigatorias.includes(k) || k === 'status') &&
    obrigatorias.every(k => k in o) &&
    numero(o.t) &&
    typeof o.hash === 'string' &&
    validarUsage(o.usage) &&
    RESULTADOS.includes(o.resultado as string) &&
    numero(o.citacoesDescartadas) &&
    (!('status' in o) || o.status === null || numero(o.status))
  )
}

function validarUsage(x: unknown): boolean {
  return (
    objetoCom(x, ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) &&
    numero(x.input_tokens) &&
    numero(x.output_tokens) &&
    numero(x.cache_read_input_tokens) &&
    numero(x.cache_creation_input_tokens)
  )
}

function validarFeedback(x: unknown): boolean {
  return (
    objetoCom(x, ['dim', 'h', 'voto', 't']) &&
    DIMENSOES.includes(x.dim as string) &&
    idCurto(x.h) &&
    VOTOS.includes(x.voto as string) &&
    numero(x.t)
  )
}

// Y3: `h` é um hash curto (12 hex).
function idCurto(x: unknown): boolean {
  return typeof x === 'string' && /^[0-9a-f]{12}$/.test(x)
}

function validarEventoObjetivo(x: unknown): x is EventoObjetivo {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false
  const o = x as Record<string, unknown>
  return (
    Object.keys(o).every(k => k === 't' || k === 'tipo' || k === 'objetivoId' || k === 'timeboxMin' || k === 'motivo') &&
    numero(o.t) &&
    (o.tipo === 'abrir' || o.tipo === 'trocar' || o.tipo === 'fechar' || o.tipo === 'timebox') &&
    typeof o.objetivoId === 'string' &&
    (!('timeboxMin' in o) || (Number.isSafeInteger(o.timeboxMin) && (o.timeboxMin as number) >= 1)) &&
    (!('motivo' in o) || o.motivo === 'reinicio')
  )
}

function migrarLivroV1(v: LivroV1): Livro {
  return { formato: 2, sessoes: v.sessoes.map(({ id, ini, fim }) => ({ id, ini, fim })) }
}

function validarRegistro(x: unknown): x is Registro {
  return objetoCom(x, ['id', 'ini', 'fim']) && typeof x.id === 'string' && numero(x.ini) && numero(x.fim)
}

function validarRegistroV1(x: unknown): x is RegistroV1 {
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

// Matriz: ausente → forma vazia; forma atual válida → usar; formato anterior válido → migrado em memória;
// qualquer outra → `dados-incompativeis:<chave>`.
// Só lê: serve ao `ui.render`, onde gravar no `$.state` é recusado.
async function lerSemRelatar<V>($: EngineInterface, d: Desc<V>): Promise<Leitura<V>> {
  const bruto = await $.store.get(d.chave)
  if (bruto === undefined) return { ok: true, valor: d.vazio() }
  if (d.validar(bruto)) return { ok: true, valor: bruto }
  const migrado = d.migrar === null ? null : d.migrar(bruto)
  if (migrado !== null) return { ok: true, valor: migrado }
  return { ok: false, codigo: `dados-incompativeis:${d.chave}` }
}

// Fora do desenho: a leitura rejeitada vira o erro corrente (atom e status).
async function ler<V>($: EngineInterface, d: Desc<V>): Promise<V | null> {
  const l = await lerSemRelatar($, d)
  if (l.ok) return l.valor
  await falhar($, l.codigo, null)
  return null
}

// get → validar → podar → mudar → medir → set. Devolve `true` só se gravou.
export async function gravar<V>($: EngineInterface, d: Desc<V>, agora: number, mudar: (v: V) => V): Promise<boolean> {
  const atual = await ler($, d)
  if (atual === null) return false
  const novo = mudar(d.podar(atual, agora))
  if (d.cheio !== null && JSON.stringify(novo).length > ORCAMENTO) {
    await falhar($, d.cheio, null)
    return false
  }
  const recusa = await $.store.set(d.chave, novo).then(
    () => null,
    (r: unknown) => (r instanceof Error ? r.message : String(r)),
  )
  if (recusa !== null) {
    await falhar($, 'store-recusou', recusa)
    return false
  }
  return true
}

// O erro mais recente fica no atom e no status; a mensagem da recusa nunca vai para o store.
// O mesmo erro, enquanto é o corrente, é registrado uma vez (a faixa relê o store a cada desenho).
async function falhar($: EngineInterface, codigo: Codigo, detalhe: string | null): Promise<void> {
  const corrente = await read($, erroAtom)
  if (corrente !== null && corrente.codigo === codigo && corrente.detalhe === detalhe) return
  await update($, erroAtom, () => ({ codigo, detalhe }))
  $.ui.status(`harness-session-guard: ${codigo}${detalhe === null ? '' : `: ${detalhe}`} · /hsg`)
}
