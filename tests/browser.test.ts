import { describe, expect, it } from "vitest"

import * as browserEntry from "../src/browser"

describe("browser entry", () => {
  it("exports only the browser-safe API surface", () => {
    expect(browserEntry).toHaveProperty("parsePrompt")
    expect(browserEntry).toHaveProperty("renderPrompt")
    expect(browserEntry).toHaveProperty("validatePrompt")
    expect(browserEntry).not.toHaveProperty("loadPrompt")
    expect(browserEntry).not.toHaveProperty("discoverPrompts")
  })
})
