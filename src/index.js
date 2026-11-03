import { prepararBanco } from './banco.js';
import {
  TAMANHO_MINIMO_SENHA,
  cookieDeSaida,
  criarSessao,
  encerrarSessao,
  limparFalhas,
  obterSessao,
  registrarFalha,
  senhaConfigurada,
  senhaCorreta,
  verificarBloqueio,
} from './autenticacao.js';

const MAX_CORPO_BYTES = 64 * 1024;
const MAX_ANOTACAO = 2000;

const CABECALHOS_SEGURANCA = {
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  // O navegador impede o uso da câmera e da localização por este site.
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(self)',
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

function comSeguranca(resposta) {
  const nova = new Response(resposta.body, resposta);
  for (const [nome, valor] of Object.entries(CABECALHOS_SEGURANCA)) nova.headers.set(nome, valor);
  return nova;
}

function json(dados, status = 200, extras = {}) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extras },
  });
}

function erro(status, codigo, mensagem, extras) {
  return json({ erro: { codigo, mensagem } }, status, extras);
}

async function lerJson(request) {
  const tamanho = Number(request.headers.get('content-length') ?? 0);
  if (tamanho > MAX_CORPO_BYTES) return { falha: erro(413, 'corpo_grande', 'O conteúdo enviado é grande demais.') };
  const texto = await request.text();
  if (new TextEncoder().encode(texto).length > MAX_CORPO_BYTES) {
    return { falha: erro(413, 'corpo_grande', 'O conteúdo enviado é grande demais.') };
  }
  try {
    const dados = JSON.parse(texto);
    if (dados && typeof dados === 'object') return { dados };
  } catch {
    // tratado abaixo
  }
  return { falha: erro(400, 'json_invalido', 'O conteúdo enviado não é válido.') };
}

function origemValida(request, url) {
  const origem = request.headers.get('origin');
  return origem === url.origin;
}

function estadoDaConfiguracao(env) {
  return { senhaConfigurada: senhaConfigurada(env), bancoConectado: Boolean(env.DB) };
}

async function rotear(request, env, url) {
  const { pathname: caminho } = url;
  const metodo = request.method;

  if (caminho === '/api/estado' && metodo === 'GET') {
    let autenticado = false;
    if (env.DB) {
      await prepararBanco(env.DB);
      autenticado = Boolean(await obterSessao(env.DB, env, request));
    }
    return json({ ...estadoDaConfiguracao(env), autenticado, tamanhoMinimoSenha: TAMANHO_MINIMO_SENHA });
  }

  if (metodo !== 'GET' && !origemValida(request, url)) {
    return erro(403, 'origem_invalida', 'Pedido bloqueado: ele não veio do próprio JARVIS.');
  }

  if (!env.DB) {
    return erro(503, 'banco_nao_conectado', 'O banco de dados não está conectado a este aplicativo.');
  }
  await prepararBanco(env.DB);

  if (caminho === '/api/entrar' && metodo === 'POST') {
    if (!senhaConfigurada(env)) {
      return erro(503, 'senha_nao_configurada', 'A senha de acesso ainda não foi configurada na Cloudflare.');
    }
    const minutos = await verificarBloqueio(env.DB, request);
    if (minutos > 0) {
      return erro(429, 'bloqueado', `Muitas tentativas erradas. Tente de novo em ${minutos} min.`, {
        'Retry-After': String(minutos * 60),
      });
    }
    const { dados, falha } = await lerJson(request);
    if (falha) return falha;
    if (typeof dados.senha !== 'string' || !(await senhaCorreta(env, dados.senha))) {
      await registrarFalha(env.DB, request);
      return erro(401, 'senha_incorreta', 'Senha incorreta.');
    }
    await limparFalhas(env.DB, request);
    const { cookie } = await criarSessao(env.DB, env);
    return json({ ok: true }, 200, { 'Set-Cookie': cookie });
  }

  const sessao = await obterSessao(env.DB, env, request);
  if (!sessao) return erro(401, 'nao_autenticado', 'Entre com sua senha para continuar.');

  if (caminho === '/api/sair' && metodo === 'POST') {
    await encerrarSessao(env.DB, sessao);
    return json({ ok: true }, 200, { 'Set-Cookie': cookieDeSaida() });
  }

  if (caminho === '/api/diagnostico' && metodo === 'GET') {
    const id = crypto.randomUUID();
    const inicio = Date.now();
    await env.DB.prepare('INSERT INTO diagnostico (id, criado_em) VALUES (?, ?)').bind(id, inicio).run();
    const lido = await env.DB.prepare('SELECT id FROM diagnostico WHERE id = ?').bind(id).first();
    await env.DB.prepare('DELETE FROM diagnostico WHERE id = ?').bind(id).run();
    const total = await env.DB.prepare('SELECT COUNT(*) AS total FROM anotacoes').first();
    return json({
      banco: { gravouELeu: lido?.id === id, milissegundos: Date.now() - inicio },
      anotacoes: total.total,
      sessaoExpiraEm: sessao.expira_em,
      verificadoEm: Date.now(),
    });
  }

  if (caminho === '/api/anotacoes' && metodo === 'GET') {
    const { results } = await env.DB
      .prepare('SELECT id, texto, criada_em FROM anotacoes ORDER BY criada_em DESC, id LIMIT 100')
      .all();
    return json({ anotacoes: results });
  }

  if (caminho === '/api/anotacoes' && metodo === 'POST') {
    const { dados, falha } = await lerJson(request);
    if (falha) return falha;
    const texto = typeof dados.texto === 'string' ? dados.texto.trim() : '';
    if (!texto) return erro(400, 'texto_vazio', 'Escreva algo antes de salvar.');
    if (texto.length > MAX_ANOTACAO) {
      return erro(400, 'texto_longo', `Use no máximo ${MAX_ANOTACAO} caracteres.`);
    }
    const anotacao = { id: crypto.randomUUID(), texto, criada_em: Date.now() };
    await env.DB
      .prepare('INSERT INTO anotacoes (id, texto, criada_em) VALUES (?, ?, ?)')
      .bind(anotacao.id, anotacao.texto, anotacao.criada_em)
      .run();
    return json({ anotacao }, 201);
  }

  const excluir = caminho.match(/^\/api\/anotacoes\/([0-9a-f-]{36})$/);
  if (excluir && metodo === 'DELETE') {
    const resultado = await env.DB.prepare('DELETE FROM anotacoes WHERE id = ?').bind(excluir[1]).run();
    if (!resultado.meta.changes) return erro(404, 'nao_encontrada', 'Esta anotação não existe mais.');
    return json({ ok: true });
  }

  return erro(404, 'rota_inexistente', 'Este endereço não existe.');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return comSeguranca(await env.ASSETS.fetch(request));
    }
    try {
      return comSeguranca(await rotear(request, env, url));
    } catch (falha) {
      console.error('Falha ao atender', url.pathname, falha);
      return comSeguranca(erro(500, 'falha_interna', 'O servidor encontrou um erro ao processar o pedido.'));
    }
  },
};
