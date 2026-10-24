// Camada 1 determinística (mod-v2 D-C1…D-C7, D-J3). Puro: sem `$` e sem relógio; recebe dados brutos.
import type { SessionMessage } from 'claude-code'

import type { Calculo, Commit, Dado, Objetivo, PromptRegistro, Sessao } from '../types'
import type { Registro } from './atencao'
import { sha256Hex } from './hash'
import { tempoAtivoSeg } from './objetivo'

export type Mensagem = Pick<SessionMessage, 'role' | 'text' | 'toolUses' | 'toolResults'>

// D-C1/D-C4: `fim` null = objetivo aberto (sem limite superior para commits, prompts e compactações).
export type Janela = { ini: number; fim: number | null }

export type Casamento = {
  casados: ReadonlyMap<number, PromptRegistro> // índice da mensagem → prompt registrado
  semRegistro: readonly number[] // índices das mensagens digitadas sem registro (omitidas)
  semMensagem: readonly PromptRegistro[] // prompts registrados sem mensagem
}

export type EntradaFatos = {
  objetivo: Objetivo | null
  fechamento: number | null // D-C1; o atom `objetivo` guarda só o aberto, então o chamador de hoje passa null
  viva: Sessao | null
  registros: readonly Registro[] | null // o livro; null = incompatível
  commits: Dado<Commit[]> // já cortado na janela por `parsearGitLog`
  mensagens: Dado<readonly Mensagem[]>
  prompts: readonly PromptRegistro[]
  compactacoes: readonly number[]
}

const FERRAMENTAS_EDICAO = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']
const MAX_ASSUNTO = 200

// D-J3: NFC, espaços colapsados em um, trim.
export function normalizar(texto: string): string {
  return texto.normalize('NFC').replace(/\s+/g, ' ').trim()
}

// D-J3: `len` e `hash` de um prompt digitado; `null` se o texto normalizado é vazio (não casaria com nada).
// A ordem `k` é dada por `acrescentarPrompt`, dentro do `update` do atom (o hash é assíncrono).
export async function registrarPrompt(texto: string, t: number): Promise<Omit<PromptRegistro, 'k'> | null> {
  const n = normalizar(texto)
  if (n === '') return null
  return { t, len: n.length, hash: await sha256Hex(n) }
}

export function acrescentarPrompt(prompts: readonly PromptRegistro[], r: Omit<PromptRegistro, 'k'>): PromptRegistro[] {
  return [...prompts, { k: (prompts.at(-1)?.k ?? 0) + 1, ...r }]
}

// D-C1: a janela do objetivo; sem objetivo, a sessão viva até `ultimaID`; sem nenhum dos dois, `null`.
export function janelaDe(objetivo: Objetivo | null, fechamento: number | null, viva: Sessao | null): Janela | null {
  if (objetivo !== null) return { ini: objetivo.abertoEm, fim: fechamento }
  return viva === null ? null : { ini: viva.ini, fim: viva.ultimaID }
}

// D-C4: prompts com horário na janela.
export function turnosDoObjetivo(prompts: readonly PromptRegistro[], j: Janela): PromptRegistro[] {
  return prompts.filter(p => dentro(p.t, j))
}

// D-C2: o argv fixo do único `git log` do mod; início e fim em segundos de época, sem texto do dev.
export function argvGitLog(j: Janela): string[] {
  return [
    'git',
    'log',
    'HEAD',
    '--no-merges',
    `--since=${seg(j.ini)}`,
    ...(j.fim === null ? [] : [`--until=${seg(j.fim)}`]),
    '--format=%H %ct %s',
  ]
}

// D-C2: uma linha por commit, `hash época assunto`; o filtro por horário de época repete o do git.
export function parsearGitLog(stdout: string, j: Janela): Dado<Commit[]> {
  const commits: Commit[] = []
  for (const linha of stdout.split(/\r?\n/)) {
    if (linha === '') continue
    const m = /^([0-9a-f]{40}|[0-9a-f]{64}) (\d+) ([\s\S]*)$/.exec(linha)
    if (m === null) return { ok: false, motivo: 'git: saída ilegível' }
    const epoca = Number(m[2])
    if (epoca < seg(j.ini) || (j.fim !== null && epoca > seg(j.fim))) continue
    commits.push({ hash: m[1] as string, t: epoca * 1000, assunto: Array.from(m[3] as string).slice(0, MAX_ASSUNTO).join('') })
  }
  return { ok: true, valor: commits }
}

// D-J3: mensagem `user` sem `toolResults` é candidata a prompt digitado.
function ehDigitada(m: Mensagem): boolean {
  return m.role === 'user' && (m.toolResults?.length ?? 0) === 0
}

// D-J3: a partir do ponteiro, o primeiro registro (na ordem de `k`) cujo `len` e `hash` casam com o prefixo da
// `text` normalizada; o ponteiro avança além dele. Sem registro, a mensagem é omitida e contada.
export async function casarPrompts(mensagens: readonly Mensagem[], prompts: readonly PromptRegistro[]): Promise<Casamento> {
  const casados = new Map<number, PromptRegistro>()
  const semRegistro: number[] = []
  let ponteiro = 0
  for (const [i, m] of mensagens.entries()) {
    if (!ehDigitada(m)) continue
    const texto = normalizar(m.text)
    let j = -1
    for (let idx = ponteiro; idx < prompts.length && j < 0; idx++) {
      const p = prompts[idx] as PromptRegistro
      if (p.len <= texto.length && (await sha256Hex(texto.slice(0, p.len))) === p.hash) j = idx
    }
    if (j < 0) {
      semRegistro.push(i)
      continue
    }
    casados.set(i, prompts[j] as PromptRegistro)
    ponteiro = j + 1
  }
  const usados = new Set(casados.values())
  return { casados, semRegistro, semMensagem: prompts.filter(p => !usados.has(p)) }
}

// D-C5: por arquivo, `max(0, turnos distintos editando − 1)`; o total é a soma. Um turno vale do prompt dele até o
// anterior ao seguinte; uma mensagem digitada sem registro encerra o turno anterior sem abrir outro.
// Só entram turnos com horário na janela. Edição = `Edit`/`Write`/`MultiEdit`/`NotebookEdit` sem `isError`.
export function ciclosDeRefinamento(
  mensagens: readonly Mensagem[],
  casados: ReadonlyMap<number, PromptRegistro>,
  j: Janela,
): Dado<{ edicoes: number; ciclos: number }> {
  const porArquivo = new Map<string, Set<number>>()
  let edicoes = 0
  let atual: PromptRegistro | null = null
  for (const [i, m] of mensagens.entries()) {
    if (ehDigitada(m)) {
      atual = casados.get(i) ?? null
      continue
    }
    if (m.role !== 'assistant' || atual === null || !dentro(atual.t, j)) continue
    for (const u of m.toolUses) {
      if (!FERRAMENTAS_EDICAO.includes(u.tool) || u.isError === true) continue
      const arquivo = u.input.file_path ?? u.input.notebook_path
      if (typeof arquivo !== 'string') return { ok: false, motivo: `edição sem caminho de arquivo (${u.tool})` }
      edicoes++
      porArquivo.set(arquivo, (porArquivo.get(arquivo) ?? new Set<number>()).add(atual.k))
    }
  }
  let ciclos = 0
  for (const turnos of porArquivo.values()) ciclos += Math.max(0, turnos.size - 1)
  return { ok: true, valor: { edicoes, ciclos } }
}

// D-C1…D-C7: todos os fatos de uma janela. `{ tipo: 'nada' }` sem objetivo e sem sessão viva.
export async function calcularFatos(x: EntradaFatos): Promise<Calculo> {
  const j = janelaDe(x.objetivo, x.fechamento, x.viva)
  if (j === null) return { tipo: 'nada' }
  const fim = fimDasDuracoes(j, x)
  const intervalos = intervalosAteUltimoEvento(x)
  const ativo = (de: number): Dado<number> => {
    if (intervalos === null) return { ok: false, motivo: 'livro incompatível' }
    return fim.ok ? { ok: true, valor: tempoAtivoSeg(intervalos, de, fim.valor) } : fim
  }
  const tempo = ativo(j.ini)
  const turnos = turnosDoObjetivo(x.prompts, j)

  let semMensagem: Dado<number>
  let mensagensSemRegistro: Dado<number>
  let edicoes: Dado<number>
  let ciclos: Dado<number>
  if (x.mensagens.ok) {
    const c = await casarPrompts(x.mensagens.valor, x.prompts)
    const r = ciclosDeRefinamento(x.mensagens.valor, c.casados, j)
    semMensagem = { ok: true, valor: c.semMensagem.filter(p => dentro(p.t, j)).length }
    mensagensSemRegistro = { ok: true, valor: c.semRegistro.length }
    edicoes = r.ok ? { ok: true, valor: r.valor.edicoes } : r
    ciclos = r.ok ? { ok: true, valor: r.valor.ciclos } : r
  } else {
    const falha: Dado<number> = { ok: false, motivo: `mensagens: ${x.mensagens.motivo}` }
    semMensagem = mensagensSemRegistro = edicoes = ciclos = falha
  }

  return {
    tipo: 'fatos',
    fatos: {
      objetivo:
        x.objetivo === null
          ? null
          : {
              abertoEm: x.objetivo.abertoEm,
              fechamento: x.fechamento,
              timeboxMin: x.objetivo.timeboxMin,
              temDod: x.objetivo.dod !== null,
            },
      ini: j.ini,
      fim,
      tempoAtivoSeg: tempo,
      commits: x.commits,
      desdeAvancoSeg: desdeAvanco(x, j, ativo),
      timebox: timebox(x.objetivo, tempo),
      turnos: turnos.length,
      semMensagem,
      mensagensSemRegistro,
      edicoes,
      ciclos,
      compactacoes: x.compactacoes.filter(t => dentro(t, j)),
    },
  }
}

// D-C3: tempo ativo entre o último avanço (commit na janela ou fechamento; senão o início da janela) e o fim.
function desdeAvanco(x: EntradaFatos, j: Janela, ativo: (de: number) => Dado<number>): Dado<number> {
  if (!x.commits.ok) return { ok: false, motivo: `commits: ${x.commits.motivo}` }
  const avancos = [j.ini, ...x.commits.valor.map(c => c.t), ...(x.fechamento === null ? [] : [x.fechamento])]
  return ativo(Math.max(...avancos))
}

// D-C7: valor e se foi atingido (tempo ativo ≥ timebox, como o evento `timebox` do tick).
function timebox(objetivo: Objetivo | null, tempo: Dado<number>): Dado<{ min: number; atingido: boolean }> | null {
  if (objetivo === null || objetivo.timeboxMin === null) return null
  const min = objetivo.timeboxMin
  return tempo.ok ? { ok: true, valor: { min, atingido: tempo.valor >= min * 60 } } : tempo
}

// D-C1: fechamento; ou, aberto, `ultimaID` da sessão viva; sem sessão viva, o último fim do livro. Sem relógio.
function fimDasDuracoes(j: Janela, x: EntradaFatos): Dado<number> {
  if (j.fim !== null) return { ok: true, valor: j.fim }
  if (x.viva !== null) return { ok: true, valor: Math.max(j.ini, x.viva.ultimaID) }
  if (x.registros === null) return { ok: false, motivo: 'livro incompatível' }
  return { ok: true, valor: x.registros.reduce((m, r) => Math.max(m, r.fim), j.ini) }
}

// D-C1: os intervalos do livro (todas as janelas) e a sessão viva até `ultimaID`, não até `agora`.
// O registro do livro da própria sessão viva sai: o tick o gravou até `agora` com turno aberto.
function intervalosAteUltimoEvento(x: EntradaFatos): (readonly [number, number])[] | null {
  if (x.registros === null) return null
  const viva = x.viva
  const intervalos = x.registros.filter(r => viva === null || r.id !== viva.id).map(r => [r.ini, r.fim] as const)
  if (viva !== null) intervalos.push([viva.ini, viva.ultimaID] as const)
  return intervalos
}

function dentro(t: number, j: Janela): boolean {
  return t >= j.ini && (j.fim === null || t <= j.fim)
}

function seg(ms: number): number {
  return Math.floor(ms / 1000)
}
