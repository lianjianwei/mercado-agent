const SNAPSHOT_SOURCE =
  'docs/美客多受限商品品牌列表.md (Mercado Libre official snapshot 2026-08-26)';

// Canonical display names from the local snapshot, including documented aliases.
// Matching is case- and punctuation-insensitive; aliases like `AP` / `Audemars
// Piguet`, `CK` / `CALVIN KLEIN` and `YSL` / `YVES SAINT LAURENT` are expanded
// so any alias resolves to the same restricted brand.
const BRAND_GROUPS: ReadonlyArray<{
  canonical: string;
  aliases: string[];
}> = [
  { canonical: 'ADIDAS', aliases: [] },
  { canonical: 'ADOLFO DOMINGUEZ', aliases: [] },
  { canonical: 'Audemars Piguet', aliases: ['AP', 'AUDEMARS PIGUET'] },
  { canonical: 'APPLE', aliases: [] },
  { canonical: 'ARMAF', aliases: [] },
  { canonical: 'Armani', aliases: ['ARMANI'] },
  { canonical: 'ASICS', aliases: [] },
  { canonical: 'Balenciaga', aliases: ['BALENCIAGA'] },
  { canonical: 'BIMBA Y LOLA', aliases: [] },
  { canonical: 'BIRKENSTOCK', aliases: [] },
  { canonical: 'BOSE', aliases: [] },
  { canonical: 'BURBERRY', aliases: [] },
  { canonical: 'BVLGARI', aliases: [] },
  { canonical: 'Byredo', aliases: ['BYREDO'] },
  { canonical: 'Calvin Klein', aliases: ['CALVIN KLEIN', 'CK'] },
  { canonical: 'CAROLINA HERRERA', aliases: [] },
  { canonical: 'Cartier', aliases: ['CARTIER'] },
  { canonical: 'CASIO', aliases: [] },
  { canonical: 'Céline', aliases: ['CELINE'] },
  { canonical: 'CERAVE', aliases: [] },
  { canonical: 'CETAPHIL', aliases: [] },
  { canonical: 'CHANEL', aliases: [] },
  { canonical: 'CHARLOTTE TILBURY', aliases: [] },
  { canonical: 'CLINIQUE', aliases: [] },
  { canonical: 'CONVERSE', aliases: [] },
  { canonical: 'CREED', aliases: [] },
  { canonical: 'CROCS', aliases: [] },
  { canonical: 'DIOR', aliases: [] },
  { canonical: 'DOLCE GABBANA', aliases: [] },
  { canonical: 'DYSON', aliases: [] },
  { canonical: 'ESTEE LAUDER', aliases: [] },
  { canonical: 'EUCERIN', aliases: [] },
  { canonical: 'Fendi', aliases: ['FENDI'] },
  { canonical: 'FENTY BEAUTY', aliases: [] },
  { canonical: 'FIFA', aliases: [] },
  { canonical: 'FILA', aliases: [] },
  { canonical: 'GIORGIO ARMANI', aliases: [] },
  { canonical: 'GIVENCHY', aliases: [] },
  { canonical: 'GOLDEN GOOSE', aliases: [] },
  { canonical: 'GUCCI', aliases: [] },
  { canonical: 'Hermes', aliases: ['HERMES'] },
  { canonical: 'HOKA', aliases: [] },
  { canonical: 'Huda Beauty', aliases: ['HUDA BEAUTY'] },
  { canonical: 'HUGO BOSS', aliases: [] },
  { canonical: 'ISDIN', aliases: [] },
  { canonical: 'JANSPORT', aliases: [] },
  { canonical: 'JEAN PAUL GAULTIER', aliases: [] },
  { canonical: 'Jo Malone', aliases: ['JO MALONE'] },
  { canonical: 'JORDAN', aliases: [] },
  { canonical: 'KYLIE COSMETICS', aliases: [] },
  { canonical: 'LA ROCHE POSAY', aliases: [] },
  { canonical: 'LABUBU', aliases: [] },
  { canonical: 'LACOSTE', aliases: [] },
  { canonical: 'LANCOME', aliases: [] },
  { canonical: 'Laneige', aliases: ['LANEIGE'] },
  { canonical: 'LATTAFA', aliases: [] },
  { canonical: 'LE LABO', aliases: [] },
  { canonical: "LEVI'S", aliases: [] },
  { canonical: 'LOREAL PARIS', aliases: [] },
  { canonical: 'LOUIS VUITTON', aliases: [] },
  { canonical: 'LULULEMON', aliases: [] },
  { canonical: 'MAC', aliases: [] },
  { canonical: 'MAYBELLINE', aliases: [] },
  { canonical: 'MEDICUBE', aliases: [] },
  { canonical: 'Nars', aliases: ['NARS'] },
  { canonical: 'NBA', aliases: [] },
  { canonical: 'NEUTROGENA', aliases: [] },
  { canonical: 'NEW BALANCE', aliases: [] },
  { canonical: 'New Era', aliases: ['NEW ERA'] },
  { canonical: 'NFL', aliases: [] },
  { canonical: 'NHL', aliases: [] },
  { canonical: 'NIKE', aliases: [] },
  { canonical: 'OAKLEY', aliases: [] },
  { canonical: 'OLAPLEX', aliases: [] },
  { canonical: 'Omega', aliases: ['OMEGA'] },
  { canonical: 'ON CLOUD', aliases: [] },
  { canonical: 'Patek Philippe', aliases: ['PATEK PHILIPPE'] },
  { canonical: 'PHILIPS', aliases: [] },
  { canonical: 'PRADA', aliases: [] },
  { canonical: 'PUMA', aliases: [] },
  { canonical: 'RALPH LAUREN', aliases: [] },
  { canonical: 'RARE BEAUTY', aliases: [] },
  { canonical: 'RAY-BAN', aliases: [] },
  { canonical: 'Richard Mille', aliases: ['RICHARD MILLE'] },
  { canonical: 'ROLEX', aliases: [] },
  { canonical: 'SAMSUNG', aliases: [] },
  { canonical: 'SKINCEUTICALS', aliases: [] },
  { canonical: 'SOL DE JANEIRO', aliases: [] },
  { canonical: 'THE NORTH FACE', aliases: [] },
  { canonical: 'THE ORDINARY', aliases: [] },
  { canonical: 'Tiffany & Co.', aliases: ['TIFFANY', 'TIFFANY AND CO', 'TIFFANY & CO'] },
  { canonical: 'TOM FORD', aliases: [] },
  { canonical: 'UNDER ARMOUR', aliases: [] },
  { canonical: 'VALENTINO', aliases: [] },
  { canonical: 'Van Cleef & Arpels', aliases: ['VAN CLEEF & ARPELS', 'VAN CLEEF AND ARPELS'] },
  { canonical: 'VEJA VERT', aliases: [] },
  { canonical: 'VERSACE', aliases: [] },
  { canonical: 'VICHY', aliases: [] },
  { canonical: 'Yves Saint Laurent', aliases: ['YVES SAINT LAURENT', 'YSL'] },
];

// Fold to a comparable key: uppercase, keep letters/digits, collapse spaces.
function normalizeBrandName(value: string): string {
  return value
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const RESTRICTED_KEYS: ReadonlySet<string> = (() => {
  const keys = new Set<string>();
  for (const group of BRAND_GROUPS) {
    for (const name of [group.canonical, ...group.aliases]) {
      keys.add(normalizeBrandName(name));
    }
  }
  return keys;
})();

export type RestrictedBrandGroup = (typeof BRAND_GROUPS)[number];

export function restrictedBrandNames(): string[] {
  return BRAND_GROUPS.map((group) => group.canonical);
}

export function isRestrictedBrand(value: string | null | undefined): boolean {
  if (!value) return false;
  const key = normalizeBrandName(value);
  return key.length > 0 && RESTRICTED_KEYS.has(key);
}

export const RESTRICTED_BRANDS_SNAPSHOT_SOURCE = SNAPSHOT_SOURCE;
