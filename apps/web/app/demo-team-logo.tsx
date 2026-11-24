const palettes = [
  ['#123b62', '#44c8ed'],
  ['#692531', '#ffc65a'],
  ['#194d39', '#a8de81'],
  ['#402967', '#d2adff'],
  ['#813f17', '#ffcc75'],
  ['#164f59', '#70e0cc'],
  ['#323b69', '#f593bd'],
  ['#6b3228', '#ff9d65']
] as const;

export function demoTeamIdentity(name: string) {
  const normalized = name
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
  let hash = 0;
  for (const character of normalized) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  const words = normalized.split(' ').filter((word) => !['de', 'del', 'la', 'las', 'los', 'el', 'y'].includes(word));
  const initials =
    words
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase() || 'PS';
  return { colors: palettes[hash % palettes.length], shape: hash % 3, initials };
}

export default function DemoTeamLogo({ name, preview = false }: { name: string; preview?: boolean }) {
  const {
    colors: [base, accent],
    shape,
    initials
  } = demoTeamIdentity(name);
  return (
    <svg
      className={preview ? 'institutionLogoPreview' : 'institutionLogo'}
      viewBox="0 0 64 64"
      width={32}
      height={32}
      role="img"
      aria-hidden={!preview}
      aria-label={`Logo de ${name}`}
      data-demo-team-logo={name}
    >
      <title>{`Logo de ${name}`}</title>
      {shape === 0 ? (
        <path d="M7 6H57V35Q53 51 32 60Q11 51 7 35Z" fill={base} stroke={accent} strokeWidth="3" />
      ) : shape === 1 ? (
        <path d="M32 3L58 18V46L32 61L6 46V18Z" fill={base} stroke={accent} strokeWidth="3" />
      ) : (
        <circle cx="32" cy="32" r="28" fill={base} stroke={accent} strokeWidth="3" />
      )}
      <path d="M12 37L52 22M14 44L54 29" stroke={accent} strokeWidth="4" opacity=".3" />
      <path d="M32 10L35 16L42 17L37 22L38 29L32 26L26 29L27 22L22 17L29 16Z" fill={accent} />
      <text
        x="32"
        y="46"
        textAnchor="middle"
        fill="#ffffff"
        fontFamily="Arial, sans-serif"
        fontSize="21"
        fontWeight="800"
      >
        {initials}
      </text>
      <circle cx="32" cy="53" r="2" fill={accent} />
    </svg>
  );
}
