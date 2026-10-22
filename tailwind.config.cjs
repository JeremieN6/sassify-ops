/** Sassify Ops — thème Tailwind v3 (le projet est en Tailwind 3.4 via @nuxtjs/tailwindcss 6 : aucune conversion v4 nécessaire).
 *  Fichier en .cjs car package.json déclare "type": "module".
 *  Les couleurs en hexadécimal acceptent les modificateurs d'opacité : bg-ok/12, bg-warn/14, bg-crit/14, bg-accent/16
 *  reproduisent les teintes de fond ; ces paliers (6, 12, 14, 16) sont ajoutés à l'échelle d'opacité ci-dessous.
 *  Texte : text-ink (principal) et text-ink-muted (secondaire).
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        bg: '#080B12',
        rail: '#0B0F18',
        panel: '#0E1320',
        field: '#090D17',
        line: { DEFAULT: '#1D2638', strong: '#2A3550' },
        ink: { DEFAULT: '#E8ECF4', muted: '#8E99B0' },
        accent: {
          DEFAULT: '#8B93FF',
          soft: '#C9CDFF',
          fill: '#5B63F0',
          'fill-hover': '#6C73F5',
        },
        ok: '#4ADE9B',
        warn: '#F6B94C',
        crit: '#FF7A7A',
        series: { fixed: '#3B4670' },
      },
      fontFamily: {
        sans: ['"Instrument Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        label: ['12px', { lineHeight: '1.45', letterSpacing: '0.06em' }],
        small: ['13px', { lineHeight: '1.45' }],
        body: ['14px', { lineHeight: '1.45' }],
        section: ['16px', { lineHeight: '1.45', fontWeight: '600' }],
        title: ['28px', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '600' }],
        kpi: ['32px', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '500' }],
      },
      borderRadius: {
        xs: '4px',
        sm: '6px',
        md: '8px',
        lg: '10px',
        xl: '12px',
      },
      opacity: {
        6: '0.06',
        12: '0.12',
        14: '0.14',
        16: '0.16',
      },
      keyframes: {
        'live-pulse': {
          '0%': { boxShadow: '0 0 0 0 rgba(74,222,155,.5)' },
          '100%': { boxShadow: '0 0 0 8px rgba(74,222,155,0)' },
        },
      },
      animation: {
        'live-pulse': 'live-pulse 2s ease-out infinite',
      },
    },
  },
};
