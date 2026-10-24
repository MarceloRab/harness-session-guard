// Sugestões de prompt por template (mod-v2-feed D-F5, D-F6). Puro: sem `$`; nada chama o modelo.
// F5: mudar um rótulo ou um texto exige nova `VERSAO_SUGESTOES` e nova aprovação.
import type { Achado, Alvo, Dimensao } from '../types'
import { DIMENSOES } from './resultado'

export const VERSAO_SUGESTOES = 's1'

export type Sugestao = { dim: Dimensao; rotulo: string; texto: string }

const ROTULO: Record<Dimensao, string> = {
  dod: 'Melhorar DoD',
  suposicao: 'Preencher lacunas',
  semLastro: 'Exigir lastro',
  tangente: 'Voltar ao DoD',
}

const TEMPLATE: Record<Dimensao, (objetivo: string, dod: string, citacao: string) => string> = {
  dod: (o, d, c) =>
    `Revise a entrega contra o DoD antes de seguir.\nObjetivo: ${o}\nDoD: ${d}\nTrecho que indica o problema: "${c}"\nPara cada item do DoD, diga se está cumprido e mostre a evidência (arquivo, comando ou saída). Para o item que não está, entregue-o agora ou diga exatamente o que falta. Não declare cumprido sem evidência.`,
  suposicao: (o, d, c) =>
    `Você assumiu algo que eu não disse.\nObjetivo: ${o}\nDoD: ${d}\nTrecho: "${c}"\nListe cada suposição que fez neste trabalho, o que dependeu dela e o que muda se ela estiver errada. Faça as perguntas necessárias para trocar cada suposição por uma decisão minha e não siga até eu responder.`,
  semLastro: (o, d, c) =>
    `Você afirmou algo que a conversa não sustenta.\nObjetivo: ${o}\nDoD: ${d}\nTrecho: "${c}"\nMostre a evidência dessa afirmação: a saída do comando, o teste ou o arquivo e a linha que a sustenta. Se não houver, rode a verificação agora ou retire a afirmação. Não troque evidência por estimativa ou heurística.`,
  tangente: (o, d, c) =>
    `Isto parece fora do DoD.\nObjetivo: ${o}\nDoD: ${d}\nTrecho: "${c}"\nExplique por que essa mudança é necessária para cumprir o DoD. Se não for, desfaça o que foi feito (ou não faça) e volte ao que o DoD pede.`,
}

// D-F5: ruim = algum achado de nível 2 não descartado.
export function ruim(achados: readonly Achado[]): boolean {
  return achados.some(a => a.nivel === 2 && (a.estado === 'novo' || a.estado === 'ja-apontado'))
}

// D-F6: um template por dimensão em nível 2 (não descartada), na ordem de `DIMENSOES`.
export function sugestoes(achados: readonly Achado[], alvo: Alvo): Sugestao[] {
  return DIMENSOES.flatMap(dim => {
    const a = achados.find(x => x.dim === dim && x.nivel === 2 && x.estado !== 'descartado')
    return a === undefined ? [] : [{ dim, rotulo: ROTULO[dim], texto: TEMPLATE[dim](alvo.texto, alvo.dod, cortar(a.citacao)) }]
  })
}

// D-F6: a citação cortada em 300 code points, com `…` só quando maior.
function cortar(citacao: string): string {
  const cs = Array.from(citacao)
  return cs.length > 300 ? `${cs.slice(0, 300).join('')}…` : citacao
}
