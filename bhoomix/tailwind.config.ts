import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // ─── BhoomiX Color Tokens ───────────────────────────────────────────
      colors: {
        bhoomix: {
          // Base UI chrome (dark mode)
          bg:       '#0B0F1A',
          surface:  '#111827',
          surface2: '#1E2535',
          border:   '#2D3748',
          muted:    '#4B5563',
          text:     '#E2E8F0',
          subtext:  '#94A3B8',

          // Brand accent
          primary:       '#6366F1',
          'primary-dark':'#4F46E5',
          'primary-glow':'rgba(99,102,241,0.2)',

          // Semantic
          success: '#10B981',
          warning: '#F59E0B',
          error:   '#F43F5E',
          info:    '#38BDF8',
        },

        // Parcel status (for map legend and badges)
        parcel: {
          ai:        '#F59E0B', // Amber — AI Suggestion
          confirmed: '#10B981', // Emerald — Confirmed
          conflict:  '#F43F5E', // Rose — Conflict/Dispute
          pending:   '#94A3B8', // Slate — Pending
          selected:  '#6366F1', // Indigo — Selected
        },
      },

      // ─── Typography ─────────────────────────────────────────────────────
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },

      // ─── Spacing ────────────────────────────────────────────────────────
      spacing: {
        sidebar: '280px',
        'sidebar-collapsed': '52px',
        header: '52px',
        panel: '360px',
      },

      // ─── Border Radius ──────────────────────────────────────────────────
      borderRadius: {
        sm:  '4px',
        md:  '8px',
        lg:  '12px',
        xl:  '16px',
        pill:'9999px',
      },

      // ─── Box Shadow (Elevation) ─────────────────────────────────────────
      boxShadow: {
        'bhoomix-sm':   '0 1px 3px rgba(0,0,0,0.4)',
        'bhoomix-md':   '0 4px 12px rgba(0,0,0,0.5)',
        'bhoomix-glow': '0 0 20px rgba(99,102,241,0.25)',
        'parcel-ai':    '0 0 12px rgba(245,158,11,0.3)',
        'parcel-conf':  '0 0 12px rgba(16,185,129,0.3)',
        'parcel-conf2': '0 0 12px rgba(244,63,94,0.3)',
      },

      // ─── Transitions ────────────────────────────────────────────────────
      transitionDuration: {
        micro:  '150',
        normal: '250',
        drawer: '350',
      },
      transitionTimingFunction: {
        'bhoomix': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },

      // ─── Animation ──────────────────────────────────────────────────────
      keyframes: {
        'fade-in': {
          '0%':   { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          '0%':   { opacity: '0', transform: 'translateX(16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(99,102,241,0)' },
          '50%':      { boxShadow: '0 0 20px 4px rgba(99,102,241,0.3)' },
        },
        'spin-slow': {
          '0%':   { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'fade-in':        'fade-in 250ms cubic-bezier(0.4,0,0.2,1) both',
        'slide-in-right': 'slide-in-right 300ms cubic-bezier(0.4,0,0.2,1) both',
        'pulse-glow':     'pulse-glow 2s ease-in-out infinite',
        'spin-slow':      'spin-slow 3s linear infinite',
      },

      // ─── Background Gradients ───────────────────────────────────────────
      backgroundImage: {
        'bhoomix-gradient': 'linear-gradient(135deg, #0B0F1A 0%, #111827 50%, #1a1f35 100%)',
        'confidence-bar':   'linear-gradient(90deg, #F59E0B 0%, #10B981 100%)',
        'header-gradient':  'linear-gradient(90deg, #111827 0%, #1E2535 100%)',
      },
    },
  },
  plugins: [],
};

export default config;
