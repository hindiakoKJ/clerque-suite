import Nav from '@/components/Nav';
import Hero from '@/components/Hero';
import Modules from '@/components/Modules';
import Verticals from '@/components/Verticals';
import BirReady from '@/components/BirReady';
import Hardware from '@/components/Hardware';
import Faq from '@/components/Faq';
import Cta from '@/components/Cta';
import Footer from '@/components/Footer';

export default function HomePage() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Modules />
        <Verticals />
        <BirReady />
        <Hardware />
        <Faq />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
