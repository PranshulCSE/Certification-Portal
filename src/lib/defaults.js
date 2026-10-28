import { uid } from './format';

export const FONT_GROUPS = [
  {
    category: 'Formal & Academic Serif',
    fonts: [
      { label: 'Playfair Display (Serif)', value: "'Playfair Display', 'Noto Serif Devanagari', serif" },
      { label: 'Cormorant Garamond (Serif)', value: "'Cormorant Garamond', 'Noto Serif Devanagari', serif" },
      { label: 'EB Garamond (Diploma Serif)', value: "'EB Garamond', 'Noto Serif Devanagari', serif" },
      { label: 'Merriweather (Serif)', value: "'Merriweather', 'Noto Serif Devanagari', serif" },
      { label: 'Lora (Editorial Serif)', value: "'Lora', 'Noto Serif Devanagari', serif" },
      { label: 'Libre Baskerville (Classic Serif)', value: "'Libre Baskerville', 'Noto Serif Devanagari', serif" },
      { label: 'Bodoni Moda (Luxury Serif)', value: "'Bodoni Moda', 'Noto Serif Devanagari', serif" },
      { label: 'Prata (Didone Serif)', value: "'Prata', 'Noto Serif Devanagari', serif" },
    ],
  },
  {
    category: 'Royal & Inscriptional',
    fonts: [
      { label: 'Cinzel (Classical)', value: "'Cinzel', 'Noto Serif Devanagari', serif" },
      { label: 'Cinzel Decorative (Heading Display)', value: "'Cinzel Decorative', 'Noto Serif Devanagari', serif" },
    ],
  },
  {
    category: 'Calligraphy & Script (Signatures / Names)',
    fonts: [
      { label: 'Great Vibes (Flowing Script)', value: "'Great Vibes', cursive" },
      { label: 'Alex Brush (Certificate Calligraphy)', value: "'Alex Brush', cursive" },
      { label: 'Pinyon Script (Royal Formal Script)', value: "'Pinyon Script', cursive" },
      { label: 'Allura (Clean Signature Script)', value: "'Allura', cursive" },
      { label: 'Dancing Script (Casual Script)', value: "'Dancing Script', cursive" },
      { label: 'Parisienne (Vintage Script)', value: "'Parisienne', cursive" },
      { label: 'Tangerine (Graceful Script)', value: "'Tangerine', cursive" },
      { label: 'Satisfy (Brush Script)', value: "'Satisfy', cursive" },
    ],
  },
  {
    category: 'Modern Sans-Serif',
    fonts: [
      { label: 'Montserrat (Geometric Sans)', value: "'Montserrat', 'Noto Sans Devanagari', sans-serif" },
      { label: 'Poppins (Rounded Sans)', value: "'Poppins', 'Noto Sans Devanagari', sans-serif" },
      { label: 'Inter (Clean Technical)', value: "'Inter', 'Noto Sans Devanagari', sans-serif" },
      { label: 'Manrope (Contemporary Sans)', value: "'Manrope', 'Noto Sans Devanagari', sans-serif" },
      { label: 'Outfit (Modern Sans)', value: "'Outfit', 'Noto Sans Devanagari', sans-serif" },
      { label: 'Plus Jakarta Sans (Premium Sans)', value: "'Plus Jakarta Sans', 'Noto Sans Devanagari', sans-serif" },
      { label: 'Raleway (Elegant Sans)', value: "'Raleway', 'Noto Sans Devanagari', sans-serif" },
      { label: 'Oswald (Bold Condensed)', value: "'Oswald', 'Noto Sans Devanagari', sans-serif" },
      { label: 'Bricolage Grotesque (Expressive Sans)', value: "'Bricolage Grotesque', sans-serif" },
    ],
  },
  {
    category: 'Devanagari (Hindi / Sanskrit)',
    fonts: [
      { label: 'Noto Serif Devanagari (Hindi Serif)', value: "'Noto Serif Devanagari', serif" },
      { label: 'Noto Sans Devanagari (Hindi Sans)', value: "'Noto Sans Devanagari', sans-serif" },
    ],
  },
];

export const FONTS = FONT_GROUPS.flatMap((group) => group.fonts);

export const DEFAULT_SIZE = { width: 1754, height: 1240 }; // A4 landscape @150dpi

const text = (over) => ({
  id: uid(),
  type: 'text',
  text: '',
  x: DEFAULT_SIZE.width / 2,
  y: 400,
  size: 32,
  family: FONTS[6].value,
  weight: 500,
  italic: false,
  color: '#1f2937',
  align: 'center',
  mode: 'fit',
  maxWidth: 1300,
  lineHeight: 0,
  spacing: 0,
  ...over,
});

export function defaultConfig() {
  return {
    fields: [
      text({ text: 'CERTIFICATE', y: 250, size: 84, family: "'Cinzel', 'Noto Serif Devanagari', serif", weight: 700, color: '#9a6b12', spacing: 10 }),
      text({ text: 'of participation', y: 335, size: 38, family: "'Cormorant Garamond', 'Noto Serif Devanagari', serif", italic: true, color: '#475467' }),
      text({ text: 'This is to certify that', y: 450, size: 30, color: '#475467' }),
      text({ text: '{{name}}', y: 570, size: 78, family: "'Playfair Display', 'Noto Serif Devanagari', serif", weight: 700, italic: true, color: '#0f1b33' }),
      text({
        text: 'has successfully participated in {{event}}, organized by {{organizer}} on {{date}}.',
        y: 700, size: 31, mode: 'wrap', maxWidth: 1150, lineHeight: 50, color: '#1f2937',
      }),
      text({ text: 'Certificate ID: {{code}}', x: 110, y: 1160, size: 22, align: 'left', mode: 'fit', maxWidth: 500, color: '#475467' }),
    ],
    qr: { enabled: true, x: 1580, y: 1040, size: 190 },
    images: [],
    badges: [],
    signatories: [
      { id: uid(), name: 'Authorised Signatory', title: 'Organizing Committee', path: null, x: 520, y: 980, sigWidth: 240, lineWidth: 300, nameSize: 28, titleSize: 22, family: "'Manrope', 'Noto Sans Devanagari', sans-serif", color: '#1f2937' },
    ],
  };
}

export const DEFAULT_EMAIL = {
  subject: 'Your certificate for {{event}}',
  body: `Dear {{name}},

Congratulations! Please find your certificate for {{event}}, organized by {{organizer}}, attached to this email.

You can verify its authenticity at any time using this link:
{{verify_url}}

Certificate ID: {{code}}

Regards,
{{issuer}}`,
};

export const SAMPLE_VALUES = { name: 'Aarav Sharma', code: 'ABCD-EFGH-JKMN' };
