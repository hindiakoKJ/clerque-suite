/**
 * Laundry Fleet store — washers + dryers state machine.
 *
 * Holds mock fleet data: 6 washers + 4 dryers. Running machines tick down
 * via a 1s interval started by `startFleetTicker()` (call once on screen
 * mount, dispose on unmount). Times are tracked as `endsAt` epoch ms so
 * countdowns stay correct even if the JS task is throttled.
 *
 * TODO(backend): the Cloud API exposes a real fleet at
 *   GET    /laundry/machines?branchId=X         → list with current state
 *   POST   /laundry/machines                    → create (W1, D1, …)
 *   PATCH  /laundry/machines/:id/status         → IDLE / RUNNING / OUT_OF_ORDER
 *   PATCH  /laundry/machines/:id                → metadata edit
 *   PATCH  /laundry/lines/:lineId/assign        → assign a line to a machine
 * Wiring this store to the live endpoints involves: (a) seeding `machines`
 * from a React Query call instead of the `initialMachines` literal, (b)
 * routing `assignTicket` / `markDone` / `setOutOfService` through the Cloud
 * mutations with optimistic updates, and (c) collapsing the 1s ticker to
 * derive `remainingSec` from `endsAt` returned by the API. Until that
 * lands, the screen still operates as a self-contained demo from this
 * in-memory store. — Wire when the Laundry Pro tier work begins.
 */

import { create } from 'zustand';

export type MachineKind = 'WASHER' | 'DRYER';
export type MachineState = 'IDLE' | 'RUNNING' | 'DONE' | 'OUT_OF_SERVICE';

export interface Machine {
  id: string;             // W1, W2, D1...
  kind: MachineKind;
  state: MachineState;
  /** Epoch ms — machine finishes at this time. Undefined unless RUNNING. */
  endsAt?: number;
  /** Live countdown in seconds, recomputed by the ticker. */
  remainingSec?: number;
  /** Customer ticket assigned (set when RUNNING). */
  ticketNo?: string;
  customerName?: string;
}

export interface QueuedTicket {
  ticketNo: string;
  customerName: string;
  loadKind: string;       // "Regular Wash 7kg" etc.
  queuedAt: number;
}

interface FleetState {
  machines: Machine[];
  queue: QueuedTicket[];

  assignTicket: (machineId: string, ticket: QueuedTicket, runForMinutes: number) => void;
  markDone: (machineId: string) => void;
  resetToIdle: (machineId: string) => void;
  setOutOfService: (machineId: string, oos: boolean) => void;
  enqueueTicket: (t: QueuedTicket) => void;
  removeFromQueue: (ticketNo: string) => void;
  tick: () => void;
}

const NOW = () => Date.now();

const initialMachines: Machine[] = [
  // 6 washers
  { id: 'W1', kind: 'WASHER', state: 'RUNNING', endsAt: NOW() + 23 * 60 * 1000 + 42 * 1000, ticketNo: 'L-2026-0421', customerName: 'Ronaldo Cruz' },
  { id: 'W2', kind: 'WASHER', state: 'IDLE' },
  { id: 'W3', kind: 'WASHER', state: 'DONE', ticketNo: 'L-2026-0419', customerName: 'Maria Santos' },
  { id: 'W4', kind: 'WASHER', state: 'RUNNING', endsAt: NOW() + 8 * 60 * 1000, ticketNo: 'L-2026-0420', customerName: 'Juan Dela Cruz' },
  { id: 'W5', kind: 'WASHER', state: 'OUT_OF_SERVICE' },
  { id: 'W6', kind: 'WASHER', state: 'IDLE' },
  // 4 dryers
  { id: 'D1', kind: 'DRYER', state: 'RUNNING', endsAt: NOW() + 14 * 60 * 1000, ticketNo: 'L-2026-0418', customerName: 'Anna Reyes' },
  { id: 'D2', kind: 'DRYER', state: 'IDLE' },
  { id: 'D3', kind: 'DRYER', state: 'DONE', ticketNo: 'L-2026-0417', customerName: 'Pedro Lim' },
  { id: 'D4', kind: 'DRYER', state: 'IDLE' },
];

const initialQueue: QueuedTicket[] = [
  { ticketNo: 'L-2026-0425', customerName: 'Lara Mendoza', loadKind: 'Regular Wash 7kg', queuedAt: NOW() - 12 * 60 * 1000 },
  { ticketNo: 'L-2026-0426', customerName: 'Carlos Ong', loadKind: 'Comforter (Queen)', queuedAt: NOW() - 6 * 60 * 1000 },
  { ticketNo: 'L-2026-0427', customerName: 'Maite Villanueva', loadKind: 'Dry Clean — 4 pcs', queuedAt: NOW() - 2 * 60 * 1000 },
];

export const useFleet = create<FleetState>((set) => ({
  machines: initialMachines.map((m) => ({
    ...m,
    remainingSec: m.endsAt ? Math.max(0, Math.floor((m.endsAt - NOW()) / 1000)) : undefined,
  })),
  queue: initialQueue,

  assignTicket: (machineId, ticket, runForMinutes) =>
    set((s) => {
      const endsAt = NOW() + runForMinutes * 60 * 1000;
      return {
        machines: s.machines.map((m) =>
          m.id === machineId && m.state === 'IDLE'
            ? {
                ...m,
                state: 'RUNNING',
                endsAt,
                remainingSec: runForMinutes * 60,
                ticketNo: ticket.ticketNo,
                customerName: ticket.customerName,
              }
            : m
        ),
        queue: s.queue.filter((t) => t.ticketNo !== ticket.ticketNo),
      };
    }),

  markDone: (machineId) =>
    set((s) => ({
      machines: s.machines.map((m) =>
        m.id === machineId ? { ...m, state: 'DONE', endsAt: undefined, remainingSec: undefined } : m
      ),
    })),

  resetToIdle: (machineId) =>
    set((s) => ({
      machines: s.machines.map((m) =>
        m.id === machineId
          ? { ...m, state: 'IDLE', endsAt: undefined, remainingSec: undefined, ticketNo: undefined, customerName: undefined }
          : m
      ),
    })),

  setOutOfService: (machineId, oos) =>
    set((s) => ({
      machines: s.machines.map((m) =>
        m.id === machineId
          ? {
              ...m,
              state: oos ? 'OUT_OF_SERVICE' : 'IDLE',
              endsAt: undefined,
              remainingSec: undefined,
              ticketNo: undefined,
              customerName: undefined,
            }
          : m
      ),
    })),

  enqueueTicket: (t) => set((s) => ({ queue: [...s.queue, t] })),

  removeFromQueue: (ticketNo) =>
    set((s) => ({ queue: s.queue.filter((q) => q.ticketNo !== ticketNo) })),

  tick: () =>
    set((s) => {
      const now = NOW();
      let mutated = false;
      const machines = s.machines.map((m) => {
        if (m.state !== 'RUNNING' || m.endsAt === undefined) return m;
        const remaining = Math.max(0, Math.floor((m.endsAt - now) / 1000));
        if (remaining === 0) {
          mutated = true;
          return { ...m, state: 'DONE' as const, remainingSec: 0, endsAt: undefined };
        }
        if (remaining !== m.remainingSec) {
          mutated = true;
          return { ...m, remainingSec: remaining };
        }
        return m;
      });
      return mutated ? { machines } : {};
    }),
}));

/** Start the global 1s ticker. Returns disposer. */
export function startFleetTicker(): () => void {
  const id = setInterval(() => useFleet.getState().tick(), 1000);
  return () => clearInterval(id);
}

export function formatCountdown(sec: number | undefined): string {
  if (sec === undefined) return '--:--';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
