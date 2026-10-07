// Compiled once at build time (npm run build:css) instead of the Tailwind Play
// CDN, which downloaded a ~400 KB compiler and generated CSS in the browser on
// every page load.
module.exports = {
  content: [
    './Area Supa Ventres/*.html',
    './Area Supa Ventres/js/**/*.js',
    './Area Supa Ventres/components/**/*.js'
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          gold: '#C59A3F',
          'gold-dark': '#B08632',
          goldHover: '#B08632',
          goldLight: '#DFB04F',
          goldDark: '#9E7422',
          charcoal: '#212121',
          charcoalDark: '#141414',
          warmWhite: '#FBF9F5',
          surface: '#FFFFFF',
          inputBorder: '#E5E1D8',
          muted: '#7A756D',
          borderMuted: '#EFECE6',
          bg: '#F8F6F2',
          success: '#1B7F4B',
          danger: '#B93838'
        }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'Helvetica', 'Arial', 'sans-serif']
      }
    }
  },
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/container-queries')]
};
