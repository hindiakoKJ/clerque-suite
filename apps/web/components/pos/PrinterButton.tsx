'use client';
import { useState } from 'react';
import { Printer, Unplug, Plug, TestTube } from 'lucide-react';
import { usePrinter } from '@/hooks/pos/usePrinter';

/**
 * Compact topbar button that shows thermal printer connection status
 * and a small popover to connect / disconnect / test.
 */
export function PrinterButton() {
  const { isSupported, connected, connecting, connect, disconnect, printTest } = usePrinter();
  const [open, setOpen] = useState(false);

  if (!isSupported) return null; // hidden on unsupported browsers

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={connected ? 'Printer connected — click to manage' : 'No printer connected'}
        className={`flex items-center gap-1.5 text-xs transition-colors ${
          connected
            ? 'text-green-300 hover:text-green-100'
            : 'text-blue-300 hover:text-white'
        }`}
      >
        <Printer className="h-3.5 w-3.5" />
        {connected && <span className="hidden sm:inline">Printer</span>}
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          {/* Popover */}
          <div className="absolute right-0 top-8 z-50 bg-white rounded-xl shadow-xl border border-gray-100 w-52 py-1 text-sm">
            {/* Status */}
            <div className="px-4 py-2.5 border-b border-gray-50">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-300'}`}
                />
                <span className="font-medium text-gray-700 text-xs">
                  {connected ? 'Connected' : 'No printer'}
                </span>
              </div>
              <p className="text-[10px] text-gray-400 mt-0.5">
                {connected
                  ? 'ESC/POS via Web Serial'
                  : 'Connect a thermal printer via USB/Serial'}
              </p>
            </div>

            {/* Actions */}
            {!connected ? (
              <button
                onClick={async () => { await connect(); setOpen(false); }}
                disabled={connecting}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Plug className="h-3.5 w-3.5 text-blue-500" />
                {connecting ? 'Connecting…' : 'Connect Printer'}
              </button>
            ) : (
              <>
                <button
                  onClick={async () => { await printTest(); setOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <TestTube className="h-3.5 w-3.5 text-green-500" />
                  Print Test Page
                </button>
                <button
                  onClick={async () => { await disconnect(); setOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-red-500 hover:bg-red-50 transition-colors"
                >
                  <Unplug className="h-3.5 w-3.5" />
                  Disconnect
                </button>
              </>
            )}

            <div className="px-4 py-2 border-t border-gray-50">
              <p className="text-[10px] text-gray-400">
                Compatible: Epson TM-T20, XPrinter XP-80C, BIXOLON SRP-330
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
