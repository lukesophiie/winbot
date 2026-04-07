/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#040810',
          900: '#070d1a',
          800: '#0a1225',
          700: '#0f1a35',
          600: '#152244',
        },
        cyan: {
          400: '#22d3ee',
          500: '#06b6d4',
        },
        green: {
          trade: '#00ff88',
          400: '#4ade80',
        },
        red: {
          trade: '#ff3b3b',
          400: '#f87171',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-in': 'slideIn 0.2s ease-out',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideIn: { '0%': { transform: 'translateY(-8px)', opacity: '0' },
                   '100%': { transform: 'translateY(0)', opacity: '1' } },
      },
      backdropBlur: { xs: '2px' },
    },
  },
  plugins: [],
}
