import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

import { discoverPrompts, validatePrompt } from "../src/index"
import { fixturePath } from "./helpers"

describe("validatePrompt", () => {
  it("returns parsed metadata and body for valid prompt sources", () => {
    const parsed = validatePrompt(`---
name: validated
description: Valid prompt
variables:
  sessionId:
    type: string
    description: Session identifier
---

Session: {{sessionId}}`)

    expect(parsed.metadata.name).toBe("validated")
    expect(parsed.body).toBe("\nSession: {{sessionId}}")
  })

  it("throws on undeclared variable references without rendering", () => {
    expect(() =>
      validatePrompt(`---
name: invalid
description: Invalid prompt
variables: {}
---

Hello {{missing}}`),
    ).toThrow(
      'Prompt body in prompt source references undeclared variable: missing. Declare it in frontmatter.variables or remove the reference.',
    )
  })

  it("rejects interpolation tokens that contain whitespace", () => {
    expect(() =>
      validatePrompt(`---
name: invalid-spaced-placeholder
description: Invalid prompt
variables: {}
---

Hello {{missing value}}`),
    ).toThrow(
      "Placeholder {{missing value}} in prompt source must reference a single variable name without whitespace",
    )
  })

  it("rejects conditional tokens that contain whitespace", () => {
    expect(() =>
      validatePrompt(`---
name: invalid-spaced-conditional
description: Invalid prompt
variables: {}
---

{{#if missing value}}Hello{{/if}}`),
    ).toThrow(
      "Conditional block {{#if missing value}} in prompt source must reference a single variable name without whitespace",
    )
  })

  it("throws on unexpected closing conditionals without rendering", () => {
    expect(() =>
      validatePrompt(`---
name: invalid-conditional
description: Invalid conditional
variables: {}
---

Hello
{{/if}}`),
    ).toThrow("Unexpected closing {{/if}} without a matching {{#if}} in prompt source")
  })

  it("accepts CRLF prompt sources and keeps CRLF body content intact", async () => {
    const source = await readFile(fixturePath("crlf", "prompts", "windows.md"), "utf8")
    const parsed = validatePrompt(source)

    expect(parsed.metadata.name).toBe("windows")
    expect(parsed.body).toBe(
      "\r\nWindows session: {{sessionId}}\r\n{{#if owner}}Owner: {{owner}}{{else}}Owner: unassigned{{/if}}\r\n",
    )
  })
})

describe("discoverPrompts", () => {
  it("recursively discovers prompts in root and nested folders", async () => {
    const discovered = await discoverPrompts({ basePath: fixturePath("default") })

    expect(discovered.map((prompt) => prompt.promptPath)).toEqual([
      "basic",
      "empty-body",
      "proposals/review",
      "standalone",
      "tasks/create",
      "teams/agents/session/init",
    ])

    expect(discovered.find((prompt) => prompt.promptPath === "tasks/create")?.promptName).toBe(
      "task-create",
    )
    expect(discovered.find((prompt) => prompt.promptPath === "teams/agents/session/init")?.filePath).toBe(
      fixturePath("default", "prompts", "teams", "agents", "session", "init.md"),
    )
  })

  it("raises a clear error when duplicate prompt names are discovered", async () => {
    await expect(discoverPrompts({ basePath: fixturePath("duplicates") })).rejects.toThrow(
      'Duplicate prompt name found during discovery:\n- "duplicate-create" is declared in:\n  - ',
    )
    await expect(discoverPrompts({ basePath: fixturePath("duplicates") })).rejects.toThrow(
      fixturePath("duplicates", "prompts", "proposals", "create.md"),
    )
    await expect(discoverPrompts({ basePath: fixturePath("duplicates") })).rejects.toThrow(
      fixturePath("duplicates", "prompts", "tasks", "create.md"),
    )
    await expect(discoverPrompts({ basePath: fixturePath("duplicates") })).rejects.toThrow(
      'Each prompt frontmatter "name" must be unique across the prompts directory. Rename one of the prompts or change its frontmatter name.',
    )
  })

  it("throws a clear error when the prompts directory is missing", async () => {
    await expect(discoverPrompts({ basePath: fixturePath("missing-prompts") })).rejects.toThrow(
      `Prompts directory "${fixturePath("missing-prompts", "prompts")}" does not exist. Create it or set options.promptsDir to the correct location.`,
    )
  })

  it("discovers CRLF-authored prompts without altering their body content", async () => {
    const discovered = await discoverPrompts({ basePath: fixturePath("crlf") })

    expect(discovered).toHaveLength(1)
    expect(discovered[0]?.promptPath).toBe("windows")
    expect(discovered[0]?.body).toBe(
      "\r\nWindows session: {{sessionId}}\r\n{{#if owner}}Owner: {{owner}}{{else}}Owner: unassigned{{/if}}\r\n",
    )
  })

  it("rejects discovered prompt files with interpolation tokens that contain whitespace", async () => {
    await expect(
      discoverPrompts({ basePath: fixturePath("invalid-placeholder") }),
    ).rejects.toThrow(
      `Placeholder {{missing value}} in prompt file "${fixturePath("invalid-placeholder", "prompts", "spaced-placeholder.md")}" must reference a single variable name without whitespace`,
    )
  })

  it("rejects discovered prompt files with conditional tokens that contain whitespace", async () => {
    await expect(
      discoverPrompts({ basePath: fixturePath("invalid-conditional") }),
    ).rejects.toThrow(
      `Conditional block {{#if missing value}} in prompt file "${fixturePath("invalid-conditional", "prompts", "spaced-conditional.md")}" must reference a single variable name without whitespace`,
    )
  })

  it.each([null, [], "invalid"])("rejects invalid discovery options input: %j", async (options) => {
    await expect(discoverPrompts(options as never)).rejects.toThrow(
      "options must be an object if provided",
    )
  })

  it("rejects non-string basePath in discovery options", async () => {
    await expect(discoverPrompts({ basePath: 123 as never })).rejects.toThrow(
      "options.basePath must be a non-empty string",
    )
  })

  it("rejects empty basePath in discovery options", async () => {
    await expect(discoverPrompts({ basePath: "   " })).rejects.toThrow(
      "options.basePath must be a non-empty string",
    )
  })

  it("rejects non-string promptsDir in discovery options", async () => {
    await expect(
      discoverPrompts({ basePath: fixturePath("default"), promptsDir: false as never }),
    ).rejects.toThrow("options.promptsDir must be a non-empty string")
  })

  it("rejects empty promptsDir in discovery options", async () => {
    await expect(
      discoverPrompts({ basePath: fixturePath("default"), promptsDir: "" }),
    ).rejects.toThrow("options.promptsDir must be a non-empty string")
  })
})
