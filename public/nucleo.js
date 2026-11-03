// Núcleo holográfico desenhado em canvas: esfera de pontos, órbitas e efeitos por estado.
const ESTADOS = {
  espera:      { giro: .12, cor: [56, 190, 255],  brilho: .55, onda: 0,   orbita: .25, ondas: 0, varredura: 0, marcas: 0 },
  ouvindo:     { giro: .16, cor: [56, 225, 255],  brilho: .85, onda: .03, orbita: .35, ondas: 1, varredura: 0, marcas: 0 },
  processando: { giro: .85, cor: [120, 170, 255], brilho: .8,  onda: .012, orbita: 1.5, ondas: 0, varredura: 1, marcas: 0 },
  respondendo: { giro: .24, cor: [150, 240, 255], brilho: 1,   onda: .075, orbita: .5, ondas: 0, varredura: 0, marcas: 0 },
  executando:  { giro: .4,  cor: [95, 242, 189],  brilho: .85, onda: .018, orbita: .8, ondas: 0, varredura: 0, marcas: 1 },
};

const ORBITAS = [
  { rx: 1.42, ry: .42, inclinacao: -.32, fase: 0 },
  { rx: 1.3,  ry: .62, inclinacao: .62,  fase: 2.1 },
  { rx: 1.2,  ry: .3,  inclinacao: 1.32, fase: 4.2 },
];

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
  const pontos = criarPontos(1100);
  const p = { ...ESTADOS.espera, cor: [...ESTADOS.espera.cor] };
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

  const corCss = (a, cor = p.cor) => `rgba(${cor[0] | 0},${cor[1] | 0},${cor[2] | 0},${a})`;

  function desenhar() {
    ctx.clearRect(0, 0, largura, altura);
    ctx.globalCompositeOperation = 'lighter';

    const halo = ctx.createRadialGradient(cx, cy, R * .1, cx, cy, R * 1.5);
    halo.addColorStop(0, corCss(.3 * p.brilho));
    halo.addColorStop(.6, corCss(.09 * p.brilho));
    halo.addColorStop(1, corCss(0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.5, 0, 7);
    ctx.fill();

    // Anéis da base, como uma projeção vinda de baixo
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      ctx.strokeStyle = corCss(.3 - i * .06);
      ctx.beginPath();
      ctx.ellipse(cx, cy + R * 1.17, R * (.5 + i * .24), R * (.075 + i * .036), 0, 0, 7);
      ctx.stroke();
    }

    const senY = Math.sin(angulo), cosY = Math.cos(angulo);
    const inclinacao = -.38, senX = Math.sin(inclinacao), cosX = Math.cos(inclinacao);
    for (const [x0, y0, z0] of pontos) {
      const pulso = 1 + p.onda * Math.sin(y0 * 7 - tempo * 4.5);
      const x1 = x0 * cosY + z0 * senY;
      const z1 = -x0 * senY + z0 * cosY;
      const y2 = y0 * cosX - z1 * senX;
      const z2 = y0 * senX + z1 * cosX;
      const profundidade = (z2 + 1) / 2;
      const perspectiva = 1 + z2 * .18;
      const px = cx + x1 * R * pulso * perspectiva;
      const py = cy + y2 * R * pulso * perspectiva;
      const tamanho = .7 + profundidade * 1.25;
      ctx.fillStyle = corCss((.12 + profundidade * .78) * (.55 + p.brilho * .45));
      ctx.fillRect(px - tamanho / 2, py - tamanho / 2, tamanho, tamanho);
    }

    ctx.lineWidth = 1.1;
    for (const o of ORBITAS) {
      ctx.strokeStyle = corCss(.42);
      ctx.beginPath();
      ctx.ellipse(cx, cy, R * o.rx, R * o.ry, o.inclinacao, 0, 7);
      ctx.stroke();
      const a = faseOrbita + o.fase;
      const ex = Math.cos(a) * R * o.rx, ey = Math.sin(a) * R * o.ry;
      const c = Math.cos(o.inclinacao), s = Math.sin(o.inclinacao);
      const bx = cx + ex * c - ey * s, by = cy + ex * s + ey * c;
      const conta = ctx.createRadialGradient(bx, by, 0, bx, by, 9);
      conta.addColorStop(0, 'rgba(255,255,255,.95)');
      conta.addColorStop(.25, corCss(.75));
      conta.addColorStop(1, corCss(0));
      ctx.fillStyle = conta;
      ctx.beginPath();
      ctx.arc(bx, by, 9, 0, 7);
      ctx.fill();
    }

    if (p.ondas > .02) {
      for (let i = 0; i < 3; i++) {
        const f = (faseEfeito * .5 + i / 3) % 1;
        ctx.strokeStyle = corCss((1 - f) * .75 * p.ondas);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, R * (1.02 + f * .62), 0, 7);
        ctx.stroke();
      }
    }
    if (p.varredura > .02) {
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        const a = faseEfeito * (2.4 - i * .55) + i * 2.1;
        ctx.strokeStyle = corCss(.95 * p.varredura);
        ctx.beginPath();
        ctx.arc(cx, cy, R * (1.1 + i * .075), a, a + 1.05);
        ctx.stroke();
      }
    }
    if (p.marcas > .02) {
      const total = 72, ativa = Math.floor(faseEfeito * 11) % total;
      ctx.lineWidth = 2.5;
      for (let i = 0; i < total; i++) {
        const a = (i / total) * Math.PI * 2 - Math.PI / 2;
        const distancia = (ativa - i + total) % total;
        ctx.strokeStyle = corCss(p.marcas * Math.max(.16, 1 - distancia / 26));
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * R * 1.16, cy + Math.sin(a) * R * 1.16);
        ctx.lineTo(cx + Math.cos(a) * R * 1.24, cy + Math.sin(a) * R * 1.24);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function avancar(agora) {
    const dt = Math.min((agora - ultimo) / 1000 || 0, .05);
    ultimo = agora;
    const k = 1 - Math.exp(-dt * 4.5);
    for (const chave of ['giro', 'brilho', 'onda', 'orbita', 'ondas', 'varredura', 'marcas']) {
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
    reposicionar() { medir(); iniciar(); },
  };
}
