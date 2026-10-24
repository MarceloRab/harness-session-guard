// Emissão (design M2 D11–D13, D18): um modelo de detalhes puro e as árvores/textos que saem dele.
import type { EngineInterface } from 'claude-code'

import type { Nivel, Sessao } from '../types'
import { condicoes, duracaoSeg, formatarDuracao, tendencia } from './atencao'
import type { ConfigResolvida } from './config'
import { silenciado, type Livro, type Silencio } from './livro'

export const TITULO = 'harness-session-guard'

export type Acao = 'detalhes' | 'silenciar-1h' | 'silenciar-amanha' | 'reativar' | 'apagar-dados' | 'apagar-confirmar' | 'uso'

export type Linha = { texto: string; fraco: boolean }

export type EntradaDetalhes = {
  sessao: Sessao | null
  livro: Livro | null
  silencio: Silencio | null
  erro: string | null
  config: ConfigResolvida | null
  agora: number
}

export type Faixa =
  | { tipo: 'erro'; erro: string; explicar: boolean }
  | { tipo: 'silenciado'; ate: number; explicar: boolean }
  | { tipo: 'nivel'; nivel: Nivel; explicar: boolean }

type El = ReturnType<EngineInterface['ui']['resolve']>

const LINHA_U4 = 'T mede seu tempo com o agente; clique para detalhes e para silenciar'
const COR: Record<Exclude<Nivel, 'neutro'>, string> = { atencao: '#ff8700', alerta: 'error' }
const NOME_NIVEL: Record<Nivel, string> = { neutro: 'neutro', atencao: 'atenção', alerta: 'alerta' }

export const USO = [
  'Uso:',
  '  /hsg                         detalhes da sessão de atenção',
  '  /hsg silenciar 1h            silencia por 1 hora',
  '  /hsg silenciar amanha        silencia até amanhã, na hora de início do expediente',
  '  /hsg reativar                encerra o silêncio',
  '  /hsg apagar-dados            explica o que é apagado',
  '  /hsg apagar-dados confirmar  apaga os dados do harness-session-guard',
].join('\n')

export const TEXTO_APAGAR = [
  'apagar-dados remove do armazenamento do harness-session-guard as chaves:',
  '  livro (sessões dos últimos 30 dias), silencio, explicado e diario.',
  'A sessão de atenção aberta continua sendo medida.',
  'Para apagar: /hsg apagar-dados confirmar',
].join('\n')

// D11: argumentos exatos; qualquer outro texto é `uso`, sem ação.
export function interpretar(args: string): Acao {
  switch (args.trim().split(/\s+/).join(' ')) {
    case '':
      return 'detalhes'
    case 'silenciar 1h':
      return 'silenciar-1h'
    case 'silenciar amanha':
      return 'silenciar-amanha'
    case 'reativar':
      return 'reativar'
    case 'apagar-dados':
      return 'apagar-dados'
    case 'apagar-dados confirmar':
      return 'apagar-confirmar'
    default:
      return 'uso'
  }
}

// U3/D8/D11: erro > silêncio > nível da sessão (neutro sem sessão). A cor vem de `nivelMax`, que só sobe.
export function estadoFaixa(
  sessao: Sessao | null,
  silencio: Silencio | null,
  erro: string | null,
  agora: number,
  explicar: boolean,
): Faixa {
  if (erro !== null) return { tipo: 'erro', erro, explicar }
  if (silencio !== null && silencio.ate !== null && silenciado(silencio, agora)) {
    return { tipo: 'silenciado', ate: silencio.ate, explicar }
  }
  return { tipo: 'nivel', nivel: sessao === null ? 'neutro' : sessao.nivelMax, explicar }
}

// D12/D13: o único modelo dos detalhes; o painel e o `/hsg` desenham estas linhas.
export function modeloDetalhes(x: EntradaDetalhes): Linha[] {
  const linhas: Linha[] = []
  const l = (texto: string, fraco = false) => linhas.push({ texto, fraco })
  if (x.erro !== null) l(`Erro: ${x.erro} · /hsg`)
  const c = x.config
  if (c === null) return linhas

  if (x.sessao === null) l('Sessão de atenção: nenhuma sessão de atenção aberta')
  else {
    l(`Sessão de atenção: pelo menos ${formatarDuracao(duracaoSeg(x.sessao))}`)
    l(`Nível: ${NOME_NIVEL[x.sessao.nivelMax]} — motivo: ${motivo(x.sessao, c)}`)
  }
  l('Preciso realmente fazer este trabalho agora?')
  l(
    `O laudo usa 45 min entre commits; o mod usa ${c.fimAtencaoSeg / 60} min entre interações; os números não são comparáveis.`,
    true,
  )
  l(`Silêncio: ${textoSilencio(x.silencio, x.agora)}`)
  for (const t of linhasTendencia(x.livro, x.agora, c)) l(t)
  l('Fora do expediente é avaliado com o expediente vigente na hora da interação.', true)
  l('Cada janela do Claude Code mede a própria sessão; a tendência soma todas.', true)
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

// D11/U3/U4: a bolinha `●` + `T` como Button `hsg-t`; a linha U4 por baixo enquanto `explicar`.
export function faixa(el: El, f: Faixa, abrir: () => Promise<void>) {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="column">
      <Button key="hsg-t" onPress={abrir}>
        {f.tipo === 'erro' ? (
          <Text color="error">T! {f.erro} · /hsg</Text>
        ) : f.tipo === 'silenciado' ? (
          <Text dimColor>● T silenciado até {hora(f.ate)}</Text>
        ) : f.nivel === 'neutro' ? (
          <Text dimColor>● T</Text>
        ) : (
          <Text color={COR[f.nivel]}>● T</Text>
        )}
      </Button>
      {f.explicar && <Text dimColor>{LINHA_U4}</Text>}
    </Box>
  )
}

// D11: o painel `hsg-detalhes` com as linhas de D12 e os botões de silêncio (sem configuração válida, só o erro).
export function painel(
  el: El,
  linhas: readonly Linha[],
  comBotoes: boolean,
  acao: (a: 'silenciar-1h' | 'silenciar-amanha' | 'reativar') => Promise<void>,
) {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="column">
      {linhas.map(x => (
        <Text dimColor={x.fraco}>{x.texto}</Text>
      ))}
      {comBotoes && (
        <Box flexDirection="row" gap={2}>
          <Button key="hsg-silenciar-1h" label="Silenciar 1h" onPress={() => acao('silenciar-1h')} />
          <Button key="hsg-silenciar-amanha" label="Silenciar até amanhã" onPress={() => acao('silenciar-amanha')} />
          <Button key="hsg-reativar" label="Reativar" onPress={() => acao('reativar')} />
        </Box>
      )}
    </Box>
  )
}

// ---------- Auxiliares puros ----------

function motivo(s: Sessao, c: ConfigResolvida): string {
  const { semPausa, fora, longa } = condicoes(s, c)
  const m = [
    ...(longa ? [`sessão longa (≥ ${formatarDuracao(c.longaSeg)})`] : []),
    ...(semPausa ? [`sem pausa de ${c.pausaMinSeg / 60} min há ≥ ${formatarDuracao(c.semPausaSeg)}`] : []),
    ...(fora ? ['interação fora do expediente'] : []),
  ]
  return m.length === 0 ? 'nenhuma condição vale agora' : m.join('; ')
}

function textoSilencio(s: Silencio | null, agora: number): string {
  if (s === null) return 'indisponível (dados incompatíveis · /hsg apagar-dados)'
  if (s.ate !== null && silenciado(s, agora)) return `silenciado até ${hora(s.ate)}`
  return 'não silenciado'
}

function linhasTendencia(livro: Livro | null, agora: number, c: ConfigResolvida): string[] {
  if (livro === null) return ['Tendência de 30 dias: indisponível (dados incompatíveis · /hsg apagar-dados)']
  const t = tendencia(livro.sessoes, agora, c)
  if (t.semDados) return ['Tendência de 30 dias: sem dados nos últimos 30 dias']
  return [
    `Tendência de 30 dias: ${t.nivel}`,
    ...t.sinais.map(s => `  ${s.ativo ? '•' : '·'} ${s.nome}: ${s.valor} (limite ${s.limite})`),
  ]
}
