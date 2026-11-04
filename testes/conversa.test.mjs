import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import worker from '../src/index.js';
import { criarD1Local } from './d1-local.mjs';

const BASE = 'https://jarvis.exemplo.dev';
const SENHA = 'uma-senha-bem-longa-42';
const ASSETS = { fetch: async () => new Response('ok') };
const fetchOriginal = globalThis.fetch;
afterEach(() => { globalThis.fetch = fetchOriginal; });

const respostaLLM = (mensagem, usage = { prompt_tokens: 100, completion_tokens: 20 }) => ({ choices: [{ message: mensagem }], usage });

// Simula a Groq: cada item da fila é a resposta a uma chamada; os pedidos ficam registrados.
function simularGroq(fila) {
  const pedidos = [];
  globalThis.fetch = async (url, op) => {
    assert.ok(String(url).startsWith('https://api.groq.com/'), 'só a Groq deve ser chamada');
    const corpo = JSON.parse(op.body);
    pedidos.push({ corpo, chave: op.headers.Authorization });
    const item = fila.shift();
    assert.ok(item !== undefined, 'chamada inesperada');
    if (typeof item === 'number') return new Response('{"error":{}}', { status: item });
    return new Response(JSON.stringify(item), { headers: { 'x-ratelimit-remaining-requests': '998', 'x-ratelimit-limit-requests': '1000' } });
  };
  return pedidos;
}

const ambiente = (extra = {}) => ({ DB: criarD1Local(), ASSETS, JARVIS_SENHA: SENHA, GROQ_API_KEY: 'gsk_teste', ...extra });

function pedir(env, caminho, { metodo = 'GET', corpo, cookie } = {}) {
  const headers = {};
  if (metodo !== 'GET') headers.Origin = BASE;
  if (cookie) headers.Cookie = cookie;
  return worker.fetch(new Request(BASE + caminho, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) }), env);
}

async function entrar(env) {
  const r = await pedir(env, '/api/entrar', { metodo: 'POST', corpo: { senha: SENHA } });
  return r.headers.get('set-cookie').split(';')[0];
}

async function falar(env, cookie, texto) {
  const r = await pedir(env, '/api/conversa', { metodo: 'POST', corpo: { texto }, cookie });
  assert.equal(r.status, 200);
  return (await r.text()).trim().split('\n').map((l) => JSON.parse(l));
}

test('conversa exige sessão e texto válido', async () => {
  const env = ambiente();
  simularGroq([]);
  assert.equal((await pedir(env, '/api/conversa', { metodo: 'POST', corpo: { texto: 'oi' } })).status, 401);
  const cookie = await entrar(env);
  assert.equal((await pedir(env, '/api/conversa', { metodo: 'POST', corpo: { texto: ' ' }, cookie })).status, 400);
  assert.equal((await pedir(env, '/api/conversa', { metodo: 'POST', corpo: { texto: 'a'.repeat(4001) }, cookie })).status, 400);
});

test('resposta real é salva, e a conversa seguinte recebe o contexto', async () => {
  const env = ambiente();
  const cookie = await entrar(env);
  const pedidos = simularGroq([respostaLLM({ content: 'Olá.' }), respostaLLM({ content: 'Você disse oi.' })]);
  const eventos = await falar(env, cookie, 'oi');
  assert.deepEqual(eventos.map((e) => e.tipo), ['estado', 'resposta']);
  assert.equal(eventos[1].mensagem.conteudo, 'Olá.');
  assert.equal(pedidos[0].chave, 'Bearer gsk_teste');
  assert.match(pedidos[0].corpo.messages[0].content, /Agora são .*horário de Brasília/);

  await falar(env, cookie, 'o que eu disse?');
  const contexto = pedidos[1].corpo.messages.slice(1).map((m) => m.content);
  assert.deepEqual(contexto, ['oi', 'Olá.', 'o que eu disse?']);

  const tela = await (await pedir(env, '/api/conversa', { cookie })).json();
  assert.equal(tela.mensagens.length, 4);
});

test('as instruções proíbem fingir recursos que ainda não existem', async () => {
  const env = ambiente();
  const cookie = await entrar(env);
  const pedidos = simularGroq([respostaLLM({ content: 'ok' })]);
  await falar(env, cookie, 'oi');
  const sistema = pedidos[0].corpo.messages[0].content;
  for (const recurso of ['lembretes', 'finanças', 'previsão do tempo', 'pesquisa na internet']) assert.ok(sistema.includes(recurso));
  assert.ok(sistema.includes('Nunca invente'));
  assert.ok(sistema.includes('Nunca diga que não consegue ouvir'));
  assert.ok(sistema.includes('responda que sim'));
});

test('ferramenta salva anotação de verdade e informa o estado executando', async () => {
  const env = ambiente();
  const cookie = await entrar(env);
  const pedidos = simularGroq([
    respostaLLM({ content: null, tool_calls: [{ id: 'c1', function: { name: 'salvar_anotacao', arguments: '{"texto":"Comprar café"}' } }] }),
    respostaLLM({ content: 'Anotado.' }),
  ]);
  const eventos = await falar(env, cookie, 'anote comprar café');
  assert.deepEqual(eventos.filter((e) => e.tipo === 'estado').map((e) => e.estado), ['executando', 'processando', 'respondendo']);
  const final = eventos.at(-1);
  assert.deepEqual(final.mensagem.acoes.map((a) => a.nome), ['salvar_anotacao']);
  const notas = await (await pedir(env, '/api/anotacoes', { cookie })).json();
  assert.deepEqual(notas.anotacoes.map((a) => a.texto), ['Comprar café']);
  const retorno = pedidos[1].corpo.messages.at(-1);
  assert.equal(retorno.role, 'tool');
  assert.equal(retorno.tool_call_id, 'c1');
});

test('listar anotações devolve os dados do banco ao modelo', async () => {
  const env = ambiente();
  const cookie = await entrar(env);
  await pedir(env, '/api/anotacoes', { metodo: 'POST', corpo: { texto: 'nota real' }, cookie });
  const pedidos = simularGroq([
    respostaLLM({ content: '', tool_calls: [{ id: 'c1', function: { name: 'listar_anotacoes', arguments: '' } }] }),
    respostaLLM({ content: 'Você tem uma nota.' }),
  ]);
  await falar(env, cookie, 'quais minhas notas?');
  assert.ok(pedidos[1].corpo.messages.at(-1).content.includes('nota real'));
});

test('argumentos ruins e ferramenta inexistente não executam nada', async () => {
  const env = ambiente();
  const cookie = await entrar(env);
  const pedidos = simularGroq([
    respostaLLM({ content: '', tool_calls: [
      { id: 'a', function: { name: 'salvar_anotacao', arguments: '{quebrado' } },
      { id: 'b', function: { name: 'apagar_tudo', arguments: '{}' } },
      { id: 'c', function: { name: 'salvar_anotacao', arguments: '{"texto":"  "}' } },
    ] }),
    respostaLLM({ content: 'Não consegui.' }),
  ]);
  const eventos = await falar(env, cookie, 'x');
  assert.deepEqual(eventos.at(-1).mensagem.acoes, []);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM anotacoes').first()).n, 0);
  assert.ok(pedidos[1].corpo.messages.filter((m) => m.role === 'tool').every((m) => m.content.includes('erro')));
});

test('cota esgotada passa ao próximo modelo e registra o uso', async () => {
  const env = ambiente();
  const cookie = await entrar(env);
  const pedidos = simularGroq([429, respostaLLM({ content: 'Pelo segundo modelo.' })]);
  const eventos = await falar(env, cookie, 'oi');
  assert.equal(eventos.at(-1).mensagem.modelo, 'GPT OSS 20B');
  assert.deepEqual(pedidos.map((p) => p.corpo.model), ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
  const d = await (await pedir(env, '/api/diagnostico', { cookie })).json();
  assert.deepEqual(
    { pedidos: d.ia.hoje.pedidos, falhas: d.ia.hoje.falhas, tokens: d.ia.hoje.tokens },
    { pedidos: 1, falhas: 1, tokens: 120 },
  );
  assert.equal(d.ia.porModelo[0].ultimaFalha, 'o limite gratuito foi atingido');
  assert.equal(d.ia.porModelo[1].pedidos, 1);
  assert.equal(d.ia.porModelo[1].ultimaFalha, null);
  assert.equal(d.ia.porHora.length, 24);
  assert.equal(d.ia.porHora.reduce((a, b) => a + b), 120);
});

test('Workers AI assume quando toda a Groq falha, sem repetir a anotação', async () => {
  const chamadasAi = [];
  const env = ambiente({
    AI: { run: async (modelo, corpo) => { chamadasAi.push({ modelo, corpo }); return respostaLLM({ content: 'Pela reserva.' }); } },
  });
  const cookie = await entrar(env);
  simularGroq([
    respostaLLM({ content: '', tool_calls: [{ id: 'c1', function: { name: 'salvar_anotacao', arguments: '{"texto":"única"}' } }] }),
    503, 500, 429,
  ]);
  const eventos = await falar(env, cookie, 'anote única');
  const final = eventos.at(-1);
  assert.equal(final.mensagem.modelo, 'GLM 4.7 Flash');
  assert.deepEqual(final.mensagem.acoes.map((a) => a.nome), ['salvar_anotacao']);
  assert.equal(chamadasAi[0].modelo, '@cf/zai-org/glm-4.7-flash');
  assert.equal(chamadasAi[0].corpo.max_tokens, 1000);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM anotacoes').first()).n, 1);
});

test('funciona só com Workers AI, sem chave da Groq', async () => {
  const env = ambiente({ GROQ_API_KEY: undefined, AI: { run: async () => respostaLLM({ content: 'Só reserva.' }) } });
  const cookie = await entrar(env);
  globalThis.fetch = () => assert.fail('não deve chamar a Groq');
  const eventos = await falar(env, cookie, 'oi');
  assert.equal(eventos.at(-1).mensagem.conteudo, 'Só reserva.');
});

test('se tudo falha, mostra erro real, sem resposta inventada e sem salvar a fala', async () => {
  const env = ambiente({ AI: { run: async () => { throw new Error('3036: daily free allocation of 10,000 neurons'); } } });
  const cookie = await entrar(env);
  simularGroq([429, 401, 500]);
  const eventos = await falar(env, cookie, 'oi');
  const final = eventos.at(-1);
  assert.equal(final.tipo, 'erro');
  assert.match(final.mensagem, /limite gratuito/);
  assert.match(final.mensagem, /chave de acesso/);
  assert.ok(!eventos.some((e) => e.tipo === 'resposta'));
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM mensagens').first()).n, 0);
});

test('sem nenhuma IA configurada, explica o que falta', async () => {
  const env = ambiente({ GROQ_API_KEY: undefined });
  const cookie = await entrar(env);
  const eventos = await falar(env, cookie, 'oi');
  assert.match(eventos[0].mensagem, /GROQ_API_KEY/);
});

test('resposta vazia conta como falha do modelo', async () => {
  const env = ambiente();
  const cookie = await entrar(env);
  simularGroq([respostaLLM({ content: '   ' }), respostaLLM({ content: 'Agora sim.' })]);
  const eventos = await falar(env, cookie, 'oi');
  assert.equal(eventos.at(-1).mensagem.conteudo, 'Agora sim.');
});

test('laço de ferramentas tem limite e termina sem ferramentas', async () => {
  const env = ambiente();
  const cookie = await entrar(env);
  const chamada = { content: '', tool_calls: [{ id: 'x', function: { name: 'listar_anotacoes', arguments: '{}' } }] };
  const pedidos = simularGroq([respostaLLM(chamada), respostaLLM(chamada), respostaLLM(chamada), respostaLLM({ content: 'Fim.' })]);
  const eventos = await falar(env, cookie, 'x');
  assert.equal(eventos.at(-1).mensagem.conteudo, 'Fim.');
  assert.equal(pedidos[3].corpo.tools, undefined);
});

test('nova conversa zera o contexto, mas mantém o histórico no banco', async () => {
  const env = ambiente();
  const cookie = await entrar(env);
  const pedidos = simularGroq([respostaLLM({ content: 'A.' }), respostaLLM({ content: 'B.' })]);
  await falar(env, cookie, 'primeira');
  assert.equal((await pedir(env, '/api/conversa/nova', { metodo: 'POST', cookie })).status, 200);
  await falar(env, cookie, 'segunda');
  assert.deepEqual(pedidos[1].corpo.messages.slice(1).map((m) => m.content), ['segunda']);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM mensagens').first()).n, 4);
  assert.equal((await (await pedir(env, '/api/conversa', { cookie })).json()).mensagens.length, 2);
});

test('banco antigo da etapa 1 é atualizado sem perder anotações', async () => {
  const DB = criarD1Local();
  await DB.prepare('CREATE TABLE esquema_versao (versao INTEGER PRIMARY KEY, aplicada_em INTEGER NOT NULL)').run();
  await DB.batch([
    DB.prepare('CREATE TABLE sessoes (id TEXT PRIMARY KEY, criada_em INTEGER NOT NULL, expira_em INTEGER NOT NULL)'),
    DB.prepare('CREATE TABLE tentativas_login (chave TEXT PRIMARY KEY, falhas INTEGER NOT NULL, inicio INTEGER NOT NULL)'),
    DB.prepare('CREATE TABLE anotacoes (id TEXT PRIMARY KEY, texto TEXT NOT NULL, criada_em INTEGER NOT NULL)'),
    DB.prepare('CREATE INDEX idx_anotacoes_data ON anotacoes (criada_em DESC)'),
    DB.prepare('CREATE TABLE diagnostico (id TEXT PRIMARY KEY, criado_em INTEGER NOT NULL)'),
    DB.prepare('INSERT INTO esquema_versao VALUES (1, 1)'),
    DB.prepare("INSERT INTO anotacoes VALUES ('a', 'antiga', 1)"),
  ]);
  const env = ambiente({ DB });
  const cookie = await entrar(env);
  const notas = await (await pedir(env, '/api/anotacoes', { cookie })).json();
  assert.deepEqual(notas.anotacoes.map((a) => a.texto), ['antiga']);
  assert.equal((await DB.prepare('SELECT MAX(versao) AS v FROM esquema_versao').first()).v, 2);
});

test('teste de IA reporta cada modelo e o que falta', async () => {
  const env = ambiente();
  const cookie = await entrar(env);
  simularGroq([respostaLLM({ content: 'ok' }), 404, 429]);
  const r = await (await pedir(env, '/api/diagnostico/ia', { metodo: 'POST', cookie })).json();
  assert.deepEqual(r.modelos.map((m) => m.ok), [true, false, false, false]);
  assert.match(r.modelos[1].detalhe, /não está disponível/);
  assert.match(r.modelos[3].detalhe, /Workers AI/);
});

test('a chave da Groq nunca aparece nas respostas', async () => {
  const env = ambiente();
  const cookie = await entrar(env);
  simularGroq([respostaLLM({ content: 'ok' })]);
  const textos = [
    JSON.stringify(await falar(env, cookie, 'oi')),
    await (await pedir(env, '/api/diagnostico', { cookie })).text(),
    await (await pedir(env, '/api/estado')).text(),
  ];
  for (const t of textos) assert.ok(!t.includes('gsk_teste'));
});
