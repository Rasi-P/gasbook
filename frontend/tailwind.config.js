/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        flame: '#f97316',
        ink: '#111827',
        kandam: '#0f766e',
      },
    },
  },
  plugins: [],
}
