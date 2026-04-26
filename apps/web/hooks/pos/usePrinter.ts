'use client';
import { useCallback } from 'react';
import { printer } from '@/lib/pos/printer';
import { usePrinterStore } from '@/store/pos/printer';
import { toast } from 'sonner';

export function usePrinter() {
  const { connected, connecting, setConnected, setConnecting } = usePrinterStore();

  const connect = useCallback(async () => {
    if (!printer.isSupported) {
      toast.error('Web Serial API is not supported in this browser. Use Chrome or Edge on a desktop.');
      return false;
    }
    setConnecting(true);
    const ok = await printer.connect();
    setConnecting(false);
    setConnected(ok);
    if (ok) {
      toast.success('Thermal printer connected.');
    } else {
      toast.error('Printer connection cancelled or failed.');
    }
    return ok;
  }, [setConnected, setConnecting]);

  const disconnect = useCallback(async () => {
    await printer.disconnect();
    setConnected(false);
    toast('Printer disconnected.');
  }, [setConnected]);

  const printTest = useCallback(async () => {
    try {
      await printer.printTest();
      toast.success('Test page sent.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Print failed.';
      toast.error(msg);
    }
  }, []);

  return {
    isSupported: printer.isSupported,
    connected,
    connecting,
    connect,
    disconnect,
    printTest,
    printer,
  };
}
