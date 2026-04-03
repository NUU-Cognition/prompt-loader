# @nuucognition/prompt-loader

Markdown prompt loader with YAML frontmatter metadata, validation, recursive prompt discovery, and simple template rendering.

## Features

- Load prompts from disk with `loadPrompt()`
- Parse or validate prompt source directly with `parsePrompt()` and `validatePrompt()`
- Organize prompts in arbitrary nested folders under `prompts/`
- Discover prompts recursively with `discoverPrompts()`
- Fail fast on duplicate frontmatter `name` values during discovery
- Validate required variables and undeclared template references with clear, file-aware errors

## Install

```bash
pnpm add @nuucognition/prompt-loader
```

Requires Node.js `>=20`.

## Quick Start

Create a prompt file at `prompts/tasks/create.md`:

```markdown
---
name: task-create
description: Create a task prompt
variables:
  title:
    type: string
    required: true
    description: Task title
  owner:
    type: string
    required: false
    description: Optional owner
---

Create task: {{title}}

{{#if owner}}
Assign to {{owner}}.
{{/if}}
```

Load and render it:

```typescript
import { loadPrompt } from "@nuucognition/prompt-loader"

const output = await loadPrompt("tasks/create", {
  title: "Ship prompt loader hardening",
  owner: "Nathan",
})
```

## Prompt Format

Prompt files are Markdown files with YAML frontmatter followed by a body.

```markdown
---
name: greet
description: Greet a user
variables:
  userName:
    type: string
    required: true
    description: User display name
---

Hello, {{userName}}!
```

### Frontmatter Rules

- `name` is required and must be a non-empty string
- `description` is required and must be a non-empty string
- `variables` is optional and defaults to `{}`
- Each variable must be an object with:
  - `type: string`
  - `description: string`
  - `required?: boolean`

### Body Syntax

Two template constructs are supported:

- Interpolation: `{{variableName}}`
- Conditionals: `{{#if variableName}} ... {{else}} ... {{/if}}`

Conditionals use normal JavaScript truthiness:

- Falsy: `undefined`, `null`, `false`, `0`, `""`
- Truthy: non-empty strings, objects, arrays, non-zero numbers

Interpolation behavior:

- `null` and `undefined` render as `""`
- everything else renders via `String(value)`
- arrays become comma-joined strings
- objects become `"[object Object]"`

Whitespace is preserved exactly as written in the template body.

`{{else}}` is optional. When omitted, falsy values render nothing for that conditional block.

## Nested Prompt Directories

Prompts can live anywhere under the configured prompt root:

```text
prompts/
  basic.md
  tasks/
    create.md
  proposals/
    review.md
  teams/
    agents/
      session/
        init.md
```

Use slash-separated names when loading:

```typescript
await loadPrompt("tasks/create", { title: "Write docs" })
await loadPrompt("teams/agents/session/init", { agent: "Codex" })
```

Flat prompt names remain fully supported.

## API

### `loadPrompt(name, variables?, options?)`

Load a prompt file, validate it, validate provided variables, and render the body.

```typescript
async function loadPrompt(
  name: string,
  variables?: Record<string, unknown>,
  options?: {
    basePath?: string
    promptsDir?: string
    onUnknownVariable?: "warn" | "error" | "ignore"
    logger?: Pick<Console, "warn">
  },
): Promise<string>
```

Path resolution is:

```text
{basePath}/{promptsDir}/{name}.md
```

Defaults:

- `basePath`: `process.cwd()`
- `promptsDir`: `"prompts"`
- `onUnknownVariable`: `"warn"`

Examples:

```typescript
await loadPrompt("basic", { sessionId: "abc-123" })

await loadPrompt("tasks/create", { title: "Ship it" }, {
  basePath: "/repo",
  onUnknownVariable: "error",
})

await loadPrompt("init", { agent: "Codex" }, {
  basePath: "/repo",
  promptsDir: "custom-prompts",
})
```

### `parsePrompt(source)`

Parse raw prompt source into frontmatter metadata and body.

```typescript
function parsePrompt(source: string): {
  metadata: PromptMetadata
  body: string
}
```

This validates frontmatter structure but does not validate body references.

### `validatePrompt(source)`

Validate a raw prompt source without loading it from disk.

```typescript
function validatePrompt(source: string): {
  metadata: PromptMetadata
  body: string
}
```

This is useful for linting, CI, and editor tooling. It checks:

- frontmatter structure
- variable declarations
- undeclared `{{variable}}` / `{{#if variable}}` references
- malformed placeholders
- unclosed or unmatched conditionals

### `renderPrompt(body, variables, metadata?)`

Render a prompt body directly.

```typescript
function renderPrompt(
  body: string,
  variables?: Record<string, unknown>,
  metadata?: PromptMetadata,
): string
```

When `metadata` is provided, `renderPrompt()` validates that every referenced variable is declared.

### `discoverPrompts(options?)`

Recursively scan the prompt directory and return all parsed prompts.

```typescript
async function discoverPrompts(options?: {
  basePath?: string
  promptsDir?: string
}): Promise<Array<{
  promptName: string
  promptPath: string
  filePath: string
  metadata: PromptMetadata
  body: string
}>>
```

`promptPath` is the slash-separated load path without the `.md` extension.

Example:

```typescript
import { discoverPrompts } from "@nuucognition/prompt-loader"

const prompts = await discoverPrompts({ basePath: "/repo" })

for (const prompt of prompts) {
  console.log(prompt.promptPath, prompt.promptName)
}
```

## Duplicate Detection

`discoverPrompts()` enforces uniqueness of the frontmatter `name` field across the entire prompts directory tree.

This is invalid:

```text
prompts/tasks/create.md        -> name: duplicate-create
prompts/proposals/create.md    -> name: duplicate-create
```

Discovery throws a clear error listing the conflicting name and every file path involved. This is the recommended fail-fast validation step for CI or app startup.

## Error Handling

The loader surfaces actionable errors with file paths where available. Common cases:

- prompt file missing
- prompts directory missing
- malformed YAML frontmatter
- missing `name` or `description`
- invalid `variables` structure
- missing required variables at load time
- unknown variables passed to `loadPrompt()`
- undeclared template references in the body
- unterminated placeholders
- unclosed or unexpected `{{/if}}` blocks
- invalid prompt names such as `""`, `../x`, or `tasks//create`

Unknown variable handling is configurable:

- `"warn"`: log and continue
- `"error"`: throw
- `"ignore"`: silently continue

## Development

The package now keeps its test suite under `tests/`, organized by concern:

- `tests/parse.test.ts`
- `tests/render.test.ts`
- `tests/load.test.ts`
- `tests/validation.test.ts`

Run checks:

```bash
pnpm test
pnpm typecheck
pnpm build
```

## License

Internal package for the NUU Cognition monorepo.
