import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        'rt-green': '#2d5a3d',
        'rt-brown': '#6b4423',
        'rt-cream': '#f5f0e6'
      }
    }
  },
  plugins: []
} satisfies Config;
