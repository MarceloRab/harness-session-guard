import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteResult, Register, Timer } from 'claude-code'

import type { Achado, Calculo, Commit, Dado, EntradaC, Fatos, Juiz, Objetivo, ResultadoC, Sessao, Voto } from '../types'
import { aplicarID, expirou, intervalosDe, iniciarTurno, medir, registroEm, renovar } from './atencao'
import { resolverConfig, versaoAtende, type ConfigResolvida } from './config'
import {
  acrescentarPrompt,
  argvGitLog,
  calcularFatos,
  casarPrompts,
  janelaDe,
  parsearGitLog,
  registrarPrompt,
  type Janela,
  type MensagensCasadas,
} from './fatos'
import { jaApontados, montarEntrada, MOTIVO_SEM_OBJETIVO, PARAMETROS_JUIZ } from './entrada'
import { aplicarY3, conferirCitacoes, parsearResposta } from './resultado'
import {
  apagarDados,
  CHAVES_APAGAR,
  chavesAntigas,
  erroCorrente,
  espiarLivro,
  gravarAchados,
  gravarClique,
  gravarEventosObjetivo,
  gravarFeedback,
  gravarRegistro,
  iniciarLivro,
  lerAvaliacoes,
  lerLivro,
  lerObjetivos,
  registrarErro,
  verificarDados,
  type AchadoGravado,
  type Avaliacoes,
  type CliqueAvaliacao,
  type Livro,
  type ObjetivoAvaliado,
} from './livro'
import { aplicarTransicao, temTimebox, tempoAtivoSeg, type Mutacao } from './objetivo'
import {
  achadosDaTela,
  AVISO_OBJETIVO,
  faixa,
  interpretar,
  modeloAvaliacao,
  modeloDetalhes,
  painel,
  painelAvaliacao,
  TEXTO_APAGAR,
  textoDetalhes,
  textoEntrada,
  textoObjetivo,
  TITULO,
  USO,
  type Acao,
  type EntradaDetalhes,
} from './ui'

const VERSAO_MINIMA = [2, 1, 310] as const
const ORIGENS_SUBMIT = ['composer', 'bridge']
const PANE = 'hsg-detalhes'
const PANE_AVALIACAO = 'hsg-avaliacao'
const COMANDO = 'hsg'
const TICK_MS = 60_000

// Sessão de atenção viva; o shape recusa o que uma versão anterior do código guardou.
const atencao = atom({ plugin: 'harness-session-guard', key: 'atencao' } as const, null, { shape: 'atencao-2' })
// D-T7: instante do último tick; a faixa e o painel o leem para redesenhar o relógio.
const pulso = atom({ plugin: 'harness-session-guard', key: 'pulso' } as const, 0, { shape: 'pulso-1' })
// D-O1: o objetivo aberto, com texto e DoD; só aqui e nunca no armazenamento persistente.
const objetivo = atom({ plugin: 'harness-session-guard', key: 'objetivo' } as const, null, { shape: 'objetivo-1' })
// D-J3/D-C6/D-C-UI: só `$.state`. `prompts` guarda `len` e `hash` dos prompts digitados (nunca o texto).
const prompts = atom({ plugin: 'harness-session-guard', key: 'prompts' } as const, [], { shape: 'prompts-1' })
const compactacoes = atom({ plugin: 'harness-session-guard', key: 'compactacoes' } as const, [], { shape: 'compactacoes-1' })
const resultadoC = atom({ plugin: 'harness-session-guard', key: 'resultadoC' } as const, null, { shape: 'resultadoC-2' })
// D-P4/D-J11: a última entrada do juiz (ou o motivo de não montar); só `$.state`.
const entradaC = atom({ plugin: 'harness-session-guard', key: 'entradaC' } as const, null, { shape: 'entradaC-1' })

// Estado do módulo: recomeça a cada reload e é refeito em session.start.
// `config` null = o mod não mede (versão ou configuração com erro, em `erro`; código curto em `erroCodigo`).
let config: ConfigResolvida | null = null
let erro: string | null = null
let erroCodigo: string | null = null
let timer: Timer | null = null
let tick: Timer | null = null
// D-J1: uma chamada ao juiz por vez; zerado no `finally` do ponto de chamada.
let emAndamento = false

export const register: Register = (on, options) => {
  const resultado = resolverConfig(options)

  on('session.start', async ($, e, next) => {
    await iniciarLivro($)
    // O desenho não relata erro de dados; os dados guardados são verificados (e relatados) aqui.
    await verificarDados($)
    const { base } = await $.session.version()
    config = null
    if (!versaoAtende(base, VERSAO_MINIMA)) {
      await registrarErro($, 'versao')
      erro = `versao: requer Claude Code ${VERSAO_MINIMA.join('.')} ou superior (atual: ${base ?? 'desconhecida'})`
      erroCodigo = 'versao'
    } else if (!resultado.ok) {
      await registrarErro($, `config:${resultado.campo}`)
      erro = `configuração inválida: ${resultado.campo}`
      erroCodigo = `config:${resultado.campo}`
    } else {
      erro = null
      erroCodigo = null
      config = resultado.config
    }
    mostrarErroDeConfig($)
    await $.command.register({
      name: COMANDO,
      description: 'harness-session-guard: detalhes da sessão de atenção, objetivo e dados',
      argumentHint: '[objetivo [abrir|trocar|dod|fechar] ... | avaliar | entrada | apagar-dados [confirmar]]',
    })
    await retomar($)
    armarTick($)

    return next(e)
  })

  // D-T2: a interação do dev conta como ID; quem abre o turno do agente é o `turn.start`.
  // D-J3: o prompt digitado (sem `command`) também deixa `len` e `hash` no atom `prompts`.
  on('prompt.submit', async ($, e, next) => {
    if (ORIGENS_SUBMIT.includes(e.origin.kind) && e.isMeta !== true) {
      await registrarID($)
      if (e.command === undefined) await guardarPrompt($, e.text)
    }
    return next(e)
  })

  // D-C6: o horário de cada compactação do laço principal que aconteceu (manual, automática ou de plugin).
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && r.skip === undefined) await guardarCompactacao($)
    return r
  })

  // D-T3: o início de um turno do laço principal (sem `agentId`) o marca como aberto; sem sessão viva não faz nada.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await inicioDeTurno($)
    return next(e)
  })

  // D-T3: o fim de um turno do laço principal renova a atenção, qualquer que seja o motivo.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await fimDeTurno($)
    return next(e)
  })

  // D-T3: o fim da sessão do Claude Code fecha a sessão de atenção e zera o turno aberto.
  on('session.end', async ($, e, next) => {
    await encerrar($)
    return next(e)
  })

  // A bolinha T na faixa (terminal e desktop); com pesquisa na faixa, passa a vez.
  // O desenho só lê: um livro incompatível aparece como erro sem gravar (o relato é de session.start e das gravações).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    await read($, pulso) // só assina: o tick de 1 min redesenha o relógio
    const livro = await espiarLivro($)
    const erroFaixa = erroCodigo ?? (await erroCorrente($))?.codigo ?? (livro.ok ? null : livro.codigo)
    const abrir = () => abrirDetalhes($)
    const avaliar = () => abrirAvaliacao($)
    if (erroFaixa !== null) return faixa($.ui.resolve(e), { tipo: 'erro', erro: erroFaixa }, abrir, avaliar)
    // Sem erro e sem configuração só antes de session.start: a faixa passa a vez.
    if (!livro.ok || config === null) return next(e)
    const medida = medir(await read($, atencao), livro.valor.sessoes, await $.clock.now(), config)
    return faixa($.ui.resolve(e), { tipo: 'medida', medida }, abrir, avaliar)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await read($, pulso) // só assina: o tick de 1 min redesenha o painel
    return painel($.ui.resolve(e), modeloDetalhes(await entradaDetalhes($, true)))
  })

  // D-C-UI: o painel só lê o atom; não executa git nem lê mensagens.
  on('ui.render', { component: 'Pane', requestId: PANE_AVALIACAO }, async ($, e) => {
    const r = await read($, resultadoC)
    const entrada = await read($, entradaC)
    return painelAvaliacao($.ui.resolve(e), modeloAvaliacao(r, entrada), achadosDaTela(r, entrada), {
      sugerir: a => sugerir($, a),
      votar: (a, voto) => votar($, a, voto),
    })
  })

  // `/hsg` e argumentos; cada execução conta como ID.
  on('command.run', { command: COMANDO }, async ($, e) => ({ text: await executar($, interpretar(e.args)) }))
}

// D-T2: uma interação do dev.
export async function registrarID($: EngineInterface): Promise<void> {
  if (config === null) return
  const t = await $.clock.now()
  const sessionId = await $.session.id()
  await aplicar($, t, (s, c) => aplicarID(s, t, sessionId, c))
}

// Clique da bolinha: abre o painel e conta como ID.
async function abrirDetalhes($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: TITULO })
  await registrarID($)
}

// Clique da C: abre o painel (que mostra "em andamento"), avalia e conta como ID. Com uma avaliação em curso,
// `avaliar` não chama de novo e o painel segue mostrando o andamento.
async function abrirAvaliacao($: EngineInterface): Promise<void> {
  if (config === null) return
  await $.ui.open({ id: PANE_AVALIACAO, title: TITULO })
  await avaliar($)
  await registrarID($)
}

// Fluxo: ação em livro.ts → registro de ID. Devolve o texto do `/hsg`.
async function executar($: EngineInterface, a: Acao): Promise<string> {
  let texto: string
  if (typeof a === 'object') texto = await executarObjetivo($, a.objetivo)
  else {
    switch (a) {
      case 'uso':
        texto = USO
        break
      case 'detalhes':
        texto = textoDetalhes(modeloDetalhes(await entradaDetalhes($, false)))
        break
      case 'avaliar':
        if (config === null) texto = `Indisponível: ${erro} · /hsg`
        else if (emAndamento) texto = 'Avaliação em andamento.'
        else {
          await avaliar($)
          texto = textoDetalhes(modeloAvaliacao(await read($, resultadoC), await read($, entradaC)))
        }
        break
      case 'entrada':
        texto = textoEntrada(await read($, entradaC))
        break
      case 'apagar-dados':
        texto = TEXTO_APAGAR
        break
      case 'apagar-confirmar':
        await apagarDados($)
        await update($, objetivo, () => null) // D-O6: o objetivo aberto dependia dos dados apagados
        mostrarErroDeConfig($)
        texto = `Dados apagados: ${CHAVES_APAGAR.join(', ')}; ${AVISO_OBJETIVO}.`
        break
    }
  }
  await registrarID($)
  return texto
}

// D-O2/D-O3: valida a transição, grava os eventos no store e só então muda o atom `objetivo`.
async function executarObjetivo($: EngineInterface, c: Mutacao | { tipo: 'ver' }): Promise<string> {
  if (config === null) return `Indisponível: ${erro} · /hsg`
  const atual = await read($, objetivo)
  if (c.tipo === 'ver') return textoObjetivo(atual)
  const t = await $.clock.now()
  const r = aplicarTransicao(atual, c, t, await $.session.id())
  if (!r.ok) return r.mensagem
  if (r.eventos.length > 0 && !(await gravarEventosObjetivo($, r.eventos, t))) return falhaDeDados($)
  await update($, objetivo, () => r.objetivo)
  return r.mensagem
}

// Uma gravação recusada sempre deixa o erro corrente (livro.ts `falhar`); sem ele, o invariante quebrou.
async function falhaDeDados($: EngineInterface): Promise<string> {
  const e = await erroCorrente($)
  if (e === null) throw new Error('harness-session-guard: o objetivo não gravou e não há erro corrente')
  const acao = e.codigo.startsWith('dados-incompativeis:') ? '/hsg apagar-dados confirmar' : '/hsg'
  return `Não foi possível gravar o objetivo: ${e.codigo} · ${acao}`
}

// `noDesenho`: dentro do `ui.render` lê sem relatar (gravar no `$.state` ali é recusado) e mostra a
// incompatibilidade como erro; fora dele (`/hsg`) a leitura relata pelo caminho de `livro.ts`.
async function entradaDetalhes($: EngineInterface, noDesenho: boolean): Promise<EntradaDetalhes> {
  let livro: Livro | null
  let incompativel: string | null = null
  if (noDesenho) {
    const l = await espiarLivro($)
    livro = l.ok ? l.valor : null
    incompativel = l.ok ? null : l.codigo
  } else {
    livro = await lerLivro($)
  }
  const e = await erroCorrente($)
  return {
    sessao: await read($, atencao),
    objetivo: await read($, objetivo),
    livro,
    antigas: await chavesAntigas($),
    erro: erro ?? (e === null ? incompativel : `${e.codigo}${e.detalhe === null ? '' : `: ${e.detalhe}`}`),
    config,
    agora: await $.clock.now(),
  }
}

// D-J3: só `len` e `hash` do prompt normalizado ficam no atom; o texto não é guardado.
async function guardarPrompt($: EngineInterface, texto: string): Promise<void> {
  if (config === null) return
  const t = await $.clock.now()
  const r = await registrarPrompt(texto, t)
  if (r !== null) await update($, prompts, atual => acrescentarPrompt(atual, r))
}

async function guardarCompactacao($: EngineInterface): Promise<void> {
  if (config === null) return
  const t = await $.clock.now()
  await update($, compactacoes, atual => [...atual, t])
}

// D-C-UI: lê as fontes (livro, objetivo, sessão, mensagens, git), calcula a camada 1 e guarda o resultado no atom.
// Chamada só pelo clique na C e por `/hsg avaliar`. Nada vai ao armazenamento persistente.
// D-J11: monta a entrada do juiz e a guarda em `entradaC`. D-J1/D-J8: com entrada montada, chama o juiz uma vez
// (ou reaproveita o resultado guardado de hash igual). Com uma chamada em curso, não faz nada.
async function avaliar($: EngineInterface): Promise<void> {
  if (emAndamento) return
  const o = await read($, objetivo)
  const viva = await read($, atencao)
  const janela = janelaDe(o, null, viva)
  const t = await $.clock.now()
  const contexto = await contextoC6($)
  const anterior = (await read($, resultadoC))?.juiz ?? null
  let calculo: Calculo = { tipo: 'nada' }
  let entrada: EntradaC = { t, ok: false, motivo: MOTIVO_SEM_OBJETIVO }
  let avaliacoes: Avaliacoes | null = null
  if (janela !== null) {
    const livro = await lerLivro($)
    const bruto = await tentar($.session.messages())
    const mensagens: Dado<MensagensCasadas> = bruto.ok
      ? { ok: true, valor: { lista: bruto.valor, casamento: await casarPrompts(bruto.valor, await read($, prompts)) } }
      : bruto
    calculo = calcularFatos({
      objetivo: o,
      fechamento: null,
      viva,
      registros: livro === null ? null : livro.sessoes,
      commits: await commitsDaJanela($, janela),
      mensagens,
      prompts: await read($, prompts),
      compactacoes: await read($, compactacoes),
    })
    avaliacoes = await lerAvaliacoes($)
    const montada = await montarEntrada({
      objetivo: o,
      fatos: calculo.tipo === 'fatos' ? calculo.fatos : null,
      mensagens,
      avaliacoes,
    })
    entrada = montada.ok ? { t, ok: true, ...montada.valor } : { t, ok: false, motivo: montada.motivo }
  }
  await update($, entradaC, () => entrada)
  const base = { calculo, andamento: false, contexto }
  // D-J8: hash igual e resultado `ok` no `$.state` = o guardado, sem chamada; sem resultado (ou outro hash), chama.
  if (!entrada.ok || o === null || avaliacoes === null || calculo.tipo !== 'fatos') {
    await update($, resultadoC, () => ({ ...base, juiz: anterior }))
    return
  }
  if (anterior !== null && anterior.hash === entrada.hash && anterior.resultado === 'ok') {
    await update($, resultadoC, () => ({ ...base, juiz: { ...anterior, reutilizado: true as const } }))
    return
  }
  const juiz = await julgar($, { entrada, objetivo: o, fatos: calculo.fatos, avaliacoes }, { ...base, juiz: anterior })
  await update($, resultadoC, () => ({ ...base, juiz }))
}

type PedidoJuiz = {
  entrada: Extract<EntradaC, { ok: true }>
  objetivo: Objetivo
  fatos: Fatos
  avaliacoes: Avaliacoes
}

// D-J1: o ÚNICO ponto que chama o modelo: sem histórico e sem `system`, o bloco de regras com `cache: true`, os
// parâmetros de `PARAMETROS_JUIZ`; sem nova tentativa. D-J13: grava só números, hashes, `usage` e votos.
async function julgar($: EngineInterface, p: PedidoJuiz, antes: ResultadoC): Promise<Juiz> {
  const { model, effort, maxTokens, timeoutMs } = PARAMETROS_JUIZ
  emAndamento = true
  let resposta: Dado<ModelCompleteResult>
  try {
    await update($, resultadoC, () => ({ ...antes, andamento: true }))
    resposta = await tentar($.model.complete({ model, effort, maxTokens, timeoutMs, prompt: p.entrada.blocos }))
  } finally {
    emAndamento = false
  }
  const t = await $.clock.now()
  const hash = p.entrada.hash
  // Pedido recusado antes de enviar (ex.: id fora da lista permitida): sem `usage`, nada a gravar.
  if (!resposta.ok) return { hash, t, resultado: 'api-error', achados: [], usage: null, motivo: resposta.motivo }
  const r = resposta.valor
  if (!r.isAnswered) {
    const motivo = r.reason === 'api-error' ? `status ${r.status ?? 'sem resposta'} · ${r.error}` : undefined
    const status = r.reason === 'api-error' ? { status: r.status } : {}
    const gravacao = await gravarResultado($, p, { t, hash, usage: r.usage, resultado: r.reason, citacoesDescartadas: 0, ...status }, [])
    return { hash, t, resultado: r.reason, achados: [], usage: r.usage, ...(motivo === undefined ? {} : { motivo }), ...gravacao }
  }
  const resposta2 = parsearResposta(r.text)
  if (!resposta2.ok) {
    const gravacao = await gravarResultado($, p, { t, hash, usage: r.usage, resultado: 'json-invalido', citacoesDescartadas: 0 }, [])
    return { hash, t, resultado: 'json-invalido', achados: [], usage: r.usage, motivo: resposta2.motivo, ...gravacao }
  }
  const { achados: candidatos, descartados } = await conferirCitacoes(resposta2.valor, p.entrada.evidencia)
  const achados = aplicarY3(candidatos, descartados, jaApontados(p.avaliacoes, p.objetivo))
  const novos = achados.filter(a => a.estado === 'novo').map(a => ({ dim: a.dim, h: a.h, t }))
  const clique = { t, hash, usage: r.usage, resultado: 'ok' as const, citacoesDescartadas: descartados.size }
  const gravacao = await gravarResultado($, p, clique, novos)
  return { hash, t, resultado: 'ok', achados, usage: r.usage, ...gravacao }
}

// D-J13: `cliques` + `objetivos` (camada 1, só números) e os achados novos (Y3). Devolve `{ gravacao }` com o código do
// erro corrente se alguma escrita falhou (a avaliação continua visível, sem persistir); vazio se tudo gravou.
async function gravarResultado(
  $: EngineInterface,
  p: PedidoJuiz,
  clique: CliqueAvaliacao,
  novos: readonly AchadoGravado[],
): Promise<{ gravacao?: string }> {
  const t = clique.t
  const gravouClique = await gravarClique($, clique, objetivoAvaliado(p.objetivo, p.fatos, t), t)
  const gravouAchados = novos.length === 0 || (await gravarAchados($, novos, t))
  return gravouClique && gravouAchados ? {} : { gravacao: await codigoDoErro($) }
}

// D-J13: a camada 1 só como números; fonte indisponível não vira zero: sem os quatro números, não há registro.
function objetivoAvaliado(o: Objetivo, f: Fatos, t: number): ObjetivoAvaliado | null {
  if (!f.tempoAtivoSeg.ok || !f.ciclos.ok || !f.commits.ok || !f.desdeAvancoSeg.ok) return null
  return {
    t,
    objetivoId: o.id,
    tAtivoSeg: f.tempoAtivoSeg.valor,
    ciclos: f.ciclos.valor,
    commits: f.commits.valor.length,
    semAvancoSeg: f.desdeAvancoSeg.valor,
  }
}

// Uma gravação recusada sempre deixa o erro corrente (livro.ts `falhar`); sem ele, o invariante quebrou.
async function codigoDoErro($: EngineInterface): Promise<string> {
  const e = await erroCorrente($)
  if (e === null) throw new Error('harness-session-guard: a gravação falhou e não há erro corrente')
  return e.codigo
}

// D-J10 (C6): o uso do contexto da sessão, informativo; `$.session.usage()` recusado = indisponível com o motivo.
async function contextoC6($: EngineInterface): Promise<ResultadoC['contexto']> {
  const r = await tentar($.session.usage())
  if (!r.ok) return r
  const c = r.valor.context
  return { ok: true, valor: { tokens: c.tokens ?? null, window: c.window, percent: c.percent ?? null } }
}

// D-J10 (U1): escreve a sugestão no campo do prompt e nunca envia.
async function sugerir($: EngineInterface, a: Achado): Promise<void> {
  if (a.sugestao === undefined) return
  const r = await $.prompt.fill({ text: a.sugestao, mode: 'replace' })
  await avisar($, r.isFilled ? undefined : `o prompt não foi preenchido (${r.refusal ?? 'recusado'})`)
}

// D-J10 (U2): grava o voto do dev; só marca o achado na tela se gravou.
async function votar($: EngineInterface, a: Achado, voto: Voto): Promise<void> {
  const t = await $.clock.now()
  if (!(await gravarFeedback($, { dim: a.dim, h: a.h, voto, t }, t))) {
    await avisar($, `voto não gravado: ${await codigoDoErro($)}`)
    return
  }
  await update($, resultadoC, r => {
    if (r === null || r.juiz === null) return r
    const achados = r.juiz.achados.map(x => (x.dim === a.dim && x.h === a.h ? { ...x, voto } : x))
    return { ...semAviso(r), juiz: { ...r.juiz, achados } }
  })
}

async function avisar($: EngineInterface, aviso: string | undefined): Promise<void> {
  await update($, resultadoC, r => (r === null ? r : aviso === undefined ? semAviso(r) : { ...r, aviso }))
}

// O atom não guarda `undefined`: sem aviso, a chave não existe.
function semAviso(r: ResultadoC): ResultadoC {
  const { aviso: _descartado, ...resto } = r
  return resto
}

// D-C2: o único comando externo do mod; um `git` que falha, ausente ou ilegível vira "indisponível", nunca zero.
async function commitsDaJanela($: EngineInterface, janela: Janela): Promise<Dado<Commit[]>> {
  const r = await tentar($.process.run(argvGitLog(janela)))
  if (!r.ok) return { ok: false, motivo: `git: ${r.motivo}` }
  if (r.valor.exitCode !== 0) return { ok: false, motivo: `git: ${r.valor.exitCode}` }
  if (r.valor.isStdoutTruncated) return { ok: false, motivo: 'git: saída truncada' }
  return parsearGitLog(r.valor.stdout, janela)
}

// Uma chamada recusada vira o motivo (Dado), sem `catch`.
function tentar<V>(p: Promise<V>): Promise<Dado<V>> {
  return p.then(
    valor => ({ ok: true as const, valor }),
    (r: unknown) => ({ ok: false as const, motivo: r instanceof Error ? r.message : String(r) }),
  )
}

// Status do erro de versão/configuração; refeito depois de apagar-dados, que limpa o status.
function mostrarErroDeConfig($: EngineInterface): void {
  $.ui.status(erro === null ? undefined : `harness-session-guard: ${erro} · /hsg`)
}

async function inicioDeTurno($: EngineInterface): Promise<void> {
  if (config === null) return
  const t = await $.clock.now()
  await aplicar($, t, (s, c) => iniciarTurno(s, t, c))
}

async function fimDeTurno($: EngineInterface): Promise<void> {
  if (config === null) return
  const t = await $.clock.now()
  await aplicar($, t, (s, c) => renovar(s, t, c))
}

// D-T3/D-T4: fecha a sessão e zera o turno aberto; `aplicar` grava o registro com `fim = turnoAberto ? t : ultimaID`.
async function encerrar($: EngineInterface): Promise<void> {
  if (config === null) return
  await aplicar($, await $.clock.now(), () => null)
}

// Depois de um reload: fecha a sessão viva se a atenção já expirou; senão rearma o timer.
async function retomar($: EngineInterface): Promise<void> {
  const c = config
  if (c === null) return
  const s = await read($, atencao)
  const t = await $.clock.now()
  if (s !== null && expirou(s, t, c)) await fecharSeExpirou($)
  else armarFechamento($, s, t, c)
}

async function fecharSeExpirou($: EngineInterface): Promise<void> {
  const t = await $.clock.now()
  await aplicar($, t, (s, c) => (s !== null && expirou(s, t, c) ? null : s))
}

// Ponto único de mudança da sessão viva; a sessão que fecha (ou é trocada) é gravada aqui (D-T4, `registroEm`).
async function aplicar(
  $: EngineInterface,
  t: number,
  f: (s: Sessao | null, c: ConfigResolvida) => Sessao | null,
): Promise<Sessao | null> {
  const c = config
  if (c === null) return null
  // `antes` é escrito dentro do callback do `update`; o `as` impede o TS de estreitá-lo para `null`.
  let antes = null as Sessao | null
  const atual = await update($, atencao, s => {
    antes = s
    return f(s, c)
  })
  armarFechamento($, atual, t, c)
  const fechada = antes
  if (fechada !== null && (atual === null || atual.id !== fechada.id)) {
    await gravarRegistro($, registroEm(fechada, t), t)
  }
  return atual
}

// D-T4: fecha a sessão em `ultimaID + fimAtencao`; rearmado a cada mudança e em session.start.
// Com turno aberto não há prazo: o `turn.complete` (ou o session.end) rearma ou fecha.
function armarFechamento($: EngineInterface, s: Sessao | null, agora: number, c: ConfigResolvida): void {
  timer?.cancel()
  timer = null
  if (s === null || s.turnoAberto !== null) return
  timer = $.clock.after(Math.max(0, s.ultimaID + c.fimAtencaoSeg * 1000 - agora), () => {
    void fecharSeExpirou($)
  })
}

// D-T7: tick de 1 min, cancelado e rearmado em session.start.
function armarTick($: EngineInterface): void {
  tick?.cancel()
  tick = $.clock.every(TICK_MS, () => {
    void aoTick($)
  })
}

// D-T7: (a) atualiza `pulso` para redesenhar o relógio; (b) com sessão viva, grava o registro vivo. Sem sessão, não escreve.
async function aoTick($: EngineInterface): Promise<void> {
  if (config === null) return
  const t = await $.clock.now()
  await update($, pulso, () => t)
  const s = await read($, atencao)
  if (s !== null) await gravarRegistro($, registroEm(s, t), t)
  const o = await read($, objetivo)
  if (o !== null) await verificarTimebox($, o, t)
}

// D-T7(c): grava `timebox` uma única vez, quando o tempo ativo do objetivo (união dos registros do livro, já
// atualizado pelo registro vivo do tick) chega ao timebox.
async function verificarTimebox($: EngineInterface, o: Objetivo, t: number): Promise<void> {
  if (o.timeboxMin === null) return
  const livro = await lerLivro($)
  if (livro === null) return
  if (tempoAtivoSeg(intervalosDe(livro.sessoes, null, t), o.abertoEm, t) < o.timeboxMin * 60) return
  const objetivos = await lerObjetivos($)
  if (objetivos === null || temTimebox(objetivos.eventos, o.id)) return
  await gravarEventosObjetivo($, [{ t, tipo: 'timebox', objetivoId: o.id, timeboxMin: o.timeboxMin }], t)
}
