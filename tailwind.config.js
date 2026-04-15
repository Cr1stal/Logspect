/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src-vue/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['Fira Code', 'SF Mono', 'Monaco', 'Inconsolata', 'Droid Sans Mono', 'monospace'],
      },
      animation: {
        'pulse-dot': 'pulse-dot 2s infinite',
      },
      keyframes: {
        'pulse-dot': {
          '0%': { opacity: '1' },
          '50%': { opacity: '0.5' },
          '100%': { opacity: '1' },
        }
      }
    },
  },
  plugins: [],
};
