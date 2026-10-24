import type { PluginOptions } from 'claude-code'

export type ConfigResolvida = {
  limiteSessaoSeg: number
  limiteDiaSeg: number
  fimAtencaoSeg: number
}

export type CampoConfig = 'limiteSessaoMin' | 'limiteDiaMin' | 'fimAtencaoMin'
export type ResultadoConfig = { ok: true; config: ConfigResolvida } | { ok: false; campo: CampoConfig }

// D-T9: os padrões vivem no plugin.json; aqui só se valida. Chaves antigas das opções são ignoradas.
export function resolverConfig(options: PluginOptions): ResultadoConfig {
  const { limiteSessaoMin, limiteDiaMin, fimAtencaoMin } = options

  if (!inteiroMin1(limiteSessaoMin)) return { ok: false, campo: 'limiteSessaoMin' }
  if (!inteiroMin1(limiteDiaMin) || limiteDiaMin <= limiteSessaoMin) return { ok: false, campo: 'limiteDiaMin' }
  if (!inteiroMin1(fimAtencaoMin)) return { ok: false, campo: 'fimAtencaoMin' }

  return {
    ok: true,
    config: {
      limiteSessaoSeg: limiteSessaoMin * 60,
      limiteDiaSeg: limiteDiaMin * 60,
      fimAtencaoSeg: fimAtencaoMin * 60,
    },
  }
}

// Verdadeiro se `base` (ex.: "2.1.310" ou "2.1.310-dev") é pelo menos `minimo`; falso se não for uma release.
export function versaoAtende(base: string | undefined, minimo: readonly number[]): boolean {
  const m = base === undefined ? null : /^(\d+)\.(\d+)\.(\d+)(?:-|$)/.exec(base)
  if (m === null) return false
  const partes = [Number(m[1]), Number(m[2]), Number(m[3])]
  for (let i = 0; i < minimo.length; i++) {
    const a = partes[i] as number
    const b = minimo[i] as number
    if (a !== b) return a > b
  }
  return true
}

function inteiroMin1(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1
}
