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
        md: '0 1px 2px rgb(var(--aji-shadow) / 0.04), 0 4px 12px rgb(var(--aji-shadow) / 0.06)',
        lg: '0 2px 4px rgb(var(--aji-shadow) / 0.04), 0 8px 24px rgb(var(--aji-shadow) / 0.08)',
        sheet: '0 -8px 30px rgb(var(--aji-shadow) / 0.12)',
        // 精致卡片：近距接触影 + 远距环境影，双层叠加出“浮起”感
        card: '0 1px 2px rgb(var(--aji-shadow) / 0.04), 0 10px 28px -6px rgb(var(--aji-shadow) / 0.08)',
        cardHover: '0 2px 4px rgb(var(--aji-shadow) / 0.05), 0 14px 34px -6px rgb(var(--aji-shadow) / 0.12)',
        // 主按钮/悬浮钮：品牌色发光 + 顶部内高光（玻璃质感）
        glowPri: '0 8px 22px -6px rgb(var(--c-pri) / 0.5), inset 0 1px 0 0 rgb(255 255 255 / 0.22)',
        glowPriSm: '0 4px 14px -4px rgb(var(--c-pri) / 0.45), inset 0 1px 0 0 rgb(255 255 255 / 0.18)',
        // 元素浮于内容之上（toast / 弹出层）
        pop: '0 4px 8px rgb(var(--aji-shadow) / 0.06), 0 16px 40px -8px rgb(var(--aji-shadow) / 0.16)',
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
        'aji-fade-in-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'aji-scale-in': {
          from: { opacity: '0', transform: 'scale(0.9)' },
          to: { opacity: '1', transform: 'scale(1)' },
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
        // 列表/卡片入场：上浮+淡入，both 填充模式配合 animationDelay 做 stagger
        'fade-in-up': 'aji-fade-in-up 340ms cubic-bezier(0.16,1,0.3,1) both',
        'scale-in': 'aji-scale-in 220ms cubic-bezier(0.16,1,0.3,1) both',
        'shimmer': 'aji-shimmer 1.5s ease-in-out infinite',
        'indeterminate': 'aji-indeterminate 1.3s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
