import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Sessao } from '../types'
import { aplicarAA, aplicarID, expirou, paraRegistro } from './atencao'
import { resolverConfig, versaoAtende, type ConfigResolvida } from './config'
import { gravacaoVencida, gravarRegistro, iniciarLivro, registrarErro } from './livro'

const VERSAO_MINIMA = [2, 1, 310] as const
const ORIGENS_CHANGE = ['history', 'undo', 'engine']
const ORIGENS_SUBMIT = ['composer', 'bridge']

// Sessão de atenção viva; o shape recusa o que uma versão anterior do código guardou.
const atencao = atom({ plugin: 'harness-session-guard', key: 'atencao' } as const, null, { shape: 'atencao-1' })

// Estado do módulo: recomeça a cada reload e é refeito em session.start.
// `config` null = o mod não mede (versão ou configuração com erro, em `erro`).
let config: ConfigResolvida | null = null
let erro: string | null = null
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
    } else if (!resultado.ok) {
      await registrarErro($, `config:${resultado.campo}`, await $.clock.now())
      erro = `configuração inválida: ${resultado.campo}`
    } else {
      erro = null
      config = resultado.config
    }
    $.ui.status(erro === null ? undefined : `harness-session-guard: ${erro} · /hsg`)
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
}

// D16: grava a sessão viva se `gravar` ou se passaram 60 s desde a última gravação.
export async function registrarID($: EngineInterface, gravar = false): Promise<void> {
  if (config === null) return
  const t = await $.clock.now()
  const sessionId = await $.session.id()
  const atual = await aplicar($, t, (s, c) => aplicarID(s, t, sessionId, c).atual)
  if (atual !== null && (gravar || gravacaoVencida(t))) await gravarRegistro($, paraRegistro(atual), t)
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
  if (fechada !== null && (atual === null || atual.id !== fechada.id)) await gravarRegistro($, paraRegistro(fechada), t)
  return atual
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
