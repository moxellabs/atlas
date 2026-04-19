/** Stable marker used by tests to prove the Moxel-branded OpenAPI shell is served. */
export const MOXEL_SCALAR_THEME_MARKER = "moxel-atlas-openapi-theme";

/** CDN used by the custom Moxel OpenAPI shell to mount Scalar inside our page chrome. */
export const SCALAR_CDN_URL =
	"https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.52.5/dist/browser/standalone.min.js";

/**
 * Scalar runtime overrides for components that are mounted after the page shell.
 *
 * These rules intentionally avoid changing global Scalar background tokens. The
 * search dialog reuses `--scalar-background-1`, which the page theme keeps
 * translucent for the banded Moxel background, so the modal needs its own
 * opaque surface scoped to Scalar's verified search modal classes.
 */
export const moxelScalarCustomCss = `
body.moxel-openapi-body #headlessui-portal-root.scalar-app .scalar-modal-layout {
  left: var(--moxel-openapi-sidebar-width, 288px) !important;
  width: calc(100dvw - var(--moxel-openapi-sidebar-width, 288px)) !important;
  background: transparent !important;
  backdrop-filter: none !important;
  animation-duration: 0.15s !important;
}

body.moxel-openapi-body #headlessui-portal-root.scalar-app .scalar-modal-layout::before {
  content: "";
  position: absolute;
  inset: 0;
  background-color: rgba(0, 3, 10, 0.2);
  pointer-events: none;
}

body.moxel-openapi-body #headlessui-portal-root.scalar-app .scalar-modal.scalar-modal-search {
  --scalar-background-1: rgba(3, 7, 17, 0.92);
  --scalar-background-2: rgba(6, 15, 28, 0.9);
  --scalar-background-3: rgba(12, 24, 38, 0.94);
  position: relative;
  z-index: 1;
  border: 1px solid rgba(70, 215, 255, 0.34) !important;
  background-color: rgba(3, 7, 17, 0.92) !important;
  box-shadow: 0 28px 82px rgba(0, 0, 0, 0.58), inset 0 1px 0 rgba(109, 242, 214, 0.08) !important;
  backdrop-filter: blur(12px) saturate(112%);
  animation-duration: 0.15s !important;
  animation-delay: 0.05s !important;
}

body.moxel-openapi-body #headlessui-portal-root.scalar-app .scalar-modal.scalar-modal-search .scalar-modal-body {
  background: rgba(3, 7, 17, 0.92) !important;
}

body.moxel-openapi-body #headlessui-portal-root.scalar-app .scalar-modal.scalar-modal-search label {
  border-bottom: 1px solid rgba(70, 215, 255, 0.2) !important;
  background: rgba(6, 15, 28, 0.9) !important;
  color: var(--fg-100) !important;
}

body.moxel-openapi-body #headlessui-portal-root.scalar-app .scalar-modal.scalar-modal-search input[role="combobox"] {
  background: transparent !important;
  color: var(--fg-100) !important;
}

body.moxel-openapi-body #headlessui-portal-root.scalar-app .scalar-modal.scalar-modal-search input[role="combobox"]::placeholder {
  color: rgba(195, 210, 240, 0.62) !important;
}

body.moxel-openapi-body #headlessui-portal-root.scalar-app .scalar-modal.scalar-modal-search [role="listbox"] {
  background: rgba(3, 7, 17, 0.92) !important;
}

body.moxel-openapi-body #headlessui-portal-root.scalar-app .scalar-modal.scalar-modal-search [role="option"] {
  color: var(--fg-100) !important;
}

body.moxel-openapi-body #headlessui-portal-root.scalar-app .scalar-modal.scalar-modal-search [role="option"]:hover,
body.moxel-openapi-body #headlessui-portal-root.scalar-app .scalar-modal.scalar-modal-search [role="option"][aria-selected="true"] {
  background: rgba(53, 240, 255, 0.11) !important;
  color: var(--fg-100) !important;
}

body.moxel-openapi-body #headlessui-portal-root.scalar-app .scalar-modal.scalar-modal-search .ref-search-meta {
  border-top: 1px solid rgba(70, 215, 255, 0.18) !important;
  background: rgba(3, 7, 17, 0.94) !important;
  color: rgba(195, 210, 240, 0.72) !important;
}

@media (max-width: 1000px) {
  body.moxel-openapi-body #headlessui-portal-root.scalar-app .scalar-modal-layout {
    left: 0 !important;
    width: 100dvw !important;
  }
}
`;

/** CSS for the custom Moxel OpenAPI shell and embedded Scalar reference. */
export const moxelOpenApiCss = `
/* ${MOXEL_SCALAR_THEME_MARKER} */
:root {
  color-scheme: dark;
  font-family: "Space Grotesk", Inter, system-ui, sans-serif;
  --moxel-topbar-height: 4.15rem;
  --moxel-openapi-sidebar-width: 288px;
  --bg-900: #030711;
  --bg-800: #060b1a;
  --bg-700: rgba(12, 18, 32, 0.86);
  --fg-100: #f5f8ff;
  --fg-300: rgba(215, 228, 255, 0.8);
  --fg-muted: rgba(195, 210, 240, 0.72);
  --accent-400: #35f0ff;
  --accent-500: #6df2d6;
  --accent-soft: rgba(55, 200, 255, 0.15);
  --border-strong: rgba(70, 215, 255, 0.5);
  --border-soft: rgba(70, 215, 255, 0.2);
  --moxel-panel: rgba(4, 9, 18, 0.30);
  --moxel-panel-strong: rgba(3, 7, 17, 0.37);
  --moxel-panel-border: rgba(70, 215, 255, 0.24);
  --shadow: 0 22px 44px rgba(2, 8, 26, 0.65);
  --scalar-font: "Space Grotesk", Inter, system-ui, sans-serif;
  --scalar-font-code: "SFMono-Regular", "Cascadia Code", "Roboto Mono", ui-monospace, monospace;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  min-height: 100%;
  margin: 0;
  background: var(--bg-900);
  color: var(--fg-100);
}

body {
  overflow-x: hidden;
  line-height: 1.55;
  font-size: 1rem;
}

canvas#banded-field {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  display: block;
  z-index: 0;
  pointer-events: none;
  background: transparent;
  opacity: 0.46;
}

.noise {
  position: fixed;
  inset: -15%;
  pointer-events: none;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240' viewBox='0 0 240 240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.2' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)' opacity='0.25'/%3E%3C/svg%3E");
  mix-blend-mode: screen;
  animation: grain 8s steps(60) infinite;
  z-index: 1;
  opacity: 0.24;
}

@keyframes grain {
  to {
    transform: translate3d(-6%, -4%, 0);
  }
}

.moxel-openapi-shell {
  position: relative;
  z-index: 2;
  min-height: 100vh;
  background: radial-gradient(circle at 18% 12%, rgba(90, 204, 255, 0.1), transparent 55%),
    radial-gradient(circle at 74% 78%, rgba(115, 244, 214, 0.08), transparent 62%);
}

.moxel-topbar {
  position: fixed;
  top: 0;
  right: 0;
  left: 0;
  z-index: 5;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 1rem;
  align-items: center;
  height: var(--moxel-topbar-height);
  padding: 0.85rem clamp(1rem, 2vw, 2rem);
  border-bottom: 1px solid var(--border-soft);
  background: rgba(3, 7, 17, 0.84);
  backdrop-filter: blur(18px);
  text-transform: uppercase;
  letter-spacing: 0.16em;
}

.moxel-wordmark {
  color: var(--fg-100);
  font-size: 1.04rem;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.moxel-meta {
  color: var(--fg-muted);
  font-size: 0.68rem;
}

.moxel-status {
  justify-self: end;
  min-width: 1.9rem;
  min-height: 0.9rem;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  opacity: 0.55;
  background: rgba(53, 240, 255, 0.06);
}

.moxel-reference {
  min-height: 100vh;
  padding-top: var(--moxel-topbar-height);
}

.moxel-openapi-intro {
  position: relative;
  z-index: 3;
  margin: calc(var(--moxel-topbar-height) + 1rem) clamp(1rem, 2vw, 2rem) 0;
  padding: 1.25rem;
  border: 1px solid var(--border-soft);
  border-radius: 1.2rem;
  background: var(--moxel-panel-strong);
  box-shadow: var(--shadow);
}

.moxel-openapi-intro a,
.moxel-docs-page a {
  color: var(--accent-400);
  text-decoration: none;
}

.moxel-openapi-intro h1,
.moxel-docs-page h1,
.moxel-docs-page h2 {
  margin-top: 0;
}

.moxel-reference {
  padding-top: 1rem;
}

.moxel-docs-page {
  position: relative;
  z-index: 2;
  width: min(1120px, calc(100vw - 2rem));
  margin: 0 auto;
  padding: calc(var(--moxel-topbar-height) + 2rem) 0 4rem;
}

.moxel-docs-hero,
.moxel-docs-panel,
.moxel-docs-grid > article {
  border: 1px solid var(--border-soft);
  border-radius: 1.35rem;
  background: var(--moxel-panel-strong);
  box-shadow: var(--shadow);
}

.moxel-docs-hero,
.moxel-docs-panel {
  padding: clamp(1.25rem, 3vw, 2rem);
}

.moxel-docs-hero h1 {
  font-size: clamp(2.4rem, 8vw, 5.6rem);
  letter-spacing: -0.06em;
  line-height: 0.92;
}

.moxel-eyebrow {
  color: var(--accent-500);
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.moxel-docs-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1.25rem;
}

.moxel-docs-actions a {
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  padding: 0.65rem 1rem;
  background: rgba(53, 240, 255, 0.08);
}

.moxel-docs-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  margin: 1rem 0;
}

.moxel-docs-grid > article {
  padding: 1.2rem;
}

.moxel-docs-page pre {
  overflow-x: auto;
  border: 1px solid rgba(70, 215, 255, 0.18);
  border-radius: 0.9rem;
  padding: 1rem;
  background: rgba(0, 3, 10, 0.48);
}

@media (max-width: 760px) {
  .moxel-docs-grid {
    grid-template-columns: 1fr;
  }
}

#api-reference {
  position: relative;
  z-index: 2;
}

.moxel-reference > .scalar-app,
.moxel-reference > div {
  min-height: calc(100vh - var(--moxel-topbar-height));
}

.light-mode,
.dark-mode {
  --scalar-color-1: var(--fg-100);
  --scalar-color-2: var(--fg-300);
  --scalar-color-3: var(--fg-muted);
  --scalar-color-accent: var(--accent-400);
  --scalar-background-1: rgba(3, 7, 17, 0.40);
  --scalar-background-2: var(--moxel-panel);
  --scalar-background-3: rgba(9, 17, 29, 0.72);
  --scalar-background-accent: rgba(53, 240, 255, 0.1);
  --scalar-border-color: var(--moxel-panel-border);
  --scalar-color-green: var(--accent-500);
  --scalar-color-blue: var(--accent-400);
  --scalar-button-1: var(--accent-400);
  --scalar-button-1-color: #06101a;
  --scalar-button-1-hover: #66f2ff;
  --scalar-scrollbar-color: rgba(53, 240, 255, 0.3);
  --scalar-scrollbar-color-active: rgba(53, 240, 255, 0.6);
}

.scalar-app {
  --scalar-custom-header-height: var(--moxel-topbar-height);
  background: transparent !important;
}

.scalar-app .scalar-card,
.scalar-app .request-card,
.scalar-app .response-card,
.scalar-app .endpoint {
  border-color: var(--moxel-panel-border) !important;
  background-color: var(--moxel-panel) !important;
}

.scalar-app pre,
.scalar-app code,
.scalar-app .cm-editor,
.scalar-app .cm-scroller,
.scalar-app .scalar-code-block {
  background-color: var(--moxel-panel-strong) !important;
}

.t-doc__sidebar {
  --scalar-sidebar-background-1: rgba(3, 7, 17, 0.78);
  --scalar-sidebar-color-1: var(--fg-100);
  --scalar-sidebar-color-2: var(--fg-muted);
  --scalar-sidebar-border-color: rgba(70, 215, 255, 0.16);
  --scalar-sidebar-item-hover-background: rgba(53, 240, 255, 0.07);
  --scalar-sidebar-item-hover-color: var(--fg-100);
  --scalar-sidebar-item-active-background: rgba(53, 240, 255, 0.1);
  --scalar-sidebar-color-active: var(--accent-400);
  --scalar-sidebar-search-background: rgba(3, 7, 17, 0.72);
  --scalar-sidebar-search-color: var(--fg-100);
  --scalar-sidebar-search-border-color: var(--border-soft);
  background: rgba(3, 7, 17, 0.82);
  box-shadow: inset -1px 0 0 rgba(70, 215, 255, 0.08);
}

@media (min-width: 1001px) {
  body.moxel-openapi-body.moxel-search-open .references-layout.references-sidebar {
    grid-template-columns: var(--moxel-openapi-sidebar-width) 1fr !important;
  }

  body.moxel-openapi-body.moxel-search-open .t-doc__sidebar {
    position: fixed !important;
    top: var(--moxel-topbar-height) !important;
    left: 0 !important;
    width: var(--moxel-openapi-sidebar-width) !important;
    height: calc(100dvh - var(--moxel-topbar-height)) !important;
    overflow-y: auto !important;
    z-index: 4 !important;
  }
}

.scalar-app h1,
.scalar-app h2,
.scalar-app h3,
.scalar-app h4 {
  color: var(--fg-100) !important;
  letter-spacing: 0.02em;
}

.scalar-app p,
.scalar-app li {
  max-width: 76ch;
  line-height: 1.68 !important;
}

.moxel-introduction-section {
  --moxel-doc-card: rgba(3, 7, 17, 0.42);
}

.moxel-introduction-section h1 {
  font-size: clamp(2rem, 4vw, 3.8rem) !important;
  letter-spacing: -0.035em !important;
  line-height: 0.98 !important;
}

.moxel-introduction-section h2 {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  margin-top: 2.1rem !important;
  margin-bottom: 0.75rem !important;
  font-size: clamp(1.25rem, 2vw, 1.75rem) !important;
}

.moxel-introduction-section h2::before {
  content: "";
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 999px;
  background: var(--accent-400);
  box-shadow: 0 0 20px rgba(53, 240, 255, 0.55);
}

.moxel-introduction-section > div:first-child,
.moxel-introduction-section [class*="section-content"],
.moxel-introduction-section [class*="SectionContent"] {
  max-width: 880px !important;
}

.moxel-introduction-section ol,
.moxel-introduction-section ul {
  display: grid;
  gap: 0.65rem;
  max-width: 880px;
  margin-top: 0.85rem !important;
  padding-left: 0 !important;
  list-style: none !important;
}

.moxel-introduction-section ol {
  counter-reset: moxel-step;
}

.moxel-introduction-section ol > li,
.moxel-introduction-section ul > li {
  position: relative;
  border: 1px solid rgba(70, 215, 255, 0.18);
  border-radius: 0.95rem;
  padding: 0.8rem 1rem 0.8rem 3rem !important;
  background: var(--moxel-doc-card);
  box-shadow: inset 0 1px 0 rgba(109, 242, 214, 0.06);
}

.moxel-introduction-section ol > li::before {
  counter-increment: moxel-step;
  content: counter(moxel-step);
  position: absolute;
  top: 0.82rem;
  left: 0.95rem;
  display: grid;
  place-items: center;
  width: 1.35rem;
  height: 1.35rem;
  border-radius: 999px;
  background: rgba(53, 240, 255, 0.14);
  color: var(--accent-400);
  font-size: 0.78rem;
  font-weight: 800;
}

.moxel-introduction-section ul > li::before {
  content: "→";
  position: absolute;
  top: 0.78rem;
  left: 1rem;
  color: var(--accent-400);
  font-weight: 900;
}

.moxel-introduction-section code {
  border: 1px solid rgba(70, 215, 255, 0.16);
  border-radius: 0.38rem;
  padding: 0.1rem 0.35rem;
  color: var(--accent-500) !important;
}

.moxel-introduction-section .atlas-docs-hero {
  position: relative;
  overflow: hidden;
  max-width: 980px;
  margin: 0 0 1.25rem;
  border: 1px solid rgba(70, 215, 255, 0.24);
  border-radius: 1.35rem;
  padding: clamp(1.25rem, 3vw, 2.25rem);
  background:
    radial-gradient(circle at 18% 18%, rgba(53, 240, 255, 0.16), transparent 34%),
    linear-gradient(135deg, rgba(3, 7, 17, 0.72), rgba(6, 18, 28, 0.42));
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.36), inset 0 1px 0 rgba(109, 242, 214, 0.08);
}

.moxel-introduction-section .atlas-docs-hero::after {
  content: "";
  position: absolute;
  right: -8%;
  bottom: -28%;
  width: 42%;
  aspect-ratio: 1;
  border-radius: 50%;
  border: 1px solid rgba(53, 240, 255, 0.22);
  background: radial-gradient(circle, rgba(53, 240, 255, 0.13), transparent 62%);
}

.moxel-introduction-section .atlas-docs-eyebrow {
  margin: 0 0 0.8rem !important;
  color: var(--accent-500) !important;
  font-size: 0.72rem !important;
  font-weight: 900;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.moxel-introduction-section .atlas-docs-lede {
  max-width: 68ch;
  color: rgba(235, 244, 255, 0.88) !important;
  font-size: 1.08rem !important;
}

.moxel-introduction-section .atlas-docs-actions {
  position: relative;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  margin-top: 1.25rem;
}

.moxel-introduction-section .atlas-docs-actions a {
  border: 1px solid rgba(70, 215, 255, 0.32);
  border-radius: 999px;
  padding: 0.55rem 0.85rem;
  background: rgba(53, 240, 255, 0.08);
  color: var(--accent-400) !important;
  font-size: 0.86rem;
  font-weight: 800;
  text-decoration: none !important;
}

.moxel-introduction-section .atlas-docs-cards,
.moxel-introduction-section .atlas-docs-workflow {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
  max-width: 980px;
  margin: 1.2rem 0 1.8rem;
}

.moxel-introduction-section .atlas-docs-cards article,
.moxel-introduction-section .atlas-docs-workflow div {
  border: 1px solid rgba(70, 215, 255, 0.18);
  border-radius: 1rem;
  padding: 1rem;
  background: rgba(3, 7, 17, 0.38);
  box-shadow: inset 0 1px 0 rgba(109, 242, 214, 0.06);
}

.moxel-introduction-section .atlas-docs-cards strong,
.moxel-introduction-section .atlas-docs-workflow strong {
  display: block;
  margin-bottom: 0.4rem;
  color: var(--fg-100);
  font-size: 0.96rem;
}

.moxel-introduction-section .atlas-docs-cards span,
.moxel-introduction-section .atlas-docs-workflow p {
  display: block;
  margin: 0 !important;
  color: rgba(215, 228, 255, 0.78) !important;
  font-size: 0.92rem !important;
  line-height: 1.55 !important;
}

.moxel-introduction-section .atlas-docs-workflow h2 {
  grid-column: 1 / -1;
}

@media (max-width: 900px) {
  .moxel-introduction-section .atlas-docs-cards,
  .moxel-introduction-section .atlas-docs-workflow {
    grid-template-columns: 1fr;
  }
}

.moxel-hidden-intro-panel {
  display: none !important;
}

.moxel-introduction-section .moxel-hidden-intro-panel,
.moxel-introduction-section [data-moxel-intro-panel="hidden"] {
  display: none !important;
}

.scalar-app code,
.endpoint-path,
.scalar-code-block,
.cm-editor {
  font-family: var(--scalar-font-code) !important;
}

.endpoint-path {
  overflow-wrap: normal !important;
  white-space: nowrap !important;
}

.scalar-app button,
.scalar-app .scalar-button {
  border-color: rgba(70, 215, 255, 0.18) !important;
  border-radius: 0.4rem !important;
}

.scalar-app button:hover,
.scalar-app .scalar-button:hover {
  border-color: rgba(70, 215, 255, 0.48) !important;
}

.scalar-app input,
.scalar-app textarea,
.scalar-app select {
  border-color: rgba(70, 215, 255, 0.16) !important;
  background: rgba(3, 7, 17, 0.76) !important;
  color: var(--fg-100) !important;
  border-radius: 0.4rem !important;
}

.scalar-app .scalar-api-client,
.scalar-app [class*="ApiClient"],
.scalar-app [class*="api-client"] {
  border-color: rgba(70, 215, 255, 0.2) !important;
  background: rgba(3, 7, 17, 0.94) !important;
  color: var(--fg-100) !important;
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.56);
  backdrop-filter: blur(18px);
}

.scalar-app .scalar-api-client button,
.scalar-app [class*="ApiClient"] button,
.scalar-app [class*="api-client"] button {
  background: rgba(6, 15, 28, 0.82) !important;
  color: var(--fg-100) !important;
}

.scalar-app .scalar-api-client button:hover,
.scalar-app [class*="ApiClient"] button:hover,
.scalar-app [class*="api-client"] button:hover {
  color: var(--accent-400) !important;
}

.scalar-app .moxel-test-request-button,
.scalar-app button.moxel-test-request-button,
.scalar-app [role="button"].moxel-test-request-button,
.moxel-test-request-button {
  border: 1px solid rgba(53, 240, 255, 0.3) !important;
  background: rgba(3, 7, 17, 0.9) !important;
  color: var(--accent-400) !important;
  opacity: 1 !important;
  text-shadow: none !important;
  filter: none !important;
  box-shadow: inset 0 0 14px rgba(53, 240, 255, 0.04) !important;
  letter-spacing: 0.08em !important;
  text-transform: uppercase !important;
  font-size: 0.74rem !important;
  font-weight: 700 !important;
}

.scalar-app .moxel-test-request-button *,
.moxel-test-request-button * {
  color: var(--accent-400) !important;
  opacity: 1 !important;
  filter: none !important;
}

.scalar-app .moxel-test-request-button:hover,
.scalar-app button.moxel-test-request-button:hover,
.scalar-app [role="button"].moxel-test-request-button:hover,
.moxel-test-request-button:hover {
  border-color: rgba(109, 242, 214, 0.48) !important;
  background: rgba(6, 18, 28, 0.94) !important;
  color: var(--fg-100) !important;
  box-shadow: inset 0 0 18px rgba(53, 240, 255, 0.08) !important;
}

.scalar-app .moxel-test-request-button:hover *,
.moxel-test-request-button:hover * {
  color: var(--fg-100) !important;
}

.scalar-app .moxel-test-request-button[disabled],
.scalar-app .moxel-test-request-button[aria-disabled="true"],
.moxel-test-request-button[disabled],
.moxel-test-request-button[aria-disabled="true"] {
  border-color: rgba(53, 240, 255, 0.22) !important;
  background: rgba(3, 7, 17, 0.72) !important;
  color: rgba(53, 240, 255, 0.58) !important;
  opacity: 1 !important;
  cursor: not-allowed;
}

.scalar-app .moxel-test-request-button[disabled] *,
.scalar-app .moxel-test-request-button[aria-disabled="true"] *,
.moxel-test-request-button[disabled] *,
.moxel-test-request-button[aria-disabled="true"] * {
  color: rgba(53, 240, 255, 0.58) !important;
}

.http-method,
.method {
  font-family: var(--scalar-font-code) !important;
  font-size: 0.68rem !important;
  letter-spacing: 0.1em !important;
  border-radius: 0.28rem !important;
}

.download-cta,
.sidebar-footer,
.sidebar-footer-wrapper,
.moxel-hidden-scalar-branding,
[aria-label="Ask AI Agent"],
[aria-label="Open API Client"],
[title="Ask AI Agent"],
[title="Open API Client"],
[class*="powered-by"],
[class*="PoweredBy"] {
  display: none !important;
}

@media (prefers-reduced-motion: reduce) {
  .noise {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}

@media (max-width: 760px) {
  :root {
    --moxel-topbar-height: 4.8rem;
  }

  .moxel-topbar {
    grid-template-columns: 1fr;
    gap: 0.2rem;
    align-content: center;
  }

  .moxel-meta {
    display: none;
  }

  .moxel-status {
    justify-self: start;
  }
}
`;

/** Removes optional Scalar promotional controls and marks request buttons for branded contrast. */
export const moxelOpenApiPolishScript = `
(() => {
  const root = document.querySelector(".moxel-reference");
  if (!root) {
    return;
  }

  const hiddenLabels = new Set(["Ask AI Agent", "Open API Client", "Powered by Scalar", "Generate MCP"]);

  function closestInteractive(element) {
    return element.closest("button, a, [role='button'], [class*='footer'], [class*='Footer']") || element;
  }

  function normalizeText(value) {
    return value.replace(/\\s+/g, " ").trim();
  }

  function markIntroduction() {
    const hero = root.querySelector(".atlas-docs-hero");
    const section = hero?.closest("section, article, [class*='Section'], [class*='section']") || hero?.parentElement;
    section?.classList.add("moxel-introduction-section");
  }

  function polish() {
    markIntroduction();
    const candidates = root.querySelectorAll("button, a, [role='button'], [class*='footer'], [class*='Footer']");
    for (const candidate of candidates) {
      const text = normalizeText(candidate.textContent || "");

      if (text.includes("Test Request")) {
        const button = closestInteractive(candidate);
        button.classList.add("moxel-test-request-button");
        candidate.classList.add("moxel-test-request-button");
        continue;
      }

      if (hiddenLabels.has(text)) {
        closestInteractive(candidate).classList.add("moxel-hidden-scalar-branding");
      }
    }
  }

  function syncSearchState() {
    const portalRoot = document.getElementById("headlessui-portal-root");
    const searchModal = portalRoot?.querySelector(".scalar-modal.scalar-modal-search");
    document.body.classList.toggle("moxel-search-open", Boolean(searchModal));
  }

  polish();
  syncSearchState();

  const observer = new MutationObserver(() => {
    polish();
    syncSearchState();
  });
  observer.observe(root, { childList: true, subtree: true });

  const bodyObserver = new MutationObserver(syncSearchState);
  bodyObserver.observe(document.body, { childList: true, subtree: true });
})();
`;

/** JavaScript port of the moxel.ai banded-field canvas background. */
export const moxelBandedFieldScript = `
(() => {
  const canvas = document.getElementById("banded-field");
  const pointer = { x: 0.5, y: 0.5, active: false };
  const pulses = [];
  let frameHandle = null;
  let stageWidth = 0;
  let stageHeight = 0;
  let deviceRatio = Math.min(window.devicePixelRatio || 1, 1.8);
  let lastTime = performance.now();
  const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  function wrap01(value) {
    return ((value % 1) + 1) % 1;
  }

  function seedPulses() {
    pulses.length = 0;
    for (let idx = 0; idx < 42; idx += 1) {
      pulses.push({
        position: Math.random(),
        offset: Math.random(),
        intensity: 0.45 + Math.random() * 0.55,
        speed: 0.00004 + Math.random() * 0.00008
      });
    }
  }

  if (!(canvas instanceof HTMLCanvasElement)) return;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (ctx === null) return;

  function resize() {
    deviceRatio = Math.min(window.devicePixelRatio || 1, 1.8);
    stageWidth = window.innerWidth;
    stageHeight = window.innerHeight;
    canvas.width = Math.round(stageWidth * deviceRatio);
    canvas.height = Math.round(stageHeight * deviceRatio);
    canvas.style.width = stageWidth + "px";
    canvas.style.height = stageHeight + "px";
    ctx.setTransform(deviceRatio, 0, 0, deviceRatio, 0, 0);
  }

  function drawFrame(time, staticFrame = false) {
    const dt = Math.max(16, time - lastTime);
    lastTime = time;

    ctx.setTransform(deviceRatio, 0, 0, deviceRatio, 0, 0);
    const gradient = ctx.createLinearGradient(0, 0, stageWidth, stageHeight);
    gradient.addColorStop(0, "#030711");
    gradient.addColorStop(1, "#081224");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, stageWidth, stageHeight);

    const columns = 28;
    const rows = 18;
    const cellW = stageWidth / columns;
    const cellH = stageHeight / rows;
    const slope = 0.72 + Math.sin(time * 0.00028) * 0.12;
    const shift = Math.sin(time * 0.00021) * 0.22;
    const pulsePhase = Math.sin(time * 0.0006) * 0.15;

    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.65;
    for (let c = 0; c <= columns; c += 1) {
      const x = c * cellW;
      const alpha = 0.08 + 0.12 * Math.sin(time * 0.0004 + c * 0.45);
      ctx.strokeStyle = "rgba(52, 132, 208, " + alpha + ")";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, stageHeight);
      ctx.stroke();
    }

    for (let r = 0; r <= rows; r += 1) {
      const y = r * cellH;
      const alpha = 0.05 + 0.14 * Math.cos(time * 0.00033 + r * 0.4);
      ctx.strokeStyle = "rgba(36, 92, 164, " + alpha + ")";
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(stageWidth, y);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    for (let c = 0; c < columns; c += 1) {
      const u = (c + 0.5) / columns;
      for (let r = 0; r < rows; r += 1) {
        const v = (r + 0.5) / rows;
        const diag = v - (u * slope + shift + 0.25);
        const normalized = diag - Math.round(diag);
        const wave = 0.45 + 0.55 * Math.sin(time * 0.0011 + u * 14 + v * 12);
        const gaussian = Math.exp(-(normalized * normalized) / 0.0085);
        const pointerInfluence = pointer.active ? Math.max(0, 0.20 - Math.hypot(u - pointer.x, v - pointer.y)) * 1.6 : 0;
        const value = Math.min(1, wave * gaussian + pointerInfluence + pulsePhase * 0.4);

        if (value > 0.08) {
          ctx.fillStyle = "rgba(53, 240, 255, " + (0.06 + value * 0.22) + ")";
          ctx.fillRect(c * cellW, r * cellH, cellW + 1, cellH + 1);
        }
      }
    }

    if (!staticFrame) {
      ctx.globalCompositeOperation = "lighter";
      for (const pulse of pulses) {
        pulse.position = wrap01(pulse.position + pulse.speed * dt);
        const u = pulse.position;
        const v = wrap01(u * slope + shift + pulse.offset * 0.6 + 0.25);
        const x = u * stageWidth;
        const y = v * stageHeight;
        const radius = 1.6 + pulse.intensity * 3.6;
        ctx.fillStyle = "rgba(109, 242, 214, " + (0.18 + pulse.intensity * 0.35) + ")";
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(53, 240, 255, " + (0.12 + pulse.intensity * 0.22) + ")";
        ctx.lineWidth = 0.6 + pulse.intensity * 0.6;
        ctx.beginPath();
        ctx.moveTo(x - cellW * 0.4, y - cellH * 0.12);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    }
  }

  function loop(time) {
    drawFrame(time);
    frameHandle = requestAnimationFrame(loop);
  }

  function startAnimation() {
    cancelAnimationFrame(frameHandle ?? 0);
    frameHandle = null;
    if (reduceMotionQuery.matches) {
      drawFrame(performance.now(), true);
    } else {
      seedPulses();
      lastTime = performance.now();
      frameHandle = requestAnimationFrame(loop);
    }
  }

  resize();
  startAnimation();
  window.addEventListener("resize", () => {
    resize();
    startAnimation();
  });
  reduceMotionQuery.addEventListener("change", startAnimation);
  window.addEventListener("pointermove", (event) => {
    pointer.x = event.clientX / window.innerWidth;
    pointer.y = event.clientY / window.innerHeight;
    pointer.active = true;
  });
  window.addEventListener("pointerleave", () => {
    pointer.active = false;
  });
})();
`;
