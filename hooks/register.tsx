import type { Register } from 'claude-code'

import { resolverConfig, versaoAtende, type ConfigResolvida } from './config'

const VERSAO_MINIMA = [2, 1, 310] as const

export const register: Register = (on, options) => {
  const resultado = resolverConfig(options)
  // Configuração válida e versão suportada; null = o mod não mede (erro em `erro`).
  let config: ConfigResolvida | null = null
  let erro: string | null = null

  on('session.start', async ($, e, next) => {
    const { base } = await $.session.version()
    if (!versaoAtende(base, VERSAO_MINIMA)) {
      erro = `versao: requer Claude Code ${VERSAO_MINIMA.join('.')} ou superior (atual: ${base ?? 'desconhecida'})`
    } else if (!resultado.ok) {
      erro = `configuração inválida: ${resultado.campo}`
    } else {
      erro = null
      config = resultado.config
    }
    $.ui.status(erro === null ? undefined : `harness-session-guard: ${erro} · /hsg`)

    return next(e)
  })
}
