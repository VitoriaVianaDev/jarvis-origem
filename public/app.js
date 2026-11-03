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
      const raio = Math.min(janela.width * (larga ? .3 : .3), janela.height * .34);
      return { x: janela.left - base.left + janela.width / 2, y, raio: Math.max(raio, 90) };
    }
    const y = larga ? innerHeight * .38 : 300;
    return { x: innerWidth / 2, y, raio: Math.min(innerWidth * .28, innerHeight * .2, 190) };
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
  $('data').textContent = formatoData.format(agora);
}

// Diagnóstico
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
  nucleo.definirEstado('espera');
  mostrar('tela-entrar');
});

$('verificar').addEventListener('click', verificar);

for (const opcao of document.querySelectorAll('input[name="estado"]')) {
  opcao.addEventListener('change', () => {
    nucleo.definirEstado(opcao.value);
    $('estado-nome').textContent = NOMES_ESTADO[opcao.value];
  });
}

function abrirPainel() {
  mostrar('tela-painel');
  atualizarRelogio();
  carregarAnotacoes();
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
