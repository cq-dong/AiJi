/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // A1: 主题 token 走 CSS 变量（:root 浅 / .dark 深），屏层 bg-page/text-ink 等类不变即可切主题。
        // catIdea/catProject 等品牌强调色两套主题一致（静态 hex）。
        page: 'rgb(var(--c-page) / <alpha-value>)',
        card: 'rgb(var(--c-card) / <alpha-value>)',
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        t2: 'rgb(var(--c-t2) / <alpha-value>)',
        t3: 'rgb(var(--c-t3) / <alpha-value>)',
        pri: 'rgb(var(--c-pri) / <alpha-value>)',
        priS: 'rgb(var(--c-priS) / <alpha-value>)',
        brd: 'rgb(var(--c-brd) / <alpha-value>)',
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
