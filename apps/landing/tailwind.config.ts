import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Legacy tokens (preserved) ─────────────────────
        cyan: { DEFAULT: '#00d1ff' },
        obsidian: '#010101',

        // ── HNScorpPH parent · Cyan ───────────────────────
        hns: {
          50:   '#ECFEFF',
          100:  '#CFFAFE',
          200:  '#A5F3FC',
          300:  '#67E8F9',
          400:  '#22D3EE',
          500:  '#06B6D4',
          600:  '#0891B2', // primary
          700:  '#0E7490',
          800:  '#155E75',
          900:  '#164E63',
          deep: '#0E5A6E',
          soft: '#E0F4F7',
        },

        // ── Clerque · Trust Indigo ────────────────────────
        clerque: {
          50:   '#EEF2FF',
          100:  '#E0E7FF',
          200:  '#C7D2FE',
          300:  '#A5B4FC',
          400:  '#818CF8',
          500:  '#6366F1',
          600:  '#4F46E5', // primary
          700:  '#4338CA',
          800:  '#3730A3',
          900:  '#312E81',
          deep: '#312E81',
          soft: '#EEF2FF',
        },

        // ── Steady · Calming Teal ─────────────────────────
        steady: {
          50:   '#F0FDFA',
          100:  '#CCFBF1',
          200:  '#99F6E4',
          300:  '#5EEAD4',
          400:  '#2DD4BF',
          500:  '#14B8A6',
          600:  '#0D9488', // primary
          700:  '#0F766E',
          800:  '#115E59',
          900:  '#134E4A',
          deep: '#115E59',
          soft: '#E6FAF6',
        },

        // ── Shared neutrals ───────────────────────────────
        ink:   '#0F172A',
        paper: '#FFFFFF',
        sand:  '#FAFAF9',
      },

      fontFamily: {
        // Populated by Inter Tight CSS variable (set in layout.tsx)
        sans:    ['var(--font-inter-tight)', 'Inter', 'system-ui', 'sans-serif'],
        display: ['var(--font-inter-tight)', 'Inter', 'system-ui', 'sans-serif'],
      },

      letterSpacing: {
        'wordmark':       '-0.02em',
        'wordmark-tight': '-0.025em',
      },
      animation: {
        ticker: 'ticker 30s linear infinite',
        shimmer: 'shimmer 2.5s linear infinite',
        'pulse-ring': 'pulse-ring 1.5s ease-out infinite',
        float: 'float 6s ease-in-out infinite',
      },
      keyframes: {
        ticker: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% center' },
          '100%': { backgroundPosition: '200% center' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.8)', opacity: '0.8' },
          '100%': { transform: 'scale(2.2)', opacity: '0' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-12px)' },
        },
      },
    },
  },
  plugins: [],
};
export default config;
