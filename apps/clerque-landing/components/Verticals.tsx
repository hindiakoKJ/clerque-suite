import {
  Coffee, Croissant, UtensilsCrossed, Shirt, Pill, Fuel,
  Stethoscope, ShoppingBag, Wrench,
} from 'lucide-react';

const VERTICALS = [
  { icon: Coffee,           name: 'Coffee shops',         desc: 'Modifier groups, drink sizing, recipe drain' },
  { icon: Croissant,        name: 'Bakeries',             desc: 'Pre-orders, wholesale price lists, FEFO, bake list' },
  { icon: UtensilsCrossed,  name: 'Restaurants',          desc: 'KDS pairing, tables, dining mode, voids' },
  { icon: ShoppingBag,      name: 'Retail',               desc: 'Barcode scan, customer phone lookup, loyalty' },
  { icon: Shirt,            name: 'Laundromats',          desc: 'Intake tickets, per-kg pricing, claim flow' },
  { icon: Pill,             name: 'Pharmacies',           desc: 'Rx-attest, Yellow Rx serial, FDA license print' },
  { icon: Fuel,             name: 'Gas stations',         desc: 'Manual fuel meter, tank dip, DOE ceiling check' },
  { icon: Stethoscope,      name: 'Medical equipment',    desc: 'Serial tracking, rentals, repair tickets' },
  { icon: Wrench,           name: 'Service businesses',   desc: 'Job orders, parts + labor, claim tickets' },
] as const;

export default function Verticals() {
  return (
    <section id="verticals" className="py-20 sm:py-28 bg-clerque-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto text-center mb-12">
          <p className="text-sm font-semibold text-clerque-500 uppercase tracking-wider mb-2">Built for nine verticals</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-clerque-900 tracking-tight-display mb-3">
            Your business is not a spreadsheet.
          </h2>
          <p className="text-muted text-lg">
            Clerque adapts to your vertical. A bakery sees pre-orders and bake lists.
            A laundromat sees intake tickets. A pharmacy sees Rx capture. Same platform, different workflow.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {VERTICALS.map((v) => (
            <div
              key={v.name}
              className="rounded-xl bg-white border border-clerque-100 p-5 flex gap-4 hover:shadow-md hover:border-clerque-300 transition-all"
            >
              <div className="shrink-0 w-11 h-11 rounded-lg bg-clerque-100 flex items-center justify-center text-clerque-700">
                <v.icon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-clerque-900 mb-1">{v.name}</h3>
                <p className="text-xs text-muted leading-relaxed">{v.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
