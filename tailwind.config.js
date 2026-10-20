/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0f1b33',
        slate2: '#475467',
        mist: '#f3f5f8',
        line: '#e3e7ee',
        saffron: { 50: '#fff6ea', 100: '#ffe8c7', 500: '#e8890c', 600: '#d9730d', 700: '#b85a0a' },
        ok: '#0e8a5f',
        bad: '#c0392b',
      },
      fontFamily: {
        sans: ['"Manrope"', 'system-ui', 'sans-serif'],
        display: ['"Bricolage Grotesque"', '"Manrope"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
