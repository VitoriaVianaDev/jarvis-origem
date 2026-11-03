// Núcleo holográfico em canvas: radar, esfera, anéis e efeitos por estado.
// Os dois arcos com rótulo mostram dados reais: a hora do dia e a cota restante de IA.
const CIANO = [58, 222, 235];
const LARANJA = [255, 140, 50];
const AZUL = [70, 170, 255];

const ESTADOS = {
  espera:      { giro: .1,  cor: CIANO,          brilho: .6,  onda: 0,    orbita: .16, ondas: 0, varredura: 0, marcas: 0, antenas: .35 },
  ouvindo:     { giro: .14, cor: [110, 240, 250], brilho: .9,  onda: .03,  orbita: .24, ondas: 1, varredura: 0, marcas: 0, antenas: .7 },
  processando: { giro: .75, cor: AZUL,           brilho: .8,  onda: .012, orbita: 1.1, ondas: 0, varredura: 1, marcas: 0, antenas: .5 },
  respondendo: { giro: .2,  cor: [150, 245, 250], brilho: 1,   onda: .07,  orbita: .35, ondas: 0, varredura: 0, marcas: 0, antenas: 1 },
  executando:  { giro: .4,  cor: LARANJA,        brilho: .9,  onda: .018, orbita: .7,  ondas: 0, varredura: 0, marcas: 1, antenas: 1 },
};

function criarPontos(n) {
  const pontos = [];
  const aureo = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const raio = Math.sqrt(1 - y * y);
    pontos.push([Math.cos(aureo * i) * raio, y, Math.sin(aureo * i) * raio]);
  }
  return pontos;
}

export function criarNucleo(canvas, { centro }) {
  const ctx = canvas.getContext('2d');
  const movimentoReduzido = matchMedia('(prefers-reduced-motion: reduce)');
  const pontos = criarPontos(1500);
  const antenas = pontos.filter((_, i) => i % 75 === 0);
  const p = { ...ESTADOS.espera, cor: [...ESTADOS.espera.cor] };
  const dados = { dia: null, cota: null };
  let alvo = ESTADOS.espera;
  let largura = 0, altura = 0, cx = 0, cy = 0, R = 0;
  let angulo = .4, faseOrbita = 0, faseEfeito = 0, tempo = 0, ultimo = 0, quadro = 0;

  function medir() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    largura = canvas.clientWidth;
    altura = canvas.clientHeight;
    canvas.width = Math.round(largura * dpr);
    canvas.height = Math.round(altura * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = centro();
    cx = c.x; cy = c.y; R = c.raio;
  }

  const cor = (a, c = p.cor) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const TOPO = -Math.PI / 2;

  function arco(raio, inicio, fim, espessura, estilo) {
    ctx.lineWidth = espessura;
    ctx.strokeStyle = estilo;
    ctx.beginPath();
    ctx.arc(cx, cy, raio, inicio, fim);
    ctx.stroke();
  }

  function radar() {
    // Fundo escuro do instrumento, com malha fina
    const raioMax = R * 1.72;
    const fundo = ctx.createRadialGradient(cx, cy, R * .4, cx, cy, raioMax);
    fundo.addColorStop(0, cor(.17 * p.brilho));
    fundo.addColorStop(.62, cor(.05 * p.brilho));
    fundo.addColorStop(1, cor(0));
    ctx.fillStyle = fundo;
    ctx.beginPath();
    ctx.arc(cx, cy, raioMax, 0, 7);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.46, 0, 7);
    ctx.clip();
    ctx.strokeStyle = cor(.07);
    ctx.lineWidth = 1;
    const passo = Math.max(R / 9, 9);
    ctx.beginPath();
    for (let x = cx - R * 1.5; x < cx + R * 1.5; x += passo) { ctx.moveTo(x, cy - R * 1.5); ctx.lineTo(x, cy + R * 1.5); }
    for (let y = cy - R * 1.5; y < cy + R * 1.5; y += passo) { ctx.moveTo(cx - R * 1.5, y); ctx.lineTo(cx + R * 1.5, y); }
    ctx.stroke();
    ctx.restore();

    // Anéis concêntricos
    for (const [r, a] of [[1.2, .32], [1.34, .16], [1.46, .42], [1.62, .22], [1.72, .5]]) arco(R * r, 0, 7, 1, cor(a));

    // Régua graduada externa
    for (let i = 0; i < 144; i++) {
      const a = (i / 144) * Math.PI * 2 + TOPO;
      const longa = i % 12 === 0;
      const r1 = R * 1.72, r2 = r1 + (longa ? R * .07 : R * .03);
      ctx.strokeStyle = cor(longa ? .75 : .32);
      ctx.lineWidth = longa ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.stroke();
    }

    // Segmentos grossos que giram devagar
    const gira = faseOrbita * .35;
    for (const [i, tam] of [[0, .5], [2.1, .28], [4.2, .4]]) arco(R * 1.54, gira + i, gira + i + tam, 4, cor(.65));
    arco(R * 1.54, -gira * 1.4 + 1, -gira * 1.4 + 1.14, 4, cor(.9, LARANJA));
    arco(R * 1.54, -gira * 1.4 + 3.9, -gira * 1.4 + 4, 4, cor(.9, LARANJA));

    // Anel tracejado interno
    ctx.save();
    ctx.setLineDash([2, 9]);
    ctx.lineDashOffset = -faseOrbita * 30;
    arco(R * 1.27, 0, 7, 1.5, cor(.55));
    ctx.restore();
  }

  function rotuloNoAnel(texto, angulo, raio) {
    const x = cx + Math.cos(angulo) * raio, y = cy + Math.sin(angulo) * raio;
    const direita = Math.cos(angulo) >= 0;
    ctx.font = '600 11.5px Inter, sans-serif';
    ctx.textAlign = direita ? 'left' : 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(220,247,250,.92)';
    ctx.fillText(texto, x + (direita ? 8 : -8), y);
  }

  function dadosReais() {
    ctx.globalCompositeOperation = 'source-over';
    const rotularCota = R > 100 && dados.cota !== null;
    if (dados.dia !== null) {
      const raio = R * 1.86;
      const fim = TOPO + dados.dia * Math.PI * 2;
      arco(raio, TOPO, fim, 2, cor(.9, LARANJA));
      ctx.fillStyle = cor(1, LARANJA);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(fim) * raio, cy + Math.sin(fim) * raio, 3.5, 0, 7);
      ctx.fill();
      if (R > 100) {
        // Perto do topo o rótulo fica fixo à direita, para não cobrir o da cota.
        const pertoDoTopo = dados.dia < .09 || dados.dia > .82;
        rotuloNoAnel('Hora do dia', pertoDoTopo ? TOPO + .62 : fim, R * 1.98);
      }
    }
    if (dados.cota !== null) {
      const raioCota = R * 1.94;
      arco(raioCota, 0, 7, 1, cor(.16, CIANO));
      arco(raioCota, TOPO, TOPO + dados.cota * Math.PI * 2, 1.5, cor(.7, CIANO));
      if (rotularCota) rotuloNoAnel(`Cota de IA ${Math.round(dados.cota * 100)}%`, TOPO - .62, R * 1.98);
    }
    ctx.globalCompositeOperation = 'lighter';
  }

  function projetar(ponto, senY, cosY, senX, cosX, escala) {
    const [x0, y0, z0] = ponto;
    const x1 = x0 * cosY + z0 * senY;
    const z1 = -x0 * senY + z0 * cosY;
    const y2 = y0 * cosX - z1 * senX;
    const z2 = y0 * senX + z1 * cosX;
    const perspectiva = 1 + z2 * .16;
    return { x: cx + x1 * escala * perspectiva, y: cy + y2 * escala * perspectiva, z: z2 };
  }

  function esfera() {
    const senY = Math.sin(angulo), cosY = Math.cos(angulo);
    const inclinacao = -.34, senX = Math.sin(inclinacao), cosX = Math.cos(inclinacao);

    const disco = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.02);
    disco.addColorStop(0, cor(.3 * p.brilho));
    disco.addColorStop(.75, cor(.14 * p.brilho));
    disco.addColorStop(1, cor(0));
    ctx.fillStyle = disco;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.02, 0, 7);
    ctx.fill();

    // Antenas de rastreio, como na referência
    ctx.lineWidth = 1;
    for (const ponto of antenas) {
      const base = projetar(ponto, senY, cosY, senX, cosX, R);
      if (base.z < -.1) continue;
      const ponta = projetar(ponto, senY, cosY, senX, cosX, R * (1 + .17 * p.antenas));
      ctx.strokeStyle = cor(.6 * p.antenas);
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(ponta.x, ponta.y);
      ctx.stroke();
      ctx.fillStyle = cor(.9 * p.antenas, LARANJA);
      ctx.fillRect(ponta.x - 1.5, ponta.y - 1.5, 3, 3);
    }

    for (const ponto of pontos) {
      const pulso = 1 + p.onda * Math.sin(ponto[1] * 7 - tempo * 4.5);
      const q = projetar(ponto, senY, cosY, senX, cosX, R * pulso);
      const profundidade = (q.z + 1) / 2;
      const tamanho = .7 + profundidade * 1.35;
      ctx.fillStyle = cor((.1 + profundidade * .8) * (.55 + p.brilho * .45));
      ctx.fillRect(q.x - tamanho / 2, q.y - tamanho / 2, tamanho, tamanho);
    }
  }

  function astros() {
    // Dois corpos em órbita, ligados por uma linha, como na referência
    const a1 = faseOrbita * .9 + 2.6, a2 = -faseOrbita * .55 + .7;
    const r1 = R * 1.34, r2 = R * 1.46;
    const x1 = cx + Math.cos(a1) * r1, y1 = cy + Math.sin(a1) * r1;
    const x2 = cx + Math.cos(a2) * r2, y2 = cy + Math.sin(a2) * r2;
    ctx.strokeStyle = 'rgba(235,250,252,.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    for (const [x, y, r, c] of [[x1, y1, Math.max(R * .085, 5), [235, 245, 245]], [x2, y2, Math.max(R * .05, 3.5), p.cor]]) {
      const luz = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
      luz.addColorStop(0, cor(.95, c));
      luz.addColorStop(.42, cor(.85, c));
      luz.addColorStop(.5, cor(.22, c));
      luz.addColorStop(1, cor(0, c));
      ctx.fillStyle = luz;
      ctx.beginPath();
      ctx.arc(x, y, r * 2.4, 0, 7);
      ctx.fill();
    }
  }

  function efeitos() {
    if (p.ondas > .02) {
      for (let i = 0; i < 3; i++) {
        const f = (faseEfeito * .5 + i / 3) % 1;
        arco(R * (1.04 + f * .66), 0, 7, 1.5, cor((1 - f) * .8 * p.ondas));
      }
    }
    if (p.varredura > .02) {
      const a = faseEfeito * 2.2;
      const passos = 26;
      for (let i = 0; i < passos; i++) {
        ctx.fillStyle = cor(((1 - i / passos) ** 2) * .3 * p.varredura);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R * 1.46, a - (i + 1) * .045, a - i * .045);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = cor(.95 * p.varredura);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * R * 1.46, cy + Math.sin(a) * R * 1.46);
      ctx.stroke();
    }
    if (p.marcas > .02) {
      const total = 72, ativa = Math.floor(faseEfeito * 14) % total;
      ctx.lineWidth = 3;
      for (let i = 0; i < total; i++) {
        const a = (i / total) * Math.PI * 2 + TOPO;
        const distancia = (ativa - i + total) % total;
        ctx.strokeStyle = cor(p.marcas * Math.max(.14, 1 - distancia / 24));
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * R * 1.1, cy + Math.sin(a) * R * 1.1);
        ctx.lineTo(cx + Math.cos(a) * R * 1.17, cy + Math.sin(a) * R * 1.17);
        ctx.stroke();
      }
    }
  }

  function desenhar() {
    ctx.clearRect(0, 0, largura, altura);
    ctx.globalCompositeOperation = 'lighter';
    radar();
    efeitos();
    esfera();
    astros();
    dadosReais();
    ctx.globalCompositeOperation = 'source-over';
  }

  function avancar(agora) {
    const dt = Math.min((agora - ultimo) / 1000 || 0, .05);
    ultimo = agora;
    const k = 1 - Math.exp(-dt * 4.5);
    for (const chave of ['giro', 'brilho', 'onda', 'orbita', 'ondas', 'varredura', 'marcas', 'antenas']) {
      p[chave] += (alvo[chave] - p[chave]) * k;
    }
    for (let i = 0; i < 3; i++) p.cor[i] += (alvo.cor[i] - p.cor[i]) * k;
    tempo += dt;
    angulo += p.giro * dt;
    faseOrbita += p.orbita * dt;
    faseEfeito += dt;
    desenhar();
    quadro = requestAnimationFrame(avancar);
  }

  function iniciar() {
    cancelAnimationFrame(quadro);
    if (movimentoReduzido.matches || document.hidden) {
      Object.assign(p, alvo, { cor: [...alvo.cor] });
      faseEfeito = 1.1;
      desenhar();
      return;
    }
    ultimo = performance.now();
    quadro = requestAnimationFrame(avancar);
  }

  addEventListener('resize', () => { medir(); iniciar(); });
  document.addEventListener('visibilitychange', iniciar);
  movimentoReduzido.addEventListener('change', iniciar);
  medir();
  iniciar();

  return {
    definirEstado(nome) {
      alvo = ESTADOS[nome] ?? ESTADOS.espera;
      if (movimentoReduzido.matches) iniciar();
    },
    definirDados(novos) {
      Object.assign(dados, novos);
      if (movimentoReduzido.matches) desenhar();
    },
    reposicionar() { medir(); iniciar(); },
  };
}
