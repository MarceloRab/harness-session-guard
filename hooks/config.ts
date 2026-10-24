import type { PluginOptions } from 'claude-code'

export type Dias = 'seg-sex' | 'seg-sab' | 'todos'
export type Intensidade = 'discreto' | 'padrao' | 'rigido'

export type ConfigResolvida = {
  inicio: number
  fim: number
  dias: Dias
  semPausaSeg: number
  longaSeg: number
  fimAtencaoSeg: number
  pausaMinSeg: number
}

export type ResultadoConfig = { ok: true; config: ConfigResolvida } | { ok: false; campo: string }

// Perfis provisórios (D7): limites de "sem pausa" e "longa", em segundos.
const PERFIS: Record<Intensidade, { semPausaSeg: number; longaSeg: number }> = {
  discreto: { semPausaSeg: 10800, longaSeg: 16200 },
  padrao: { semPausaSeg: 7200, longaSeg: 10800 },
  rigido: { semPausaSeg: 5400, longaSeg: 8100 },
}

const DIAS: readonly Dias[] = ['seg-sex', 'seg-sab', 'todos']
const INTENSIDADES: readonly Intensidade[] = ['discreto', 'padrao', 'rigido']

export function resolverConfig(options: PluginOptions): ResultadoConfig {
  const { inicio, fim, dias, intensidade, fimAtencaoMin, pausaMinMin } = options

  if (!inteiroEntre(inicio, 0, 23)) return { ok: false, campo: 'inicio' }
  if (!inteiroEntre(fim, 1, 24)) return { ok: false, campo: 'fim' }
  if (inicio >= fim) return { ok: false, campo: 'fim' }
  if (!DIAS.includes(dias as Dias)) return { ok: false, campo: 'dias' }
  if (!INTENSIDADES.includes(intensidade as Intensidade)) return { ok: false, campo: 'intensidade' }
  if (!inteiroEntre(fimAtencaoMin, 1, Number.MAX_SAFE_INTEGER)) return { ok: false, campo: 'fimAtencaoMin' }
  if (!inteiroEntre(pausaMinMin, 1, Number.MAX_SAFE_INTEGER)) return { ok: false, campo: 'pausaMinMin' }
  if (pausaMinMin >= fimAtencaoMin) return { ok: false, campo: 'pausaMinMin' }

  return {
    ok: true,
    config: {
      inicio,
      fim,
      dias: dias as Dias,
      ...PERFIS[intensidade as Intensidade],
      fimAtencaoSeg: fimAtencaoMin * 60,
      pausaMinSeg: pausaMinMin * 60,
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

function inteiroEntre(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
}
