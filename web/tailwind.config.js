/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        severity: {
          ok: '#16a34a',       // green-600
          warn: '#d97706',     // amber-600
          alert: '#dc2626',    // red-600
          critical: '#7f1d1d', // red-900
          unknown: '#6b7280',  // gray-500
        },
      },
    },
  },
  plugins: [],
};
