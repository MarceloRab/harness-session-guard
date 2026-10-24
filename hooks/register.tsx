import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Nivel, Sessao } from '../types'
import { aplicarAA, aplicarID, expirou, ORDEM, paraRegistro } from './atencao'
import { resolverConfig, versaoAtende, type ConfigResolvida } from './config'
import {
  apagarDados,
  erroCorrente,
  gravacaoVencida,
  gravarRegistro,
  iniciarLivro,
  lerExplicado,
  lerLivro,
  lerSilencio,
  marcarExplicado,
  reativar,
  registrarErro,
  registrarEvento,
  silenciado,
  silenciar,
} from './livro'
import {
  estadoFaixa,
  faixa,
  hora,
  interpretar,
  modeloDetalhes,
  painel,
  TEXTO_APAGAR,
  textoDetalhes,
  TITULO,
  USO,
  type Acao,
} from './ui'

const VERSAO_MINIMA = [2, 1, 310] as const
const ORIGENS_CHANGE = ['history', 'undo', 'engine']
const ORIGENS_SUBMIT = ['composer', 'bridge']
const PANE = 'hsg-detalhes'

// Sessão de atenção viva; o shape recusa o que uma versão anterior do código guardou.
const atencao = atom({ plugin: 'harness-session-guard', key: 'atencao' } as const, null, { shape: 'atencao-1' })
// U4 (D18): linha de explicação visível até abrir os detalhes ou fechar a sessão.
const explicar = atom({ plugin: 'harness-session-guard', key: 'explicar' } as const, false, { shape: 'explicar-1' })

// Estado do módulo: recomeça a cada reload e é refeito em session.start.
// `config` null = o mod não mede (versão ou configuração com erro, em `erro`; código curto em `erroCodigo`).
let config: ConfigResolvida | null = null
let erro: string | null = null
let erroCodigo: string | null = null
let timer: Timer | null = null

export const register: Register = (on, options) => {
  const resultado = resolverConfig(options)

  on('session.start', async ($, e, next) => {
    await iniciarLivro($)
    const { base } = await $.session.version()
    config = null
    if (!versaoAtende(base, VERSAO_MINIMA)) {
      await registrarErro($, 'versao', await $.clock.now())
      erro = `versao: requer Claude Code ${VERSAO_MINIMA.join('.')} ou superior (atual: ${base ?? 'desconhecida'})`
      erroCodigo = 'versao'
    } else if (!resultado.ok) {
      await registrarErro($, `config:${resultado.campo}`, await $.clock.now())
      erro = `configuração inválida: ${resultado.campo}`
      erroCodigo = `config:${resultado.campo}`
    } else {
      erro = null
      erroCodigo = null
      config = resultado.config
    }
    mostrarErroDeConfig($)
    await $.command.register({
      name: 'hsg',
      description: 'harness-session-guard: detalhes da sessão de atenção, silêncio e dados',
      argumentHint: '[silenciar 1h | silenciar amanha | reativar | apagar-dados [confirmar]]',
    })
    await retomar($)

    return next(e)
  })

  // D2: interações do dev.
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    await registrarID($)
    return box
  })

  on('prompt.change', async ($, e, next) => {
    if (ORIGENS_CHANGE.includes(e.origin.kind)) await registrarID($)
    return next(e)
  })

  // D16: prompt.submit, turn.complete principal e session.end gravam a sessão viva.
  on('prompt.submit', async ($, e, next) => {
    if (ORIGENS_SUBMIT.includes(e.origin.kind)) await registrarID($, true)
    else await gravarAtual($)
    return next(e)
  })

  // D3: atividade do agente, só no laço principal.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) await registrarAA($)
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await registrarAA($)
      await gravarAtual($)
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await gravarAtual($)
    return next(e)
  })

  // D11: a bolinha T na faixa (terminal e desktop); com pesquisa na faixa, passa a vez.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const silencio = await lerSilencio($)
    const f = estadoFaixa(
      await read($, atencao),
      silencio,
      erroCodigo ?? (await erroCorrente($))?.codigo ?? null,
      await $.clock.now(),
      await read($, explicar),
    )
    return faixa($.ui.resolve(e), f, () => abrirDetalhes($))
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const linhas = modeloDetalhes(await entradaDetalhes($))
    return painel($.ui.resolve(e), linhas, config !== null, async a => {
      await executar($, a)
    })
  })

  // D11: `/hsg` e argumentos; cada execução conta como ID.
  on('command.run', { command: 'hsg' }, async ($, e) => ({ text: await executar($, interpretar(e.args)) }))
}

// D16: grava a sessão viva se `gravar` ou se passaram 60 s desde a última gravação.
export async function registrarID($: EngineInterface, gravar = false): Promise<void> {
  if (config === null) return
  const t = await $.clock.now()
  const sessionId = await $.session.id()
  const atual = await aplicar($, t, (s, c) => aplicarID(s, t, sessionId, c).atual)
  if (atual !== null && (gravar || gravacaoVencida(t))) await gravarRegistro($, paraRegistro(atual), t)
}

// Press da bolinha: abre o painel, registra `detalhes` no diário, encerra U4 e conta como ID.
async function abrirDetalhes($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: TITULO })
  await registrarEvento($, { t: await $.clock.now(), tipo: 'detalhes' })
  await update($, explicar, () => false)
  await registrarID($)
}

// Fluxo: ação em livro.ts → registro de ID → update do atom. Devolve o texto do `/hsg`.
async function executar($: EngineInterface, a: Acao): Promise<string> {
  const agora = await $.clock.now()
  let texto: string
  switch (a) {
    case 'uso':
      texto = USO
      break
    case 'detalhes':
      await update($, explicar, () => false)
      texto = textoDetalhes(modeloDetalhes(await entradaDetalhes($)))
      break
    case 'silenciar-1h':
    case 'silenciar-amanha': {
      // Sem configuração não há `inicio`; `erro` diz por quê.
      const c = config
      if (c === null) {
        texto = `Indisponível: ${erro} · /hsg`
        break
      }
      const ate = await silenciar($, a === 'silenciar-1h' ? '1h' : 'amanha', agora, c.inicio)
      texto = ate === null ? await falhaDeDados($, 'silenciar') : `Silenciado até ${hora(ate)}.`
      break
    }
    case 'reativar':
      texto = (await reativar($, agora)) ? 'Silêncio encerrado.' : await falhaDeDados($, 'reativar')
      break
    case 'apagar-dados':
      texto = TEXTO_APAGAR
      break
    case 'apagar-confirmar':
      await apagarDados($)
      mostrarErroDeConfig($)
      texto = 'Dados apagados: livro, silencio, explicado e diario.'
      break
  }
  await registrarID($)
  return texto
}

// Uma gravação recusada sempre deixa o erro corrente (livro.ts `falhar`); sem ele, o invariante quebrou.
async function falhaDeDados($: EngineInterface, oQue: string): Promise<string> {
  const e = await erroCorrente($)
  if (e === null) throw new Error(`harness-session-guard: ${oQue} não gravou e não há erro corrente`)
  return `Não foi possível ${oQue}: ${e.codigo} · /hsg`
}

async function entradaDetalhes($: EngineInterface) {
  const e = await erroCorrente($)
  return {
    sessao: await read($, atencao),
    livro: await lerLivro($),
    silencio: await lerSilencio($),
    erro: erro ?? (e === null ? null : `${e.codigo}${e.detalhe === null ? '' : `: ${e.detalhe}`}`),
    config,
    agora: await $.clock.now(),
  }
}

// Status do erro de versão/configuração; refeito depois de apagar-dados, que limpa o status.
function mostrarErroDeConfig($: EngineInterface): void {
  $.ui.status(erro === null ? undefined : `harness-session-guard: ${erro} · /hsg`)
}

async function gravarAtual($: EngineInterface): Promise<void> {
  if (config === null) return
  const s = await read($, atencao)
  if (s !== null) await gravarRegistro($, paraRegistro(s), await $.clock.now())
}

async function registrarAA($: EngineInterface): Promise<void> {
  if (config === null) return
  const t = await $.clock.now()
  await aplicar($, t, (s, c) => aplicarAA(s, t, c))
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

// Ponto único de mudança da sessão viva; D16: a sessão que fecha (ou é trocada) é gravada aqui.
// MUST-15: a subida de `nivelMax` (que só sobe dentro da sessão) vai para o diário uma vez.
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
    await gravarRegistro($, paraRegistro(fechada), t)
    await update($, explicar, () => false)
  }
  const mesma = fechada !== null && atual !== null && fechada.id === atual.id ? fechada : null
  if (atual !== null && ORDEM[atual.nivelMax] > ORDEM[mesma?.nivelMax ?? 'neutro']) await subiuNivel($, atual.nivelMax, t)
  return atual
}

// D8/D18: em silêncio, a subida vai para o diário com `silenciado` e U4 não dispara.
// Silêncio ou `explicado` com dados incompatíveis (erro já exibido): registra a subida, sem U4.
async function subiuNivel($: EngineInterface, nivel: Nivel, t: number): Promise<void> {
  const s = await lerSilencio($)
  if (s !== null && silenciado(s, t)) {
    await registrarEvento($, { t, tipo: 'nivel', nivel, codigo: 'silenciado' })
    return
  }
  await registrarEvento($, { t, tipo: 'nivel', nivel })
  if (s === null) return
  const ex = await lerExplicado($)
  if (ex !== null && !ex.t) {
    await update($, explicar, () => true)
    await marcarExplicado($, t)
  }
}

// D4: fecha a sessão em `ultimaID + fimAtencao`; rearmado a cada mudança e em session.start.
function armarFechamento($: EngineInterface, s: Sessao | null, agora: number, c: ConfigResolvida): void {
  timer?.cancel()
  timer = null
  if (s === null) return
  timer = $.clock.after(Math.max(0, s.ultimaID + c.fimAtencaoSeg * 1000 - agora), () => {
    void fecharSeExpirou($)
  })
}
