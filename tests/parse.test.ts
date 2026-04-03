import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

import { parsePrompt } from "../src/index"
import { fixturePath } from "./helpers"

describe("parsePrompt", () => {
  it("extracts metadata from frontmatter-only prompt files", () => {
    const source = `---
name: metadata-only
description: Prompt without body
variables:
  optional:
    type: string
    description: Optional value
---
`

    const parsed = parsePrompt(source)

    expect(parsed.metadata).toEqual({
      name: "metadata-only",
      description: "Prompt without body",
      variables: {
        optional: {
          type: "string",
          description: "Optional value",
          required: undefined,
        },
      },
    })
    expect(parsed.body).toBe("")
  })

  it("defaults variables to an empty object when omitted", () => {
    const parsed = parsePrompt(`---
name: metadata-only
description: Prompt without variables
---

Body`)

    expect(parsed.metadata.variables).toEqual({})
    expect(parsed.body).toBe("\nBody")
  })

  it("throws when the source is not a string", () => {
    expect(() => parsePrompt(undefined as never)).toThrow("Prompt source must be a string")
  })

  it("throws when the frontmatter is not a YAML object", () => {
    expect(() =>
      parsePrompt(`---
- item
---

Body`),
    ).toThrow("Prompt frontmatter in prompt source must be a YAML object")
  })

  it("throws when the name field is missing", () => {
    expect(() =>
      parsePrompt(`---
description: Missing name
variables: {}
---

Body`),
    ).toThrow('Prompt frontmatter field "name" in prompt source must be a non-empty string')
  })

  it("throws when the description field is missing", () => {
    expect(() =>
      parsePrompt(`---
name: missing-description
variables: {}
---

Body`),
    ).toThrow('Prompt frontmatter field "description" in prompt source must be a non-empty string')
  })

  it("throws when the name field is empty", () => {
    expect(() =>
      parsePrompt(`---
name: "   "
description: Has no real name
variables: {}
---

Body`),
    ).toThrow('Prompt frontmatter field "name" in prompt source must be a non-empty string')
  })

  it("throws when the variables field is not a YAML object", () => {
    expect(() =>
      parsePrompt(`---
name: bad-variables
description: Bad variables
variables: not-an-object
---

Body`),
    ).toThrow('Prompt frontmatter field "variables" in prompt source must be a YAML object')
  })

  it("throws when a variable definition is not an object", () => {
    expect(() =>
      parsePrompt(`---
name: bad-variable
description: Bad variable
variables:
  sessionId: string
---

Body`),
    ).toThrow('Prompt variable "sessionId" in prompt source must be a YAML object')
  })

  it("throws when required is not a boolean", () => {
    expect(() =>
      parsePrompt(`---
name: bad-required
description: Bad required flag
variables:
  sessionId:
    type: string
    description: Session identifier
    required: yes
---

Body`),
    ).toThrow('Prompt variable "sessionId" field "required" in prompt source must be a boolean')
  })

  it("wraps YAML syntax errors with prompt context", () => {
    expect(() =>
      parsePrompt(`---
name: bad-yaml
description Missing colon
variables: {}
---

Body`),
    ).toThrow("Failed to parse YAML frontmatter in prompt source")
  })

  it("parses Windows-authored prompts with CRLF frontmatter and body content", async () => {
    const source = await readFile(fixturePath("crlf", "prompts", "windows.md"), "utf8")
    const parsed = parsePrompt(source)

    expect(parsed.metadata).toEqual({
      name: "windows",
      description: "Windows-authored prompt",
      variables: {
        sessionId: {
          type: "string",
          description: "Session identifier",
          required: true,
        },
        owner: {
          type: "string",
          description: "Prompt owner",
          required: undefined,
        },
      },
    })
    expect(parsed.body).toBe(
      "\r\nWindows session: {{sessionId}}\r\n{{#if owner}}Owner: {{owner}}{{else}}Owner: unassigned{{/if}}\r\n",
    )
  })
})
