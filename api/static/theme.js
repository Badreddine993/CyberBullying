// Loaded in <head> before the CSS so the page never flashes the wrong theme.
(function () {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => document.documentElement.setAttribute("data-bs-theme", mq.matches ? "dark" : "light");
  apply();
  mq.addEventListener("change", apply);
})();
