// D-J3/D-010: SHA-256 hex do texto em UTF-8; o único ponto de hash do mod. Assíncrono: o ambiente dos hooks
// não tem Node (`node:crypto` é recusado pelo validate), só a Web Crypto global.
export async function sha256Hex(texto: string): Promise<string> {
  const resumo = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
  return Array.from(new Uint8Array(resumo), b => b.toString(16).padStart(2, '0')).join('')
}
