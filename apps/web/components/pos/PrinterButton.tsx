'use client';
import { useState } from 'react';
import { Printer, Unplug, Plug, TestTube, Bluetooth, ExternalLink } from 'lucide-react';
import { usePrinter } from '@/hooks/pos/usePrinter';
import { isLikelyAndroid, uint8ToBase64 } from '@/lib/pos/printer-dispatch';
import { toast } from 'sonner';

/**
 * Topbar printer control — connection status plus a popover to connect,
 * test and disconnect.
 *
 * Two transports, because one is not enough for a real counter:
 *
 *   USB / Web Serial — desktop Chrome only. This used to be the ONLY path,
 *     and the whole button returned null when `navigator.serial` was missing.
 *     On the Android tablet a cashier actually stands at, that meant no
 *     printer control existed at all and no explanation why.
 *
 *   Bluetooth via RawBT — the Android path. RawBT is a free app that owns the
 *     pairing (classic SPP printers are out of reach of Web Bluetooth) and
 *     accepts ESC/POS over a `rawbt:` intent URL. Pairing happens once in
 *     Android; from here the cashier just sends a test slip to confirm it.
 *
 * Available to every till user, not just owners — the person who needs to
 * reconnect a printer mid-shift is the cashier standing in front of it.
 */

/** Minimal ESC/POS test slip: init, centred title, feed, cut. */
function buildTestSlip(): Uint8Array {
  const enc = new TextEncoder();
  const parts: number[] = [];
  const push = (bytes: ArrayLike<number>) => { for (let i = 0; i < bytes.length; i++) parts.push(bytes[i]); };

  push([0x1b, 0x40]);             // ESC @  — initialise
  push([0x1b, 0x61, 0x01]);       // ESC a 1 — centre
  push(enc.encode('CLERQUE\n'));
  push(enc.encode('Printer test\n'));
  push([0x1b, 0x61, 0x00]);       // ESC a 0 — left
  push(enc.encode(`\n${new Date().toLocaleString('en-PH')}\n`));
  push(enc.encode('If you can read this, the\nprinter is connected.\n'));
  push([0x0a, 0x0a, 0x0a]);       // feed
  push([0x1d, 0x56, 0x00]);       // GS V 0 — full cut
  return new Uint8Array(parts);
}

/** Hand an ESC/POS payload to the RawBT app via its intent URL. */
function sendViaRawBt(bytes: Uint8Array): void {
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = `rawbt:base64,${uint8ToBase64(bytes)}`;
  document.body.appendChild(iframe);
  setTimeout(() => {
    if (iframe.parentNode) document.body.removeChild(iframe);
  }, 1000);
}

export function PrinterButton() {
  const { isSupported, connected, connecting, connect, disconnect, printTest } = usePrinter();
  const [open, setOpen] = useState(false);

  const android = isLikelyAndroid();

  // Previously: `if (!isSupported) return null`, which hid the control
  // entirely on every tablet. Now it renders whenever EITHER transport is
  // plausible, and only disappears where neither can work (e.g. iOS Safari,
  // which has no Web Serial and cannot launch RawBT).
  if (!isSupported && !android) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={connected ? 'Printer connected — click to manage' : 'Printer settings'}
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
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-50 bg-white rounded-xl shadow-xl border border-gray-100 w-64 py-1 text-sm">

            {/* Status */}
            <div className="px-4 py-2.5 border-b border-gray-50">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-300'}`} />
                <span className="font-medium text-gray-700 text-xs">
                  {connected ? 'USB printer connected' : 'No USB printer'}
                </span>
              </div>
              <p className="text-[10px] text-gray-400 mt-0.5">
                {connected
                  ? 'ESC/POS via Web Serial'
                  : android
                    ? 'Use Bluetooth below, or plug in via USB'
                    : 'Connect a thermal printer via USB/Serial'}
              </p>
            </div>

            {/* ── USB / Web Serial ─────────────────────────────────────── */}
            {isSupported && (!connected ? (
              <button
                onClick={async () => { await connect(); setOpen(false); }}
                disabled={connecting}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Plug className="h-3.5 w-3.5 text-blue-500" />
                {connecting ? 'Connecting…' : 'Connect USB printer'}
              </button>
            ) : (
              <>
                <button
                  onClick={async () => { await printTest(); setOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <TestTube className="h-3.5 w-3.5 text-green-500" />
                  Print test page
                </button>
                <button
                  onClick={async () => { await disconnect(); setOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-red-500 hover:bg-red-50 transition-colors"
                >
                  <Unplug className="h-3.5 w-3.5" />
                  Disconnect
                </button>
              </>
            ))}

            {/* ── Bluetooth via RawBT (Android) ────────────────────────── */}
            {android && (
              <div className="border-t border-gray-50">
                <button
                  onClick={() => {
                    sendViaRawBt(buildTestSlip());
                    toast.info(
                      'Test slip sent to RawBT. If nothing prints, open RawBT and pair your printer there first.',
                      { duration: 8_000 },
                    );
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <Bluetooth className="h-3.5 w-3.5 text-blue-500" />
                  Test Bluetooth printer
                </button>
                <a
                  href="https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-gray-500 hover:bg-gray-50 transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5 text-gray-400" />
                  Get the RawBT app
                </a>
                <p className="px-4 pb-2 text-[10px] text-gray-400 leading-relaxed">
                  Pair the printer once in RawBT (or Android Bluetooth settings). Clerque then sends
                  receipts straight to it.
                </p>
              </div>
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
