/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{svelte,js,ts}'],
  theme: {
    extend: {
      colors: {
        theme: {
          bg: '#090a0f',
          surface: '#12141c',
          card: '#181a24',
          border: '#232636',
          muted: '#8e93a6',
          primary: '#6366f1',
          'primary-hover': '#4f46e5',
          accent: '#38bdf8',
        },
      },
    },
  },
  plugins: [],
};
