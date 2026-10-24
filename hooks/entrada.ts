// Entrada do juiz (mod-v2 D-J4…D-J8, D-J1). Pura: sem `$`; a mesma entrada de dados dá os mesmos blocos e o mesmo hash.
import type { Bloco, Dado, Fatos, Objetivo } from '../types'
import { dentro, ehDigitada, normalizar, type Janela, type MensagensCasadas } from './fatos'
import { sha256Hex } from './hash'
import type { Avaliacoes } from './livro'
import { RUBRICA_V1, VERSAO_RUBRICA } from './rubrica'

// D-J1: os parâmetros da chamada ao modelo, num único ponto (usados também no hash, D-J8).
export const PARAMETROS_JUIZ = { model: 'claude-sonnet-5-5', effort: 'medium', maxTokens: 2048, timeoutMs: 180_000 } as const

export const VERSAO_ESQUEMA = 1
// Campo `version` de `.claude-plugin/plugin.json`: o módulo de hooks não lê JSON, então o valor é copiado aqui.
export const VERSAO_MOD = '0.1.0'

// D-J7 (provisório): bytes UTF-8 da evidência.
export const ORCAMENTO_EVIDENCIA_BYTES = 40_960

export const MOTIVO_SEM_OBJETIVO =
  'defina objetivo e DoD: /hsg objetivo abrir [timebox=<min>] <texto> e /hsg objetivo dod <texto>'

type Chamada = { id: string; ferramenta: string; arquivo: string | null; ok: boolean }
// `t` (horário do prompt) só serve para decidir o turno N; não entra na evidência.
export type Turno = { k: number; t: number; prompt: string; agente: string[]; chamadas: Chamada[] }

export type DadosEntrada = {
  objetivo: Objetivo | null
  fatos: Fatos | null
  mensagens: Dado<MensagensCasadas>
  avaliacoes: Avaliacoes | null // null = incompatível (já relatado pelo chamador)
  // mod-v2-avaliar D-A3: a marca (`ateTurno` da última avaliação `ok` deste objetivo, em memória); null = sem marca.
  ateTurno: number | null
}

// `evidencia`: os itens de texto enviados (prompts digitados e texto do agente, normalizados), para a C1.
// `ultimoTurno` (D-A2): o `k` do último turno enviado.
export type EntradaMontada = { blocos: Bloco[]; hash: string; evidencia: string[]; ultimoTurno: number }

// D-J6: objeto JSON com chaves ordenadas (recursivamente) e strings em NFC, com espaços colapsados e trim.
export function canonico(valor: unknown): string {
  return JSON.stringify(ordenar(valor))
}

function ordenar(v: unknown): unknown {
  if (typeof v === 'string') return normalizar(v)
  if (Array.isArray(v)) return v.map(ordenar)
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>
    return Object.fromEntries(Object.keys(o).sort().map(k => [k, ordenar(o[k])]))
  }
  return v
}

// D-J5: só o que a allowlist permite, dos turnos do objetivo (prompts digitados casados, ordem de `k`).
export function evidenciaDe(m: MensagensCasadas, j: Janela): Turno[] {
  const turnos: Turno[] = []
  let atual: Turno | null = null
  for (const [i, msg] of m.lista.entries()) {
    if (ehDigitada(msg)) {
      const r = m.casamento.casados.get(i)
      atual = r === undefined || !dentro(r.t, j) ? null : { k: r.k, t: r.t, prompt: normalizar(msg.text).slice(0, r.len), agente: [], chamadas: [] }
      if (atual !== null) turnos.push(atual)
    } else if (atual !== null && msg.role === 'assistant') {
      if (normalizar(msg.text) !== '') atual.agente.push(msg.text)
      for (const u of msg.toolUses) {
        atual.chamadas.push({
          id: `turno ${atual.k}, chamada ${atual.chamadas.length + 1}`,
          ferramenta: u.tool,
          arquivo: caminho(u.input),
          ok: u.isError !== true,
        })
      }
    }
  }
  return turnos
}

// D-J5: arquivo só de `input.file_path` / `input.notebook_path`; senão `null`; nenhum outro campo de `input`.
function caminho(input: Record<string, unknown>): string | null {
  if (typeof input.file_path === 'string') return input.file_path
  return typeof input.notebook_path === 'string' ? input.notebook_path : null
}

// D-J7: corta pelos turnos mais antigos até a evidência caber em `ORCAMENTO_EVIDENCIA_BYTES` e escreve
// "k turnos omitidos". Se o turno mais recente sozinho não cabe, não monta (nunca trunca dentro de um turno).
export function cortarEvidencia(turnos: readonly Turno[]): Dado<{ turnos: Turno[]; omitidos: number }> {
  const partes = turnos.map(textoTurno)
  const bytes = partes.map(bytesUtf8)
  let restante = bytes.reduce((a, b) => a + b, 0) + Math.max(0, partes.length - 1)
  for (let omitidos = 0; omitidos < turnos.length; omitidos++) {
    const total = bytesUtf8(textoEvidencia([], omitidos)) + restante
    if (total <= ORCAMENTO_EVIDENCIA_BYTES) return { ok: true, valor: { turnos: turnos.slice(omitidos), omitidos } }
    restante -= (bytes[omitidos] as number) + (omitidos < turnos.length - 1 ? 1 : 0)
  }
  const ultimo = turnos.at(-1)
  return { ok: false, motivo: `turno ${ultimo === undefined ? 0 : ultimo.k} maior que 40 KB: avaliação indisponível` }
}

function textoTurno(t: Turno): string {
  return canonico({ turno: t.k, prompt: t.prompt, agente: t.agente, chamadas: t.chamadas })
}

// O mesmo texto que `canonico({ nota, turnos })` daria, montado de turnos já serializados.
function textoEvidencia(partes: readonly string[], omitidos: number): string {
  const nota = omitidos > 0 ? `"nota":${JSON.stringify(`${omitidos} turnos omitidos`)},` : ''
  return `{${nota}"turnos":[${partes.join(',')}]}`
}

function bytesUtf8(texto: string): number {
  return new TextEncoder().encode(texto).length
}

// D-J4: os 5 blocos, nesta ordem; o hash (D-J8) é SHA-256 hex dos textos dos blocos, na ordem, e das versões,
// `model` e `effort`, separados por `\n`.
export async function montarEntrada(d: DadosEntrada): Promise<Dado<EntradaMontada>> {
  const o = d.objetivo
  if (o === null || o.dod === null || d.fatos === null) return { ok: false, motivo: MOTIVO_SEM_OBJETIVO }
  if (!d.mensagens.ok) return { ok: false, motivo: `mensagens: ${d.mensagens.motivo}` }
  if (d.avaliacoes === null) return { ok: false, motivo: 'avaliacoes: dados-incompativeis:avaliacoes · /hsg apagar-dados confirmar' }

  const turnos = evidenciaDe(d.mensagens.valor, { ini: o.abertoEm, fim: null })
  if (turnos.length === 0) return { ok: false, motivo: 'nenhum prompt digitado do objetivo casou com uma mensagem da sessão' }
  const corte = cortarEvidencia(turnos)
  if (!corte.ok) return corte

  // D-A3: depois da marca; sem marca, o primeiro turno do objetivo.
  const avalieAPartirDoTurno = d.ateTurno === null ? (turnos[0] as Turno).k : d.ateTurno + 1
  const blocos: Bloco[] = [
    { text: RUBRICA_V1, cache: true },
    { text: canonico({ objetivo: { texto: o.texto, dod: o.dod, timeboxMin: o.timeboxMin, abertoEm: new Date(o.abertoEm).toISOString() } }) },
    { text: canonico({ fatos: fatosDaEntrada(d.fatos) }) },
    { text: textoEvidencia(corte.valor.turnos.map(textoTurno), corte.valor.omitidos) },
    { text: canonico({ jaApontados: jaApontados(d.avaliacoes, o), avalieAPartirDoTurno }) },
  ]
  const hash = await hashEntrada(blocos)
  const evidencia = corte.valor.turnos.flatMap(t => [t.prompt, ...t.agente]).map(normalizar)
  // `cortarEvidencia` só devolve ok com pelo menos o turno mais recente.
  const ultimoTurno = (corte.valor.turnos.at(-1) as Turno).k
  return { ok: true, valor: { blocos, hash, evidencia, ultimoTurno } }
}

// D-J8.
export async function hashEntrada(blocos: readonly Bloco[]): Promise<string> {
  const { model, effort } = PARAMETROS_JUIZ
  return sha256Hex([...blocos.map(b => b.text), String(VERSAO_ESQUEMA), VERSAO_RUBRICA, VERSAO_MOD, model, effort].join('\n'))
}

// Y3: ids `{dim, h}` dos achados com `t ≥ abertoEm` do objetivo, em ordem fixa.
export function jaApontados(a: Avaliacoes, o: Objetivo): { dim: string; h: string }[] {
  return a.achados
    .filter(x => x.t >= o.abertoEm)
    .map(x => ({ dim: x.dim, h: x.h }))
    .sort((x, y) => (x.dim === y.dim ? (x.h < y.h ? -1 : x.h > y.h ? 1 : 0) : x.dim < y.dim ? -1 : 1))
}

// D-J4(3): a camada 1 como dados; durações até o último evento (sem "agora"); fonte que falhou vai como `indisponivel`.
function fatosDaEntrada(f: Fatos): unknown {
  const dado = <V>(d: Dado<V>, mostrar: (v: V) => unknown): unknown => (d.ok ? { valor: mostrar(d.valor) } : { indisponivel: d.motivo })
  const iso = (t: number) => new Date(t).toISOString()
  return {
    objetivo: f.objetivo === null ? null : { fechamento: f.objetivo.fechamento === null ? null : iso(f.objetivo.fechamento) },
    fim: dado(f.fim, iso),
    tempoAtivoSeg: dado(f.tempoAtivoSeg, v => v),
    commits: dado(f.commits, v => ({ quantidade: v.length, assuntos: v.map(c => c.assunto) })),
    desdeAvancoSeg: dado(f.desdeAvancoSeg, v => v),
    timebox: f.timebox === null ? null : dado(f.timebox, v => v),
    turnos: f.turnos,
    semMensagem: dado(f.semMensagem, v => v),
    mensagensSemRegistro: dado(f.mensagensSemRegistro, v => v),
    edicoesPeloMenos: dado(f.edicoes, v => v),
    ciclosPeloMenos: dado(f.ciclos, v => v),
    compactacoes: f.compactacoes.map(iso),
  }
}
