import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Sessao } from '../types'
import { aplicarAA, aplicarID, expirou } from './atencao'
import { resolverConfig, versaoAtende, type ConfigResolvida } from './config'

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
    const { base } = await $.session.version()
    config = null
    if (!versaoAtende(base, VERSAO_MINIMA)) {
      erro = `versao: requer Claude Code ${VERSAO_MINIMA.join('.')} ou superior (atual: ${base ?? 'desconhecida'})`
    } else if (!resultado.ok) {
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

  on('prompt.submit', async ($, e, next) => {
    if (ORIGENS_SUBMIT.includes(e.origin.kind)) await registrarID($)
    return next(e)
  })

  // D3: atividade do agente, só no laço principal.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) await registrarAA($)
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await registrarAA($)
    return next(e)
  })
}

export async function registrarID($: EngineInterface): Promise<void> {
  if (config === null) return
  const t = await $.clock.now()
  const sessionId = await $.session.id()
  await aplicar($, t, (s, c) => aplicarID(s, t, sessionId, c).atual)
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

// Ponto único de mudança da sessão viva (a gravação da track 03 entra aqui).
async function aplicar(
  $: EngineInterface,
  t: number,
  f: (s: Sessao | null, c: ConfigResolvida) => Sessao | null,
): Promise<void> {
  const c = config
  if (c === null) return
  const atual = await update($, atencao, s => f(s, c))
  armarFechamento($, atual, t, c)
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
