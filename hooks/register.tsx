import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Sessao } from '../types'
import { aplicarID, expirou, medir, registroFechado, registroVivo, renovar } from './atencao'
import { resolverConfig, versaoAtende, type ConfigResolvida } from './config'
import {
  apagarDados,
  CHAVES_APAGAR,
  chavesAntigas,
  erroCorrente,
  espiarLivro,
  gravarRegistro,
  iniciarLivro,
  lerLivro,
  registrarErro,
  verificarDados,
  type Livro,
} from './livro'
import {
  faixa,
  interpretar,
  modeloDetalhes,
  painel,
  TEXTO_APAGAR,
  textoDetalhes,
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
      description: 'harness-session-guard: detalhes da sessão de atenção e dados',
      argumentHint: '[apagar-dados [confirmar]]',
    })
    await retomar($)
    armarTick($)

    return next(e)
  })

  // D-T2/D-T3: a interação do dev que abre o turno do agente. Um `/hsg` conta pelo `command.run` e não abre turno.
  on('prompt.submit', async ($, e, next) => {
    if (ORIGENS_SUBMIT.includes(e.origin.kind) && e.isMeta !== true && e.command?.name !== COMANDO) {
      await registrarID($, true)
    }
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

// D-T2/D-T3: uma interação do dev; `abrirTurno` marca o turno do agente.
export async function registrarID($: EngineInterface, abrirTurno = false): Promise<void> {
  if (config === null) return
  const t = await $.clock.now()
  const sessionId = await $.session.id()
  await aplicar($, t, (s, c) => aplicarID(s, t, sessionId, c, abrirTurno))
}

// Clique da bolinha: abre o painel e conta como ID.
async function abrirDetalhes($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: TITULO })
  await registrarID($)
}

// Fluxo: ação em livro.ts → registro de ID. Devolve o texto do `/hsg`.
async function executar($: EngineInterface, a: Acao): Promise<string> {
  let texto: string
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
      mostrarErroDeConfig($)
      texto = `Dados apagados: ${CHAVES_APAGAR.join(', ')}.`
      break
  }
  await registrarID($)
  return texto
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

async function fimDeTurno($: EngineInterface): Promise<void> {
  if (config === null) return
  const t = await $.clock.now()
  await aplicar($, t, (s, c) => renovar(s, t, c))
}

async function encerrar($: EngineInterface): Promise<void> {
  if (config === null) return
  const t = await $.clock.now()
  // D-008: o session.end com turno aberto conta como o fim do turno; renova `ultimaID` para o registro fechar em `t`.
  await aplicar($, t, (s, c) => (s !== null && s.turnoAberto !== null ? renovar(s, t, c) : s))
  await aplicar($, t, () => null)
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

// Ponto único de mudança da sessão viva; a sessão que fecha (ou é trocada) é gravada aqui com `fim = ultimaID`.
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
    await gravarRegistro($, registroFechado(fechada), t)
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
  if (s !== null) await gravarRegistro($, registroVivo(s, t), t)
}
