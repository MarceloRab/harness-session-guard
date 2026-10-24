// Emissão (mod-v2 D-T10): um modelo de detalhes puro e as árvores/textos que saem dele.
import type { EngineInterface } from 'claude-code'

import type { Sessao } from '../types'
import { formatarRelogio, medir, sessaoSeg, type Cor, type Medida } from './atencao'
import type { ConfigResolvida } from './config'
import { CHAVES_APAGAR, type Livro } from './livro'

export const TITULO = 'harness-session-guard'

export type Acao = 'detalhes' | 'apagar-dados' | 'apagar-confirmar' | 'uso'

export type Linha = { texto: string; fraco: boolean }

export type EntradaDetalhes = {
  sessao: Sessao | null
  livro: Livro | null
  antigas: readonly string[]
  erro: string | null
  config: ConfigResolvida | null
  agora: number
}

export type Faixa = { tipo: 'erro'; erro: string } | { tipo: 'medida'; medida: Medida }

type El = ReturnType<EngineInterface['ui']['resolve']>

const COR: Record<Exclude<Cor, 'neutra'>, string> = { laranja: '#ff8700', vermelha: 'error' }

export const USO = [
  'Uso:',
  '  /hsg                         detalhes da sessão de atenção',
  '  /hsg apagar-dados            explica o que é apagado',
  '  /hsg apagar-dados confirmar  apaga os dados do harness-session-guard',
].join('\n')

export const TEXTO_APAGAR = [
  'apagar-dados remove do armazenamento do harness-session-guard as chaves:',
  `  ${CHAVES_APAGAR.join(', ')}.`,
  'A sessão de atenção aberta continua sendo medida.',
  'Para apagar: /hsg apagar-dados confirmar',
].join('\n')

// Argumentos exatos; qualquer outro texto é `uso`, sem ação.
export function interpretar(args: string): Acao {
  switch (args.trim().split(/\s+/).join(' ')) {
    case '':
      return 'detalhes'
    case 'apagar-dados':
      return 'apagar-dados'
    case 'apagar-dados confirmar':
      return 'apagar-confirmar'
    default:
      return 'uso'
  }
}

// D-T10: o único modelo dos detalhes; o painel e o `/hsg` desenham estas linhas.
export function modeloDetalhes(x: EntradaDetalhes): Linha[] {
  const linhas: Linha[] = []
  const l = (texto: string, fraco = false) => linhas.push({ texto, fraco })
  if (x.erro !== null) l(`Erro: ${x.erro} · /hsg`)
  if (x.antigas.length > 0) l(`Dados antigos sem uso: ${x.antigas.join(', ')} · /hsg apagar-dados`, true)
  const c = x.config
  if (c === null) return linhas

  if (x.sessao === null) l('Sessão de atenção: nenhuma sessão de atenção aberta')
  else {
    l(`Sessão de atenção: pelo menos ${formatarRelogio(sessaoSeg(x.sessao, x.agora))}`)
    if (x.sessao.turnoAberto !== null) l(`Turno aberto desde ${hora(x.sessao.turnoAberto)}`)
  }
  l(
    x.livro === null
      ? 'Total do dia: indisponível (dados incompatíveis · /hsg apagar-dados confirmar)'
      : `Total do dia: pelo menos ${formatarRelogio(medir(x.sessao, x.livro.sessoes, x.agora, c).diaSeg)}`,
  )
  l(
    `Ao fechar, a sessão termina na última interação: o relógio pode recuar até ${c.fimAtencaoSeg / 60} min.`,
    true,
  )
  l(
    'Cada janela do Claude Code mede a própria sessão; o total do dia une todas (a sessão viva de outra janela entra só pelo último registro gravado).',
    true,
  )
  return linhas
}

export function textoDetalhes(linhas: readonly Linha[]): string {
  return linhas.map(x => x.texto).join('\n')
}

export function hora(t: number): string {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ---------- Árvores ----------

// A bolinha `●` + `T` + relógio como Button `hsg-t`, na cor de D-T1.
export function faixa(el: El, f: Faixa, abrir: () => Promise<void>) {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="column">
      <Button key="hsg-t" onPress={abrir}>
        {f.tipo === 'erro' ? (
          <Text color="error">T! {f.erro} · /hsg</Text>
        ) : f.medida.cor === 'neutra' ? (
          <Text dimColor>
            ● T {formatarRelogio(f.medida.sessaoSeg)} · {formatarRelogio(f.medida.diaSeg)}
          </Text>
        ) : (
          <Text color={COR[f.medida.cor]}>
            ● T {formatarRelogio(f.medida.sessaoSeg)} · {formatarRelogio(f.medida.diaSeg)}
          </Text>
        )}
      </Button>
    </Box>
  )
}

// O painel `hsg-detalhes` com as linhas do modelo.
export function painel(el: El, linhas: readonly Linha[]) {
  const { Box, Text } = el
  return (
    <Box flexDirection="column">
      {linhas.map(x => (
        <Text dimColor={x.fraco}>{x.texto}</Text>
      ))}
    </Box>
  )
}
