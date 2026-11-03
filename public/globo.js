// Planeta com continentes reais. Pequeno, é só um botão; ampliado, gira, aproxima e mostra as rádios.
import { ALTURA_MASCARA, LARGURA_MASCARA } from './planeta.js';

const RAD = Math.PI / 180;
const AZUL = [46, 224, 238];
const LARANJA = [255, 140, 50];
const MAX_LADO = 640;

export function criarPlaneta(canvas) {
  const ctx = canvas.getContext('2d');
  const reduzido = matchMedia('(prefers-reduced-motion: reduce)');
  const buffer = document.createElement('canvas');
  const ctxBuffer = buffer.getContext('2d');
  let imagem = null, tabela = null, mapa = null;
  let lugares = [], selecionado = null, sobre = null, aoEscolher = () => {};
  let largura = 0, altura = 0, cx = 0, cy = 0, R = 0;
  let lon0 = -50, lat0 = -12, zoom = 1, destino = null, tocou = false, expandido = false;
  let quadro = 0, ultimo = 0, contador = 0;

  function medir() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    largura = canvas.clientWidth; altura = canvas.clientHeight;
    if (!largura || !altura) return;
    canvas.width = Math.round(largura * dpr);
    canvas.height = Math.round(altura * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = largura / 2; cy = altura / 2;
    R = Math.min(largura, altura) / 2 * (expandido ? .9 : .86);
    preparar();
  }

  function preparar() {
    const lado = Math.min(MAX_LADO, Math.max(100, Math.round(R * 2 * Math.min(devicePixelRatio || 1, 1.5))));
    if (buffer.width !== lado) { buffer.width = lado; buffer.height = lado; }
    imagem = ctxBuffer.createImageData(lado, lado);
    const indices = [], xs = [], ys = [], zs = [], bordas = [];
    const meio = lado / 2;
    for (let j = 0; j < lado; j++) {
      for (let i = 0; i < lado; i++) {
        const u = (i + .5 - meio) / meio, v = (j + .5 - meio) / meio;
        const d2 = u * u + v * v;
        if (d2 > 1) continue;
        const sx = u / zoom, sy = -v / zoom;
        indices.push((j * lado + i) * 4);
        xs.push(sx); ys.push(sy); zs.push(Math.sqrt(Math.max(0, 1 - sx * sx - sy * sy)));
        bordas.push(Math.min(1, (1 - d2) * 18));
      }
    }
    tabela = {
      n: indices.length, indices: Uint32Array.from(indices), xs: Float32Array.from(xs),
      ys: Float32Array.from(ys), zs: Float32Array.from(zs), bordas: Float32Array.from(bordas),
    };
  }

  function pintarTerra() {
    if (!tabela) return;
    const { n, indices, xs, ys, zs, bordas } = tabela;
    const px = imagem.data;
    const sinLat = Math.sin(lat0 * RAD), cosLat = Math.cos(lat0 * RAD);
    const [r, g, b] = AZUL;
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
        const f = (t / 255) * luz;
        px[m] = 12 + r * f; px[m + 1] = 24 + g * f; px[m + 2] = 40 + b * f;
      } else {
        const grade = (lon % 15 < .28 || Math.abs(lat) % 15 < .22) ? 26 : 0;
        px[m] = (3 + grade * .3) * luz; px[m + 1] = (20 + grade * .75) * luz; px[m + 2] = (46 + grade) * luz;
      }
      px[m + 3] = bordas[k] * 255;
    }
    ctxBuffer.putImageData(imagem, 0, 0);
  }

  function projetar(lat, lon) {
    const dLon = (lon - lon0) * RAD, la = lat * RAD;
    const x = Math.cos(la) * Math.sin(dLon);
    const y0 = Math.sin(la), z0 = Math.cos(la) * Math.cos(dLon);
    const sinLat = Math.sin(lat0 * RAD), cosLat = Math.cos(lat0 * RAD);
    const y = y0 * cosLat - z0 * sinLat, z = y0 * sinLat + z0 * cosLat;
    const sx = cx + x * R * zoom, sy = cy - y * R * zoom;
    return { x: sx, y: sy, z, nx: x, ny: -y, dentro: z > .02 && Math.hypot(sx - cx, sy - cy) < R };
  }

  function desenhar(repintar) {
    if (!largura || !altura) return;
    ctx.clearRect(0, 0, largura, altura);
    const halo = ctx.createRadialGradient(cx, cy, R * .95, cx, cy, R * 1.14);
    halo.addColorStop(0, 'rgba(46,224,238,.32)');
    halo.addColorStop(1, 'rgba(46,224,238,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.14, 0, 7); ctx.fill();
    if (repintar) pintarTerra();
    ctx.drawImage(buffer, cx - R, cy - R, R * 2, R * 2);
    ctx.strokeStyle = 'rgba(46,224,238,.8)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.015, 0, 7); ctx.stroke();

    const escala = expandido ? Math.max(R / 170, .6) : .35;
    const raio = expandido ? Math.max(2.2, Math.min(3.8, R / 65)) : 1.4;
    for (const lugar of lugares) {
      const q = projetar(lugar.lat, lugar.lon);
      lugar.visivel = q.dentro;
      if (!q.dentro) continue;
      const antena = (3 + Math.log2(lugar.total + 1) * 3) * escala;
      ctx.strokeStyle = `rgba(255,140,50,${.4 + q.z * .35})`;
      ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x + q.nx * antena, q.y + q.ny * antena); ctx.stroke();
      ctx.fillStyle = `rgba(255,140,50,${.6 + q.z * .4})`;
      ctx.fillRect(q.x - raio / 2, q.y - raio / 2, raio, raio);
    }
    if (!expandido) return;
    for (const lugar of [selecionado, sobre]) {
      if (!lugar) continue;
      const q = projetar(lugar.lat, lugar.lon);
      if (!q.dentro) continue;
      ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(q.x, q.y, 7, 0, 7); ctx.stroke();
    }
    if (sobre) {
      const q = projetar(sobre.lat, sobre.lon);
      if (q.dentro) {
        ctx.font = '600 13px Inter, sans-serif';
        const texto = `${sobre.nome}: ${sobre.total} ${sobre.total === 1 ? 'rádio' : 'rádios'}`;
        const w = ctx.measureText(texto).width;
        const x = Math.max(8, Math.min(q.x + 12, largura - w - 16)), y = Math.max(16, q.y - 24);
        ctx.fillStyle = 'rgba(1,6,14,.94)';
        ctx.fillRect(x - 6, y - 13, w + 12, 24);
        ctx.fillStyle = '#e0f4ff';
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(texto, x, y);
      }
    }
  }

  function avancar(agora) {
    const dt = Math.min((agora - ultimo) / 1000 || 0, .05);
    ultimo = agora;
    if (!tocou) lon0 -= dt * 4;
    if (destino) {
      const d = ((destino.lon - lon0 + 540) % 360) - 180;
      lon0 += d * .08;
      lat0 += (destino.lat - lat0) * .08;
      if (Math.abs(d) < .2 && Math.abs(destino.lat - lat0) < .2) destino = null;
    }
    contador += 1;
    desenhar(contador % (expandido ? 2 : 3) === 0);
    quadro = requestAnimationFrame(avancar);
  }

  function iniciar() {
    cancelAnimationFrame(quadro);
    if (reduzido.matches || document.hidden) { desenhar(true); return; }
    ultimo = performance.now();
    quadro = requestAnimationFrame(avancar);
  }

  const posicao = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const perto = ({ x, y }) => {
    let melhor = null, menor = 14;
    for (const lugar of lugares) {
      if (!lugar.visivel) continue;
      const q = projetar(lugar.lat, lugar.lon);
      const d = Math.hypot(q.x - x, q.y - y);
      if (q.dentro && d < menor) { menor = d; melhor = lugar; }
    }
    return melhor;
  };

  let arrasto = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!expandido) return;
    arrasto = { x: e.clientX, y: e.clientY, ix: e.clientX, iy: e.clientY, moveu: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!expandido) return;
    if (arrasto) {
      const dx = e.clientX - arrasto.x, dy = e.clientY - arrasto.y;
      arrasto.x = e.clientX; arrasto.y = e.clientY;
      if (Math.hypot(e.clientX - arrasto.ix, e.clientY - arrasto.iy) > 4) {
        arrasto.moveu = true; tocou = true; destino = null;
        canvas.classList.add('arrastando');
        lon0 -= (dx / (R * zoom)) * 57.3;
        lat0 = Math.max(-85, Math.min(85, lat0 + (dy / (R * zoom)) * 57.3));
      }
    } else {
      sobre = perto(posicao(e));
      canvas.classList.toggle('sobre-ponto', Boolean(sobre));
    }
    if (reduzido.matches) desenhar(true);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!expandido) return;
    canvas.classList.remove('arrastando');
    if (arrasto && !arrasto.moveu) {
      const lugar = perto(posicao(e));
      if (lugar) { selecionado = lugar; tocou = true; aoEscolher(lugar); }
    }
    arrasto = null;
  });
  canvas.addEventListener('wheel', (e) => {
    if (!expandido) return;
    e.preventDefault();
    tocou = true;
    zoom = Math.max(1, Math.min(10, zoom * Math.exp(-e.deltaY * .0015)));
    preparar();
    if (reduzido.matches) desenhar(true);
  }, { passive: false });

  new ResizeObserver(() => { medir(); iniciar(); }).observe(canvas);
  document.addEventListener('visibilitychange', iniciar);
  reduzido.addEventListener('change', iniciar);
  medir();
  iniciar();

  return {
    definirMapa(novo) { mapa = novo; if (reduzido.matches) desenhar(true); },
    definirLugares(novos, callback) {
      lugares = novos;
      if (callback) aoEscolher = callback;
      if (reduzido.matches) desenhar(true);
    },
    focar(lat, lon, lugar = null) {
      tocou = true;
      selecionado = lugar;
      destino = { lat: Math.max(-85, Math.min(85, lat)), lon };
      if (expandido) { zoom = Math.max(zoom, 2.2); preparar(); }
      if (reduzido.matches) { lon0 = lon; lat0 = destino.lat; destino = null; desenhar(true); }
    },
    expandir(ativo) {
      expandido = ativo;
      if (!ativo) { zoom = 1; sobre = null; }
      medir();
      iniciar();
    },
  };
}
