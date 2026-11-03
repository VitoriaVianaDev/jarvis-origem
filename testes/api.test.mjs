import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import worker from '../src/index.js';
import { criarD1Local } from './d1-local.mjs';

const BASE = 'https://jarvis.exemplo.dev';
const SENHA = 'uma-senha-bem-longa-42';
const ASSETS = { fetch: async () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }) };

const ambiente = (extra = {}) => ({ DB: criarD1Local(), ASSETS, JARVIS_SENHA: SENHA, ...extra });

function pedir(env, caminho, { metodo = 'GET', corpo, cookie, origem = BASE, ip } = {}) {
  const headers = {};
  if (metodo !== 'GET' && origem) headers.Origin = origem;
  if (corpo !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  if (ip) headers['cf-connecting-ip'] = ip;
  return worker.fetch(
    new Request(BASE + caminho, {
      method: metodo,
      headers,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    }),
    env,
  );
}

async function entrar(env, senha = SENHA) {
  const r = await pedir(env, '/api/entrar', { metodo: 'POST', corpo: { senha } });
  assert.equal(r.status, 200);
  return r.headers.get('set-cookie').split(';')[0];
}

test('sem senha, com senha curta ou com a de exemplo, ninguém entra', async () => {
  for (const JARVIS_SENHA of [undefined, 'curta', 'defina-sua-senha']) {
    const env = ambiente({ JARVIS_SENHA });
    const r = await pedir(env, '/api/entrar', { metodo: 'POST', corpo: { senha: JARVIS_SENHA ?? '' } });
    assert.equal(r.status, 503);
    assert.equal((await r.json()).erro.codigo, 'senha_nao_configurada');
  }
});

test('senha errada é barrada e o cookie só nasce com a certa', async () => {
  const env = ambiente();
  const errada = await pedir(env, '/api/entrar', { metodo: 'POST', corpo: { senha: 'errada-errada-errada' } });
  assert.equal(errada.status, 401);
  assert.equal(errada.headers.get('set-cookie'), null);
  const certa = await pedir(env, '/api/entrar', { metodo: 'POST', corpo: { senha: SENHA } });
  const cookie = certa.headers.get('set-cookie');
  for (const parte of ['__Host-jarvis=', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) {
    assert.ok(cookie.includes(parte), parte);
  }
});

test('cinco erros bloqueiam o IP, sem afetar outro IP, e até a senha certa fica barrada', async () => {
  const env = ambiente();
  for (let i = 0; i < 5; i++) {
    const r = await pedir(env, '/api/entrar', { metodo: 'POST', corpo: { senha: 'x' }, ip: '1.1.1.1' });
    assert.equal(r.status, 401);
  }
  const bloqueado = await pedir(env, '/api/entrar', { metodo: 'POST', corpo: { senha: SENHA }, ip: '1.1.1.1' });
  assert.equal(bloqueado.status, 429);
  const outro = await pedir(env, '/api/entrar', { metodo: 'POST', corpo: { senha: SENHA }, ip: '2.2.2.2' });
  assert.equal(outro.status, 200);
});

test('todas as rotas de dados exigem sessão', async () => {
  const env = ambiente();
  for (const [metodo, caminho] of [
    ['GET', '/api/anotacoes'],
    ['POST', '/api/anotacoes'],
    ['DELETE', '/api/anotacoes/00000000-0000-0000-0000-000000000000'],
    ['GET', '/api/diagnostico'],
    ['POST', '/api/sair'],
  ]) {
    const r = await pedir(env, caminho, { metodo, corpo: metodo === 'POST' ? {} : undefined });
    assert.equal(r.status, 401, `${metodo} ${caminho}`);
  }
  const falso = await pedir(env, '/api/anotacoes', { cookie: '__Host-jarvis=token-inventado' });
  assert.equal(falso.status, 401);
});

test('pedido vindo de outro site é bloqueado, mesmo com sessão', async () => {
  const env = ambiente();
  const cookie = await entrar(env);
  for (const origem of ['https://site-malicioso.exemplo', null]) {
    const r = await pedir(env, '/api/anotacoes', { metodo: 'POST', corpo: { texto: 'x' }, cookie, origem });
    assert.equal(r.status, 403);
  }
});

test('anotação é criada, listada e excluída; texto inválido é recusado', async () => {
  const env = ambiente();
  const cookie = await entrar(env);
  const criada = await pedir(env, '/api/anotacoes', { metodo: 'POST', corpo: { texto: '  Comprar café  ' }, cookie });
  assert.equal(criada.status, 201);
  const { anotacao } = await criada.json();
  assert.equal(anotacao.texto, 'Comprar café');
  const lista = await (await pedir(env, '/api/anotacoes', { cookie })).json();
  assert.deepEqual(lista.anotacoes.map((a) => a.id), [anotacao.id]);

  assert.equal((await pedir(env, '/api/anotacoes', { metodo: 'POST', corpo: { texto: '   ' }, cookie })).status, 400);
  assert.equal(
    (await pedir(env, '/api/anotacoes', { metodo: 'POST', corpo: { texto: 'a'.repeat(2001) }, cookie })).status,
    400,
  );

  const caminho = `/api/anotacoes/${anotacao.id}`;
  assert.equal((await pedir(env, caminho, { metodo: 'DELETE', cookie })).status, 200);
  assert.equal((await pedir(env, caminho, { metodo: 'DELETE', cookie })).status, 404);
});

test('dados e sessão continuam depois de reabrir o banco', async () => {
  const pasta = mkdtempSync(join(tmpdir(), 'jarvis-'));
  const arquivo = join(pasta, 'banco.sqlite');
  try {
    const env1 = ambiente({ DB: criarD1Local(arquivo) });
    const cookie = await entrar(env1);
    await pedir(env1, '/api/anotacoes', { metodo: 'POST', corpo: { texto: 'persistente' }, cookie });
    env1.DB.fechar();

    const env2 = ambiente({ DB: criarD1Local(arquivo) });
    const { anotacoes } = await (await pedir(env2, '/api/anotacoes', { cookie })).json();
    assert.deepEqual(anotacoes.map((a) => a.texto), ['persistente']);
    env2.DB.fechar();
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

test('sair encerra a sessão, e trocar a senha encerra as demais', async () => {
  const env = ambiente();
  const cookie = await entrar(env);
  assert.equal((await pedir(env, '/api/sair', { metodo: 'POST', cookie })).status, 200);
  assert.equal((await pedir(env, '/api/anotacoes', { cookie })).status, 401);

  const cookie2 = await entrar(env);
  env.JARVIS_SENHA = 'outra-senha-bem-longa-99';
  assert.equal((await pedir(env, '/api/anotacoes', { cookie: cookie2 })).status, 401);
});

test('o banco não guarda o token nem a senha', async () => {
  const env = ambiente();
  const cookie = await entrar(env);
  const token = cookie.split('=')[1];
  const { results } = await env.DB.prepare('SELECT id FROM sessoes').all();
  assert.equal(results.length, 1);
  assert.notEqual(results[0].id, token);
  assert.ok(!JSON.stringify(results).includes(SENHA));
});

test('diagnóstico faz gravação real e não deixa resíduo', async () => {
  const env = ambiente();
  const cookie = await entrar(env);
  const d = await (await pedir(env, '/api/diagnostico', { cookie })).json();
  assert.equal(d.banco.gravouELeu, true);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM diagnostico').first()).n, 0);
});

test('banco ausente gera aviso claro, e a página continua abrindo', async () => {
  const env = ambiente({ DB: undefined });
  const estado = await (await pedir(env, '/api/estado')).json();
  assert.equal(estado.bancoConectado, false);
  const r = await pedir(env, '/api/entrar', { metodo: 'POST', corpo: { senha: SENHA } });
  assert.equal((await r.json()).erro.codigo, 'banco_nao_conectado');
  assert.equal((await pedir(env, '/')).status, 200);
});

test('falha inesperada não vaza detalhes', async () => {
  const env = ambiente();
  const original = console.error;
  console.error = () => {};
  env.DB = { prepare() { throw new Error('segredo interno'); } };
  const r = await pedir(env, '/api/estado');
  console.error = original;
  assert.equal(r.status, 500);
  assert.ok(!(await r.text()).includes('segredo'));
});

test('câmera e localização ficam proibidas pelo navegador, em páginas e na API', async () => {
  const env = ambiente();
  for (const caminho of ['/', '/api/estado']) {
    const r = await pedir(env, caminho);
    const politica = r.headers.get('permissions-policy');
    assert.ok(politica.includes('camera=()'));
    assert.ok(politica.includes('geolocation=()'));
    assert.ok(r.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  }
});
