// Rádios reais do diretório aberto Radio Browser. Os dados vêm de terceiros: nunca são tratados como HTML.
const SERVIDORES = ['all.api.radio-browser.info', 'de1.api.radio-browser.info', 'nl1.api.radio-browser.info', 'at1.api.radio-browser.info', 'de2.api.radio-browser.info'];
const LIMITE_MAPA = 5000;
const $ = (id) => document.getElementById(id);

async function consultar(caminho) {
  let ultimoErro = null;
  for (const servidor of SERVIDORES) {
    try {
      const resposta = await fetch(`https://${servidor}${caminho}`, { signal: AbortSignal.timeout(15000) });
      if (resposta.ok) return await resposta.json();
      ultimoErro = new Error(`erro ${resposta.status}`);
    } catch (e) {
      ultimoErro = e;
    }
  }
  throw ultimoErro;
}

// Só aproveita endereços seguros: o navegador bloquearia os demais.
export function limparEstacoes(lista) {
  const vistas = new Set();
  return lista.filter((r) => {
    const url = r.url_resolved || r.url || '';
    if (!url.startsWith('https://') || vistas.has(r.stationuuid)) return false;
    vistas.add(r.stationuuid);
    return true;
  });
}

// Agrupa rádios próximas (cerca de 25 km) em um único ponto do mapa.
export function agruparPorLugar(estacoes) {
  const grupos = new Map();
  for (const r of estacoes) {
    const lat = Number(r.geo_lat), lon = Number(r.geo_long);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    const chave = `${Math.round(lat * 4)}:${Math.round(lon * 4)}`;
    if (!grupos.has(chave)) grupos.set(chave, { lat: 0, lon: 0, total: 0, estacoes: [], locais: new Map() });
    const g = grupos.get(chave);
    g.lat += lat; g.lon += lon; g.total += 1; g.estacoes.push(r);
    const local = (r.state || '').trim();
    if (local) g.locais.set(local, (g.locais.get(local) ?? 0) + 1);
  }
  return [...grupos.values()].map((g) => {
    const local = [...g.locais.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const pais = g.estacoes[0].countrycode || g.estacoes[0].country || '';
    return {
      lat: g.lat / g.total,
      lon: g.lon / g.total,
      total: g.total,
      estacoes: g.estacoes,
      nome: [local, pais].filter(Boolean).join(', ') || 'Local sem nome',
    };
  });
}

function descricao(r) {
  return [r.state, r.countrycode || r.country, r.bitrate ? `${r.bitrate} kbps` : '', r.codec].filter(Boolean).join(', ');
}

export function iniciarRadio(nucleo, { mapaFalhou }) {
  const audio = new Audio();
  audio.preload = 'none';
  audio.volume = Number($('radio-volume').value);
  let tocando = null;
  let abaixado = false;
  const aplicarVolume = () => { audio.volume = Number($('radio-volume').value) * (abaixado ? .12 : 1); };

  const estado = (texto) => { $('radio-estado').textContent = texto; };

  function marcarLista() {
    for (const botao of $('radio-lista').querySelectorAll('button')) {
      botao.setAttribute('aria-pressed', String(botao.dataset.id === tocando?.stationuuid));
    }
  }

  function tocar(estacao) {
    tocando = estacao;
    audio.src = estacao.url_resolved || estacao.url;
    $('radio-player').hidden = false;
    $('radio-tocando').textContent = `Conectando a ${estacao.name}…`;
    marcarLista();
    audio.play().catch(() => {}); // A falha é tratada no evento de erro abaixo.
    // Pedido do diretório: registrar o clique, para mostrar as rádios mais ouvidas.
    consultar(`/json/url/${encodeURIComponent(estacao.stationuuid)}`).catch(() => {});
  }

  audio.addEventListener('playing', () => {
    if (tocando) $('radio-tocando').textContent = `Tocando: ${tocando.name}`;
    $('radio-pausar').textContent = 'Parar';
  });
  audio.addEventListener('error', () => {
    if (!tocando || !audio.getAttribute('src')) return;
    $('radio-tocando').textContent = `${tocando.name} não está transmitindo agora. Escolha outra rádio.`;
  });
  $('radio-pausar').addEventListener('click', () => {
    if (audio.paused && tocando) {
      tocar(tocando);
    } else {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      $('radio-tocando').textContent = tocando ? `Parada: ${tocando.name}` : '';
      $('radio-pausar').textContent = 'Tocar de novo';
    }
  });
  $('radio-volume').addEventListener('input', aplicarVolume);

  function mostrarLista(titulo, estacoes) {
    $('radio-lugar').textContent = titulo;
    $('radio-lugar').hidden = false;
    $('radio-lista').replaceChildren(...estacoes.slice(0, 60).map((r) => {
      const li = document.createElement('li');
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.dataset.id = r.stationuuid;
      const nome = document.createElement('span');
      nome.textContent = r.name;
      const info = document.createElement('small');
      info.textContent = descricao(r);
      botao.append(nome, info);
      botao.addEventListener('click', () => {
        tocar(r);
        const lat = Number(r.geo_lat), lon = Number(r.geo_long);
        if (Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon)) nucleo.focar(lat, lon);
      });
      li.append(botao);
      return li;
    }));
    marcarLista();
  }

  $('form-radio').addEventListener('submit', async (e) => {
    e.preventDefault();
    const termo = $('busca-radio').value.trim();
    if (!termo) return;
    estado(`Buscando “${termo}”…`);
    const q = encodeURIComponent(termo);
    const base = 'hidebroken=true&order=clickcount&reverse=true&limit=60';
    try {
      const resultados = await Promise.allSettled([
        consultar(`/json/stations/search?name=${q}&${base}`),
        consultar(`/json/stations/search?state=${q}&${base}`),
      ]);
      if (resultados.every((r) => r.status === 'rejected')) throw resultados[0].reason;
      const estacoes = limparEstacoes(resultados.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])));
      estado(estacoes.length ? `${estacoes.length} rádios encontradas.` : 'Nenhuma rádio encontrada. Tente o nome da rádio ou do estado.');
      mostrarLista(`Busca: ${termo}`, estacoes);
      const comLocal = estacoes.find((r) => Number(r.geo_lat) || Number(r.geo_long));
      if (comLocal) nucleo.focar(Number(comLocal.geo_lat), Number(comLocal.geo_long));
    } catch {
      estado('O diretório de rádios não respondeu. Tente de novo em instantes.');
    }
  });

  (async () => {
    try {
      const lista = await consultar(`/json/stations/search?has_geo_info=true&hidebroken=true&order=clickcount&reverse=true&limit=${LIMITE_MAPA}`);
      const lugares = agruparPorLugar(limparEstacoes(lista));
      nucleo.definirLugares(lugares, (lugar) => mostrarLista(lugar.nome, lugar.estacoes));
      const total = lugares.reduce((s, l) => s + l.total, 0);
      estado(`${total.toLocaleString('pt-BR')} rádios em ${lugares.length.toLocaleString('pt-BR')} locais. Clique no planeta para ampliar; depois, arraste, use a rolagem e clique em um ponto laranja.`
        + (mapaFalhou() ? ' O mapa dos continentes não carregou.' : ''));
    } catch {
      estado('O diretório de rádios não respondeu. Recarregue a página para tentar de novo.');
    }
  })();

  // Enquanto o microfone está ligado, a rádio fica baixa para não atrapalhar o reconhecimento.
  return {
    abaixar(valor) {
      abaixado = valor;
      aplicarVolume();
    },
  };
}
