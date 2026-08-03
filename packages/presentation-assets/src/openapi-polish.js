(() => {
  const root = document.querySelector(".moxel-reference");
  if (!root) {
    return;
  }

  const hiddenLabels = new Set([
    "Ask AI Agent",
    "Open API Client",
    "Powered by Scalar",
    "Generate MCP",
  ]);

  function closestInteractive(element) {
    return (
      element.closest(
        "button, a, [role='button'], [class*='footer'], [class*='Footer']",
      ) || element
    );
  }

  function normalizeText(value) {
    return value.replace(/\s+/g, " ").trim();
  }

  function markIntroduction() {
    const hero = root.querySelector(".atlas-docs-hero");
    const section =
      hero?.closest(
        "section, article, [class*='Section'], [class*='section']",
      ) || hero?.parentElement;
    section?.classList.add("moxel-introduction-section");
  }

  function polish() {
    markIntroduction();
    const candidates = root.querySelectorAll(
      "button, a, [role='button'], [class*='footer'], [class*='Footer']",
    );
    for (const candidate of candidates) {
      const text = normalizeText(candidate.textContent || "");

      if (text.includes("Test Request")) {
        const button = closestInteractive(candidate);
        button.classList.add("moxel-test-request-button");
        candidate.classList.add("moxel-test-request-button");
        continue;
      }

      if (hiddenLabels.has(text)) {
        closestInteractive(candidate).classList.add(
          "moxel-hidden-scalar-branding",
        );
      }
    }
  }

  function syncSearchState() {
    const portalRoot = document.getElementById("headlessui-portal-root");
    const searchModal = portalRoot?.querySelector(
      ".scalar-modal.scalar-modal-search",
    );
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
