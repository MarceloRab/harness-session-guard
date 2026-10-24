import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Objetivo, Sessao } from '../types'
import { aplicarID, expirou, intervalosDe, iniciarTurno, medir, registroEm, renovar } from './atencao'
import { resolverConfig, versaoAtende, type ConfigResolvida } from './config'
import {
  apagarDados,
  CHAVES_APAGAR,
  chavesAntigas,
  erroCorrente,
  espiarLivro,
  gravarEventosObjetivo,
  gravarRegistro,
  iniciarLivro,
  lerLivro,
  lerObjetivos,
  registrarErro,
  verificarDados,
  type Livro,
} from './livro'
import { aplicarTransicao, temTimebox, tempoAtivoSeg, type Mutacao } from './objetivo'
import {
  AVISO_OBJETIVO,
  faixa,
  interpretar,
  modeloDetalhes,
  painel,
  TEXTO_APAGAR,
  textoDetalhes,
  textoObjetivo,
  TITULO,
  USO,
  type Acao,
  type EntradaDetalhes,
} from './ui'

const VERSAO_MINIMA = [2, 1, 310] as const
const ORIGENS_SUBMIT = ['composer', 'bridge']
const PANE = 'hsg-detalhes'
const COMANDO = 'hsg'
const TICK_MS = 60_000

// Sessão de atenção viva; o shape recusa o que uma versão anterior do código guardou.
const atencao = atom({ plugin: 'harness-session-guard', key: 'atencao' } as const, null, { shape: 'atencao-2' })
// D-T7: instante do último tick; a faixa e o painel o leem para redesenhar o relógio.
const pulso = atom({ plugin: 'harness-session-guard', key: 'pulso' } as const, 0, { shape: 'pulso-1' })
// D-O1: o objetivo aberto, com texto e DoD; só aqui e nunca no armazenamento persistente.
const objetivo = atom({ plugin: 'harness-session-guard', key: 'objetivo' } as const, null, { shape: 'objetivo-1' })

// Estado do módulo: recomeça a cada reload e é refeito em session.start.
// `config` null = o mod não mede (versão ou configuração com erro, em `erro`; código curto em `erroCodigo`).
let config: ConfigResolvida | null = null
let erro: string | null = null
let erroCodigo: string | null = null
let timer: Timer | null = null
let tick: Timer | null = null

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
      argumentHint: '[objetivo [abrir|trocar|dod|fechar] ... | apagar-dados [confirmar]]',
    })
    await retomar($)
    armarTick($)

    return next(e)
  })

  // D-T2: a interação do dev conta como ID; quem abre o turno do agente é o `turn.start`.
  on('prompt.submit', async ($, e, next) => {
    if (ORIGENS_SUBMIT.includes(e.origin.kind) && e.isMeta !== true) await registrarID($)
    return next(e)
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
    if (erroFaixa !== null) return faixa($.ui.resolve(e), { tipo: 'erro', erro: erroFaixa }, abrir)
    // Sem erro e sem configuração só antes de session.start: a faixa passa a vez.
    if (!livro.ok || config === null) return next(e)
    const medida = medir(await read($, atencao), livro.valor.sessoes, await $.clock.now(), config)
    return faixa($.ui.resolve(e), { tipo: 'medida', medida }, abrir)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await read($, pulso) // só assina: o tick de 1 min redesenha o painel
    return painel($.ui.resolve(e), modeloDetalhes(await entradaDetalhes($, true)))
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
