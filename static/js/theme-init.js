(() => {
  try {
    const saved = localStorage.getItem("spotlight:theme");
    const theme = saved === "light" || saved === "dark"
      ? saved
      : window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#f6f5f2" : "#121316");
  } catch (_) {}
})();
