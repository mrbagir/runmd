// Tailwind is used only at *development* time to generate static/vendor/tailwind.css.
// Rebuild after changing classes in static/index.html or static/js/**:  make css
module.exports = {
  content: ['../../static/index.html', '../../static/js/**/*.js'],
  theme: { extend: {} },
  plugins: [],
};
