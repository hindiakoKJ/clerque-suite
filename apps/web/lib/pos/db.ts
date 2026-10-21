import Dexie, { type Table } from 'dexie';

export interface CachedProduct {
  id: string;
  name: string;
  sku?: string;
  barcode?: string;
  price: number;
  costPrice?: number;
  isVatable: boolean;
  categoryId?: string;
  imageUrl?: string;
  branchId: string;
  tenantId: string;
  cachedAt: number;
  [key: string]: unknown;
}

export interface CachedCategory {
  id: string;
  name: string;
  tenantId: string;
  cachedAt: number;
}

export interface CachedShift {
  id: string;
  branchId: string;
  cashierId: string;
  openingCash: number;
  openedAt: string;
  cachedAt: number;
}

export type PendingStatus = 'PENDING' | 'SYNCING' | 'FAILED';

export interface PendingOrder {
  id?: number;
  clientUuid: string;
  branchId: string;
  /**
   * The shop and the person that rang this sale. A tablet can be shared by two
   * shops, and only the shop that rang a sale may see, send or delete it (see
   * lib/pos/pending-scope.ts). Not indexed, so no schema version is needed:
   * Dexie stores extra fields as they come, and rows queued before these were
   * recorded simply lack them and are matched by branch instead.
   */
  tenantId?: string;
  userId?: string;
  payload: object;
  receiptSnapshot: object;
  queuedAt: number;
  retries: number;
  status: PendingStatus;
  lastError?: string;
}

class PosDatabase extends Dexie {
  products!: Table<CachedProduct, string>;
  categories!: Table<CachedCategory, string>;
  pendingOrders!: Table<PendingOrder, number>;
  activeShift!: Table<CachedShift, string>;

  constructor() {
    super('pos-offline-db');
    this.version(1).stores({
      products: 'id, branchId, tenantId, cachedAt',
      categories: 'id, tenantId, cachedAt',
      pendingOrders: '++id, clientUuid, status, queuedAt',
    });
    this.version(2).stores({
      products: 'id, branchId, tenantId, cachedAt',
      categories: 'id, tenantId, cachedAt',
      pendingOrders: '++id, clientUuid, status, queuedAt',
      activeShift: 'id, branchId, cachedAt',
    });
  }
}

export const db = new PosDatabase();
