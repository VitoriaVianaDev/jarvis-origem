import { criarNucleo } from './nucleo.js';

const $ = (id) => document.getElementById(id);
const TELAS = ['tela-carregando', 'tela-ajuste', 'tela-entrar', 'tela-painel'];
const FUSO = 'America/Sao_Paulo';
const NOMES_ESTADO = {
  espera: 'Em espera', ouvindo: 'Ouvindo', processando: 'Processando',
  respondendo: 'Respondendo', executando: 'Executando tarefa',
};

let telaAtual = 'tela-carregando';

const canvas = $('nucleo');
const nucleo = criarNucleo(canvas, {
  centro() {
    const larga = innerWidth > 1080;
    if (telaAtual === 'tela-painel') {
      const janela = document.querySelector('.janela-nucleo').getBoundingClientRect();
      const base = canvas.getBoundingClientRect();
      const y = janela.top - base.top + janela.height / 2;
      const raio = Math.min(janela.width * .235, janela.height * .235);
      return { x: janela.left - base.left + janela.width / 2, y, raio: Math.max(raio, 58) };
    }
    const y = larga ? innerHeight * .38 : 300;
    return { x: innerWidth / 2, y, raio: Math.min(innerWidth * .24, innerHeight * .17, 170) };
  },
});

function mostrar(tela) {
  telaAtual = tela;
  for (const id of TELAS) $(id).hidden = id !== tela;
  nucleo.reposicionar();
}

async function api(caminho, opcoes = {}) {
  const { corpo, metodo = 'GET' } = opcoes;
  let resposta;
  try {
    resposta = await fetch(caminho, {
      method: metodo,
      credentials: 'same-origin',
      headers: corpo === undefined ? {} : { 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    throw Object.assign(new Error('Sem conexão com o servidor. Verifique sua internet.'), { codigo: 'sem_conexao' });
  }
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    const e = dados?.erro ?? { codigo: 'resposta_invalida', mensagem: `O servidor respondeu com erro ${resposta.status}.` };
    throw Object.assign(new Error(e.mensagem), { codigo: e.codigo });
  }
  return dados;
}

function tratarSessaoExpirada(erro) {
  if (erro.codigo === 'nao_autenticado') {
    mostrar('tela-entrar');
    return true;
  }
  return false;
}

// Relógio
const formatoHora = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', second: '2-digit' });
const formatoData = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, weekday: 'long', day: 'numeric', month: 'long' });
const formatoCurto = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function atualizarRelogio() {
  const agora = new Date();
  $('hora').textContent = formatoHora.format(agora);
  const [h, m, s] = formatoHora.format(agora).split(':').map(Number);
  nucleo.definirDados({ dia: (h * 3600 + m * 60 + s) / 86400 });
  $('data').textContent = formatoData.format(agora);
}

// Diagnóstico
let resultadoTesteIa = null;

function linhaDiagnostico(rotulo, valor, classe) {
  const div = document.createElement('div');
  const dt = document.createElement('dt');
  const dd = document.createElement('dd');
  dt.textContent = rotulo;
  dd.textContent = valor;
  if (classe) dd.className = classe;
  div.append(dt, dd);
  return div;
}

function desenharModelos(modelos) {
  $('lista-modelos').replaceChildren(...modelos.map((m) => {
    const teste = resultadoTesteIa?.find((r) => r.nome === m.nome);
    const li = document.createElement('li');
    const cabeca = document.createElement('div');
    cabeca.className = 'modelo-cabeca';
    const nome = document.createElement('span');
    nome.textContent = m.nome;
    const contagem = document.createElement('span');
    contagem.className = 'modelo-contagem';
    contagem.textContent = m.falhas ? `${m.pedidos} ok, ${m.falhas} com falha` : `${m.pedidos} ok`;
    cabeca.append(nome, contagem);
    li.append(cabeca);
    const aviso = !m.disponivel ? 'Não configurado' : teste ? (teste.ok ? `Teste: respondeu em ${teste.detalhe}` : `Teste: ${teste.detalhe}`) : m.ultimaFalha ? `Última falha: ${m.ultimaFalha}` : '';
    if (aviso) {
      const detalhe = document.createElement('p');
      detalhe.className = `modelo-detalhe ${teste?.ok ? 'certo' : 'falha'}`;
      detalhe.textContent = aviso;
      li.append(detalhe);
    }
    return li;
  }));
}

function desenharUso(porHora) {
  const NS = 'http://www.w3.org/2000/svg';
  const maior = Math.max(...porHora);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 264 76');
  svg.setAttribute('role', 'img');
  const total = porHora.reduce((a, b) => a + b, 0);
  svg.setAttribute('aria-label', maior
    ? `${total} tokens hoje; maior consumo às ${porHora.indexOf(maior)} horas, com ${maior} tokens.`
    : 'Nenhum consumo de IA hoje.');
  const linhaBase = document.createElementNS(NS, 'line');
  for (const [k, v] of Object.entries({ x1: 0, x2: 264, y1: 58.5, y2: 58.5, class: 'uso-base' })) linhaBase.setAttribute(k, v);
  svg.append(linhaBase);
  porHora.forEach((tokens, hora) => {
    const altura = maior ? Math.max(tokens ? 3 : 0, (tokens / maior) * 54) : 0;
    const grupo = document.createElementNS(NS, 'g');
    const titulo = document.createElementNS(NS, 'title');
    titulo.textContent = `${hora}h: ${tokens.toLocaleString('pt-BR')} tokens`;
    const alvo = document.createElementNS(NS, 'rect');
    for (const [k, v] of Object.entries({ x: hora * 11, y: 0, width: 11, height: 58, fill: 'transparent' })) alvo.setAttribute(k, v);
    const barra = document.createElementNS(NS, 'rect');
    for (const [k, v] of Object.entries({ x: hora * 11 + 2, y: 58 - altura, width: 7, height: altura, rx: 1.5, class: 'uso-barra' })) barra.setAttribute(k, v);
    grupo.append(titulo, alvo, barra);
    svg.append(grupo);
    if (hora % 6 === 0) {
      const rotulo = document.createElementNS(NS, 'text');
      for (const [k, v] of Object.entries({ x: hora * 11 + 5.5, y: 72, 'text-anchor': 'middle', class: 'uso-rotulo' })) rotulo.setAttribute(k, v);
      rotulo.textContent = `${hora}h`;
      svg.append(rotulo);
    }
  });
  $('grafico-uso').replaceChildren(svg);
}

async function verificar() {
  const botao = $('verificar');
  botao.disabled = true;
  botao.textContent = 'Verificando…';
  $('erro-diagnostico').textContent = '';
  try {
    const d = await api('/api/diagnostico');
    $('diagnostico').replaceChildren(
      linhaDiagnostico('Banco de dados', d.banco.gravouELeu ? 'Gravou e leu' : 'Falhou', d.banco.gravouELeu ? 'certo' : 'falha'),
      linhaDiagnostico('Tempo do teste', `${d.banco.milissegundos} ms`),
      linhaDiagnostico('Anotações guardadas', String(d.anotacoes)),
      linhaDiagnostico('Sessão expira em', formatoCurto.format(d.sessaoExpiraEm)),
      linhaDiagnostico('Verificado às', formatoHora.format(d.verificadoEm)),
    );
    $('diagnostico').append(
      linhaDiagnostico('Chave da Groq', d.ia.groqConfigurado ? 'Configurada' : 'Falta configurar', d.ia.groqConfigurado ? 'certo' : 'falha'),
      linhaDiagnostico('IA reserva', d.ia.workersAiConectado ? 'Conectada' : 'Falta conectar', d.ia.workersAiConectado ? 'certo' : 'falha'),
    );
    if (d.ia.pedidosRestantes) {
      $('diagnostico').append(linhaDiagnostico(`Cota ${d.ia.modeloPrincipal}`, `${d.ia.pedidosRestantes} de ${d.ia.pedidosLimite}`));
      nucleo.definirDados({ cota: Number(d.ia.pedidosRestantes) / Number(d.ia.pedidosLimite) });
    }
    $('leitura-banco').textContent = d.banco.gravouELeu ? `${d.banco.milissegundos} ms` : 'Falhou';
    $('leitura-pedidos').textContent = String(d.ia.hoje.pedidos);
    $('leitura-tokens').textContent = d.ia.hoje.tokens.toLocaleString('pt-BR');
    desenharModelos(d.ia.porModelo);
    desenharUso(d.ia.porHora);
  } catch (e) {
    if (!tratarSessaoExpirada(e)) {
      $('diagnostico').replaceChildren(linhaDiagnostico('Banco de dados', 'Falhou', 'falha'));
      $('erro-diagnostico').textContent = e.message;
    }
  } finally {
    botao.disabled = false;
    botao.textContent = 'Verificar agora';
  }
}

// Anotações
function itemAnotacao(anotacao) {
  const li = document.createElement('li');
  const texto = document.createElement('p');
  texto.className = 'anotacao-texto';
  texto.textContent = anotacao.texto;
  const rodape = document.createElement('div');
  rodape.className = 'anotacao-rodape';
  const data = document.createElement('span');
  data.textContent = formatoCurto.format(anotacao.criada_em);
  const excluir = document.createElement('button');
  excluir.type = 'button';
  excluir.className = 'botao-discreto';
  excluir.textContent = 'Excluir';
  let confirmando = false;
  excluir.addEventListener('click', async () => {
    if (!confirmando) {
      confirmando = true;
      excluir.textContent = 'Confirmar exclusão';
      return;
    }
    excluir.disabled = true;
    $('erro-anotacao').textContent = '';
    try {
      await api(`/api/anotacoes/${anotacao.id}`, { metodo: 'DELETE' });
      await carregarAnotacoes();
      verificar();
    } catch (e) {
      excluir.disabled = false;
      if (!tratarSessaoExpirada(e)) $('erro-anotacao').textContent = e.message;
    }
  });
  rodape.append(data, excluir);
  li.append(texto, rodape);
  return li;
}

async function carregarAnotacoes() {
  try {
    const { anotacoes } = await api('/api/anotacoes');
    $('lista-anotacoes').replaceChildren(...anotacoes.map(itemAnotacao));
    $('sem-anotacoes').hidden = anotacoes.length > 0;
  } catch (e) {
    if (!tratarSessaoExpirada(e)) $('erro-anotacao').textContent = e.message;
  }
}

$('form-anotacao').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const botao = evento.submitter;
  botao.disabled = true;
  $('erro-anotacao').textContent = '';
  try {
    await api('/api/anotacoes', { metodo: 'POST', corpo: { texto: $('anotacao').value } });
    $('anotacao').value = '';
    await carregarAnotacoes();
    verificar();
  } catch (e) {
    if (!tratarSessaoExpirada(e)) $('erro-anotacao').textContent = e.message;
  } finally {
    botao.disabled = false;
  }
});

// Entrada e saída
$('form-entrar').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const botao = evento.submitter;
  $('erro-entrar').textContent = '';
  if (!$('senha').value) {
    $('erro-entrar').textContent = 'Digite sua senha.';
    return;
  }
  botao.disabled = true;
  try {
    await api('/api/entrar', { metodo: 'POST', corpo: { senha: $('senha').value } });
    $('senha').value = '';
    abrirPainel();
  } catch (e) {
    $('erro-entrar').textContent = e.message;
    $('senha').select();
  } finally {
    botao.disabled = false;
  }
});

$('sair').addEventListener('click', async () => {
  try {
    await api('/api/sair', { metodo: 'POST' });
  } catch (e) {
    if (e.codigo !== 'nao_autenticado') return;
  }
  definirEstado('espera');
  modoConversa(false);
  $('historico').replaceChildren();
  mostrar('tela-entrar');
});

$('verificar').addEventListener('click', verificar);

// Conversa
let conversando = false;
let temporizadorEstado = 0;

function definirEstado(nome) {
  clearTimeout(temporizadorEstado);
  nucleo.definirEstado(nome);
  $('estado-nome').textContent = NOMES_ESTADO[nome];
}

function modoConversa(ativo) {
  const mudou = $('centro').classList.contains('com-conversa') !== ativo;
  $('centro').classList.toggle('com-conversa', ativo);
  $('historico').hidden = !ativo;
  $('nova-conversa').hidden = !ativo;
  if (mudou) nucleo.reposicionar();
}

function adicionarFala(mensagem) {
  const fala = document.createElement('div');
  fala.className = `fala ${mensagem.papel === 'user' ? 'fala-usuario' : 'fala-jarvis'}`;
  const texto = document.createElement('p');
  texto.textContent = mensagem.conteudo;
  fala.append(texto);
  if (mensagem.papel !== 'user') {
    const detalhes = document.createElement('div');
    detalhes.className = 'fala-detalhes';
    for (const acao of mensagem.acoes ?? []) {
      const item = document.createElement('span');
      item.className = 'fala-acao';
      item.textContent = acao.descricao;
      detalhes.append(item);
    }
    if (mensagem.modelo) {
      const modelo = document.createElement('span');
      modelo.textContent = mensagem.modelo;
      detalhes.append(modelo);
    }
    fala.append(detalhes);
  }
  $('historico').append(fala);
  $('historico').scrollTop = $('historico').scrollHeight;
  return fala;
}

function ajustarCampo() {
  const campo = $('mensagem');
  campo.style.height = 'auto';
  const altura = Math.min(campo.scrollHeight, 140);
  campo.style.height = `${altura}px`;
  campo.style.overflowY = campo.scrollHeight > 140 ? 'auto' : 'hidden';
}

async function carregarConversa() {
  try {
    const { mensagens } = await api('/api/conversa');
    $('historico').replaceChildren();
    modoConversa(mensagens.length > 0);
    mensagens.forEach(adicionarFala);
  } catch (e) {
    if (!tratarSessaoExpirada(e)) $('erro-conversa').textContent = e.message;
  }
}

async function lerEventos(resposta, aoReceber) {
  const leitor = resposta.body.getReader();
  const decodificador = new TextDecoder();
  let pendente = '';
  while (true) {
    const { done, value } = await leitor.read();
    if (done) break;
    pendente += decodificador.decode(value, { stream: true });
    const linhas = pendente.split('\n');
    pendente = linhas.pop();
    for (const linha of linhas) if (linha.trim()) await aoReceber(JSON.parse(linha));
  }
}

async function enviarMensagem() {
  const campo = $('mensagem');
  const texto = campo.value.trim();
  if (!texto || conversando) return;
  conversando = true;
  $('enviar').disabled = true;
  $('erro-conversa').textContent = '';
  modoConversa(true);
  const falaUsuario = adicionarFala({ papel: 'user', conteudo: texto });
  campo.value = '';
  ajustarCampo();
  definirEstado('processando');

  let final = null;
  let falha = null;
  try {
    const resposta = await fetch('/api/conversa', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto }),
    });
    if (!resposta.ok) {
      const dados = await resposta.json().catch(() => null);
      throw Object.assign(new Error(dados?.erro?.mensagem ?? `O servidor respondeu com erro ${resposta.status}.`), {
        codigo: dados?.erro?.codigo,
      });
    }
    // A ação costuma levar milissegundos: o estado fica visível por tempo suficiente para ser notado.
    let liberarEm = 0;
    await lerEventos(resposta, async (evento) => {
      const espera = liberarEm - Date.now();
      if (espera > 0) await new Promise((r) => setTimeout(r, espera));
      if (evento.tipo === 'estado') {
        definirEstado(evento.estado);
        if (evento.estado === 'executando') liberarEm = Date.now() + 900;
      }
      if (evento.tipo === 'resposta') final = evento.mensagem;
      if (evento.tipo === 'erro') falha = evento;
    });
    if (!final && !falha) falha = { mensagem: 'A conexão foi interrompida antes da resposta. Tente de novo.' };
  } catch (e) {
    falha = e.codigo ? e : { mensagem: e.message === 'Failed to fetch' ? 'Sem conexão com o servidor. Verifique sua internet.' : e.message };
  }

  conversando = false;
  $('enviar').disabled = false;
  if (final) {
    adicionarFala(final);
    definirEstado('respondendo');
    temporizadorEstado = setTimeout(() => definirEstado('espera'), Math.min(1500 + final.conteudo.length * 12, 6000));
    if (final.acoes.length) carregarAnotacoes();
  } else {
    definirEstado('espera');
    if (falha.acoes?.length) carregarAnotacoes();
    if (!tratarSessaoExpirada(falha)) {
      // A fala não foi salva: ela volta ao campo para uma nova tentativa.
      falaUsuario.remove();
      if ($('historico').childElementCount === 0) modoConversa(false);
      campo.value = texto;
      ajustarCampo();
      $('erro-conversa').textContent = falha.mensagem;
    }
  }
  verificar();
  campo.focus();
}

$('form-conversa').addEventListener('submit', (evento) => {
  evento.preventDefault();
  enviarMensagem();
});
$('mensagem').addEventListener('input', ajustarCampo);
$('mensagem').addEventListener('keydown', (evento) => {
  if (evento.key === 'Enter' && !evento.shiftKey && !evento.isComposing) {
    evento.preventDefault();
    enviarMensagem();
  }
});
$('nova-conversa').addEventListener('click', async () => {
  if (conversando) return;
  try {
    await api('/api/conversa/nova', { metodo: 'POST' });
    $('historico').replaceChildren();
    $('erro-conversa').textContent = '';
    modoConversa(false);
    definirEstado('espera');
    $('mensagem').focus();
  } catch (e) {
    if (!tratarSessaoExpirada(e)) $('erro-conversa').textContent = e.message;
  }
});

$('testar-ia').addEventListener('click', async () => {
  const botao = $('testar-ia');
  botao.disabled = true;
  botao.textContent = 'Testando…';
  try {
    const { modelos } = await api('/api/diagnostico/ia', { metodo: 'POST' });
    resultadoTesteIa = modelos;
    await verificar();
  } catch (e) {
    if (!tratarSessaoExpirada(e)) $('erro-diagnostico').textContent = e.message;
  } finally {
    botao.disabled = false;
    botao.textContent = 'Testar IA';
  }
});

function abrirPainel() {
  mostrar('tela-painel');
  atualizarRelogio();
  carregarAnotacoes();
  carregarConversa();
  verificar();
}

setInterval(atualizarRelogio, 1000);

async function iniciar() {
  let estado;
  try {
    estado = await api('/api/estado');
  } catch (e) {
    document.querySelector('#tela-carregando .aviso-entrada').textContent = e.message;
    return;
  }
  if (!estado.senhaConfigurada || !estado.bancoConectado) {
    $('ajuste-minimo').textContent = estado.tamanhoMinimoSenha;
    $('ajuste-senha').hidden = estado.senhaConfigurada;
    $('ajuste-banco').hidden = estado.bancoConectado;
    mostrar('tela-ajuste');
    return;
  }
  if (estado.autenticado) abrirPainel();
  else mostrar('tela-entrar');
}

iniciar();
