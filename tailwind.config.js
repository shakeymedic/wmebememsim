// Used only by the production build (scripts/build.mjs). It mirrors the inline `tailwind.config`
// in index.html, which the in-browser Tailwind CDN uses when the source is run directly.
module.exports = {
    content: ['./index.html', './data/**/*.js'],
    theme: { extend: { colors: { slate: { 950: '#020617' } } } },
    plugins: []
};
