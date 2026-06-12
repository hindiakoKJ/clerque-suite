import { ArrowRight } from 'lucide-react';

const APP_URL = 'https://clerque.hnscorpph.com';

export default function Cta() {
  return (
    <section className="py-20 sm:py-28 bg-clerque-900 text-clerque-50 relative overflow-hidden">
      <div className="absolute inset-0 bg-grain opacity-10" />
      <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-7">
        <h2 className="text-3xl sm:text-5xl font-bold tracking-tighter-display leading-tight">
          Run your business on something built for your business.
        </h2>
        <p className="text-lg text-clerque-200 max-w-2xl mx-auto leading-relaxed">
          Pilot signups open now. Counter for Android in Play Store internal testing.
          Solo Lite starts at ₱199/month — under what most cafés spend on milk every week.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <a
            href={`${APP_URL}/signup`}
            className="inline-flex items-center justify-center gap-2 px-7 py-4 rounded-lg bg-clerque-500 text-white font-semibold hover:bg-clerque-400 shadow-lg shadow-clerque-500/30 transition"
          >
            Start free trial
            <ArrowRight className="w-4 h-4" />
          </a>
          <a
            href="mailto:sales@hnscorpph.com"
            className="inline-flex items-center justify-center gap-2 px-7 py-4 rounded-lg border-2 border-clerque-700 text-clerque-100 font-semibold hover:border-clerque-400 hover:text-white transition"
          >
            Talk to sales
          </a>
        </div>
      </div>
    </section>
  );
}
