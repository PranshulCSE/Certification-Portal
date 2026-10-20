import { uid } from './format';

export const FONTS = [
  { label: 'Playfair Display (serif)', value: "'Playfair Display', 'Noto Serif Devanagari', serif" },
  { label: 'Cormorant Garamond (serif)', value: "'Cormorant Garamond', 'Noto Serif Devanagari', serif" },
  { label: 'Merriweather (serif)', value: "'Merriweather', 'Noto Serif Devanagari', serif" },
  { label: 'Cinzel (inscription)', value: "'Cinzel', 'Noto Serif Devanagari', serif" },
  { label: 'Montserrat (sans)', value: "'Montserrat', 'Noto Sans Devanagari', sans-serif" },
  { label: 'Poppins (sans)', value: "'Poppins', 'Noto Sans Devanagari', sans-serif" },
  { label: 'Manrope (sans)', value: "'Manrope', 'Noto Sans Devanagari', sans-serif" },
  { label: 'Great Vibes (script)', value: "'Great Vibes', cursive" },
  { label: 'Dancing Script (script)', value: "'Dancing Script', cursive" },
  { label: 'Noto Sans Devanagari (Hindi)', value: "'Noto Sans Devanagari', sans-serif" },
  { label: 'Noto Serif Devanagari (Hindi)', value: "'Noto Serif Devanagari', serif" },
];

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
      text({ text: 'CERTIFICATE', y: 250, size: 84, family: FONTS[3].value, weight: 700, color: '#9a6b12', spacing: 10 }),
      text({ text: 'of participation', y: 335, size: 38, family: FONTS[1].value, italic: true, color: '#475467' }),
      text({ text: 'This is to certify that', y: 450, size: 30, color: '#475467' }),
      text({ text: '{{name}}', y: 570, size: 78, family: FONTS[0].value, weight: 700, italic: true, color: '#0f1b33' }),
      text({
        text: 'has successfully participated in {{event}}, organized by {{organizer}} on {{date}}.',
        y: 700, size: 31, mode: 'wrap', maxWidth: 1150, lineHeight: 50, color: '#1f2937',
      }),
      text({ text: 'Certificate ID: {{code}}', x: 110, y: 1160, size: 22, align: 'left', mode: 'fit', maxWidth: 500, color: '#475467' }),
    ],
    qr: { enabled: true, x: 1580, y: 1040, size: 190 },
    images: [],
    signatories: [
      { id: uid(), name: 'Authorised Signatory', title: 'Organizing Committee', path: null, x: 520, y: 980, sigWidth: 240, lineWidth: 300, nameSize: 28, titleSize: 22, family: FONTS[6].value, color: '#1f2937' },
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
