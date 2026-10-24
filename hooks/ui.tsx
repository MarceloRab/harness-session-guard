// Emissão (mod-v2 D-T10): um modelo de detalhes puro e as árvores/textos que saem dele.
import type { EngineInterface } from 'claude-code'

import type { Achado, Alvo, Dado, Dimensao, EntradaC, Fatos, Juiz, Objetivo, ResultadoC, Sessao, Voto } from '../types'
import { formatarRelogio, intervalosDe, medir, sessaoSeg, type Cor, type Medida } from './atencao'
import type { ConfigResolvida } from './config'
import { CHAVES_APAGAR, type Livro } from './livro'
import { parsearObjetivo, tempoAtivoSeg, type ComandoObjetivo } from './objetivo'
import { DIMENSOES } from './resultado'
import { ruim, sugestoes } from './sugestoes'

export type Acao = 'detalhes' | 'avaliar' | 'entrada' | 'apagar-dados' | 'apagar-confirmar' | 'uso' | { objetivo: ComandoObjetivo }

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
  '  /hsg avaliar                 avalia (camada 1 e juiz) e mostra no feed',
  '  /hsg entrada                 mostra no feed a entrada exata do juiz',
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
    case 'avaliar':
      return 'avaliar'
    case 'entrada':
      return 'entrada'
    case 'apagar-dados':
      return 'apagar-dados'
    case 'apagar-dados confirmar':
      return 'apagar-confirmar'
    default:
      return 'uso'
  }
}

// D-T10: o único modelo dos detalhes; o `/hsg` desenha estas linhas.
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
  const medida = x.livro === null ? null : medir(x.sessao, x.livro.sessoes, x.agora, c)
  l(
    medida === null
      ? 'Total do dia: indisponível (dados incompatíveis · /hsg apagar-dados confirmar)'
      : `Total do dia: pelo menos ${formatarRelogio(medida.diaSeg)}`,
  )
  if (medida !== null && medida.cor !== 'neutra') l('Veja a qualidade no tempo em C.')
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

// mod-v2-avaliar D-B3: um eixo por dimensão; `achado` = o não descartado (com votos), `citacao` já cortada.
export type Eixo = { dim: Dimensao; rotulo: string; cor: string; texto: string; citacao: string | null; achado: Achado | null }
// D-B4: `cor` null = "indisponível".
export type Laudo = { texto: string; cor: string | null }
// D-B1: as seções da linha do `/hsg avaliar` no feed.
export type ModeloAvaliacao = { topo: Linha[]; eixos: Eixo[]; laudo: Laudo | null; rodape: Linha[] }

const EIXO: Record<Dimensao, { rotulo: string; cor: string; resumo: Record<1 | 2, string> }> = {
  dod: {
    rotulo: 'DoD',
    cor: '#5f87d7',
    resumo: { 1: 'DoD cumprido em parte ou sem mostrar a entrega', 2: 'item do DoD não entregue ou declarado sem prova' },
  },
  suposicao: {
    rotulo: 'Suposição',
    cor: '#af5faf',
    resumo: { 1: 'suposição plausível seguida sem avisar', 2: 'suposição que muda o resultado ou contraria o dev' },
  },
  tangente: {
    rotulo: 'Tangente',
    cor: '#af8700',
    resumo: { 1: 'proposta fora do DoD', 2: 'mudança fora do DoD executada' },
  },
  semLastro: {
    rotulo: 'Sem lastro',
    cor: '#008787',
    resumo: { 1: 'afirmação com apoio só indireto', 2: 'afirmação sem nenhuma evidência na conversa' },
  },
}

// D-C-UI/D-B1: o único modelo da linha do `/hsg avaliar` no feed (o hook só chama com a entrada da memória).
// Fonte que falhou aparece como "<nome> indisponível (motivo)" na posição do fato; as demais continuam.
export function modeloAvaliacao(r: ResultadoC | null, entrada: EntradaC): ModeloAvaliacao {
  if (r === null) {
    return { topo: [{ texto: 'Nenhuma avaliação ainda: clique em C ou use /hsg avaliar.', fraco: false }], eixos: [], laudo: null, rodape: [] }
  }
  const j = juizVisivel(r, entrada)
  return {
    topo: topo(r, j),
    eixos: j === null || j.resultado !== 'ok' ? [] : DIMENSOES.map(dim => eixo(j, dim)),
    laudo: laudo(r, entrada, j),
    rodape: rodape(r, j),
  }
}

// D-B2: camada 1 numa linha, as fracas só com valor > 0 e as linhas de estado.
function topo(r: ResultadoC, j: Juiz | null): Linha[] {
  const linhas: Linha[] = []
  const l = (texto: string, fraco = false) => linhas.push({ texto, fraco })
  if (r.calculo.tipo === 'nada') l('Nada a calcular: sem objetivo e sem sessão de atenção aberta.')
  else {
    const f = r.calculo.fatos
    l(linhaCamada1(f))
    if (f.compactacoes.length > 0) l(`Histórico anterior a ${hora(Math.max(...f.compactacoes))} compactado`, true)
    if (f.semMensagem.ok && f.semMensagem.valor > 0) l(`${f.semMensagem.valor} prompts sem mensagem correspondente`, true)
    if (f.mensagensSemRegistro.ok && f.mensagensSemRegistro.valor > 0) {
      l(`${f.mensagensSemRegistro.valor} mensagens do dev sem registro (omitidas)`, true)
    }
  }
  if (r.aviso !== undefined) l(`Aviso: ${r.aviso}`)
  if (r.andamento) l('Avaliação em andamento…')
  if (j !== null) {
    if (j.reutilizado === true) l('Resultado guardado, sem custo: a entrada não mudou desde a última avaliação.')
    if (r.semTurnoNovo === true) l(`Sem turnos novos desde a avaliação das ${hora(j.t)}: resultado do juiz mantido, sem nova chamada.`)
    if (j.gravacao !== undefined) l(`Não gravado em avaliacoes: ${j.gravacao}`)
  }
  return linhas
}

// D-B3: o eixo de uma dimensão do juiz `ok`.
function eixo(j: Juiz, dim: Dimensao): Eixo {
  const { rotulo, cor, resumo } = EIXO[dim]
  const a = j.achados.find(x => x.dim === dim)
  if (a === undefined) return { dim, rotulo, cor, texto: `${rotulo} · nada a apontar`, citacao: null, achado: null }
  if (a.estado === 'descartado') {
    return { dim, rotulo, cor, texto: `${rotulo} · descartado: citação não encontrada`, citacao: null, achado: null }
  }
  const jaApontado = a.estado === 'ja-apontado' ? ' · já apontado' : ''
  const voto = a.voto === undefined ? '' : ` · voto: ${(VOTOS.find(v => v.voto === a.voto) as { rotulo: string }).rotulo}`
  return {
    dim,
    rotulo,
    cor,
    texto: `${rotulo} · nível ${a.nivel}${jaApontado} · ${resumo[a.nivel]}${voto}`,
    citacao: `  "${cortar160(a.citacao)}"`,
    achado: a,
  }
}

// D-B3: a citação cortada em 160 code points, com `…` só quando maior.
function cortar160(citacao: string): string {
  const cs = Array.from(citacao)
  return cs.length > 160 ? `${cs.slice(0, 160).join('')}…` : citacao
}

// D-B4: os sete ramos, nesta ordem, sobre os achados não descartados (já apontados incluídos).
function laudo(r: ResultadoC, entrada: EntradaC, j: Juiz | null): Laudo | null {
  if (r.calculo.tipo === 'nada' || r.andamento) return null
  if (!entrada.ok) return { texto: `Laudo: indisponível · ${entrada.motivo}`, cor: null }
  if (j === null) return { texto: 'Laudo: indisponível · o juiz não respondeu nesta avaliação', cor: null }
  if (j.resultado !== 'ok') {
    return { texto: `Laudo: indisponível · juiz ${j.resultado}${j.motivo === undefined ? '' : ` · ${j.motivo}`}`, cor: null }
  }
  const rotulos = (nivel: 1 | 2) =>
    DIMENSOES.filter(dim => j.achados.some(a => a.dim === dim && a.estado !== 'descartado' && a.nivel === nivel))
      .map(dim => EIXO[dim].rotulo)
      .join(', ')
  const n2 = rotulos(2)
  if (n2 !== '') return { texto: `Laudo: ruim · nível 2 em ${n2}`, cor: 'error' }
  const n1 = rotulos(1)
  if (n1 !== '') return { texto: `Laudo: atenção · indício em ${n1}`, cor: 'warning' }
  return { texto: 'Laudo: sem apontamentos', cor: 'success' }
}

// D-B5: custo do juiz (ou o aviso fixo) e o contexto da sessão, as duas fracas.
function rodape(r: ResultadoC, j: Juiz | null): Linha[] {
  let custo: string
  if (j === null) custo = 'O juiz não vê CLAUDE.md nem skills, não entra no /usage e não é determinístico.'
  else {
    const u = j.usage
    const numeros =
      u === null
        ? 'custo indisponível (a chamada foi recusada antes de enviar)'
        : `input ${u.input_tokens} · cache_read ${u.cache_read_input_tokens} · cache_creation ${u.cache_creation_input_tokens} · output ${u.output_tokens}`
    custo = `Custo do juiz às ${hora(j.t)}: ${numeros} · fora do /usage · não vê CLAUDE.md nem skills · não determinístico`
  }
  const contexto = r.contexto.ok
    ? `Contexto da sessão: ${r.contexto.valor.tokens ?? 'sem medida'} de ${r.contexto.valor.window} tokens${r.contexto.valor.percent === null ? '' : ` (${r.contexto.valor.percent}%)`}`
    : `Contexto da sessão: indisponível (${r.contexto.motivo})`
  return [
    { texto: custo, fraco: true },
    { texto: contexto, fraco: true },
  ]
}

// O resultado do juiz só vale para a entrada atual (mesmo hash) ou quando foi mantido sem turno novo (D-A5);
// de outra entrada ele não é mostrado.
function juizVisivel(r: ResultadoC, entrada: EntradaC | null): Juiz | null {
  return r.juiz !== null && entrada !== null && entrada.ok && (entrada.hash === r.juiz.hash || r.semTurnoNovo === true)
    ? r.juiz
    : null
}

// Os achados não descartados do juiz visível: base de `ruim`/`sugestoes` (D-F5/D-F6).
export function achadosDaTela(r: ResultadoC | null, entrada: EntradaC | null): Achado[] {
  const j = r === null ? null : juizVisivel(r, entrada)
  return j === null ? [] : j.achados.filter(a => a.estado !== 'descartado')
}

// D-J11: o estado da entrada do juiz; `hash` completo quando montada.
function linhaEntrada(e: EntradaC): string {
  return e.ok ? `Entrada do juiz: montada · hash ${e.hash} · /hsg entrada` : `Entrada do juiz: não montada: ${e.motivo}`
}

// `/hsg entrada`: a entrada exata do último cálculo (blocos na ordem) e o hash, sem chamar o modelo.
export function textoEntrada(e: EntradaC | null): string {
  if (e === null) return 'Nenhuma entrada montada: ainda não houve clique na C nem /hsg avaliar.'
  if (!e.ok) return linhaEntrada(e)
  const partes = e.blocos.map((b, i) => `--- bloco ${i + 1}${b.cache === true ? ' (cache)' : ''} ---\n${b.text}`)
  return [`hash ${e.hash}`, ...partes].join('\n')
}

// D-B2(2): a camada 1 numa linha; fato indisponível = "<nome> indisponível (motivo)" na mesma posição.
function linhaCamada1(f: Fatos): string {
  const dado = <V,>(nome: string, d: Dado<V>, mostrar: (v: V) => string) =>
    d.ok ? mostrar(d.valor) : `${nome} indisponível (${d.motivo})`
  const partes = [
    linhaEscopo(f),
    dado('tempo ativo', f.tempoAtivoSeg, v => `tempo ativo ≥ ${formatarRelogio(v)}`),
    dado('commits', f.commits, v => `${v.length} commits`),
    dado('último avanço', f.desdeAvancoSeg, v => `último avanço há ${formatarRelogio(v)}`),
    dado('ciclos', f.ciclos, v => `ciclos ≥ ${v}`),
  ]
  if (f.timebox !== null) {
    partes.push(dado('timebox', f.timebox, v => `timebox ${v.min} min (${v.atingido ? 'atingido' : 'não atingido'})`))
  }
  return partes.join(' · ')
}

function linhaEscopo(f: Fatos): string {
  if (f.objetivo === null) return `Objetivo não declarado: calculado pela sessão de atenção desde ${hora(f.ini)}`
  const aberto = `aberto às ${hora(f.objetivo.abertoEm)}`
  return f.objetivo.fechamento === null
    ? `Objetivo ${aberto}`
    : `Objetivo fechado às ${hora(f.objetivo.fechamento)} (${aberto})`
}

export function hora(t: number): string {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// `/hsg`: sem o texto do objetivo, só o id curto e o tempo ativo (pelo menos: o livro é o piso).
function linhaObjetivo(o: Objetivo, livro: Livro | null, viva: Sessao | null, agora: number): string {
  const ativo =
    livro === null
      ? 'indisponível (dados incompatíveis)'
      : `pelo menos ${formatarRelogio(tempoAtivoSeg(intervalosDe(livro.sessoes, viva, agora), o.abertoEm, agora))}`
  const timebox = o.timeboxMin === null ? '' : ` · timebox ${o.timeboxMin} min`
  return `Objetivo aberto às ${hora(o.abertoEm)} (id ${o.id.slice(0, 8)}) · tempo ativo: ${ativo}${timebox}`
}

// ---------- Árvores ----------

// A bolinha `●` + `T` + relógio como Button `hsg-t`, na cor de D-T1; ao lado, a C (`hsg-c`), sempre neutra.
// Em erro a faixa mostra só o erro: sem medição não há o que avaliar. D-F11: `aviso` (atom `avisoFaixa`) esmaecido no fim.
export function faixa(
  el: El,
  f: Faixa,
  aviso: string | null,
  pedirT: () => Promise<void>,
  pedirC: () => Promise<void>,
) {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="row" gap={1}>
      <Button key="hsg-t" onPress={pedirT}>
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
      {f.tipo === 'medida' && (
        <Button key="hsg-c" onPress={pedirC}>
          <Text dimColor>● C</Text>
        </Button>
      )}
      {aviso !== null && <Text dimColor>{aviso}</Text>}
    </Box>
  )
}

export type AcoesLinha = {
  votar: (a: Achado, voto: Voto) => Promise<void> // U2
  sugerir: (texto: string) => Promise<void> // D-F8: acrescenta o template à caixa, sem enviar
}

const VOTOS: readonly { voto: Voto; rotulo: string }[] = [
  { voto: 'util', rotulo: 'útil' },
  { voto: 'nao-se-aplica', rotulo: 'não se aplica' },
  { voto: 'errado', rotulo: 'errado' },
]

// D-F4/D-B1: a árvore da linha do `/hsg avaliar` no feed: topo → um row por eixo (na cor do eixo, com os votos U2 do
// achado) e a citação embaixo → laudo → sugestões D-F5/D-F6 quando a avaliação é ruim → rodapé.
export function linhaRica(el: El, m: ModeloAvaliacao, achados: readonly Achado[], alvo: Alvo | null, acoes: AcoesLinha) {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="column">
      {m.topo.map(x => (
        <Text dimColor={x.fraco}>{x.texto}</Text>
      ))}
      {m.eixos.map(e => (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text color={e.cor}>{e.texto}</Text>
            {e.achado !== null &&
              VOTOS.map(v => (
                <Button key={`hsg-u2-${e.dim}-${v.voto}`} onPress={() => acoes.votar(e.achado as Achado, v.voto)}>
                  <Text>{v.rotulo}</Text>
                </Button>
              ))}
          </Box>
          {e.citacao !== null && <Text color={e.cor}>{e.citacao}</Text>}
        </Box>
      ))}
      {m.laudo !== null &&
        (m.laudo.cor === null ? <Text bold>{m.laudo.texto}</Text> : <Text bold color={m.laudo.cor}>{m.laudo.texto}</Text>)}
      {ruim(achados) &&
        (alvo === null ? (
          <Text>Sugestões indisponíveis: avaliação sem objetivo e DoD</Text>
        ) : (
          <Box flexDirection="column">
            <Text>Sugestões de prompt (escrevem na caixa, não enviam):</Text>
            <Box flexDirection="row" gap={1}>
              {sugestoes(achados, alvo).map(s => (
                <Button key={`hsg-s-${s.dim}`} onPress={() => acoes.sugerir(s.texto)}>
                  <Text>{s.rotulo}</Text>
                </Button>
              ))}
            </Box>
          </Box>
        ))}
      {m.rodape.map(x => (
        <Text dimColor>{x.texto}</Text>
      ))}
    </Box>
  )
}

// D-F4: a árvore da linha do `/hsg entrada` no feed, uma `Text` por linha.
export function arvoreEntrada(el: El, texto: string) {
  const { Box, Text } = el
  return (
    <Box flexDirection="column">
      {texto.split('\n').map(x => (
        <Text>{x}</Text>
      ))}
    </Box>
  )
}

// D-F4: linha de uma avaliação ou entrada que não é a da memória: o texto guardado, esmaecido, e o aviso, sem botões.
export function linhaAntiga(el: El, texto: string) {
  const { Box, Text } = el
  return (
    <Box flexDirection="column">
      <Text dimColor>{texto}</Text>
      <Text>Detalhes fora da memória: substituídos por uma avaliação mais nova ou a sessão foi reiniciada · /hsg avaliar</Text>
    </Box>
  )
}
