// Imita a interface do D1 usando o SQLite do Node, apenas para testes fora da Cloudflare.
import { DatabaseSync } from 'node:sqlite';

class Comando {
  constructor(banco, sql, valores = []) {
    this.banco = banco;
    this.sql = sql;
    this.valores = valores;
  }
  bind(...valores) {
    return new Comando(this.banco, this.sql, valores);
  }
  async first() {
    return this.banco.prepare(this.sql).get(...this.valores) ?? null;
  }
  async all() {
    return { results: this.banco.prepare(this.sql).all(...this.valores), meta: {} };
  }
  async run() {
    const r = this.banco.prepare(this.sql).run(...this.valores);
    return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}

export function criarD1Local(caminho = ':memory:') {
  const banco = new DatabaseSync(caminho);
  return {
    prepare: (sql) => new Comando(banco, sql),
    async batch(comandos) {
      banco.exec('BEGIN');
      try {
        const saida = [];
        for (const c of comandos) saida.push(await c.run());
        banco.exec('COMMIT');
        return saida;
      } catch (e) {
        banco.exec('ROLLBACK');
        throw e;
      }
    },
    fechar: () => banco.close(),
  };
}
