// Cria e atualiza as tabelas automaticamente. Cada item é aplicado uma única vez.
const MIGRACOES = [
  [
    `CREATE TABLE sessoes (
       id TEXT PRIMARY KEY,
       criada_em INTEGER NOT NULL,
       expira_em INTEGER NOT NULL
     )`,
    `CREATE TABLE tentativas_login (
       chave TEXT PRIMARY KEY,
       falhas INTEGER NOT NULL,
       inicio INTEGER NOT NULL
     )`,
    `CREATE TABLE anotacoes (
       id TEXT PRIMARY KEY,
       texto TEXT NOT NULL,
       criada_em INTEGER NOT NULL
     )`,
    `CREATE INDEX idx_anotacoes_data ON anotacoes (criada_em DESC)`,
    `CREATE TABLE diagnostico (
       id TEXT PRIMARY KEY,
       criado_em INTEGER NOT NULL
     )`,
  ],
];

const preparados = new WeakSet();

export async function prepararBanco(db) {
  if (preparados.has(db)) return;
  await db
    .prepare('CREATE TABLE IF NOT EXISTS esquema_versao (versao INTEGER PRIMARY KEY, aplicada_em INTEGER NOT NULL)')
    .run();
  const linha = await db.prepare('SELECT MAX(versao) AS versao FROM esquema_versao').first();
  const atual = linha?.versao ?? 0;
  for (let i = atual; i < MIGRACOES.length; i++) {
    const comandos = MIGRACOES[i].map((sql) => db.prepare(sql));
    comandos.push(
      db.prepare('INSERT INTO esquema_versao (versao, aplicada_em) VALUES (?, ?)').bind(i + 1, Date.now()),
    );
    await db.batch(comandos);
  }
  preparados.add(db);
}
