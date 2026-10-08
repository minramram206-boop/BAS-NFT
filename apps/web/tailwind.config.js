/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        district: {
          dark: '#121820',
          frame: '#8298ad',
          card: '#c5d5e5',
          inner: '#d7e4f0',
          border: '#2b3d4f',
          parchment: '#ebd6ae',
          int: '#3b74a6',
          aln: '#3f9252',
          cmp: '#8c579c',
        }
      },
      fontFamily: {
        pixel: ['var(--font-pixel)', 'monospace'],
        heading: ['var(--font-heading)', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
