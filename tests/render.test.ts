import { describe, expect, it } from "vitest"

import { renderPrompt, type PromptMetadata } from "../src/index"

const nestedMetadata: PromptMetadata = {
  name: "nested",
  description: "Nested conditional prompt",
  variables: {
    outer: { type: "string", description: "Outer value" },
    inner: { type: "string", description: "Inner value" },
    deepest: { type: "string", description: "Deepest value" },
    zero: { type: "number", description: "Zero value" },
    disabled: { type: "boolean", description: "Disabled value" },
    empty: { type: "string", description: "Empty string value" },
    count: { type: "number", description: "Count value" },
    enabled: { type: "boolean", description: "Enabled value" },
    items: { type: "array", description: "Items" },
    settings: { type: "object", description: "Settings" },
    value: { type: "string", description: "Generic value" },
  },
}

describe("renderPrompt", () => {
  it("renders nested conditional blocks", () => {
    const body = [
      "Top",
      "{{#if outer}}",
      "Outer: {{outer}}",
      "{{#if inner}}",
      "Inner: {{inner}}",
      "{{/if}}",
      "{{/if}}",
      "Bottom",
    ].join("\n")

    const result = renderPrompt(body, {
      outer: "enabled",
      inner: "nested",
    })

    expect(result).toContain("Outer: enabled")
    expect(result).toContain("Inner: nested")
    expect(result).toContain("Bottom")
  })

  it("renders without metadata validation when metadata is omitted", () => {
    const result = renderPrompt("Unknown: {{unknown}}", { unknown: "value" })

    expect(result).toBe("Unknown: value")
  })

  it("renders deeply nested conditionals", () => {
    const result = renderPrompt(
      [
        "{{#if outer}}",
        "Outer",
        "{{#if inner}}",
        "Inner",
        "{{#if deepest}}",
        "Deepest: {{deepest}}",
        "{{/if}}",
        "{{/if}}",
        "{{/if}}",
      ].join("\n"),
      {
        outer: "yes",
        inner: "also-yes",
        deepest: "layer-3",
      },
      nestedMetadata,
    )

    expect(result).toContain("Outer")
    expect(result).toContain("Inner")
    expect(result).toContain("Deepest: layer-3")
  })

  it("renders else branches when the conditional value is falsy", () => {
    const result = renderPrompt(
      "{{#if enabled}}Enabled{{else}}Disabled{{/if}}",
      { enabled: false },
      nestedMetadata,
    )

    expect(result).toBe("Disabled")
  })

  it("treats 0 as falsy in conditional blocks", () => {
    const result = renderPrompt("Before\n{{#if zero}}Zero{{/if}}\nAfter", { zero: 0 }, nestedMetadata)

    expect(result).toBe("Before\n\nAfter")
  })

  it("treats false as falsy in conditional blocks", () => {
    const result = renderPrompt(
      "Before\n{{#if disabled}}Disabled{{/if}}\nAfter",
      { disabled: false },
      nestedMetadata,
    )

    expect(result).toBe("Before\n\nAfter")
  })

  it("treats an empty string as falsy in conditional blocks", () => {
    const result = renderPrompt("Before\n{{#if empty}}Hidden{{/if}}\nAfter", { empty: "" }, nestedMetadata)

    expect(result).toBe("Before\n\nAfter")
  })

  it("stringifies non-string interpolation values", () => {
    const result = renderPrompt(
      "Count: {{count}}\nEnabled: {{enabled}}\nItems: {{items}}\nSettings: {{settings}}",
      {
        count: 3,
        enabled: true,
        items: ["a", "b"],
        settings: { mode: "strict" },
      },
      nestedMetadata,
    )

    expect(result).toContain("Count: 3")
    expect(result).toContain("Enabled: true")
    expect(result).toContain("Items: a,b")
    expect(result).toContain("Settings: [object Object]")
  })

  it("preserves surrounding whitespace when conditional blocks are omitted", () => {
    const result = renderPrompt(
      "Before\n  {{#if value}}\n  Value: {{value}}\n  {{/if}}\nAfter",
      { value: "" },
      nestedMetadata,
    )

    expect(result).toBe("Before\n  \nAfter")
  })

  it("throws on unterminated placeholders", () => {
    expect(() => renderPrompt("Hello {{name", { name: "Nathan" })).toThrow(
      "Unterminated placeholder in prompt source",
    )
  })

  it("throws on unterminated conditional tags", () => {
    expect(() => renderPrompt("{{#if outer", { outer: true })).toThrow(
      "Unterminated conditional block in prompt source",
    )
  })

  it("throws on unclosed conditionals", () => {
    expect(() => renderPrompt("{{#if outer}}Hello", { outer: true })).toThrow(
      "Unclosed conditional block in prompt source",
    )
  })

  it("throws on unexpected closing conditionals", () => {
    expect(() => renderPrompt("Hello\n{{/if}}", {})).toThrow(
      "Unexpected closing {{/if}} without a matching {{#if}} in prompt source",
    )
  })

  it("renders nested conditionals with else branches at multiple levels", () => {
    const result = renderPrompt(
      [
        "{{#if outer}}",
        "Outer",
        "{{#if inner}}",
        "Inner: {{inner}}",
        "{{else}}",
        "No inner",
        "{{/if}}",
        "{{else}}",
        "{{#if inner}}",
        "Only inner: {{inner}}",
        "{{else}}",
        "Nothing",
        "{{/if}}",
        "{{/if}}",
      ].join("\n"),
      { outer: false, inner: "nested" },
      nestedMetadata,
    )

    expect(result).not.toContain("Outer")
    expect(result).toContain("Only inner: nested")
    expect(result).not.toContain("Nothing")
  })

  it("throws on unexpected else tags outside a conditional", () => {
    expect(() => renderPrompt("Hello\n{{else}}", {})).toThrow(
      "Unexpected {{else}} outside of a conditional block in prompt source",
    )
  })

  it("throws when metadata validation finds undeclared variables", () => {
    expect(() =>
      renderPrompt("Hello {{missing}}", {}, {
        name: "render-metadata",
        description: "Metadata validation",
        variables: {},
      }),
    ).toThrow(
      'Prompt body in prompt source references undeclared variable: missing. Declare it in frontmatter.variables or remove the reference.',
    )
  })

  it("rejects interpolation tokens that contain whitespace", () => {
    expect(() => renderPrompt("Hello {{missing value}}", {}, nestedMetadata)).toThrow(
      'Placeholder {{missing value}} in prompt source must reference a single variable name without whitespace',
    )
  })

  it("rejects conditional tokens that contain whitespace", () => {
    expect(() => renderPrompt("{{#if missing value}}Nope{{/if}}", {}, nestedMetadata)).toThrow(
      'Conditional block {{#if missing value}} in prompt source must reference a single variable name without whitespace',
    )
  })
})
