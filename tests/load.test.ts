import { describe, expect, expectTypeOf, it, vi } from "vitest"

import {
  discoverPrompts,
  loadPrompt,
  type DiscoveredPrompt,
  type LoadPromptOptions,
  type PromptDiscoveryOptions,
  type PromptMetadata,
  type PromptVariable,
} from "../src/index"
import { fixturePath } from "./helpers"

const defaultBasePath = fixturePath("default")

describe("loadPrompt", () => {
  it("loads and interpolates a prompt from disk", async () => {
    const result = await loadPrompt(
      "basic",
      {
        sessionId: "abc-123",
        person: "Nathan Luo",
      },
      { basePath: defaultBasePath, onUnknownVariable: "error" },
    )

    expect(result).toContain("Your session ID is abc-123")
    expect(result).toContain('You are acting on behalf of @"Mesh/People/Nathan Luo.md"')
  })

  it("omits optional conditional sections when variables are not provided", async () => {
    const result = await loadPrompt(
      "basic",
      {
        sessionId: "abc-123",
      },
      { basePath: defaultBasePath, onUnknownVariable: "error" },
    )

    expect(result).toContain("Your session ID is abc-123")
    expect(result).not.toContain("You are acting on behalf")
  })

  it("throws when a required variable is missing", async () => {
    await expect(
      loadPrompt("basic", {}, { basePath: defaultBasePath, onUnknownVariable: "error" }),
    ).rejects.toThrow(
      `Missing required prompt variable for "basic" in "${fixturePath("default", "prompts", "basic.md")}": sessionId. Provide it in the variables argument.`,
    )
  })

  it("warns when unknown variables are provided", async () => {
    const logger = {
      warn: vi.fn(),
    }

    const result = await loadPrompt(
      "basic",
      {
        sessionId: "abc-123",
        extra: "surplus",
      },
      { basePath: defaultBasePath, logger },
    )

    expect(result).toContain("Your session ID is abc-123")
    expect(logger.warn).toHaveBeenCalledWith(
      `Unknown prompt variable for "basic" in "${fixturePath("default", "prompts", "basic.md")}": extra. Declare it in frontmatter.variables or remove it from the call.`,
    )
  })

  it("can optionally error on unknown variables", async () => {
    await expect(
      loadPrompt(
        "basic",
        {
          sessionId: "abc-123",
          extra: "surplus",
        },
        { basePath: defaultBasePath, onUnknownVariable: "error" },
      ),
    ).rejects.toThrow(
      `Unknown prompt variable for "basic" in "${fixturePath("default", "prompts", "basic.md")}": extra. Declare it in frontmatter.variables or remove it from the call.`,
    )
  })

  it("supports onUnknownVariable ignore mode", async () => {
    const logger = {
      warn: vi.fn(),
    }

    const result = await loadPrompt(
      "basic",
      {
        sessionId: "abc-123",
        extra: "surplus",
      },
      { basePath: defaultBasePath, logger, onUnknownVariable: "ignore" },
    )

    expect(result).toContain("Your session ID is abc-123")
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it("returns an empty string for prompts with an empty body", async () => {
    const result = await loadPrompt("empty-body", {}, {
      basePath: defaultBasePath,
      onUnknownVariable: "error",
    })

    expect(result).toBe("")
  })

  it("supports standalone package usage through the public API", async () => {
    const module = await import("../src/index")
    const result = await module.loadPrompt(
      "standalone",
      {
        tool: "prompt-loader",
        enabled: true,
      },
      { basePath: defaultBasePath, onUnknownVariable: "error" },
    )

    expect(result).toContain("Tool: prompt-loader")
    expect(result).toContain("Feature enabled")
  })

  it("supports custom basePath options", async () => {
    const result = await loadPrompt(
      "from-base",
      { value: "custom-base" },
      {
        basePath: fixturePath("custom-base"),
        onUnknownVariable: "error",
      },
    )

    expect(result).toBe("\nBase: custom-base\n")
  })

  it("supports custom promptsDir options", async () => {
    const result = await loadPrompt(
      "from-custom-dir",
      { value: "custom-dir" },
      {
        basePath: fixturePath("custom-dir"),
        promptsDir: "custom-prompts",
        onUnknownVariable: "error",
      },
    )

    expect(result).toBe("\nCustom dir: custom-dir\n")
  })

  it("loads prompts from nested folders using slash-separated names", async () => {
    const result = await loadPrompt(
      "tasks/create",
      { title: "Ship production hardening" },
      { basePath: defaultBasePath, onUnknownVariable: "error" },
    )

    expect(result).toBe("\nCreate task: Ship production hardening\n")
  })

  it("loads prompts from deeply nested folders", async () => {
    const result = await loadPrompt(
      "teams/agents/session/init",
      { agent: "Codex" },
      { basePath: defaultBasePath, onUnknownVariable: "error" },
    )

    expect(result).toBe("\nInitialize Codex\n")
  })

  it("throws when a prompt body references undeclared variables", async () => {
    await expect(
      loadPrompt("undeclared-body", {}, {
        basePath: fixturePath("invalid-body"),
        onUnknownVariable: "error",
      }),
    ).rejects.toThrow(
      `Prompt body in prompt file "${fixturePath("invalid-body", "prompts", "undeclared-body.md")}" references undeclared variable: missingValue. Declare it in frontmatter.variables or remove the reference.`,
    )
  })

  it("loads CRLF-authored prompt files end to end", async () => {
    const result = await loadPrompt(
      "windows",
      {
        sessionId: "abc-123",
      },
      { basePath: fixturePath("crlf"), onUnknownVariable: "error" },
    )

    expect(result).toBe("\r\nWindows session: abc-123\r\nOwner: unassigned\r\n")
  })

  it.each([
    {
      name: null,
      error: "Prompt name must be a string",
    },
    {
      name: undefined,
      error: "Prompt name must be a string",
    },
    {
      name: "",
      error: "Prompt name must be a non-empty string",
    },
    {
      name: "tasks//create",
      error: 'Prompt name must be a relative prompt path without empty, "." or ".." segments',
    },
    {
      name: "../basic",
      error: 'Prompt name must be a relative prompt path without empty, "." or ".." segments',
    },
  ])("validates prompt name input: %j", async ({ name, error }) => {
    await expect(
      loadPrompt(name as never, {}, { basePath: defaultBasePath, onUnknownVariable: "error" }),
    ).rejects.toThrow(error)
  })

  it.each([null, [], "invalid"])("rejects invalid load options input: %j", async (options) => {
    await expect(loadPrompt("basic", {}, options as never)).rejects.toThrow(
      "options must be an object if provided",
    )
  })

  it("rejects invalid onUnknownVariable values", async () => {
    await expect(
      loadPrompt("basic", { sessionId: "abc-123" }, {
        basePath: defaultBasePath,
        onUnknownVariable: "bogus" as never,
      }),
    ).rejects.toThrow('options.onUnknownVariable must be one of "warn", "error", or "ignore"')
  })

  it("rejects invalid logger objects", async () => {
    await expect(
      loadPrompt("basic", { sessionId: "abc-123" }, {
        basePath: defaultBasePath,
        logger: "not-a-logger" as never,
      }),
    ).rejects.toThrow('options.logger must be an object with a "warn" method')
  })

  it("rejects non-string basePath values", async () => {
    await expect(
      loadPrompt("basic", { sessionId: "abc-123" }, {
        basePath: 123 as never,
      }),
    ).rejects.toThrow("options.basePath must be a non-empty string")
  })

  it("rejects empty basePath values", async () => {
    await expect(
      loadPrompt("basic", { sessionId: "abc-123" }, {
        basePath: "   ",
      }),
    ).rejects.toThrow("options.basePath must be a non-empty string")
  })

  it("rejects non-string promptsDir values", async () => {
    await expect(
      loadPrompt("basic", { sessionId: "abc-123" }, {
        basePath: defaultBasePath,
        promptsDir: 42 as never,
      }),
    ).rejects.toThrow("options.promptsDir must be a non-empty string")
  })

  it("rejects empty promptsDir values", async () => {
    await expect(
      loadPrompt("basic", { sessionId: "abc-123" }, {
        basePath: defaultBasePath,
        promptsDir: "",
      }),
    ).rejects.toThrow("options.promptsDir must be a non-empty string")
  })

  it("exports TypeScript types for consumers", () => {
    expectTypeOf<PromptVariable>().toMatchTypeOf<{
      type: string
      description: string
      required?: boolean
    }>()
    expectTypeOf<PromptMetadata>().toMatchTypeOf<{
      name: string
      description: string
      variables: Record<string, PromptVariable>
    }>()
    expectTypeOf<PromptDiscoveryOptions>().toMatchTypeOf<{
      basePath?: string
      promptsDir?: string
    }>()
    expectTypeOf<LoadPromptOptions>().toMatchTypeOf<{
      basePath?: string
      promptsDir?: string
      onUnknownVariable?: "warn" | "error" | "ignore"
    }>()
    expectTypeOf<DiscoveredPrompt>().toMatchTypeOf<{
      promptName: string
      promptPath: string
      filePath: string
    }>()
  })
})
