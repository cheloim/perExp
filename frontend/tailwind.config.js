import defaultTheme from 'tailwindcss/defaultTheme'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class', // We can force dark mode if we want, but we'll apply dark utility classes directly or just build dark explicitly
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', ...defaultTheme.fontFamily.sans],
      },
      colors: {
        // Warm light background
        background: '#fafaf9',
        surface: '#ffffff',
        sidebar: '#f4f3f1',
        // Vibrant neon purple/indigo brand
        brand: {
          50:  '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6', // vibrant purple
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95',
        },
      },
      boxShadow: {
        'glass': '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)',
        'glass-sm': '0 1px 2px rgba(0,0,0,0.06)',
        'card': '0 1px 4px rgba(0,0,0,0.08)',
        'neon': '0 0 10px rgba(139,92,246,0.4), 0 0 20px rgba(139,92,246,0.2)',
      },
      borderRadius: {
        xl: '0.75rem',
        '2xl': '1rem',
        '3xl': '1.25rem',
      },
      backgroundImage: {
        'glass-gradient': 'linear-gradient(135deg, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0.4) 100%)',
        'glow-gradient': 'radial-gradient(circle at 30% 20%, rgba(139,92,246,0.06) 0%, rgba(0,0,0,0) 60%)',
      }
    },
  },
  plugins: [],
}
