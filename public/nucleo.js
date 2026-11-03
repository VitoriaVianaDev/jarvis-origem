// Núcleo do JARVIS: a Terra real dentro de um radar. Os anéis são desenho; os pontos são rádios reais.
import { ALTURA_MASCARA, LARGURA_MASCARA } from './planeta.js';

const AZUL = [44, 196, 255];
const LARANJA = [255, 140, 50];
const ESTADOS = {
  espera:      { giro: .05, cor: AZUL,           brilho: .75, onda: 0, orbita: .16, ondas: 0, varredura: 0, marcas: 0 },
  ouvindo:     { giro: .07, cor: [110, 225, 255], brilho: 1,   onda: 0, orbita: .24, ondas: 1, varredura: 0, marcas: 0 },
  processando: { giro: .4,  cor: [90, 150, 255], brilho: .85, onda: 0, orbita: 1.1, ondas: 0, varredura: 1, marcas: 0 },
  respondendo: { giro: .08, cor: [130, 235, 255], brilho: 1.1, onda: 1, orbita: .35, ondas: 0, varredura: 0, marcas: 0 },
  executando:  { giro: .2,  cor: LARANJA,        brilho: 1,   onda: 0, orbita: .7,  ondas: 0, varredura: 0, marcas: 1 },
};
const TOPO = -Math.PI / 2;
const RAD = Math.PI / 180;
const MAX_LADO = 560;

export function criarNucleo(canvas, { centro, areaInterativa }) {
  const ctx = canvas.getContext('2d');
  const movimentoReduzido = matchMedia('(prefers-reduced-motion: reduce)');
  const p = { ...ESTADOS.espera, cor: [...ESTADOS.espera.cor] };
  const tela = document.createElement('canvas');
  const ctxTela = tela.getContext('2d');
  let imagem = null, tabela = null;
  let alvo = ESTADOS.espera;
  let mapa = null, lugares = [], selecionado = null, sobre = null, aoEscolher = () => {};
  let largura = 0, altura = 0, cx = 0, cy = 0, R = 0;
  let lon0 = -50, lat0 = -12, zoom = 1, destino = null;
  let faseOrbita = 0, faseEfeito = 0, ultimo = 0, quadro = 0, contador = 0, tocou = false;

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
    prepararTabela();
  }

  // Calcula antes a posição de cada pixel na esfera, para girar o planeta sem pesar.
  function prepararTabela() {
    const lado = Math.min(MAX_LADO, Math.max(120, Math.round(R * 2 * Math.min(devicePixelRatio || 1, 1.5))));
    if (tela.width !== lado) { tela.width = lado; tela.height = lado; }
    imagem = ctxTela.createImageData(lado, lado);
    const indices = [], xs = [], ys = [], zs = [], bordas = [];
    const meio = lado / 2;
    for (let j = 0; j < lado; j++) {
      for (let i = 0; i < lado; i++) {
        const u = (i + .5 - meio) / meio, v = (j + .5 - meio) / meio;
        const d2 = u * u + v * v;
        if (d2 > 1) continue;
        const sx = u / zoom, sy = -v / zoom;
        const r2 = sx * sx + sy * sy;
        indices.push((j * lado + i) * 4);
        xs.push(sx); ys.push(sy); zs.push(Math.sqrt(Math.max(0, 1 - r2)));
        bordas.push(Math.min(1, (1 - d2) * 18));
      }
    }
    tabela = {
      n: indices.length,
      indices: Uint32Array.from(indices), xs: Float32Array.from(xs), ys: Float32Array.from(ys),
      zs: Float32Array.from(zs), bordas: Float32Array.from(bordas),
    };
  }

  function pintarTerra() {
    if (!tabela) return;
    const { n, indices, xs, ys, zs, bordas } = tabela;
    const px = imagem.data;
    const sinLat = Math.sin(lat0 * RAD), cosLat = Math.cos(lat0 * RAD);
    const brilho = Math.min(p.brilho, 1.15);
    const [r, g, b] = p.cor;
    const W = LARGURA_MASCARA, H = ALTURA_MASCARA;
    for (let k = 0; k < n; k++) {
      const x = xs[k], y = ys[k], z = zs[k];
      const y2 = y * cosLat + z * sinLat;
      const z2 = z * cosLat - y * sinLat;
      const lat = Math.asin(y2 > 1 ? 1 : y2 < -1 ? -1 : y2) / RAD;
      let lon = Math.atan2(x, z2) / RAD + lon0;
      lon = ((lon + 180) % 360 + 360) % 360;
      const t = mapa ? mapa[(((90 - lat) / 180 * H) | 0) * W + ((lon / 360 * W) | 0)] : 0;
      const luz = (.3 + .7 * z) * bordas[k];
      const m = indices[k];
      if (t) {
        const f = (t / 255) * luz * brilho;
        px[m] = 12 + r * f; px[m + 1] = 24 + g * f; px[m + 2] = 40 + b * f;
      } else {
        const grade = (lon % 15 < .28 || Math.abs(lat) % 15 < .22) ? 26 : 0;
        const f = luz * brilho;
        px[m] = (3 + grade * .3) * f; px[m + 1] = (20 + grade * .75) * f; px[m + 2] = (46 + grade) * f;
      }
      px[m + 3] = bordas[k] * 255;
    }
    ctxTela.putImageData(imagem, 0, 0);
  }

  function projetar(lat, lon) {
    const dLon = (lon - lon0) * RAD, la = lat * RAD;
    const x = Math.cos(la) * Math.sin(dLon);
    const y0 = Math.sin(la);
    const z0 = Math.cos(la) * Math.cos(dLon);
    const sinLat = Math.sin(lat0 * RAD), cosLat = Math.cos(lat0 * RAD);
    const y = y0 * cosLat - z0 * sinLat;
    const z = y0 * sinLat + z0 * cosLat;
    const sx = cx + x * R * zoom, sy = cy - y * R * zoom;
    const dentro = z > 0.02 && Math.hypot(sx - cx, sy - cy) < R;
    return { x: sx, y: sy, z, dentro, nx: x, ny: -y };
  }

  function arco(raio, inicio, fim, espessura, estilo) {
    ctx.lineWidth = espessura;
    ctx.strokeStyle = estilo;
    ctx.beginPath();
    ctx.arc(cx, cy, raio, inicio, fim);
    ctx.stroke();
  }

  function radar() {
    const halo = ctx.createRadialGradient(cx, cy, R * .92, cx, cy, R * 1.34);
    halo.addColorStop(0, cor(.3 * p.brilho));
    halo.addColorStop(1, cor(0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.34, 0, 7);
    ctx.fill();

    for (const [r, a] of [[1.03, .8], [1.2, .28], [1.42, .4], [1.7, .55]]) arco(R * r, 0, 7, 1, cor(a));

    // Grandes arcos azuis e detalhes laranja, como na primeira referência
    const gira = faseOrbita * .3;
    for (const [i, tam] of [[-.5, 1], [2.64, 1]]) arco(R * 1.31, i - .0, i + tam, R * .09, cor(.28));
    for (const [i, tam] of [[.1, .55], [2.2, .3], [4.3, .42]]) arco(R * 1.55, gira + i, gira + i + tam, 5, cor(.75));
    arco(R * 1.55, -gira + 1.1, -gira + 1.22, 5, cor(.95, LARANJA));
    arco(R * 1.55, -gira + 4, -gira + 4.09, 5, cor(.95, LARANJA));
    arco(R * 1.13, -gira * 1.6, -gira * 1.6 + .5, 2, cor(.9));
    arco(R * 1.13, -gira * 1.6 + 3.1, -gira * 1.6 + 3.5, 2, cor(.9));

    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2 + TOPO;
      const longa = i % 10 === 0;
      const r1 = R * 1.7, r2 = r1 + (longa ? R * .08 : R * .035);
      ctx.strokeStyle = cor(longa ? .85 : .35);
      ctx.lineWidth = longa ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.stroke();
    }
    // Quatro marcadores da mira
    for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      ctx.strokeStyle = cor(.9, LARANJA);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R * 1.05, cy + Math.sin(a) * R * 1.05);
      ctx.lineTo(cx + Math.cos(a) * R * 1.11, cy + Math.sin(a) * R * 1.11);
      ctx.stroke();
    }
  }

  function efeitos() {
    if (p.ondas > .02) {
      for (let i = 0; i < 3; i++) {
        const f = (faseEfeito * .5 + i / 3) % 1;
        arco(R * (1.04 + f * .6), 0, 7, 1.5, cor((1 - f) * .8 * p.ondas));
      }
    }
    if (p.onda > .02) {
      const f = (faseEfeito * 1.2) % 1;
      arco(R * (1.03 + f * .16), 0, 7, 3, cor((1 - f) * .9 * p.onda));
    }
    if (p.varredura > .02) {
      const a = faseEfeito * 2.2;
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = cor(((1 - i / 26) ** 2) * .3 * p.varredura);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R * 1.42, a - (i + 1) * .045, a - i * .045);
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
        ctx.moveTo(cx + Math.cos(a) * R * 1.22, cy + Math.sin(a) * R * 1.22);
        ctx.lineTo(cx + Math.cos(a) * R * 1.29, cy + Math.sin(a) * R * 1.29);
        ctx.stroke();
      }
    }
  }

  function pontos() {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.2, 0, 7);
    ctx.clip();
    const raioPonto = Math.max(2.2, Math.min(3.6, R / 65));
    for (const lugar of lugares) {
      const q = projetar(lugar.lat, lugar.lon);
      if (!q.dentro) continue;
      lugar.tx = q.x; lugar.ty = q.y; lugar.visivel = true;
      // A antena cresce conforme a quantidade de rádios do lugar.
      const antena = (3 + Math.log2(lugar.total + 1) * 3) * Math.max(R / 170, .6);
      ctx.strokeStyle = cor(.4 + q.z * .35, LARANJA);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(q.x + q.nx * antena, q.y + q.ny * antena);
      ctx.stroke();
      ctx.fillStyle = cor(.6 + q.z * .4, LARANJA);
      ctx.fillRect(q.x - raioPonto / 2, q.y - raioPonto / 2, raioPonto, raioPonto);
    }
    ctx.restore();
    for (const lugar of [selecionado, sobre]) {
      if (!lugar) continue;
      const q = projetar(lugar.lat, lugar.lon);
      if (!q.dentro) continue;
      ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 6, 0, 7);
      ctx.stroke();
    }
    if (sobre) {
      const q = projetar(sobre.lat, sobre.lon);
      if (q.dentro) {
        ctx.font = '600 12.5px Inter, sans-serif';
        const texto = `${sobre.nome}: ${sobre.total} ${sobre.total === 1 ? 'rádio' : 'rádios'}`;
        const w = ctx.measureText(texto).width;
        const x = Math.min(q.x + 10, largura - w - 16), y = q.y - 22;
        ctx.fillStyle = 'rgba(1,6,14,.92)';
        ctx.fillRect(x - 6, y - 12, w + 12, 22);
        ctx.fillStyle = '#e0f4ff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(texto, x, y);
      }
    }
  }

  function desenhar(repintar) {
    ctx.clearRect(0, 0, largura, altura);
    ctx.globalCompositeOperation = 'lighter';
    radar();
    efeitos();
    ctx.globalCompositeOperation = 'source-over';
    if (repintar) pintarTerra();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tela, cx - R, cy - R, R * 2, R * 2);
    pontos();
  }

  function avancar(agora) {
    const dt = Math.min((agora - ultimo) / 1000 || 0, .05);
    ultimo = agora;
    const k = 1 - Math.exp(-dt * 4.5);
    for (const chave of ['giro', 'brilho', 'onda', 'orbita', 'ondas', 'varredura', 'marcas']) p[chave] += (alvo[chave] - p[chave]) * k;
    for (let i = 0; i < 3; i++) p.cor[i] += (alvo.cor[i] - p.cor[i]) * k;
    if (!tocou) lon0 -= p.giro * dt * 60;
    if (destino) {
      const dLon = ((destino.lon - lon0 + 540) % 360) - 180;
      lon0 += dLon * .08;
      lat0 += (destino.lat - lat0) * .08;
      if (Math.abs(dLon) < .2 && Math.abs(destino.lat - lat0) < .2) destino = null;
    }
    faseOrbita += p.orbita * dt;
    faseEfeito += dt;
    contador += 1;
    desenhar(contador % 2 === 0 || !imagem);
    quadro = requestAnimationFrame(avancar);
  }

  function iniciar() {
    cancelAnimationFrame(quadro);
    if (movimentoReduzido.matches || document.hidden) {
      Object.assign(p, alvo, { cor: [...alvo.cor] });
      faseEfeito = 1.1;
      desenhar(true);
      return;
    }
    ultimo = performance.now();
    quadro = requestAnimationFrame(avancar);
  }

  // Girar, aproximar e clicar
  function posicao(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function lugarPerto({ x, y }) {
    let melhor = null, menor = 14;
    for (const lugar of lugares) {
      if (!lugar.visivel) continue;
      const q = projetar(lugar.lat, lugar.lon);
      if (!q.dentro) continue;
      const d = Math.hypot(q.x - x, q.y - y);
      if (d < menor) { menor = d; melhor = lugar; }
    }
    return melhor;
  }
  let arrasto = null;
  areaInterativa?.addEventListener('pointerdown', (e) => {
    arrasto = { x: e.clientX, y: e.clientY, inicioX: e.clientX, inicioY: e.clientY, moveu: false };
    areaInterativa.setPointerCapture(e.pointerId);
  });
  areaInterativa?.addEventListener('pointermove', (e) => {
    if (arrasto) {
      const dx = e.clientX - arrasto.x, dy = e.clientY - arrasto.y;
      arrasto.x = e.clientX; arrasto.y = e.clientY;
      if (Math.hypot(e.clientX - arrasto.inicioX, e.clientY - arrasto.inicioY) > 4) {
        arrasto.moveu = true;
        tocou = true;
        destino = null;
        areaInterativa.classList.add('arrastando');
        lon0 -= (dx / (R * zoom)) * 57.3;
        lat0 = Math.max(-85, Math.min(85, lat0 + (dy / (R * zoom)) * 57.3));
      }
    } else {
      sobre = lugarPerto(posicao(e));
      areaInterativa.classList.toggle('sobre-ponto', Boolean(sobre));
    }
    if (movimentoReduzido.matches) desenhar(true);
  });
  areaInterativa?.addEventListener('pointerup', (e) => {
    areaInterativa.classList.remove('arrastando');
    if (arrasto && !arrasto.moveu) {
      const lugar = lugarPerto(posicao(e));
      if (lugar) {
        selecionado = lugar;
        tocou = true;
        aoEscolher(lugar);
      }
    }
    arrasto = null;
  });
  areaInterativa?.addEventListener('wheel', (e) => {
    e.preventDefault();
    tocou = true;
    zoom = Math.max(1, Math.min(10, zoom * Math.exp(-e.deltaY * .0015)));
    prepararTabela();
    if (movimentoReduzido.matches) desenhar(true);
  }, { passive: false });

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
    definirMapa(novo) { mapa = novo; if (movimentoReduzido.matches) desenhar(true); },
    definirLugares(novos, callback) {
      lugares = novos;
      if (callback) aoEscolher = callback;
      if (movimentoReduzido.matches) desenhar(true);
    },
    focar(lat, lon, lugar = null) {
      tocou = true;
      selecionado = lugar;
      destino = { lat: Math.max(-85, Math.min(85, lat)), lon };
      zoom = Math.max(zoom, 2.2);
      prepararTabela();
      if (movimentoReduzido.matches) { lon0 = lon; lat0 = destino.lat; destino = null; desenhar(true); }
    },
    reposicionar() { medir(); iniciar(); },
  };
}
