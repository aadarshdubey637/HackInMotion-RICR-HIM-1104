import type { Config } from 'tailwindcss';

/**
 * Design tokens.
 *
 * Colour carries meaning in this app: a farmer should be able to glance at the
 * screen and know whether something needs attention. Severity colours are kept
 * deliberately few and consistent — red only ever means "act now".
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand — the green of a healthy crop.
        brand: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
        },
        // Earth tones for surfaces, so the UI feels agricultural not clinical.
        soil: {
          50: '#faf8f5',
          100: '#f2ede5',
          200: '#e3d9c9',
          300: '#cdbca3',
          400: '#b39a78',
          500: '#9c7f5c',
          600: '#856a4c',
          700: '#6d5540',
          800: '#5a4738',
          900: '#4a3b30',
        },
        // Severity scale — used by alerts, health flags and action cards.
        critical: '#dc2626',
        high: '#ea580c',
        medium: '#d97706',
        low: '#0891b2',
        info: '#4b5563',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.25s ease-out',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
};

export default config;
