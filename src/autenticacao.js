const NOME_COOKIE = '__Host-jarvis';
const DURACAO_SESSAO_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FALHAS = 5;
const JANELA_FALHAS_MS = 15 * 60 * 1000;
export const TAMANHO_MINIMO_SENHA = 12;
const SENHA_DE_EXEMPLO = 'defina-sua-senha';

const codificador = new TextEncoder();

function paraBase64Url(bytes) {
  let texto = '';
  for (const b of bytes) texto += String.fromCharCode(b);
  return btoa(texto).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function sha256(texto) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', codificador.encode(texto)));
}

async function hmac(chave, mensagem) {
  const k = await crypto.subtle.importKey(
    'raw',
    codificador.encode(chave),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return paraBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', k, codificador.encode(mensagem))));
}

function iguaisEmTempoConstante(a, b) {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a[i] ^ b[i];
  return diferenca === 0;
}

export function senhaConfigurada(env) {
  const senha = env.JARVIS_SENHA;
  return typeof senha === 'string' && senha.length >= TAMANHO_MINIMO_SENHA && senha !== SENHA_DE_EXEMPLO;
}

export async function senhaCorreta(env, tentativa) {
  return iguaisEmTempoConstante(await sha256(env.JARVIS_SENHA), await sha256(String(tentativa)));
}

async function chaveDoCliente(request) {
  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  return paraBase64Url(await sha256(ip));
}

export async function verificarBloqueio(db, request, agora = Date.now()) {
  const chave = await chaveDoCliente(request);
  const linha = await db.prepare('SELECT falhas, inicio FROM tentativas_login WHERE chave = ?').bind(chave).first();
  if (!linha || agora - linha.inicio >= JANELA_FALHAS_MS || linha.falhas < MAX_FALHAS) return 0;
  return Math.ceil((linha.inicio + JANELA_FALHAS_MS - agora) / 60000);
}

export async function registrarFalha(db, request, agora = Date.now()) {
  const chave = await chaveDoCliente(request);
  await db
    .prepare(
      `INSERT INTO tentativas_login (chave, falhas, inicio) VALUES (?1, 1, ?2)
       ON CONFLICT (chave) DO UPDATE SET
         falhas = CASE WHEN ?2 - inicio >= ?3 THEN 1 ELSE falhas + 1 END,
         inicio = CASE WHEN ?2 - inicio >= ?3 THEN ?2 ELSE inicio END`,
    )
    .bind(chave, agora, JANELA_FALHAS_MS)
    .run();
}

export async function limparFalhas(db, request) {
  await db.prepare('DELETE FROM tentativas_login WHERE chave = ?').bind(await chaveDoCliente(request)).run();
}

// O banco guarda só uma assinatura do token, feita com a senha. Trocar a senha encerra todas as sessões.
export async function criarSessao(db, env, agora = Date.now()) {
  const token = paraBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const id = await hmac(env.JARVIS_SENHA, token);
  const expira = agora + DURACAO_SESSAO_MS;
  await db.batch([
    db.prepare('DELETE FROM sessoes WHERE expira_em <= ?').bind(agora),
    db.prepare('INSERT INTO sessoes (id, criada_em, expira_em) VALUES (?, ?, ?)').bind(id, agora, expira),
  ]);
  return {
    cookie: `${NOME_COOKIE}=${token}; Path=/; Max-Age=${DURACAO_SESSAO_MS / 1000}; HttpOnly; Secure; SameSite=Strict`,
    expira,
  };
}

function lerToken(request) {
  const cabecalho = request.headers.get('cookie') ?? '';
  for (const parte of cabecalho.split(';')) {
    const [nome, ...valor] = parte.trim().split('=');
    if (nome === NOME_COOKIE) return valor.join('=');
  }
  return null;
}

export async function obterSessao(db, env, request, agora = Date.now()) {
  const token = lerToken(request);
  if (!token || !senhaConfigurada(env)) return null;
  const id = await hmac(env.JARVIS_SENHA, token);
  const sessao = await db.prepare('SELECT id, expira_em FROM sessoes WHERE id = ? AND expira_em > ?').bind(id, agora).first();
  return sessao ?? null;
}

export async function encerrarSessao(db, sessao) {
  await db.prepare('DELETE FROM sessoes WHERE id = ?').bind(sessao.id).run();
}

export function cookieDeSaida() {
  return `${NOME_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
