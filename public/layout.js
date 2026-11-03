// Personalização da tela: quais cartões aparecem e o tamanho deles. Fica guardada só neste navegador.
const CHAVE = 'jarvis-layout';
const NOMES = {
  sistema: 'Sistema', voz: 'Voz', anotacoes: 'Anotações', modelos: 'Modelos', uso: 'Tokens',
  modulos: 'Módulos', radio: 'Rádios', planeta: 'Planeta',
};
const LARGURA_MIN = 220, LARGURA_MAX = 640, ALTURA_MIN = 90;

function ler() {
  try { return JSON.parse(localStorage.getItem(CHAVE)) ?? {}; } catch { return {}; }
}
function salvar(estado) {
  try { localStorage.setItem(CHAVE, JSON.stringify(estado)); } catch { /* vale só nesta sessão */ }
}

export function limitar(valor, minimo, maximo) {
  return Math.max(minimo, Math.min(maximo, valor));
}

export function iniciarLayout({ aoMudar }) {
  const geral = document.getElementById('tela-painel');
  const barra = document.getElementById('barra-cartoes');
  const cartoes = [...document.querySelectorAll('[data-cartao]')];
  const colunas = { esq: document.getElementById('coluna-esquerda'), dir: document.getElementById('coluna-direita') };
  let estado = { ocultos: [], alturas: {}, larguras: {}, ...ler() };

  function aplicar() {
    for (const cartao of cartoes) {
      const id = cartao.dataset.cartao;
      cartao.hidden = estado.ocultos.includes(id);
      const altura = estado.alturas[id];
      cartao.classList.toggle('com-altura', Boolean(altura));
      if (altura) cartao.style.height = `${altura}px`;
      else cartao.style.removeProperty('height');
    }
    for (const [lado, coluna] of Object.entries(colunas)) {
      const visiveis = [...coluna.querySelectorAll('[data-cartao]')].some((c) => !c.hidden);
      coluna.classList.toggle('coluna-vazia', !visiveis);
      const largura = visiveis ? `${estado.larguras[lado] ?? 300}px` : '0px';
      geral.style.setProperty(lado === 'esq' ? '--largura-esq' : '--largura-dir', largura);
    }
    for (const botao of barra.querySelectorAll('[data-alvo]')) {
      botao.setAttribute('aria-pressed', String(!estado.ocultos.includes(botao.dataset.alvo)));
    }
    salvar(estado);
    aoMudar();
  }

  function alternar(id) {
    estado.ocultos = estado.ocultos.includes(id) ? estado.ocultos.filter((c) => c !== id) : [...estado.ocultos, id];
    aplicar();
  }

  barra.replaceChildren(...cartoes.map((cartao) => {
    const id = cartao.dataset.cartao;
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.dataset.alvo = id;
    botao.textContent = NOMES[id];
    botao.addEventListener('click', () => alternar(id));
    return botao;
  }));
  const restaurar = document.createElement('button');
  restaurar.type = 'button';
  restaurar.className = 'restaurar';
  restaurar.textContent = 'Restaurar tela';
  restaurar.addEventListener('click', () => {
    estado = { ocultos: [], alturas: {}, larguras: {} };
    aplicar();
  });
  barra.append(restaurar);

  function arrastar(alvo, aoMover, aoFim) {
    alvo.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      alvo.setPointerCapture(e.pointerId);
      const mover = (m) => aoMover(m.clientX - e.clientX, m.clientY - e.clientY);
      const soltar = () => {
        alvo.removeEventListener('pointermove', mover);
        alvo.removeEventListener('pointerup', soltar);
        alvo.removeEventListener('pointercancel', soltar);
        aoFim();
      };
      alvo.addEventListener('pointermove', mover);
      alvo.addEventListener('pointerup', soltar);
      alvo.addEventListener('pointercancel', soltar);
    });
  }

  for (const cartao of cartoes) {
    const id = cartao.dataset.cartao;
    const fechar = document.createElement('button');
    fechar.type = 'button';
    fechar.className = 'fechar-cartao';
    fechar.textContent = '×';
    fechar.setAttribute('aria-label', `Esconder ${NOMES[id]}`);
    fechar.addEventListener('click', () => alternar(id));
    const puxador = document.createElement('div');
    puxador.className = 'puxador-altura';
    puxador.tabIndex = 0;
    puxador.setAttribute('role', 'separator');
    puxador.setAttribute('aria-orientation', 'horizontal');
    puxador.setAttribute('aria-label', `Altura de ${NOMES[id]}. Use as setas para cima e para baixo.`);
    let inicial = 0;
    puxador.addEventListener('pointerdown', () => { inicial = cartao.getBoundingClientRect().height; }, true);
    arrastar(puxador, (_, dy) => {
      estado.alturas[id] = Math.round(limitar(inicial + dy, ALTURA_MIN, innerHeight * .9));
      cartao.classList.add('com-altura');
      cartao.style.height = `${estado.alturas[id]}px`;
    }, aplicar);
    puxador.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const atual = cartao.getBoundingClientRect().height;
      estado.alturas[id] = Math.round(limitar(atual + (e.key === 'ArrowUp' ? -20 : 20), ALTURA_MIN, innerHeight * .9));
      aplicar();
    });
    cartao.append(fechar, puxador);
  }

  for (const [lado, coluna] of Object.entries(colunas)) {
    const sinal = lado === 'esq' ? 1 : -1;
    const puxador = document.createElement('div');
    puxador.className = 'puxador-coluna';
    puxador.tabIndex = 0;
    puxador.setAttribute('role', 'separator');
    puxador.setAttribute('aria-orientation', 'vertical');
    puxador.setAttribute('aria-label', 'Largura da coluna. Use as setas para os lados.');
    let inicial = 0;
    puxador.addEventListener('pointerdown', () => { inicial = coluna.getBoundingClientRect().width; }, true);
    arrastar(puxador, (dx) => {
      estado.larguras[lado] = Math.round(limitar(inicial + dx * sinal, LARGURA_MIN, LARGURA_MAX));
      geral.style.setProperty(lado === 'esq' ? '--largura-esq' : '--largura-dir', `${estado.larguras[lado]}px`);
    }, aplicar);
    puxador.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const delta = (e.key === 'ArrowRight' ? 20 : -20) * sinal;
      estado.larguras[lado] = Math.round(limitar((estado.larguras[lado] ?? 300) + delta, LARGURA_MIN, LARGURA_MAX));
      aplicar();
    });
    coluna.prepend(puxador);
  }

  aplicar();
}
