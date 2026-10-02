/*! Spotlight Studio – applies the saved theme before first paint (avoids a dark/light flash).
 *  Kept as a separate blocking script because the CSP forbids inline scripts. */
(function () {
  try {
    var pref = localStorage.getItem("spotlight:theme") || "auto";
    var light = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
    var theme = pref === "auto" ? (light ? "light" : "dark") : pref;
    document.documentElement.setAttribute("data-theme", theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#eef2f8" : "#07080d");
  } catch (e) { /* storage blocked – keep the default dark theme */ }
})();
