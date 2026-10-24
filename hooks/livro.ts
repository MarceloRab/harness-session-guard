// Persistência v2 no `$.store` (mod-v2 D-P1…D-P3). Único arquivo que toca `$.store`.
// Regras puras (validação, poda, upsert, migração) primeiro; I/O depois.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { ErroDados } from '../types'
import type { Registro } from './atencao'
import type { CampoConfig } from './config'

export type Chave = 'livro'
export type Livro = { formato: 2; sessoes: Registro[] }
export type Codigo = 'versao' | `config:${CampoConfig}` | `dados-incompativeis:${Chave}` | 'livro-cheio' | 'store-recusou'
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

// Erro corrente num atom: a faixa o lê e redesenha quando ele muda. Zerado em `iniciarLivro`.
const erroAtom = atom({ plugin: 'harness-session-guard', key: 'erro' } as const, null, { shape: 'erro-1' })

// ---------- API (register.tsx e tracks seguintes) ----------

// D-P6: com `HSG_DEBUG=1`, registra o fuso local no log (não vai para o store).
export async function iniciarLivro($: EngineInterface): Promise<void> {
  if ((await $.env.get('HSG_DEBUG')) === '1') $.ui.log(`harness-session-guard tz=${new Date().getTimezoneOffset()}`)
  await update($, erroAtom, () => null)
}

export async function erroCorrente($: EngineInterface): Promise<ErroDados | null> {
  return read($, erroAtom)
}

// Em session.start: o livro é lido e, se rejeitado, relatado fora do desenho. Um formato 1 válido é
// persistido como formato 2 aqui (D-P2).
export async function verificarDados($: EngineInterface): Promise<void> {
  if (validarLivroV1(await $.store.get(LIVRO.chave))) {
    await gravar($, LIVRO, await $.clock.now(), v => v)
    return
  }
  await ler($, LIVRO)
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
// O mesmo erro, enquanto é o corrente, é registrado uma vez (a faixa e o painel releem o store a cada desenho).
async function falhar($: EngineInterface, codigo: Codigo, detalhe: string | null): Promise<void> {
  const corrente = await read($, erroAtom)
  if (corrente !== null && corrente.codigo === codigo && corrente.detalhe === detalhe) return
  await update($, erroAtom, () => ({ codigo, detalhe }))
  $.ui.status(`harness-session-guard: ${codigo}${detalhe === null ? '' : `: ${detalhe}`} · /hsg`)
}
