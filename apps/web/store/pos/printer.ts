import { create } from 'zustand';

interface PrinterStore {
  connected: boolean;
  connecting: boolean;
  setConnected: (v: boolean) => void;
  setConnecting: (v: boolean) => void;
}

export const usePrinterStore = create<PrinterStore>((set) => ({
  connected: false,
  connecting: false,
  setConnected: (connected) => set({ connected }),
  setConnecting: (connecting) => set({ connecting }),
}));
