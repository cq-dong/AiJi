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
      boxShadow: {
        sm: '0 1px 2px rgb(var(--aji-shadow) / 0.05)',
        md: '0 4px 12px rgb(var(--aji-shadow) / 0.06)',
        lg: '0 8px 24px rgb(var(--aji-shadow) / 0.08)',
        sheet: '0 -8px 30px rgb(var(--aji-shadow) / 0.12)',
      },
      transitionDuration: {
        fast: '150ms',
        base: '200ms',
        slow: '280ms',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.16,1,0.3,1)',
        in: 'cubic-bezier(0.7,0,0.84,0)',
      },
      keyframes: {
        'aji-slide-up': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        'aji-fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'aji-shimmer': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(100%)' },
        },
        'aji-indeterminate': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(250%)' },
        },
      },
      animation: {
        'slide-up': 'aji-slide-up 280ms cubic-bezier(0.16,1,0.3,1)',
        'fade-in': 'aji-fade-in 180ms ease-out',
        'shimmer': 'aji-shimmer 1.5s ease-in-out infinite',
        'indeterminate': 'aji-indeterminate 1.3s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
