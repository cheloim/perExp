import "@testing-library/jest-dom/vitest";

// jsdom no implementa scrollIntoView ni las APIs de layout que los componentes
// usan para auto-scroll y auto-resize de textarea.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
