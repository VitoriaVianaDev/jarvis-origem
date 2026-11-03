// Fala e audição usam recursos do próprio navegador. No Chrome, o reconhecimento envia o áudio ao Google.
const CHAVE_VOZ = 'jarvis-voz';
const MASCULINAS = /daniel|antonio|antônio|fabio|fábio|thalles|donato|julio|júlio|humberto|valerio|valério|nicolau|masculin|\bmale\b/i;

function lerPreferencia() {
  try { return localStorage.getItem(CHAVE_VOZ); } catch { return null; }
}
function salvarPreferencia(valor) {
  try { localStorage.setItem(CHAVE_VOZ, valor); } catch { /* preferência só desta sessão */ }
}

// Chrome pode cortar falas longas: a resposta é dividida em frases curtas.
export function dividirEmFrases(texto, limite = 180) {
  const frases = texto.replace(/\s+/g, ' ').trim().match(/[^.!?;:]+[.!?;:]*\s*/g) ?? [];
  const partes = [];
  let atual = '';
  for (const frase of frases) {
    if (atual && (atual + frase).length > limite) { partes.push(atual.trim()); atual = ''; }
    if (frase.length > limite) {
      for (const palavra of frase.split(' ')) {
        if ((atual + palavra).length > limite) { partes.push(atual.trim()); atual = ''; }
        atual += `${palavra} `;
      }
    } else {
      atual += frase;
    }
  }
  if (atual.trim()) partes.push(atual.trim());
  return partes;
}

// Reconhece "Ei, Jarvis" e variações comuns da transcrição; devolve o que vem depois do nome.
const CHAMADO = /(?:^|[\s,.!?])(?:(?:ei|hey|ey|oi|ô|olá|e)[\s,]+)?(?:jarvis|jarvs|javis|jarves|djarvis|jarbas)(?=$|[\s,.:;!?-])[\s,.:;!?-]*(.*)$/i;
export function extrairChamado(texto) {
  const achado = CHAMADO.exec(texto);
  return achado ? { comando: achado[1].trim() } : null;
}

export function escolherMelhorVoz(vozes, preferida) {
  const salva = vozes.find((v) => v.voiceURI === preferida);
  if (salva) return salva;
  const brasil = vozes.filter((v) => /^pt[-_]br/i.test(v.lang));
  const portugues = brasil.length ? brasil : vozes;
  const natural = (v) => /natural|neural|online/i.test(v.name);
  return portugues.find((v) => natural(v) && MASCULINAS.test(v.name))
    ?? portugues.find((v) => MASCULINAS.test(v.name))
    ?? portugues.find(natural)
    ?? portugues[0] ?? null;
}

// Microfone com cancelamento de eco, para retirar o som que o próprio navegador está tocando.
let trilha = null;
export async function obterMicrofone() {
  if (trilha?.readyState === 'live') return trilha;
  if (!navigator.mediaDevices?.getUserMedia) return null;
  const fluxo = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  trilha = fluxo.getAudioTracks()[0] ?? null;
  return trilha;
}
export function soltarMicrofone() {
  trilha?.stop();
  trilha = null;
}

function iniciarComTrilha(reconhecedor, faixa) {
  if (faixa) {
    try {
      reconhecedor.start(faixa);
      return;
    } catch {
      // Navegador sem suporte a microfone próprio: usa o padrão.
    }
  }
  reconhecedor.start();
}

const MENSAGENS_ERRO = {
  'not-allowed': 'O navegador bloqueou o microfone. Clique no ícone à esquerda do endereço do site e permita o microfone.',
  'service-not-allowed': 'O navegador bloqueou o reconhecimento de voz. Permita o microfone nas configurações do site.',
  'audio-capture': 'Nenhum microfone foi encontrado. Verifique se ele está conectado e ativo no Windows.',
  network: 'O reconhecimento de voz do navegador não conseguiu se conectar. Verifique sua internet e tente de novo.',
  'no-speech': 'Não ouvi nada. Clique e fale de novo.',
};

// Escuta contínua pelo "Ei, Jarvis". Só roda quando a pessoa liga a opção.
export function criarEscuta({ aoChamar, aoParcial, aoComando, aoDesistir, aoFalhar }) {
  const Reconhecimento = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;
  let ativa = false, pausada = false, acordada = false, rec = null, fimRec = null, preparando = false;
  let tempo = 0, falhasDeRede = 0;

  const dormir = () => { acordada = false; clearTimeout(tempo); };
  const armarTempo = () => {
    clearTimeout(tempo);
    tempo = setTimeout(() => { dormir(); aoDesistir(); }, 7000);
  };

  async function iniciar() {
    if (!ativa || pausada || rec || preparando) return;
    preparando = true;
    let faixa = null;
    try {
      faixa = await obterMicrofone();
    } catch (e) {
      preparando = false;
      if (e?.name === 'NotAllowedError') {
        ativa = false;
        dormir();
        aoFalhar(MENSAGENS_ERRO['not-allowed']);
        return;
      }
    }
    preparando = false;
    if (!ativa || pausada || rec) return;
    const r = new Reconhecimento();
    rec = r;
    r.lang = 'pt-BR';
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      falhasDeRede = 0;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const resultado = e.results[i];
        const texto = resultado[0].transcript;
        let comando = texto.trim();
        if (!acordada) {
          const chamado = extrairChamado(texto);
          if (!chamado) continue;
          acordada = true;
          aoChamar();
          comando = chamado.comando;
        } else {
          const repetido = extrairChamado(texto);
          if (repetido) comando = repetido.comando;
        }
        if (comando) aoParcial(comando);
        armarTempo();
        if (resultado.isFinal && comando) {
          dormir();
          pausada = true;
          r.abort();
          aoComando(comando);
          return;
        }
      }
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
        ativa = false;
        dormir();
        aoFalhar(MENSAGENS_ERRO[e.error]);
      } else if (e.error === 'network') {
        falhasDeRede += 1;
      }
    };
    r.onend = () => {
      rec = null;
      fimRec?.();
      fimRec = null;
      if (!ativa || pausada) return;
      if (falhasDeRede >= 5) {
        ativa = false;
        dormir();
        aoFalhar(MENSAGENS_ERRO.network);
        return;
      }
      // O Chrome encerra a escuta de tempos em tempos: ela recomeça sozinha.
      setTimeout(iniciar, falhasDeRede ? 3000 : 250);
    };
    try {
      iniciarComTrilha(r, faixa);
    } catch {
      rec = null;
      setTimeout(iniciar, 1000);
    }
  }

  const aguardarFim = () => new Promise((resolver) => {
    if (!rec) { resolver(); return; }
    fimRec = resolver;
    rec.abort();
  });

  return {
    disponivel: Boolean(Reconhecimento),
    ligada: () => ativa,
    ligar() { ativa = true; pausada = false; falhasDeRede = 0; iniciar(); },
    async desligar() { ativa = false; dormir(); await aguardarFim(); soltarMicrofone(); },
    async pausar() { pausada = true; dormir(); await aguardarFim(); },
    retomar() { pausada = false; iniciar(); },
  };
}

export function criarVoz({ aoOuvirParcial, aoOuvir, aoFalhar, aoTerminarSemFala }) {
  const Reconhecimento = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;
  const sintese = globalThis.speechSynthesis;
  let reconhecedor = null;
  let vozEscolhida = null;
  let geracao = 0;
  let velocidade = 1, tom = 1;
  const aoMudar = new Set();

  const vozesEmPortugues = () => (sintese?.getVoices() ?? []).filter((v) => /^pt/i.test(v.lang));
  const atualizarVozes = () => {
    vozEscolhida = escolherMelhorVoz(vozesEmPortugues(), lerPreferencia());
    aoMudar.forEach((f) => f());
  };
  sintese?.addEventListener?.('voiceschanged', atualizarVozes);
  atualizarVozes();

  return {
    vozes: vozesEmPortugues,
    vozAtual: () => vozEscolhida,
    temVozMasculina: () => vozesEmPortugues().some((v) => MASCULINAS.test(v.name)),
    aoMudarVozes: (f) => aoMudar.add(f),
    escolherVoz(uri) {
      salvarPreferencia(uri);
      vozEscolhida = vozesEmPortugues().find((v) => v.voiceURI === uri) ?? vozEscolhida;
    },
    ajustarFala(novaVelocidade, novoTom) { velocidade = novaVelocidade; tom = novoTom; },
    ouvindo: () => Boolean(reconhecedor),
    async ouvir() {
      if (!Reconhecimento) {
        aoFalhar('Este navegador não reconhece voz. Abra o JARVIS no Google Chrome.');
        return;
      }
      let faixa = null;
      try {
        faixa = await obterMicrofone();
      } catch (e) {
        if (e?.name === 'NotAllowedError') {
          aoFalhar(MENSAGENS_ERRO['not-allowed']);
          return;
        }
      }
      const r = new Reconhecimento();
      reconhecedor = r;
      r.lang = 'pt-BR';
      r.interimResults = true;
      r.continuous = false;
      r.maxAlternatives = 1;
      let final = '';
      let falhou = false;
      r.onresult = (e) => {
        let parcial = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) final += e.results[i][0].transcript;
          else parcial += e.results[i][0].transcript;
        }
        aoOuvirParcial((final + parcial).trim());
      };
      r.onerror = (e) => {
        if (e.error === 'aborted') return;
        falhou = true;
        aoFalhar(MENSAGENS_ERRO[e.error] ?? `O reconhecimento de voz falhou (${e.error}).`);
      };
      r.onend = () => {
        reconhecedor = null;
        if (falhou) return;
        if (final.trim()) aoOuvir(final.trim());
        else aoTerminarSemFala();
      };
      try {
        iniciarComTrilha(r, faixa);
      } catch {
        reconhecedor = null;
        aoFalhar('Não foi possível ligar o microfone. Tente de novo.');
      }
    },
    pararDeOuvir() { reconhecedor?.stop(); },
    calar() {
      geracao += 1;
      sintese?.cancel();
    },
    falar(texto, aoTerminar) {
      if (!sintese) { aoTerminar(); return; }
      geracao += 1;
      const esta = geracao;
      sintese.cancel();
      // Vozes locais leem o texto inteiro, sem pausas; só as vozes on-line precisam ser divididas.
      const partes = vozEscolhida?.localService ? [texto] : dividirEmFrases(texto, 220);
      const proxima = (i) => {
        if (esta !== geracao) return;
        if (i >= partes.length) { aoTerminar(); return; }
        const u = new SpeechSynthesisUtterance(partes[i]);
        u.lang = vozEscolhida?.lang ?? 'pt-BR';
        if (vozEscolhida) u.voice = vozEscolhida;
        u.rate = velocidade;
        u.pitch = tom;
        u.onend = () => proxima(i + 1);
        u.onerror = () => proxima(i + 1);
        sintese.speak(u);
      };
      proxima(0);
    },
  };
}
