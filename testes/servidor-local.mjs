// Executa o JARVIS neste computador apenas para testes. Na Cloudflare, este arquivo não é usado.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import worker from '../src/index.js';
import { criarD1Local } from './d1-local.mjs';

const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff': 'font/woff' };
const raiz = new URL('..', import.meta.url).pathname;
const porta = Number(process.env.PORTA ?? 8787);
mkdirSync(join(raiz, '.local'), { recursive: true });

// Só para testes neste computador: imita a Groq, sem nenhuma chamada real.
if (process.env.SIMULAR_IA) {
  globalThis.fetch = async (url, op) => {
    const corpo = JSON.parse(op.body);
    const ultima = corpo.messages.at(-1);
    await new Promise((r) => setTimeout(r, 700));
    if (ultima.content.includes('cota')) return new Response('{}', { status: 429 });
    const mensagem = ultima.role === 'user' && ultima.content.startsWith('anote')
      ? { content: '', tool_calls: [{ id: 'c1', function: { name: 'salvar_anotacao', arguments: JSON.stringify({ texto: ultima.content.slice(6) }) } }] }
      : { content: ultima.role === 'tool' ? 'Anotado.' : `Resposta simulada para teste. Você escreveu: ${ultima.content}` };
    return new Response(JSON.stringify({ choices: [{ message: mensagem }], usage: { prompt_tokens: 300, completion_tokens: 40 } }), {
      headers: { 'x-ratelimit-remaining-requests': '990', 'x-ratelimit-limit-requests': '1000' },
    });
  };
}

const env = {
  JARVIS_SENHA: process.env.JARVIS_SENHA,
  GROQ_API_KEY: process.env.SIMULAR_IA ? 'simulada' : process.env.GROQ_API_KEY,
  DB: process.env.SEM_BANCO ? undefined : criarD1Local(process.env.BANCO ?? join(raiz, '.local/banco.sqlite')),
  ASSETS: {
    async fetch(request) {
      let caminho = normalize(new URL(request.url).pathname);
      if (caminho === '/') caminho = '/index.html';
      const arquivo = join(raiz, 'public', caminho);
      if (!arquivo.startsWith(join(raiz, 'public')) || !existsSync(arquivo)) return new Response('Não encontrado', { status: 404 });
      return new Response(readFileSync(arquivo), { headers: { 'Content-Type': TIPOS[extname(arquivo)] ?? 'application/octet-stream' } });
    },
  },
};

createServer(async (req, res) => {
  const partes = [];
  for await (const p of req) partes.push(p);
  const corpo = partes.length ? Buffer.concat(partes) : undefined;
  const request = new Request(`http://localhost:${porta}${req.url}`, { method: req.method, headers: req.headers, body: corpo });
  const resposta = await worker.fetch(request, env);
  res.writeHead(resposta.status, Object.fromEntries(resposta.headers));
  if (resposta.body) for await (const parte of resposta.body) res.write(parte);
  res.end();
}).listen(porta, () => console.log(`JARVIS de teste em http://localhost:${porta}`));
