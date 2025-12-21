// Theme configuration for consistent styling across the application

export const theme = {
  colors: {
    primary: {
      DEFAULT: '#000000',
      hover: '#1a1a1a',
      light: '#f5f5f5',
    },
    secondary: {
      DEFAULT: '#ffffff',
      hover: '#f9f9f9',
    },
    background: {
      DEFAULT: '#f5f5f5',
      card: '#ffffff',
    },
    text: {
      primary: '#000000',
      secondary: '#666666',
      muted: '#999999',
    },
    border: {
      DEFAULT: '#000000',
      light: '#e0e0e0',
    },
    accent: {
      DEFAULT: '#000000',
      hover: '#1a1a1a',
    },
  },
  fonts: {
    family: {
      sans: ['Inter', 'system-ui', 'sans-serif'],
      heading: ['Inter', 'system-ui', 'sans-serif'],
    },
    sizes: {
      xs: '0.75rem',      // 12px
      sm: '0.875rem',     // 14px
      base: '1rem',       // 16px
      lg: '1.125rem',     // 18px
      xl: '1.25rem',      // 20px
      '2xl': '1.5rem',    // 24px
      '3xl': '1.875rem',  // 30px
      '4xl': '2.25rem',   // 36px
      '5xl': '3rem',      // 48px
    },
    weights: {
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
  },
  spacing: {
    xs: '0.5rem',   // 8px
    sm: '0.75rem',  // 12px
    md: '1rem',     // 16px
    lg: '1.5rem',   // 24px
    xl: '2rem',     // 32px
    '2xl': '3rem',  // 48px
    '3xl': '4rem',  // 64px
  },
  borderRadius: {
    none: '0',
    sm: '0.125rem',
    DEFAULT: '0.25rem',
    md: '0.375rem',
    lg: '0.5rem',
    xl: '0.75rem',
    full: '9999px',
  },
  shadows: {
    sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    DEFAULT: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
  },
} as const;

// Typography presets for quick styling
export const typography = {
  heading: {
    h1: 'text-5xl font-bold text-black',
    h2: 'text-4xl font-bold text-black',
    h3: 'text-3xl font-bold text-black',
    h4: 'text-2xl font-bold text-black',
    h5: 'text-xl font-semibold text-black',
    h6: 'text-lg font-semibold text-black',
  },
  body: {
    base: 'text-base text-black',
    large: 'text-lg text-black',
    medium: 'text-base text-black',
    small: 'text-sm text-black',
    muted: 'text-base text-gray-600',
  },
  button: {
    primary: 'text-base font-medium',
    secondary: 'text-base font-medium',
    outline: 'text-base font-medium',
  },
} as const;

