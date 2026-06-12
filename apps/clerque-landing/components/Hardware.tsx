import { Tablet, Printer, ScanLine, BatteryCharging, Wifi, Smartphone } from 'lucide-react';

const HARDWARE = [
  {
    icon:  Tablet,
    title: 'Any Android 9+ tablet',
    desc:  'Recommended: Samsung Galaxy Tab A8 10.5″ landscape. Works on any tablet ₱8K and up.',
  },
  {
    icon:  Smartphone,
    title: 'Owner phone for spot-check',
    desc:  'Owner installs Counter on their Android phone for dashboard, today\'s pickups, and remote Z-read.',
  },
  {
    icon:  Printer,
    title: 'Bluetooth thermal printer',
    desc:  '58mm or 80mm ESC/POS. Tested with Xprinter, Bixolon, Star, Munbyn. Around ₱1,500-₱3,000.',
  },
  {
    icon:  ScanLine,
    title: 'Camera or USB scanner',
    desc:  'Tablet camera scans barcodes natively. For heavy use, plug in a USB-OTG keyboard-wedge scanner.',
  },
  {
    icon:  BatteryCharging,
    title: 'Cash drawer',
    desc:  'Standard RJ-11 drawer triggered by the printer. Optional but most pilots use one.',
  },
  {
    icon:  Wifi,
    title: 'Works offline',
    desc:  'No WiFi? Sales survive in the local SQLite outbox. Drains when connectivity returns.',
  },
] as const;

export default function Hardware() {
  return (
    <section className="py-20 sm:py-28 bg-paper">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto text-center mb-12">
          <p className="text-sm font-semibold text-clerque-500 uppercase tracking-wider mb-2">Hardware that already works</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-clerque-900 tracking-tight-display mb-3">
            Use what you already have.
          </h2>
          <p className="text-muted text-lg">
            No proprietary terminal lock-in. Clerque runs on the same hardware you can buy at Lazada,
            Shopee, or any computer shop in CDO or Cebu.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {HARDWARE.map((h) => (
            <div key={h.title} className="rounded-xl border border-clerque-100 p-5 bg-clerque-50/50 hover:bg-clerque-50">
              <div className="w-10 h-10 rounded-lg bg-white border border-clerque-200 flex items-center justify-center text-clerque-700 mb-3">
                <h.icon className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-clerque-900 mb-1.5">{h.title}</h3>
              <p className="text-sm text-muted leading-relaxed">{h.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
