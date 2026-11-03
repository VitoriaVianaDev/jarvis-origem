// Mapa real da Terra (Natural Earth, via pacote world-atlas), usado para desenhar os continentes.
const URL_MAPA = 'https://cdn.jsdelivr.net/npm/world-atlas@2/land-50m.json';
export const LARGURA_MASCARA = 2048;
export const ALTURA_MASCARA = 1024;

// Converte o formato TopoJSON em polígonos com anéis de [longitude, latitude].
export function decodificarTerra(topo) {
  const { scale = [1, 1], translate = [0, 0] } = topo.transform ?? {};
  const arcos = topo.arcs.map((arco) => {
    let x = 0, y = 0;
    return arco.map(([dx, dy]) => {
      x += dx; y += dy;
      return topo.transform ? [x * scale[0] + translate[0], y * scale[1] + translate[1]] : [dx, dy];
    });
  });
  const anel = (indices) => {
    const pontos = [];
    for (const i of indices) {
      const arco = i < 0 ? [...arcos[~i]].reverse() : arcos[i];
      pontos.push(...(pontos.length ? arco.slice(1) : arco));
    }
    return pontos;
  };
  const poligonos = [];
  const visitar = (g) => {
    if (g.type === 'GeometryCollection') g.geometries.forEach(visitar);
    else if (g.type === 'Polygon') poligonos.push(g.arcs.map(anel));
    else if (g.type === 'MultiPolygon') for (const p of g.arcs) poligonos.push(p.map(anel));
  };
  visitar(topo.objects.land);
  return poligonos;
}

// Remove saltos de 360° e fecha pelo polo os anéis que dão a volta no planeta, como a Antártida.
export function desdobrarAnel(anel) {
  const saida = [];
  let deslocamento = 0, anterior = null;
  for (const [lon, lat] of anel) {
    if (anterior !== null) {
      if (lon - anterior > 180) deslocamento -= 360;
      else if (lon - anterior < -180) deslocamento += 360;
    }
    anterior = lon;
    saida.push([lon + deslocamento, lat]);
  }
  const voltas = Math.round((saida.at(-1)[0] - saida[0][0]) / 360);
  if (voltas !== 0) {
    const polo = saida.reduce((s, p) => s + p[1], 0) / saida.length < 0 ? -90 : 90;
    saida.push([saida.at(-1)[0], polo], [saida[0][0], polo]);
  }
  return saida;
}

function pintarMascara(poligonos) {
  const tela = document.createElement('canvas');
  tela.width = LARGURA_MASCARA;
  tela.height = ALTURA_MASCARA;
  const ctx = tela.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  const x = (lon) => ((lon + 180) / 360) * LARGURA_MASCARA;
  const y = (lat) => ((90 - lat) / 180) * ALTURA_MASCARA;
  for (const deslocamento of [-360, 0, 360]) {
    for (const poligono of poligonos) {
      ctx.beginPath();
      for (const anel of poligono) {
        desdobrarAnel(anel).forEach(([lon, lat], i) => {
          if (i === 0) ctx.moveTo(x(lon + deslocamento), y(lat));
          else ctx.lineTo(x(lon + deslocamento), y(lat));
        });
        ctx.closePath();
      }
      ctx.fill('evenodd');
    }
  }
  const dados = ctx.getImageData(0, 0, LARGURA_MASCARA, ALTURA_MASCARA).data;
  const W = LARGURA_MASCARA, H = ALTURA_MASCARA;
  const terra = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) terra[i] = dados[i * 4 + 3] > 127 ? 1 : 0;

  // 0 = oceano; valores maiores = terra, com a costa mais clara e uma textura suave no interior.
  const mapa = new Uint8Array(W * H);
  let semente = 1234567;
  const aleatorio = () => (semente = (semente * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const ruido = new Float32Array(64 * 32).map(aleatorio);
  const suave = (px, py, passo) => {
    const u = px / passo, v = py / passo;
    const i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j;
    const c = (m, n) => ruido[((n & 31) << 6) | (m & 63)];
    return (c(i, j) * (1 - a) + c(i + 1, j) * a) * (1 - b) + (c(i, j + 1) * (1 - a) + c(i + 1, j + 1) * a) * b;
  };
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (!terra[k]) continue;
      const costa = !terra[j * W + ((i + 2) % W)] || !terra[j * W + ((i - 2 + W) % W)]
        || (j > 1 && !terra[(j - 2) * W + i]) || (j < H - 2 && !terra[(j + 2) * W + i]);
      const textura = suave(i, j, 40) * .6 + suave(i, j, 13) * .4;
      mapa[k] = costa ? 255 : Math.round(90 + textura * 120);
    }
  }
  return mapa;
}

export async function carregarMapa(url = URL_MAPA) {
  const resposta = await fetch(url);
  if (!resposta.ok) throw new Error(`Mapa respondeu com erro ${resposta.status}`);
  return pintarMascara(decodificarTerra(await resposta.json()));
}
