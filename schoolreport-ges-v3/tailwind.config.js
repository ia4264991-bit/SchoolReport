/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        blue: {
          DEFAULT: '#185FA5',
          dark: '#0C447C',
          light: '#E6F1FB',
        },
        green: {
          DEFAULT: '#3B6D11',
          light: '#EAF3DE',
        },
        amber: {
          DEFAULT: '#854F0B',
          light: '#FFF8E8',
        },
        red: {
          DEFAULT: '#c0392b',
          light: '#FCEBEB',
        },
        border: '#e3e8f0',
        bg: '#f4f6fb',
        purple: {
          100: '#f3e8ff',
          700: '#7c3aed',
        },
      },
      fontFamily: {
        sans: ['Segoe UI', 'system-ui', '-apple-system', 'Arial', 'sans-serif'],
      },
      borderRadius: {
        xl2: '13px',
        xl3: '16px',
      },
      keyframes: {
        'slide-up': {
          from: { transform: 'translateY(100%)', opacity: '0' },
          to:   { transform: 'translateY(0)',    opacity: '1' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
      },
      animation: {
        'slide-up': 'slide-up 0.25s ease-out',
        'fade-in':  'fade-in 0.2s ease-out',
      },
      screens: {
        xs: '375px',
      },
    },
  },
  plugins: [],
}
