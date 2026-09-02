import neo4j, { type Driver } from 'neo4j-driver';
import type { GraphStore, NodeRef, Props, Space } from './types';

const ident = (s: string) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) throw new Error(`bad identifier ${s}`);
  return s;
};

/** Every write is a MERGE on the key, then SET of the rest. Two writes of one thing are one thing. */
export class Neo4jGraph implements GraphStore {
  private driver: Driver;
  constructor(url: string, user: string, password: string) {
    this.driver = neo4j.driver(url, neo4j.auth.basic(user, password), { disableLosslessIntegers: true });
  }

  async mergeNode(label: string, key: Props, props: Props) {
    const L = ident(label);
    const keyClause = Object.keys(key)
      .map((k) => `${ident(k)}: $key.${ident(k)}`)
      .join(', ');
    await this.query(`MERGE (n:${L} {${keyClause}}) SET n += $props`, { key, props });
  }

  async mergeEdge(from: NodeRef, rel: string, to: NodeRef, props: Props = {}) {
    const a = Object.keys(from.key)
      .map((k) => `${ident(k)}: $fk.${ident(k)}`)
      .join(', ');
    const b = Object.keys(to.key)
      .map((k) => `${ident(k)}: $tk.${ident(k)}`)
      .join(', ');
    await this.query(
      `MERGE (a:${ident(from.label)} {${a}}) MERGE (b:${ident(to.label)} {${b}}) MERGE (a)-[r:${ident(rel)}]->(b) SET r += $props`,
      { fk: from.key, tk: to.key, props }
    );
  }

  async query<T = Record<string, unknown>>(cypher: string, params: Record<string, unknown> = {}): Promise<T[]> {
    const session = this.driver.session();
    try {
      const res = await session.run(cypher, params);
      return res.records.map((r) => r.toObject() as T);
    } finally {
      await session.close();
    }
  }

  async wipe(space: Space) {
    await this.query(`MATCH (n {space: $space}) DETACH DELETE n`, { space });
  }

  async close() {
    await this.driver.close();
  }
}
