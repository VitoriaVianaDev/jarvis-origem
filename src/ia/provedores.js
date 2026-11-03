// Única peça que conhece os provedores de IA. Para trocar de modelo, basta alterar esta lista.
// Todos são chamados no formato de chat compatível com OpenAI.
const MODELOS = [
  { id: 'openai/gpt-oss-120b', nome: 'GPT OSS 120B', provedor: 'groq', extra: { reasoning_effort: 'low' } },
  { id: 'llama-3.3-70b-versatile', nome: 'Llama 3.3 70B', provedor: 'groq' },
  { id: 'llama-3.1-8b-instant', nome: 'Llama 3.1 8B', provedor: 'groq' },
  { id: '@cf/zai-org/glm-4.7-flash', nome: 'GLM 4.7 Flash', provedor: 'workers-ai' },
];

const URL_GROQ = 'https://api.groq.com/openai/v1/chat/completions';
const LIMITE_ESPERA_MS = 25000;
const MAX_TOKENS_RESPOSTA = 1000;

export class FalhaDeModelo extends Error {
  constructor(motivo, status) {
    super(motivo);
    this.status = status;
  }
}

export function modelosDisponiveis(env) {
  return MODELOS.filter((m) => (m.provedor === 'groq' ? Boolean(env.GROQ_API_KEY) : Boolean(env.AI)));
}

export function hojeEmBrasilia(agora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
}

function motivoDoStatus(status) {
  if (status === 401 || status === 403) return 'a chave de acesso foi recusada';
  if (status === 404) return 'o modelo não está disponível';
  if (status === 413) return 'o pedido ficou grande demais';
  if (status === 429) return 'o limite gratuito foi atingido';
  if (status === 400) return 'o modelo não conseguiu processar o pedido';
  if (status >= 500) return 'o serviço está instável';
  return `o serviço respondeu com erro ${status}`;
}

function normalizar(dados) {
  const mensagem = dados?.choices?.[0]?.message;
  if (!mensagem) throw new FalhaDeModelo('a resposta veio em um formato inesperado');
  const chamadas = (mensagem.tool_calls ?? []).map((c) => ({
    id: c.id,
    nome: c.function?.name,
    argumentos: typeof c.function?.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function?.arguments ?? {}),
  }));
  return {
    texto: (mensagem.content ?? '').trim(),
    chamadas,
    uso: { entrada: dados.usage?.prompt_tokens ?? 0, saida: dados.usage?.completion_tokens ?? 0 },
  };
}

async function chamarGroq(env, modelo, corpo) {
  let resposta;
  try {
    resposta = await fetch(URL_GROQ, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelo.id, ...modelo.extra, ...corpo }),
      signal: AbortSignal.timeout(LIMITE_ESPERA_MS),
    });
  } catch (e) {
    throw new FalhaDeModelo(e?.name === 'TimeoutError' ? 'o serviço demorou demais para responder' : 'não foi possível conectar ao serviço');
  }
  if (!resposta.ok) {
    await resposta.body?.cancel();
    throw new FalhaDeModelo(motivoDoStatus(resposta.status), resposta.status);
  }
  const limites = {
    pedidosRestantes: resposta.headers.get('x-ratelimit-remaining-requests'),
    pedidosLimite: resposta.headers.get('x-ratelimit-limit-requests'),
  };
  const normalizado = normalizar(await resposta.json());
  return { ...normalizado, limites };
}

async function chamarWorkersAi(env, modelo, corpo) {
  const { max_completion_tokens, ...resto } = corpo;
  let dados;
  try {
    dados = await env.AI.run(modelo.id, { ...resto, max_tokens: max_completion_tokens });
  } catch (e) {
    const texto = String(e?.message ?? e);
    if (texto.includes('3036') || /neuron/i.test(texto)) throw new FalhaDeModelo('o limite gratuito foi atingido', 429);
    console.error('Workers AI', texto);
    throw new FalhaDeModelo('o serviço não conseguiu responder');
  }
  return normalizar(dados);
}

async function registrarUso(env, modelo, uso, inicio, resultado) {
  await env.DB
    .prepare(
      'INSERT INTO uso_ia (dia, modelo, tokens_entrada, tokens_saida, milissegundos, resultado, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(hojeEmBrasilia(), modelo.id, uso?.entrada ?? 0, uso?.saida ?? 0, Date.now() - inicio, resultado, Date.now())
    .run();
}

// Faz uma chamada a um modelo e registra o consumo, com sucesso ou não.
export async function chamarModelo(env, modelo, { messages, tools, maxTokens = MAX_TOKENS_RESPOSTA }) {
  const corpo = { messages, max_completion_tokens: maxTokens, temperature: 0.6 };
  if (tools?.length) {
    corpo.tools = tools;
    corpo.tool_choice = 'auto';
  }
  const inicio = Date.now();
  try {
    const saida = modelo.provedor === 'groq' ? await chamarGroq(env, modelo, corpo) : await chamarWorkersAi(env, modelo, corpo);
    await registrarUso(env, modelo, saida.uso, inicio, 'ok');
    if (saida.limites?.pedidosRestantes) {
      await env.DB
        .prepare('INSERT INTO ajustes (chave, valor) VALUES (?, ?) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor')
        .bind(`limites:${modelo.id}`, JSON.stringify({ ...saida.limites, em: Date.now() }))
        .run();
    }
    return saida;
  } catch (e) {
    if (!(e instanceof FalhaDeModelo)) throw e;
    await registrarUso(env, modelo, null, inicio, e.status === 429 ? 'limite' : 'falha');
    await env.DB
      .prepare('INSERT INTO ajustes (chave, valor) VALUES (?, ?) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor')
      .bind(`falha:${modelo.id}`, JSON.stringify({ motivo: e.message, em: Date.now() }))
      .run();
    throw e;
  }
}

export async function resumoDeUso(env) {
  const hoje = hojeEmBrasilia();
  const { results } = await env.DB
    .prepare(
      `SELECT modelo, SUM(resultado = 'ok') AS pedidos, SUM(resultado <> 'ok') AS falhas,
              SUM(tokens_entrada + tokens_saida) AS tokens
       FROM uso_ia WHERE dia = ? GROUP BY modelo`,
    )
    .bind(hoje)
    .all();
  const totais = results.reduce(
    (t, r) => ({ pedidos: t.pedidos + r.pedidos, falhas: t.falhas + r.falhas, tokens: t.tokens + r.tokens }),
    { pedidos: 0, falhas: 0, tokens: 0 },
  );
  const principal = MODELOS[0];
  const linha = await env.DB.prepare('SELECT valor FROM ajustes WHERE chave = ?').bind(`limites:${principal.id}`).first();
  const limites = linha ? JSON.parse(linha.valor) : null;

  const falhas = await env.DB.prepare("SELECT chave, valor FROM ajustes WHERE chave LIKE 'falha:%'").all();
  const ultimaFalha = new Map(falhas.results.map((f) => [f.chave.slice(6), JSON.parse(f.valor)]));
  const disponiveis = modelosDisponiveis(env);
  const porModelo = MODELOS.map((m) => {
    const uso = results.find((r) => r.modelo === m.id);
    const falha = uso?.falhas ? ultimaFalha.get(m.id) : null;
    return {
      nome: m.nome,
      disponivel: disponiveis.includes(m),
      pedidos: uso?.pedidos ?? 0,
      falhas: uso?.falhas ?? 0,
      ultimaFalha: falha?.motivo ?? null,
    };
  });

  // Brasília não tem horário de verão desde 2019: UTC-3 o ano inteiro.
  const horas = await env.DB
    .prepare(
      `SELECT ((criado_em / 3600000) - 3 + 24) % 24 AS hora, SUM(tokens_entrada + tokens_saida) AS tokens
       FROM uso_ia WHERE dia = ? GROUP BY hora`,
    )
    .bind(hoje)
    .all();
  const porHora = Array.from({ length: 24 }, () => 0);
  for (const h of horas.results) porHora[h.hora] = h.tokens;

  return {
    groqConfigurado: Boolean(env.GROQ_API_KEY),
    workersAiConectado: Boolean(env.AI),
    hoje: totais,
    porModelo,
    porHora,
    modeloPrincipal: principal.nome,
    pedidosRestantes: limites?.pedidosRestantes ?? null,
    pedidosLimite: limites?.pedidosLimite ?? null,
    limitesEm: limites?.em ?? null,
  };
}

// Faz um pedido mínimo e real a cada modelo. Gasta um pouco da cota, por isso só roda ao clicar.
export async function testarModelos(env) {
  const saida = [];
  for (const modelo of MODELOS) {
    const disponivel = modelosDisponiveis(env).includes(modelo);
    if (!disponivel) {
      saida.push({
        nome: modelo.nome,
        ok: false,
        detalhe: modelo.provedor === 'groq' ? 'falta a chave GROQ_API_KEY' : 'falta conectar o Workers AI',
      });
      continue;
    }
    const inicio = Date.now();
    try {
      await chamarModelo(env, modelo, { messages: [{ role: 'user', content: 'Responda apenas: ok' }], maxTokens: 40 });
      saida.push({ nome: modelo.nome, ok: true, detalhe: `${Date.now() - inicio} ms` });
    } catch (e) {
      if (!(e instanceof FalhaDeModelo)) throw e;
      saida.push({ nome: modelo.nome, ok: false, detalhe: e.message });
    }
  }
  return saida;
}
