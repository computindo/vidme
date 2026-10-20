/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{svelte,js,ts}'],
  theme: {
    extend: {
      colors: {
        theme: {
          bg: '#0b1326',
          surface: '#10182b',
          card: '#171f33',
          border: '#1e293b',
          muted: '#94a3b8',
          primary: '#6366f1',
          'primary-hover': '#4f46e5',
          accent: '#38bdf8',
        },
      },
    },
  },
  plugins: [],
};
