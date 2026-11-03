// Ações reais que o JARVIS pode executar. O modelo só pede; quem valida e executa é este código.
const MAX_ANOTACAO = 2000;

export const FERRAMENTAS = [
  {
    type: 'function',
    function: {
      name: 'listar_anotacoes',
      description: 'Lista as anotações salvas pelo usuário, das mais recentes para as mais antigas.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'salvar_anotacao',
      description: 'Salva uma anotação nova, somente quando o usuário pedir para anotar ou guardar um texto.',
      parameters: {
        type: 'object',
        properties: { texto: { type: 'string', description: 'O texto exato da anotação.' } },
        required: ['texto'],
      },
    },
  },
];

function lerArgumentos(bruto) {
  try {
    const dados = JSON.parse(bruto || '{}');
    return dados && typeof dados === 'object' ? dados : {};
  } catch {
    return null;
  }
}

// Retorna o resultado que volta ao modelo e, quando algo mudou, a ação mostrada na tela.
export async function executarFerramenta(db, chamada, jaSalvas) {
  const argumentos = lerArgumentos(chamada.argumentos);
  if (argumentos === null) return { resultado: { erro: 'Argumentos inválidos.' } };

  if (chamada.nome === 'listar_anotacoes') {
    const { results } = await db
      .prepare('SELECT texto, criada_em FROM anotacoes ORDER BY criada_em DESC, id LIMIT 30')
      .all();
    return {
      resultado: {
        anotacoes: results.map((a) => ({ texto: a.texto, data: new Date(a.criada_em).toISOString() })),
      },
      acao: { nome: 'listar_anotacoes', descricao: 'Consultou suas anotações' },
    };
  }

  if (chamada.nome === 'salvar_anotacao') {
    const texto = typeof argumentos.texto === 'string' ? argumentos.texto.trim() : '';
    if (!texto) return { resultado: { erro: 'O texto da anotação está vazio.' } };
    if (texto.length > MAX_ANOTACAO) return { resultado: { erro: `Use no máximo ${MAX_ANOTACAO} caracteres.` } };
    if (jaSalvas.has(texto)) return { resultado: { salva: true, texto } };
    await db
      .prepare('INSERT INTO anotacoes (id, texto, criada_em) VALUES (?, ?, ?)')
      .bind(crypto.randomUUID(), texto, Date.now())
      .run();
    jaSalvas.add(texto);
    return { resultado: { salva: true, texto }, acao: { nome: 'salvar_anotacao', descricao: 'Salvou uma anotação' } };
  }

  return { resultado: { erro: `A ferramenta ${chamada.nome} não existe.` } };
}
