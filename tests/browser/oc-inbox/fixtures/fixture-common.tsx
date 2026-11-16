/**
 * Shared fixture-side registration (tests-only): page marker + toolbox for the
 * Playwright scenarios. It must never touch production modules.
 */

declare global {
  interface Window {
    __fixtureBoot: unknown;
  }
}

export function installCommonFixtureFrame(boot: unknown): void {
  window.__fixtureBoot = boot;
  window.document.title = (window.document.title || '') + ' [FIXTURE]';
}

/** Test-only DOM lookup that throws instead of failing TS null checks. */
export function fixtureElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`FIXTURE_ELEMENT_MISSING ${id}`);
  return element;
}
