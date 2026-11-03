import { criarNucleo } from './nucleo.js';
import { criarPlaneta } from './globo.js';
import { carregarMapa } from './planeta.js';
import { iniciarRadio } from './radio.js';
import { criarEscuta, criarVoz } from './voz.js';

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
      const janela = $('janela-nucleo').getBoundingClientRect();
      const base = canvas.getBoundingClientRect();
      const raio = Math.min(janela.width * .3, janela.height * .32);
      return { x: janela.left - base.left + janela.width / 2, y: janela.top - base.top + janela.height / 2, raio: Math.max(raio, 58) };
    }
    const y = larga ? innerHeight * .36 : 280;
    return { x: innerWidth / 2, y, raio: Math.min(innerWidth * .24, innerHeight * .17, 170) };
  },
});
const planeta = criarPlaneta($('planeta'));
let mapaFalhou = false;
carregarMapa().then((mapa) => planeta.definirMapa(mapa)).catch((e) => {
  console.error('Mapa', e);
  mapaFalhou = true;
});
let radioIniciado = false;
let controleRadio = null;

function expandirPlaneta(ativo) {
  $('planeta-cartao').classList.toggle('expandido', ativo);
  $('planeta-fechar').hidden = !ativo;
  $('planeta-abrir').hidden = ativo;
  planeta.expandir(ativo);
  if (ativo) $('planeta-fechar').focus();
  else $('planeta-abrir').focus();
}
$('planeta-abrir').addEventListener('click', () => expandirPlaneta(true));
$('planeta-fechar').addEventListener('click', () => expandirPlaneta(false));
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('planeta-cartao').classList.contains('expandido')) expandirPlaneta(false);
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

function desenharMedidor(fracao, modelo) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 80 80');
  svg.setAttribute('aria-hidden', 'true');
  const anel = (raio, classe, extra = {}) => {
    const c = document.createElementNS(NS, 'circle');
    for (const [k, v] of Object.entries({ cx: 40, cy: 40, r: raio, class: classe, ...extra })) c.setAttribute(k, v);
    svg.append(c);
  };
  const volta = 2 * Math.PI * 32;
  anel(37, 'medidor-externo', { 'stroke-dasharray': '1.5 3.3' });
  anel(32, 'medidor-trilha');
  anel(32, 'medidor-valor', { 'stroke-dasharray': `${volta * fracao} ${volta}`, transform: 'rotate(-90 40 40)' });
  const numero = document.createElementNS(NS, 'text');
  for (const [k, v] of Object.entries({ x: 40, y: 45, 'text-anchor': 'middle', class: 'medidor-numero' })) numero.setAttribute(k, v);
  numero.textContent = `${Math.round(fracao * 100)}%`;
  svg.append(numero);
  const legenda = document.createElement('p');
  legenda.textContent = `Cota restante hoje de ${modelo}`;
  $('medidor-cota').replaceChildren(svg, legenda);
  $('medidor-cota').hidden = false;
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
      desenharMedidor(Number(d.ia.pedidosRestantes) / Number(d.ia.pedidosLimite), d.ia.modeloPrincipal);
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
  voz.calar();
  await escuta.desligar();
  concluirFala();
  legenda('');
  mostrar('tela-entrar');
});

$('verificar').addEventListener('click', verificar);

// Conversa por voz
let conversando = false;
let temporizadorLegenda = 0;
const NOME_BOTAO = 'Falar com o JARVIS';

function definirEstado(nome) {
  nucleo.definirEstado(nome);
  $('estado-nome').textContent = NOMES_ESTADO[nome];
}

// Uma linha passageira, sem histórico na tela: o que foi ouvido, o que ele respondeu ou o erro.
function legenda(texto, { erro = false, sumir = 0 } = {}) {
  clearTimeout(temporizadorLegenda);
  $('legenda').textContent = texto;
  $('legenda').classList.toggle('erro', erro);
  if (sumir) temporizadorLegenda = setTimeout(() => { $('legenda').textContent = ''; }, sumir);
}

function concluirFala() {
  definirEstado('espera');
  $('falar').textContent = NOME_BOTAO;
  controleRadio?.abaixar(false);
  atualizarDica();
  if (escuta?.ligada()) escuta.retomar();
}

function atualizarDica() {
  $('dica-escuta').textContent = escuta?.ligada() ? 'Diga: Ei, Jarvis' : 'Pronto para comandos';
}

const voz = criarVoz({
  aoOuvirParcial: (texto) => legenda(texto),
  aoOuvir: (texto) => enviarMensagem(texto),
  aoFalhar: (mensagem) => {
    concluirFala();
    legenda(mensagem, { erro: true });
  },
  aoTerminarSemFala: () => {
    concluirFala();
    legenda('');
  },
});

function preencherVozes() {
  const lista = voz.vozes();
  $('voz-escolha').replaceChildren(...lista.map((v) => {
    const opcao = document.createElement('option');
    opcao.value = v.voiceURI;
    opcao.textContent = `${v.name} (${v.lang})`;
    return opcao;
  }));
  const atual = voz.vozAtual();
  if (atual) $('voz-escolha').value = atual.voiceURI;
  $('voz-escolha').disabled = !lista.length;
  $('voz-aviso').textContent = !lista.length
    ? 'O navegador não informou vozes em português.'
    : voz.temVozMasculina() ? '' : 'Não encontrei voz masculina em português neste computador.';
}
const escuta = criarEscuta({
  aoChamar: () => {
    voz.calar();
    controleRadio?.abaixar(true);
    definirEstado('ouvindo');
    $('dica-escuta').textContent = 'Estou ouvindo';
    legenda('Pode falar…');
  },
  aoParcial: (texto) => legenda(texto),
  aoComando: (texto) => enviarMensagem(texto),
  aoDesistir: () => {
    concluirFala();
    legenda('');
  },
  aoFalhar: (mensagem) => {
    $('escuta-ligada').checked = false;
    salvarEscuta(false);
    concluirFala();
    legenda(mensagem, { erro: true });
  },
});

function salvarEscuta(ligada) {
  try { localStorage.setItem('jarvis-escuta', ligada ? '1' : '0'); } catch { /* vale só nesta sessão */ }
}
function escutaSalva() {
  try { return localStorage.getItem('jarvis-escuta') === '1'; } catch { return false; }
}
function ligarEscuta() {
  $('escuta-ligada').checked = true;
  salvarEscuta(true);
  escuta.ligar();
  atualizarDica();
}
$('escuta-ligada').addEventListener('change', async (e) => {
  if (e.target.checked) {
    if (!escuta.disponivel) {
      e.target.checked = false;
      legenda('Este navegador não reconhece voz. Abra o JARVIS no Google Chrome.', { erro: true });
      return;
    }
    ligarEscuta();
  } else {
    salvarEscuta(false);
    await escuta.desligar();
    concluirFala();
    legenda('');
  }
});

voz.aoMudarVozes(preencherVozes);
preencherVozes();
$('voz-escolha').addEventListener('change', (e) => voz.escolherVoz(e.target.value));
$('voz-exemplo').addEventListener('click', () => voz.falar('Às suas ordens. Todos os sistemas estão funcionando.', () => {}));

function aoResponder(texto) {
  definirEstado('respondendo');
  $('falar').textContent = 'Interromper e falar';
  legenda(texto);
  voz.falar(texto, () => {
    concluirFala();
    legenda(texto, { sumir: 5000 });
  });
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

async function enviarMensagem(texto) {
  if (conversando) return;
  conversando = true;
  $('falar').disabled = true;
  $('falar').textContent = 'Processando…';
  definirEstado('processando');
  legenda(texto);

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
      if (evento.tipo === 'estado' && evento.estado !== 'respondendo') {
        definirEstado(evento.estado);
        if (evento.estado === 'executando') liberarEm = Date.now() + 900;
      }
      if (evento.tipo === 'resposta') final = evento.mensagem;
      if (evento.tipo === 'erro') falha = evento;
    });
    if (!final && !falha) falha = { mensagem: 'A conexão caiu antes da resposta. Fale de novo.' };
  } catch (e) {
    falha = e.codigo ? e : { mensagem: e.message === 'Failed to fetch' ? 'Sem conexão com o servidor. Verifique sua internet.' : e.message };
  }

  conversando = false;
  $('falar').disabled = false;
  if (final) {
    if (final.acoes.length) carregarAnotacoes();
    aoResponder(final.conteudo);
  } else {
    if (falha.acoes?.length) carregarAnotacoes();
    concluirFala();
    if (!tratarSessaoExpirada(falha)) legenda(falha.mensagem, { erro: true });
  }
  verificar();
}

$('falar').addEventListener('click', async () => {
  if (conversando) return;
  if (voz.ouvindo()) {
    voz.pararDeOuvir();
    return;
  }
  await escuta.pausar();
  voz.calar();
  controleRadio?.abaixar(true);
  legenda('Pode falar…');
  definirEstado('ouvindo');
  $('falar').textContent = 'Ouvindo. Clique para encerrar';
  voz.ouvir();
});

$('nova-conversa').addEventListener('click', async () => {
  if (conversando) return;
  try {
    await api('/api/conversa/nova', { metodo: 'POST' });
    legenda('Nova conversa iniciada.', { sumir: 3000 });
  } catch (e) {
    if (!tratarSessaoExpirada(e)) legenda(e.message, { erro: true });
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
  verificar();
  if (escutaSalva() && escuta.disponivel && !escuta.ligada()) ligarEscuta();
  if (!radioIniciado) {
    radioIniciado = true;
    controleRadio = iniciarRadio(planeta, { mapaFalhou: () => mapaFalhou });
  }
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
