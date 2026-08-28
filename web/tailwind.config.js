/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        severity: {
          ok: '#10B981',
          warn: '#F59E0B',
          alert: '#EF4444',
          critical: '#7F1D1D',
          unknown: '#9CA3AF',
        },
      },
    },
  },
  plugins: [],
};
