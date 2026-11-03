// Núcleo do JARVIS: reator hexagonal. Tudo aqui é desenho; nenhum número é dado.
const AZUL = [46, 224, 238];
const LARANJA = [255, 140, 50];
const ESTADOS = {
  espera:      { giro: .12, cor: AZUL,            brilho: .8,  onda: 0, orbita: .18, ondas: 0, varredura: 0, marcas: 0 },
  ouvindo:     { giro: .2,  cor: [120, 245, 255], brilho: 1.15, onda: 0, orbita: .25, ondas: 1, varredura: 0, marcas: 0 },
  processando: { giro: 1,   cor: [80, 165, 255],  brilho: .95,  onda: 0, orbita: 1.2, ondas: 0, varredura: 1, marcas: 0 },
  respondendo: { giro: .3,  cor: [170, 250, 255], brilho: 1.3, onda: 1, orbita: .4, ondas: 0, varredura: 0, marcas: 0 },
  executando:  { giro: .55, cor: LARANJA,         brilho: 1.1, onda: 0, orbita: .8, ondas: 0, varredura: 0, marcas: 1 },
};
const TOPO = -Math.PI / 2;

export function criarNucleo(canvas, { centro }) {
  const ctx = canvas.getContext('2d');
  const reduzido = matchMedia('(prefers-reduced-motion: reduce)');
  const p = { ...ESTADOS.espera, cor: [...ESTADOS.espera.cor] };
  let alvo = ESTADOS.espera;
  let largura = 0, altura = 0, cx = 0, cy = 0, R = 0;
  let fase = 0, faseOrbita = 0, faseEfeito = 0, tempo = 0, ultimo = 0, quadro = 0;

  const cor = (a, c = p.cor) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

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

  function arco(raio, inicio, fim, espessura, estilo) {
    ctx.lineWidth = espessura;
    ctx.strokeStyle = estilo;
    ctx.beginPath();
    ctx.arc(cx, cy, raio, inicio, fim);
    ctx.stroke();
  }

  function hexagono(raio, giro, espessura, estilo) {
    ctx.lineWidth = espessura;
    ctx.strokeStyle = estilo;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * Math.PI * 2 + giro;
      const x = cx + Math.cos(a) * raio, y = cy + Math.sin(a) * raio;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function fundo() {
    const luz = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.6);
    luz.addColorStop(0, cor(.34 * p.brilho));
    luz.addColorStop(.45, cor(.1 * p.brilho));
    luz.addColorStop(1, cor(0));
    ctx.fillStyle = luz;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.6, 0, 7); ctx.fill();
  }

  function reator() {
    // Hexágonos do centro
    hexagono(R * .46, fase * .5 + Math.PI / 6, 2, cor(.55));
    hexagono(R * .36, -fase * .8, 1.5, cor(.8));
    ctx.fillStyle = cor(.1 * p.brilho);
    ctx.beginPath(); ctx.arc(cx, cy, R * .36, 0, 7); ctx.fill();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + fase * .5 + Math.PI / 6;
      ctx.strokeStyle = cor(.32);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R * .2, cy + Math.sin(a) * R * .2);
      ctx.lineTo(cx + Math.cos(a) * R * .46, cy + Math.sin(a) * R * .46);
      ctx.stroke();
    }

    // Núcleo de luz, que pulsa ao ouvir e ao falar
    const pulso = 1 + p.onda * .2 * Math.abs(Math.sin(tempo * 8)) + p.ondas * .08 * Math.sin(tempo * 4);
    const brilhoCentro = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * .27 * pulso);
    brilhoCentro.addColorStop(0, 'rgba(255,255,255,1)');
    brilhoCentro.addColorStop(.2, 'rgba(235,255,255,.95)');
    brilhoCentro.addColorStop(.42, cor(.85 * Math.min(p.brilho, 1)));
    brilhoCentro.addColorStop(1, cor(0));
    ctx.fillStyle = brilhoCentro;
    ctx.beginPath(); ctx.arc(cx, cy, R * .27 * pulso, 0, 7); ctx.fill();

    // Anéis segmentados girando em sentidos opostos
    const conjuntos = [
      [.58, 5, .78, 3, fase * .9, .85],
      [.7, 3, 1.25, 2, -fase * .6, .65],
      [.84, 7, .5, 3.5, fase * .4, .75],
      [.98, 4, 1, 2, -fase * .3, .55],
    ];
    for (const [r, n, tam, e, giro, a] of conjuntos) {
      for (let i = 0; i < n; i++) {
        const ini = giro + (i / n) * Math.PI * 2;
        arco(R * r, ini, ini + tam, e, cor(a));
      }
    }

    // Pontos que viajam nos anéis
    for (const [r, v, f] of [[.64, .9, 0], [.64, .9, 2.4], [.78, -.6, 1.1], [.91, .45, 3.6], [1.04, -.3, .4]]) {
      const a = fase * v + f;
      ctx.fillStyle = cor(1);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * R * r, cy + Math.sin(a) * R * r, Math.max(R * .014, 1.6), 0, 7);
      ctx.fill();
    }

    // Anéis finos e réguas graduadas
    for (const [r, a] of [[.52, .3], [1.1, .55], [1.24, .35], [1.38, .75]]) arco(R * r, 0, 7, 1, cor(a));
    for (const [r, n, tamLongo, tamCurto, passo, giro] of [[1.38, 120, .07, .03, 10, 0], [1.1, 72, .05, .022, 6, -fase * .12]]) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + TOPO + giro;
        const longa = i % passo === 0;
        ctx.strokeStyle = cor(longa ? .9 : .38);
        ctx.lineWidth = longa ? 1.6 : 1;
        const r1 = R * r, r2 = r1 + R * (longa ? tamLongo : tamCurto);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        ctx.stroke();
      }
    }
    for (const i of [0, 2.1, 4.2]) arco(R * 1.3, -fase * .25 + i, -fase * .25 + i + .7, 3, cor(.65));
  }

  function efeitos() {
    if (p.ondas > .02) {
      for (let i = 0; i < 3; i++) {
        const f = (faseEfeito * .5 + i / 3) % 1;
        arco(R * (.55 + f * .95), 0, 7, 1.8, cor((1 - f) * .85 * p.ondas));
      }
    }
    if (p.onda > .02) {
      for (let i = 0; i < 2; i++) {
        const f = (faseEfeito * 1.1 + i / 2) % 1;
        arco(R * (.28 + f * .8), 0, 7, 2.5, cor((1 - f) * .7 * p.onda));
      }
    }
    if (p.varredura > .02) {
      const a = faseEfeito * 2.2;
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = cor(((1 - i / 26) ** 2) * .3 * p.varredura);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R * 1.38, a - (i + 1) * .045, a - i * .045);
        ctx.closePath();
        ctx.fill();
      }
    }
    if (p.marcas > .02) {
      const total = 72, ativa = Math.floor(faseEfeito * 14) % total;
      ctx.lineWidth = 3;
      for (let i = 0; i < total; i++) {
        const a = (i / total) * Math.PI * 2 + TOPO;
        const dist = (ativa - i + total) % total;
        ctx.strokeStyle = cor(p.marcas * Math.max(.14, 1 - dist / 24));
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * R * 1.14, cy + Math.sin(a) * R * 1.14);
        ctx.lineTo(cx + Math.cos(a) * R * 1.2, cy + Math.sin(a) * R * 1.2);
        ctx.stroke();
      }
    }
  }

  function desenhar() {
    ctx.clearRect(0, 0, largura, altura);
    ctx.globalCompositeOperation = 'lighter';
    fundo();
    efeitos();
    reator();
    ctx.globalCompositeOperation = 'source-over';
  }

  function avancar(agora) {
    const dt = Math.min((agora - ultimo) / 1000 || 0, .05);
    ultimo = agora;
    const k = 1 - Math.exp(-dt * 4.5);
    for (const c of ['giro', 'brilho', 'onda', 'orbita', 'ondas', 'varredura', 'marcas']) p[c] += (alvo[c] - p[c]) * k;
    for (let i = 0; i < 3; i++) p.cor[i] += (alvo.cor[i] - p.cor[i]) * k;
    tempo += dt;
    fase += p.giro * dt;
    faseOrbita += p.orbita * dt;
    faseEfeito += dt;
    desenhar();
    quadro = requestAnimationFrame(avancar);
  }

  function iniciar() {
    cancelAnimationFrame(quadro);
    if (reduzido.matches || document.hidden) {
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
  reduzido.addEventListener('change', iniciar);
  medir();
  iniciar();

  return {
    definirEstado(nome) {
      alvo = ESTADOS[nome] ?? ESTADOS.espera;
      if (reduzido.matches) iniciar();
    },
    reposicionar() { medir(); iniciar(); },
  };
}
