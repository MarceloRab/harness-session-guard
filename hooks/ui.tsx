// Emissão (mod-v2 D-T10): um modelo de detalhes puro e as árvores/textos que saem dele.
import type { EngineInterface } from 'claude-code'

import type { Objetivo, Sessao } from '../types'
import { formatarRelogio, intervalosDe, medir, sessaoSeg, type Cor, type Medida } from './atencao'
import type { ConfigResolvida } from './config'
import { CHAVES_APAGAR, type Livro } from './livro'
import { parsearObjetivo, tempoAtivoSeg, type ComandoObjetivo } from './objetivo'

export const TITULO = 'harness-session-guard'

export type Acao = 'detalhes' | 'apagar-dados' | 'apagar-confirmar' | 'uso' | { objetivo: ComandoObjetivo }

export type Linha = { texto: string; fraco: boolean }

export type EntradaDetalhes = {
  sessao: Sessao | null
  objetivo: Objetivo | null
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
  '  /hsg objetivo                mostra o objetivo e o DoD abertos',
  '  /hsg objetivo abrir [timebox=<min>] <texto>   abre um objetivo',
  '  /hsg objetivo trocar [timebox=<min>] <texto>  fecha o atual como troca e abre outro',
  '  /hsg objetivo dod <texto>    define o DoD do objetivo aberto',
  '  /hsg objetivo fechar         fecha o objetivo (conta como avanço)',
  '  /hsg apagar-dados            explica o que é apagado',
  '  /hsg apagar-dados confirmar  apaga os dados do harness-session-guard',
].join('\n')

// D-O6: o atom `objetivo` é derivado dos dados apagados e também é zerado.
export const AVISO_OBJETIVO = 'encerra o objetivo aberto; reabra com /hsg objetivo abrir'

export const TEXTO_APAGAR = [
  'apagar-dados remove do armazenamento do harness-session-guard as chaves:',
  `  ${CHAVES_APAGAR.join(', ')}.`,
  `Também ${AVISO_OBJETIVO}.`,
  'A sessão de atenção aberta continua sendo medida.',
  'Para apagar: /hsg apagar-dados confirmar',
].join('\n')

// Argumentos exatos; qualquer outro texto é `uso`, sem ação.
export function interpretar(args: string): Acao {
  const objetivo = /^objetivo(?:\s+([\s\S]*))?$/.exec(args.trim())
  if (objetivo !== null) {
    const c = parsearObjetivo(objetivo[1] ?? '')
    return c === null ? 'uso' : { objetivo: c }
  }
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
  if (x.erro !== null) {
    l(`Erro: ${x.erro} · ${x.erro.startsWith('dados-incompativeis:') ? '/hsg apagar-dados confirmar' : '/hsg'}`)
  }
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
  if (x.objetivo !== null) l(linhaObjetivo(x.objetivo, x.livro, x.sessao, x.agora))
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

// `/hsg objetivo`: o único lugar, além do atom, onde o texto e o DoD aparecem.
export function textoObjetivo(o: Objetivo | null): string {
  if (o === null) return 'Nenhum objetivo aberto.'
  return [
    `Objetivo: ${o.texto}`,
    `DoD: ${o.dod ?? 'não definido (/hsg objetivo dod <texto>)'}`,
    `Aberto às ${hora(o.abertoEm)} · ${o.timeboxMin === null ? 'sem timebox' : `timebox ${o.timeboxMin} min`}`,
  ].join('\n')
}

export function textoDetalhes(linhas: readonly Linha[]): string {
  return linhas.map(x => x.texto).join('\n')
}

export function hora(t: number): string {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Painel e `/hsg`: sem o texto do objetivo, só o id curto e o tempo ativo (pelo menos: o livro é o piso).
function linhaObjetivo(o: Objetivo, livro: Livro | null, viva: Sessao | null, agora: number): string {
  const ativo =
    livro === null
      ? 'indisponível (dados incompatíveis)'
      : `pelo menos ${formatarRelogio(tempoAtivoSeg(intervalosDe(livro.sessoes, viva, agora), o.abertoEm, agora))}`
  const timebox = o.timeboxMin === null ? '' : ` · timebox ${o.timeboxMin} min`
  return `Objetivo aberto às ${hora(o.abertoEm)} (id ${o.id.slice(0, 8)}) · tempo ativo: ${ativo}${timebox}`
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
