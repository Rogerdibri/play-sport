import Image from 'next/image';
import Link from 'next/link';
import { sponsorExamples } from './sponsor-examples';

export default function SponsorStrip() {
  return (
    <div className="sponsorStrip" role="group" aria-label="Marcas de referencia para esta vista de prueba">
      {sponsorExamples.map((brand) => (
        <Link href="/highlights/publicidad" key={brand.name}
          aria-label={`Información de ${brand.name}`}>
          <Image src={brand.src} width={brand.width} height={brand.height}
            sizes="(max-width: 700px) 90px, 160px" alt={brand.name} />
        </Link>
      ))}
    </div>
  );
}
