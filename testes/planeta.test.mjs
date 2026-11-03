import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodificarTerra, desdobrarAnel } from '../public/planeta.js';
import { agruparPorLugar, limparEstacoes } from '../public/radio.js';

test('TopoJSON é decodificado com deltas, arcos invertidos e vários polígonos', () => {
  const topo = {
    transform: { scale: [1, 1], translate: [-10, -10] },
    arcs: [[[0, 0], [10, 0], [0, 10]], [[10, 10], [-10, -10]]],
    objects: { land: { type: 'GeometryCollection', geometries: [
      { type: 'Polygon', arcs: [[0, 1]] },
      { type: 'MultiPolygon', arcs: [[[~1, ~0]]] },
    ] } },
  };
  const [a, b] = decodificarTerra(topo);
  assert.deepEqual(a[0], [[-10, -10], [0, -10], [0, 0], [-10, -10]]);
  assert.deepEqual(b[0][0], [-10, -10]);
  assert.equal(b[0].length, 4);
});

test('anel que cruza o meridiano 180 não dá salto', () => {
  const saida = desdobrarAnel([[170, 10], [-170, 10], [-170, 20], [170, 20], [170, 10]]);
  for (let i = 1; i < saida.length; i++) assert.ok(Math.abs(saida[i][0] - saida[i - 1][0]) <= 180);
});

test('Antártida, que dá a volta no planeta, fecha pelo polo sul', () => {
  const anel = [[-180, -70], [-60, -72], [60, -70], [180, -70]];
  const saida = desdobrarAnel(anel);
  assert.deepEqual(saida.at(-2), [180, -90]);
  assert.deepEqual(saida.at(-1), [-180, -90]);
});

test('rádios sem endereço seguro ou repetidas são descartadas', () => {
  const lista = limparEstacoes([
    { stationuuid: 'a', url_resolved: 'https://x/a' },
    { stationuuid: 'a', url_resolved: 'https://x/a' },
    { stationuuid: 'b', url_resolved: 'http://x/b' },
    { stationuuid: 'c', url: 'javascript:alert(1)' },
    { stationuuid: 'd', url_resolved: '', url: 'https://x/d' },
  ]);
  assert.deepEqual(lista.map((r) => r.stationuuid), ['a', 'd']);
});

test('rádios próximas formam um ponto; coordenada vazia fica de fora', () => {
  const grupos = agruparPorLugar([
    { geo_lat: -20.73, geo_long: -42.03, state: 'Minas Gerais', countrycode: 'BR' },
    { geo_lat: -20.75, geo_long: -42.02, state: 'Minas Gerais', countrycode: 'BR' },
    { geo_lat: 51.5, geo_long: -0.1, state: 'London', countrycode: 'GB' },
    { geo_lat: 0, geo_long: 0, state: 'Nada', countrycode: 'XX' },
    { geo_lat: null, geo_long: null, state: 'Sem', countrycode: 'XX' },
  ]);
  assert.equal(grupos.length, 2);
  const mg = grupos.find((g) => g.total === 2);
  assert.equal(mg.nome, 'Minas Gerais, BR');
  assert.ok(Math.abs(mg.lat - -20.74) < .001);
});

test('fala é dividida em frases curtas, sem perder texto', async () => {
  const { dividirEmFrases } = await import('../public/voz.js');
  const texto = 'Primeira frase. Segunda frase! ' + 'palavra '.repeat(80).trim() + '. Fim?';
  const partes = dividirEmFrases(texto);
  assert.ok(partes.every((p) => p.length <= 181));
  assert.equal(partes.join(' ').replace(/\s+/g, ' '), texto);
});

test('a voz masculina em português do Brasil é preferida, salvo escolha salva', async () => {
  const { escolherMelhorVoz } = await import('../public/voz.js');
  const vozes = [
    { name: 'Google português do Brasil', lang: 'pt-BR', voiceURI: 'g' },
    { name: 'Microsoft Maria', lang: 'pt-BR', voiceURI: 'm' },
    { name: 'Microsoft Daniel', lang: 'pt-BR', voiceURI: 'd' },
    { name: 'Joana', lang: 'pt-PT', voiceURI: 'j' },
  ];
  assert.equal(escolherMelhorVoz(vozes, null).voiceURI, 'd');
  assert.equal(escolherMelhorVoz(vozes, 'm').voiceURI, 'm');
  assert.equal(escolherMelhorVoz([], null), null);
});

test('"Ei, Jarvis" é reconhecido em variações, sem disparar em outras palavras', async () => {
  const { extrairChamado } = await import('../public/voz.js');
  assert.deepEqual(extrairChamado('ei Jarvis'), { comando: '' });
  assert.deepEqual(extrairChamado('Ei, Jarvis, que horas são?'), { comando: 'que horas são?' });
  assert.deepEqual(extrairChamado('hey jarvis abaixa isso'), { comando: 'abaixa isso' });
  assert.deepEqual(extrairChamado('então ei jarvis olha'), { comando: 'olha' });
  for (const texto of ['bom dia', 'Travis Scott', 'jarvisão', 'o jardim']) assert.equal(extrairChamado(texto), null, texto);
});

test('voz natural masculina vem primeiro, e rádio de som fraco vai para o fim', async () => {
  const { escolherMelhorVoz } = await import('../public/voz.js');
  const { ordenarPorQualidade } = await import('../public/radio.js');
  const vozes = [
    { name: 'Microsoft Daniel', lang: 'pt-BR', voiceURI: 'd' },
    { name: 'Microsoft Francisca Online (Natural)', lang: 'pt-BR', voiceURI: 'f' },
    { name: 'Microsoft Antonio Online (Natural)', lang: 'pt-BR', voiceURI: 'a' },
  ];
  assert.equal(escolherMelhorVoz(vozes, null).voiceURI, 'a');
  const lista = ordenarPorQualidade([{ n: 1, bitrate: 32 }, { n: 2, bitrate: 128 }, { n: 3, bitrate: 0 }]);
  assert.deepEqual(lista.map((r) => r.n), [2, 3, 1]);
});

test('tamanho dos cartões respeita limites', async () => {
  const { limitar } = await import('../public/layout.js');
  assert.equal(limitar(100, 220, 640), 220);
  assert.equal(limitar(900, 220, 640), 640);
  assert.equal(limitar(300, 220, 640), 300);
});
