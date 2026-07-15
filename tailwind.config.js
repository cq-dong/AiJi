/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: '#f7f7fa',
        card: '#ffffff',
        ink: '#14141a',
        t2: '#6b6b75',
        t3: '#9a9aa5',
        pri: '#4f46e5',
        priS: '#eeedfd',
        brd: '#ececef',
        catIdea: '#4f46e5',
        catProject: '#0d9488',
        catPending: '#d97706',
        catFail: '#dc2626',
      },
      fontFamily: {
        sans: ['"Noto Sans SC"', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        screen: '32px',
        card: '16px',
        chip: '11px',
        btn: '12px',
        fab: '28px',
      },
    },
  },
  plugins: [],
}
