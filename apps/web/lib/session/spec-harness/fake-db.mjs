/**
 * In-memory stand-in for lib/pos/db.ts (Dexie), with only the calls the
 * offline queue and sign-out make. Rows are plain objects; `reset()` gives
 * each test a fresh database.
 */

class Collection {
  constructor(table, pick) { this.table = table; this.pick = pick; }
  rows() { return this.table.rows.filter(this.pick); }
  filter(fn) { return new Collection(this.table, (r) => this.pick(r) && fn(r)); }
  async toArray() { return this.rows().map((r) => ({ ...r })); }
  async count() { return this.rows().length; }
  async first() { const r = this.rows()[0]; return r ? { ...r } : undefined; }
  reverse() { return this; }
  async modify(changes) {
    const hit = this.rows();
    for (const r of hit) {
      if (typeof changes === 'function') changes(r);
      else Object.assign(r, changes);
    }
    return hit.length;
  }
  async delete() { const hit = new Set(this.rows()); this.table.rows = this.table.rows.filter((r) => !hit.has(r)); return hit.size; }
}

class Table {
  constructor(key) { this.key = key; this.rows = []; this.next = 1; }
  where(field) {
    return {
      equals: (v) => new Collection(this, (r) => r[field] === v),
      anyOf: (vs) => new Collection(this, (r) => vs.includes(r[field])),
    };
  }
  filter(fn) { return new Collection(this, fn); }
  orderBy(field) { return new Ordered(this, field); }
  async add(row) {
    const id = this.key === '++id' ? this.next++ : row.id;
    this.rows.push({ ...row, id });
    return id;
  }
  async put(row) { this.rows = this.rows.filter((r) => r.id !== row.id); this.rows.push({ ...row }); return row.id; }
  async bulkPut(rows) { for (const r of rows) await this.put(r); }
  async get(id) { const r = this.rows.find((x) => x.id === id); return r ? { ...r } : undefined; }
  async update(id, changes) { const r = this.rows.find((x) => x.id === id); if (!r) return 0; Object.assign(r, changes); return 1; }
  async delete(id) { this.rows = this.rows.filter((r) => r.id !== id); }
  async clear() { this.rows = []; }
  async toArray() { return this.rows.map((r) => ({ ...r })); }
  async count() { return this.rows.length; }
}

class Ordered extends Collection {
  constructor(table, field) { super(table, () => true); this.field = field; this.desc = false; }
  reverse() { this.desc = !this.desc; return this; }
  rows() {
    const sorted = [...this.table.rows].sort((a, b) => a[this.field] - b[this.field]);
    return this.desc ? sorted.reverse() : sorted;
  }
}

export const db = {
  pendingOrders: new Table('++id'),
  activeShift:   new Table('id'),
  products:      new Table('id'),
  categories:    new Table('id'),
};

export function reset() {
  for (const t of Object.values(db)) { t.rows = []; t.next = 1; }
}
