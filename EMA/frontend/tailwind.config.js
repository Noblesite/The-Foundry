/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx,mdx}'], // Covers additional file types
  darkMode: 'class', // Enable class-based dark mode
  theme: {
    extend: {
      backgroundImage: {
        'primary': 'linear-gradient(to right, var(--primary-start-color), var(--primary-mid-color), var(--primary-end-color))',
        'background': 'linear-gradient(to bottom, var(--background-start-color), var(--background-end-color))',
      },
      colors: {
        //primary: 'var(--primary-color)', // Use CSS variables for theme colors
        secondary: 'var(--secondary-color)',
        //background: 'var(--background-color)',
        text: 'var(--text-color)',
        accent: 'var(--accent-color)',
        hover: 'var(--hover-color)',
        markdownPrimary: 'var(--markdown-primary)',
        markdownSecondary: 'var(--markdown-secondary)',
      },
      fontFamily: {
        primary: ['var(--font-primary)', 'sans-serif'], // Use CSS variables for fonts
        secondary: ['var(--font-secondary)', 'sans-serif'],
      },
      fontSize: {
        xs: 'var(--font-size-xs)',
        sm: 'var(--font-size-sm)',
        md: 'var(--font-size-md)',
        lg: 'var(--font-size-lg)',
        xl: 'var(--font-size-xl)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('@tailwindcss/forms'),
    require('@tailwindcss/aspect-ratio'),
  ],
};

