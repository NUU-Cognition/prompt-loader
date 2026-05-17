# @nuucognition/prompt-loader

Markdown prompt loader with YAML frontmatter metadata, validation, recursive prompt discovery, and template rendering. Designed for AI agent systems, CLI tools, and any application that manages structured prompts as files.

## Table of Contents

- [Overview](#overview)
- [Core Concepts](#core-concepts)
  - [Prompt Files](#prompt-files)
  - [Frontmatter Metadata](#frontmatter-metadata)
  - [Template Body](#template-body)
  - [Variables](#variables)
  - [Prompt Discovery](#prompt-discovery)
- [Install](#install)
- [Quick Start](#quick-start)
- [Prompt File Format](#prompt-file-format)
  - [Frontmatter Schema](#frontmatter-schema)
  - [Variable Definitions](#variable-definitions)
  - [Template Syntax](#template-syntax)
    - [Interpolation](#interpolation)
    - [Conditionals](#conditionals)
    - [Nesting Conditionals](#nesting-conditionals)
  - [Empty Body Prompts](#empty-body-prompts)
- [Directory Structure](#directory-structure)
  - [Flat Layout](#flat-layout)
  - [Nested Layout](#nested-layout)
  - [Custom Directories](#custom-directories)
- [API Reference](#api-reference)
  - [loadPrompt](#loadpromptname-variables-options)
  - [parsePrompt](#parseprompt-source)
  - [validatePrompt](#validatepromptsource)
  - [renderPrompt](#renderpromptbody-variables-metadata)
  - [discoverPrompts](#discoverpromptsoptions)
  - [resolvePackageBasePath](#resolvepackagebasepathpackagename-parenturl)
- [Types](#types)
  - [PromptMetadata](#promptmetadata)
  - [PromptVariable](#promptvariable)
  - [ParsedPrompt](#parsedprompt)
  - [DiscoveredPrompt](#discoveredprompt)
  - [LoadPromptOptions](#loadpromptoptions)
  - [PromptDiscoveryOptions](#promptdiscoveryoptions)
  - [PromptVariables](#promptvariables)
- [Validation](#validation)
  - [Frontmatter Validation](#frontmatter-validation)
  - [Body Validation](#body-validation)
  - [Variable Validation at Load Time](#variable-validation-at-load-time)
  - [Unknown Variable Handling](#unknown-variable-handling)
- [Duplicate Detection](#duplicate-detection)
- [Path Security](#path-security)
- [Error Reference](#error-reference)
- [Recipes](#recipes)
  - [Agent System Prompt Loading](#agent-system-prompt-loading)
  - [CI Prompt Validation](#ci-prompt-validation)
  - [Dynamic Prompt Registry](#dynamic-prompt-registry)
  - [Conditional Feature Sections](#conditional-feature-sections)
  - [Metadata-Only Prompts](#metadata-only-prompts)
  - [Shipping Prompts in a Reusable Package](#shipping-prompts-in-a-reusable-package)
- [Development](#development)
- [License](#license)

---

## Overview

`@nuucognition/prompt-loader` treats prompts as structured documents: markdown files with YAML frontmatter that declares metadata and variables, and a template body that renders with those variables at runtime. The package handles the full lifecycle from file discovery through validation to rendered output.

The pipeline for a single prompt:

```
file on disk
  -> read from {basePath}/{promptsDir}/{name}.md
  -> split YAML frontmatter from markdown body
  -> parse and validate frontmatter (name, description, variables)
  -> validate body template references against declared variables
  -> check required variables are provided
  -> render template (interpolation + conditionals)
  -> return rendered string
```

For bulk operations, `discoverPrompts()` walks the entire prompt directory recursively, parses every `.md` file, enforces unique names across the tree, and returns all prompts sorted by path.

## Core Concepts

### Prompt Files

A prompt is a single `.md` file with two sections separated by `---` delimiters:

1. **YAML frontmatter** -- declares the prompt's identity (`name`, `description`) and its variable schema
2. **Markdown body** -- the template text that gets rendered with variable substitution

The file lives inside a configurable prompts directory (default: `prompts/` relative to `basePath`). The file's path within that directory becomes its load path.

### Frontmatter Metadata

Every prompt declares a `name` (unique identifier), `description` (human-readable purpose), and optionally a `variables` map. The frontmatter is the prompt's contract: it tells consumers what the prompt is, what inputs it expects, and which inputs are required.

The `name` field is a logical identifier, not the filename. During discovery, the loader enforces that no two prompts share the same `name` value across the entire directory tree.

### Template Body

The body is the text after the closing `---` delimiter. It supports two template constructs: interpolation (`{{variableName}}`) and conditionals (`{{#if variableName}}...{{/if}}`). Everything else is literal text passed through unchanged. Whitespace is preserved exactly as written.

### Variables

Variables are the interface between the prompt author and the prompt consumer. The author declares variables in frontmatter with a type description, a human-readable description, and an optional `required` flag. The consumer passes values at load/render time. The loader validates that:

- All required variables are provided (non-null, non-undefined)
- All template references point to declared variables
- Unknown variables are flagged (configurable: warn, error, or ignore)

### Prompt Discovery

`discoverPrompts()` recursively walks the prompt directory, parses every `.md` file, validates each one, and returns the full set as structured objects. It enforces global uniqueness of the `name` field. This is the recommended approach for startup validation, building prompt registries, or CI checks.

---

## Install

```bash
npm install @nuucognition/prompt-loader
# or
pnpm add @nuucognition/prompt-loader
# or
yarn add @nuucognition/prompt-loader
```

Requires Node.js `>=20`. The package is ESM-only (`"type": "module"`).

---

## Quick Start

**1. Create a prompt file** at `prompts/greet.md`:

```markdown
---
name: greet
description: Greet a user by name
variables:
  userName:
    type: string
    required: true
    description: The user's display name
  role:
    type: string
    required: false
    description: Optional role or title
---

Hello, {{userName}}!

{{#if role}}
Your role: {{role}}
{{/if}}
```

**2. Load and render it:**

```typescript
import { loadPrompt } from "@nuucognition/prompt-loader"

const output = await loadPrompt("greet", {
  userName: "Nathan",
  role: "Engineer",
})

console.log(output)
// Hello, Nathan!
//
// Your role: Engineer
```

**3. Without the optional variable:**

```typescript
const output = await loadPrompt("greet", { userName: "Nathan" })

console.log(output)
// Hello, Nathan!
//
```

---

## Prompt File Format

### Frontmatter Schema

The YAML frontmatter block is delimited by `---` on its own line at the start and end:

```yaml
---
name: my-prompt
description: What this prompt does
variables:
  varName:
    type: string
    required: true
    description: What this variable is for
---
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | Yes | -- | Unique identifier for this prompt. Must be non-empty. Uniqueness is enforced during discovery. |
| `description` | `string` | Yes | -- | Human-readable description of what the prompt does. Must be non-empty. |
| `variables` | `object` | No | `{}` | Map of variable names to their definitions. When omitted or `null`, defaults to an empty object. |

### Variable Definitions

Each entry in the `variables` map describes one template variable:

```yaml
variables:
  sessionId:
    type: string
    required: true
    description: The session identifier
  verbose:
    type: boolean
    required: false
    description: Enable verbose output
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `type` | `string` | Yes | -- | Describes the expected data type. This is informational for consumers (not enforced at runtime). |
| `description` | `string` | Yes | -- | Describes what this variable is for. |
| `required` | `boolean` | No | `undefined` | When `true`, `loadPrompt()` throws if the variable is `null` or `undefined`. When omitted or `false`, the variable is optional. |

The `type` field is a human-readable hint (e.g., `"string"`, `"boolean"`, `"number"`, `"string[]"`). The loader does not enforce type checking at runtime -- it is metadata for documentation and tooling.

### Template Syntax

The prompt body supports two template constructs. All other text is literal.

#### Interpolation

Replace `{{variableName}}` with the variable's value:

```markdown
Hello, {{userName}}!
Session: {{sessionId}}
```

**Rendering rules:**

| Input Value | Rendered Output | Example |
|-------------|----------------|---------|
| `string` | The string itself | `"hello"` -> `hello` |
| `number` | String coercion | `42` -> `42` |
| `boolean` | String coercion | `true` -> `true` |
| `null` | Empty string | `null` -> `` |
| `undefined` | Empty string | `undefined` -> `` |
| `array` | Comma-joined | `["a","b"]` -> `a,b` |
| `object` | `[object Object]` | `{}` -> `[object Object]` |

All values are coerced via `String(value)`, except `null` and `undefined` which render as empty strings.

#### Conditionals

Conditionally include a section based on a variable's truthiness:

```markdown
{{#if role}}
Role: {{role}}
{{/if}}
```

With an `{{else}}` branch:

```markdown
{{#if verbose}}
Debug mode is ON.
{{else}}
Running in quiet mode.
{{/if}}
```

**Truthiness rules** follow JavaScript semantics:

| Value | Truthy? |
|-------|---------|
| Non-empty string (`"hello"`) | Yes |
| Non-zero number (`1`, `-1`) | Yes |
| `true` | Yes |
| Objects, arrays (including empty) | Yes |
| `""` (empty string) | No |
| `0` | No |
| `false` | No |
| `null` | No |
| `undefined` | No |

The `{{else}}` branch is optional. When omitted and the condition is falsy, the entire block renders as nothing.

#### Nesting Conditionals

Conditionals can nest to arbitrary depth:

```markdown
{{#if agent}}
Agent: {{agent}}
{{#if verbose}}
Verbose logging enabled for {{agent}}.
{{else}}
Standard logging for {{agent}}.
{{/if}}
{{/if}}
```

Each `{{#if}}` must have a matching `{{/if}}`. The loader validates this at parse time and throws if blocks are unmatched.

### Empty Body Prompts

A prompt can have frontmatter with no body. This is valid:

```markdown
---
name: metadata-only
description: Prompt with metadata only and no body
variables: {}
---
```

The rendered output is an empty string. This is useful when you only need the metadata (name, description, variable schema) for documentation or registry purposes.

---

## Directory Structure

### Flat Layout

The simplest layout puts all prompts directly in the `prompts/` directory:

```
prompts/
  greet.md
  summarize.md
  review.md
```

Load with the filename stem:

```typescript
await loadPrompt("greet", { userName: "Nathan" })
await loadPrompt("summarize", { text: "..." })
```

### Nested Layout

Prompts can be organized into arbitrarily deep subdirectories:

```
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

Load with slash-separated paths (no `.md` extension):

```typescript
await loadPrompt("basic", { sessionId: "abc" })
await loadPrompt("tasks/create", { title: "Ship it" })
await loadPrompt("proposals/review", { proposalId: "P-42" })
await loadPrompt("teams/agents/session/init", { agent: "Codex" })
```

The path is relative to the prompts root directory. Both forward slashes and backslashes are accepted (backslashes are normalized to forward slashes internally).

### Custom Directories

Override the base path and/or prompts directory name:

```typescript
// Different base path
await loadPrompt("greet", variables, {
  basePath: "/path/to/project",
})

// Different directory name
await loadPrompt("greet", variables, {
  promptsDir: "my-prompts",  // looks in {basePath}/my-prompts/
})

// Both
await loadPrompt("greet", variables, {
  basePath: "/path/to/project",
  promptsDir: "custom-prompts",
})
```

The resolved path is always `{basePath}/{promptsDir}/{name}.md`.

---

## API Reference

### `loadPrompt(name, variables?, options?)`

The primary high-level function. Loads a prompt file from disk, validates it completely, checks provided variables, and returns the rendered body.

```typescript
async function loadPrompt(
  name: string,
  variables?: PromptVariables,
  options?: LoadPromptOptions,
): Promise<string>
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | `string` | -- | Slash-separated prompt path relative to the prompts directory, without `.md` extension. |
| `variables` | `Record<string, unknown>` | `{}` | Variable values to substitute into the template body. |
| `options` | `LoadPromptOptions` | `{}` | Configuration for path resolution and validation behavior. |

**Returns:** `Promise<string>` -- the fully rendered prompt body.

**Throws:**
- If the prompt file does not exist
- If the prompts directory does not exist
- If frontmatter is missing or malformed
- If required variables are not provided
- If the prompt name contains path traversal segments (`..`, `.`, empty segments)
- If body template references undeclared variables
- If conditional blocks are unclosed or unmatched

**Example:**

```typescript
import { loadPrompt } from "@nuucognition/prompt-loader"

// Basic load
const output = await loadPrompt("basic", {
  sessionId: "abc-123",
  person: "Nathan",
})

// With options
const output = await loadPrompt("tasks/create", { title: "Ship it" }, {
  basePath: "/my/project",
  promptsDir: "prompts",
  onUnknownVariable: "error",
})
```

**Pipeline:** `read file` -> `parse frontmatter` -> `validate frontmatter` -> `validate body references` -> `check required variables` -> `check unknown variables` -> `render body` -> `return string`

---

### `parsePrompt(source)`

Parse a raw prompt source string into its metadata and body. Validates frontmatter structure but does NOT validate body template references.

```typescript
function parsePrompt(source: string): ParsedPrompt
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `string` | The full prompt source including frontmatter delimiters and body. |

**Returns:** `ParsedPrompt` -- an object with `metadata` and `body` fields.

**Throws:**
- If `source` is not a string
- If frontmatter delimiters are missing
- If YAML parsing fails
- If required frontmatter fields (`name`, `description`) are missing or invalid

**When to use:** When you have prompt source in memory (not on disk) and want the parsed structure without full body validation. Useful for editors, previews, or partial processing.

```typescript
import { parsePrompt } from "@nuucognition/prompt-loader"

const source = `---
name: inline
description: An inline prompt
variables:
  x:
    type: string
    required: true
    description: Input value
---

Value: {{x}}`

const { metadata, body } = parsePrompt(source)
console.log(metadata.name)         // "inline"
console.log(metadata.variables.x)  // { type: "string", required: true, description: "Input value" }
console.log(body)                  // "\nValue: {{x}}"
```

---

### `validatePrompt(source)`

Full validation of a raw prompt source: frontmatter structure AND body template references. Returns the parsed prompt if valid, throws on any issue.

```typescript
function validatePrompt(source: string): ParsedPrompt
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `string` | The full prompt source including frontmatter delimiters and body. |

**Returns:** `ParsedPrompt` -- identical to `parsePrompt()` output, but guaranteed to have a valid body.

**Throws:** Everything `parsePrompt()` throws, plus:
- If body references undeclared variables (variables not in frontmatter)
- If placeholders are malformed (e.g., whitespace in variable names)
- If conditional blocks are unclosed (`{{#if x}}` without `{{/if}}`)
- If `{{/if}}` appears without a matching `{{#if}}`

**When to use:** CI pipelines, linting, editor integrations, or any context where you want to validate prompts without rendering them. This is the recommended validation function for build-time checks.

```typescript
import { validatePrompt } from "@nuucognition/prompt-loader"

// In a CI script
const source = await fs.readFile("prompts/greet.md", "utf8")
validatePrompt(source) // throws if anything is wrong
```

---

### `renderPrompt(body, variables?, metadata?)`

Render a prompt body string directly with variable substitution. This is the low-level rendering function used internally by `loadPrompt()`.

```typescript
function renderPrompt(
  body: string,
  variables?: PromptVariables,
  metadata?: PromptMetadata,
): string
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `body` | `string` | -- | The template body text (the part after the frontmatter). |
| `variables` | `Record<string, unknown>` | `{}` | Variable values for substitution. |
| `metadata` | `PromptMetadata` | `undefined` | When provided, validates that all `{{variable}}` and `{{#if variable}}` references point to variables declared in this metadata. |

**Returns:** `string` -- the rendered body.

**Throws:**
- If `body` is not a string
- If conditional blocks are unmatched
- If `metadata` is provided and body references undeclared variables

**When to use:** When you already have the body and variables separated (e.g., after your own parsing step), or when you want to render a template string that didn't come from a file.

```typescript
import { renderPrompt } from "@nuucognition/prompt-loader"

const body = "Hello, {{name}}! {{#if admin}}You have admin access.{{/if}}"

const output = renderPrompt(body, { name: "Nathan", admin: true })
// "Hello, Nathan! You have admin access."
```

**With metadata validation:**

```typescript
const metadata = {
  name: "test",
  description: "test",
  variables: {
    name: { type: "string", description: "Name" },
    admin: { type: "boolean", description: "Admin flag" },
  },
}

// This works -- all references are declared
renderPrompt(body, { name: "Nathan" }, metadata)

// This throws -- "undeclaredVar" is not in metadata.variables
renderPrompt("{{undeclaredVar}}", {}, metadata)
```

---

### `discoverPrompts(options?)`

Recursively scan the prompt directory, parse and validate every `.md` file, enforce unique names, and return all prompts sorted by path.

```typescript
async function discoverPrompts(
  options?: PromptDiscoveryOptions,
): Promise<DiscoveredPrompt[]>
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `options` | `PromptDiscoveryOptions` | `{}` | Configuration for base path and prompts directory name. |

**Returns:** `Promise<DiscoveredPrompt[]>` -- array of discovered prompts, sorted by `promptPath` (locale compare).

**Throws:**
- If the prompts directory does not exist
- If any prompt file fails validation (frontmatter or body)
- If two or more prompts share the same `name` value in frontmatter

**When to use:** Application startup (validate all prompts upfront), building a prompt registry, CI checks, documentation generation, or any scenario where you need to enumerate and inspect all available prompts.

```typescript
import { discoverPrompts } from "@nuucognition/prompt-loader"

const prompts = await discoverPrompts({ basePath: "/my/project" })

for (const prompt of prompts) {
  console.log(`${prompt.promptPath} -> ${prompt.promptName}`)
  console.log(`  Description: ${prompt.metadata.description}`)
  console.log(`  Variables: ${Object.keys(prompt.metadata.variables).join(", ")}`)
  console.log(`  File: ${prompt.filePath}`)
}
```

**Output shape for a nested directory:**

```
basic -> basic
  Description: Basic interpolation and optional identity clause
  Variables: sessionId, person
  File: /my/project/prompts/basic.md
proposals/review -> proposal-review
  Description: Review a proposal
  Variables: proposalId, reviewer
  File: /my/project/prompts/proposals/review.md
tasks/create -> task-create
  Description: Create a task prompt
  Variables: title, owner
  File: /my/project/prompts/tasks/create.md
teams/agents/session/init -> team-agent-session-init
  Description: Initialize an agent session
  Variables: agent, verbose
  File: /my/project/prompts/teams/agents/session/init.md
```

Note that `promptPath` (derived from the file path) and `promptName` (from frontmatter `name`) are independent. The path is how you load the prompt; the name is a logical identifier.

---

### `resolvePackageBasePath(packageName, parentURL?)`

Resolve the on-disk root directory of an installed npm package. Use this when a library ships its own `prompts/` directory and is consumed through a bundler that erases the package's module identity (see [Shipping Prompts in a Reusable Package](#shipping-prompts-in-a-reusable-package) for the full rationale).

```typescript
function resolvePackageBasePath(
  packageName: string,
  parentURL?: string,
): string
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `packageName` | `string` | -- | The bare specifier of the target package (e.g. `"@my-org/my-lib"`). Surrounding whitespace is trimmed. |
| `parentURL` | `string` | `import.meta.url` of prompt-loader | A `file://` URL to resolve from — typically `import.meta.url` of the calling module. Required for strict pnpm layouts where the target package is not visible from prompt-loader's own location. |

**Returns:** `string` -- the absolute path of the package's root directory (the directory that contains `package.json`).

**Throws:**
- `TypeError` if `packageName` is not a non-empty string
- `TypeError` if `parentURL` is provided but is not a non-empty string
- The underlying `require.resolve` error if the package cannot be located, or if its `exports` field does not expose `./package.json`

**Requirement on the target package:** the package being resolved must either (a) have no `exports` field, or (b) include `"./package.json": "./package.json"` in its `exports`. Without that, Node's resolver will refuse to surface the manifest. This is a common one-line addition in modern packages.

**Example:**

```typescript
import path from "node:path"
import { loadPrompt, resolvePackageBasePath } from "@nuucognition/prompt-loader"

// Inside a library that ships its own prompts/ directory:
const PROMPTS_BASE_PATH = resolvePackageBasePath("@my-org/my-lib", import.meta.url)

await loadPrompt("greet", { name: "Nathan" }, { basePath: PROMPTS_BASE_PATH })
// Reads from <my-lib install root>/prompts/greet.md, regardless of whether
// my-lib was bundled into a downstream consumer.
```

**When to use:** Inside a reusable package that ships prompts as part of its published artifact. Direct application consumers loading their own prompts do not need this — `basePath` (or the default `process.cwd()`) is enough.

---

## Types

All types are exported from the package entrypoint.

### PromptMetadata

The parsed frontmatter of a prompt file.

```typescript
interface PromptMetadata {
  name: string
  description: string
  variables: Record<string, PromptVariable>
}
```

### PromptVariable

A single variable definition from the frontmatter.

```typescript
interface PromptVariable {
  type: string
  description: string
  required?: boolean
}
```

### ParsedPrompt

The result of parsing a prompt source.

```typescript
interface ParsedPrompt {
  metadata: PromptMetadata
  body: string
}
```

### DiscoveredPrompt

A parsed prompt enriched with discovery metadata. Extends `ParsedPrompt`.

```typescript
interface DiscoveredPrompt extends ParsedPrompt {
  promptName: string   // The frontmatter name field
  promptPath: string   // Slash-separated load path (no .md extension)
  filePath: string     // Absolute file system path
}
```

| Field | Source | Example |
|-------|--------|---------|
| `promptName` | `metadata.name` | `"task-create"` |
| `promptPath` | File path relative to prompts root | `"tasks/create"` |
| `filePath` | Absolute OS path | `"/repo/prompts/tasks/create.md"` |

### LoadPromptOptions

Options for `loadPrompt()`. Extends `PromptDiscoveryOptions`.

```typescript
interface LoadPromptOptions extends PromptDiscoveryOptions {
  onUnknownVariable?: "warn" | "error" | "ignore"
  logger?: Pick<Console, "warn">
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `basePath` | `string` | `process.cwd()` | Root directory for prompt resolution. |
| `promptsDir` | `string` | `"prompts"` | Name of the prompts subdirectory under `basePath`. |
| `onUnknownVariable` | `"warn" \| "error" \| "ignore"` | `"warn"` | What to do when the caller passes a variable not declared in frontmatter. |
| `logger` | `{ warn: Function }` | `console` | Logger used for `"warn"` mode. Must have a `warn` method. |

### PromptDiscoveryOptions

Options for `discoverPrompts()`.

```typescript
interface PromptDiscoveryOptions {
  basePath?: string
  promptsDir?: string
}
```

### PromptVariables

Type alias for the variables map passed to `loadPrompt()` and `renderPrompt()`.

```typescript
type PromptVariables = Record<string, unknown>
```

---

## Validation

The loader performs validation at multiple stages. Understanding when each check runs helps you choose the right function for your use case.

### Frontmatter Validation

Runs in: `parsePrompt()`, `validatePrompt()`, `loadPrompt()`, `discoverPrompts()`

Checks:
- Source starts with `---` frontmatter delimiter
- Closing `---` delimiter exists
- YAML parses successfully
- Parsed value is an object (not a scalar, array, or null)
- `name` is a non-empty string
- `description` is a non-empty string
- `variables` (if present) is an object
- Each variable entry is an object with `type` (string) and `description` (string)
- Each variable's `required` field (if present) is a boolean

### Body Validation

Runs in: `validatePrompt()`, `loadPrompt()`, `discoverPrompts()`

Does NOT run in: `parsePrompt()`

Checks:
- Every `{{variableName}}` and `{{#if variableName}}` references a variable declared in frontmatter
- No whitespace inside placeholder names (`{{ bad Name }}` is invalid)
- No whitespace inside conditional variable names (`{{#if bad Name}}` is invalid)
- Every `{{#if}}` has a matching `{{/if}}`
- No `{{/if}}` without a matching `{{#if}}`
- No `{{else}}` outside a conditional block

### Variable Validation at Load Time

Runs in: `loadPrompt()` only

Checks:
- Every variable with `required: true` is present in the provided variables (not `null`, not `undefined`)
- Variables not declared in frontmatter trigger the `onUnknownVariable` behavior

### Unknown Variable Handling

When the caller passes a variable key that doesn't appear in the prompt's frontmatter `variables`:

| Mode | Behavior |
|------|----------|
| `"warn"` (default) | Logs a warning via `options.logger.warn()` and continues |
| `"error"` | Throws an error immediately |
| `"ignore"` | Silently continues |

```typescript
// Strict mode -- fail on any unknown variable
await loadPrompt("greet", { userName: "Nathan", typo: "oops" }, {
  onUnknownVariable: "error",
})
// Error: Unknown prompt variable for "greet" in ".../greet.md": typo

// Permissive mode -- ignore unknown variables
await loadPrompt("greet", { userName: "Nathan", extra: "data" }, {
  onUnknownVariable: "ignore",
})
// Works fine, "extra" is silently ignored

// Custom logger
await loadPrompt("greet", { userName: "Nathan", extra: "data" }, {
  onUnknownVariable: "warn",
  logger: myCustomLogger,
})
```

---

## Duplicate Detection

`discoverPrompts()` enforces that the frontmatter `name` field is unique across the entire prompt directory tree. This prevents ambiguity when prompts are referenced by name rather than path.

**Invalid example:**

```
prompts/
  tasks/create.md     -> name: "create-task"
  legacy/create.md    -> name: "create-task"    # DUPLICATE
```

The error message lists every conflicting file:

```
Duplicate prompt name found during discovery:
- "create-task" is declared in:
  - /repo/prompts/legacy/create.md
  - /repo/prompts/tasks/create.md
Each prompt frontmatter "name" must be unique across the prompts directory.
Rename one of the prompts or change its frontmatter name.
```

This check is intentionally strict. Use `discoverPrompts()` at application startup or in CI to catch name collisions early.

---

## Path Security

The loader prevents directory traversal attacks in prompt names:

- `../secret` -- rejected (traversal segment)
- `tasks/../../etc/passwd` -- rejected (traversal segment)
- `tasks//create` -- rejected (empty segment)
- `./tasks/create` -- rejected (`.` segment)
- Absolute paths (`/etc/prompts/evil`) -- rejected
- Resolved paths that escape the prompts root -- rejected

All prompt names are resolved to absolute paths and checked to be inside the configured prompts directory before any file read occurs.

---

## Error Reference

Every error thrown by the loader is a standard `Error` (or `TypeError` for argument validation). Error messages include file paths where available, making them actionable in logs and CI output.

| Scenario | Error Message Pattern |
|----------|-----------------------|
| Prompt file not found | `Prompt "name" could not be found at "path". Check the prompt name or configure basePath/promptsDir correctly.` |
| Prompts directory missing | `Prompts directory "path" does not exist. Create it or set options.promptsDir to the correct location.` |
| No frontmatter delimiter | `Prompt source must start with YAML frontmatter delimited by ---` |
| Missing closing delimiter | `Prompt source is missing a closing frontmatter delimiter (---)` |
| YAML parse error | `Failed to parse YAML frontmatter in prompt source: <yaml error>` |
| Missing `name` | `Prompt frontmatter field "name" in prompt source must be a non-empty string` |
| Missing `description` | `Prompt frontmatter field "description" in prompt source must be a non-empty string` |
| Invalid variable definition | `Prompt variable "varName" in prompt file "path" must be a YAML object` |
| Missing required variable | `Missing required prompt variable for "name" in "path": varName. Provide it in the variables argument.` |
| Unknown variable (error mode) | `Unknown prompt variable for "name" in "path": varName. Declare it in frontmatter.variables or remove it from the call.` |
| Undeclared template reference | `Prompt body in prompt file "path" references undeclared variable: varName. Declare it in frontmatter.variables or remove the reference.` |
| Malformed placeholder | `Placeholder {{bad name}} in prompt source must reference a single variable name without whitespace` |
| Unclosed conditional | `Unclosed conditional block in prompt file "path"` |
| Unmatched `{{/if}}` | `Unexpected closing {{/if}} without a matching {{#if}} in prompt source` |
| Unterminated placeholder | `Unterminated placeholder in prompt source` |
| Path traversal | `Prompt name must be a relative prompt path without empty, "." or ".." segments` |
| Non-string source | `Prompt source must be a string` (TypeError) |
| Invalid variables argument | `Prompt variables must be an object map` (TypeError) |
| Duplicate names | `Duplicate prompt name found during discovery: ...` |

---

## Recipes

### Agent System Prompt Loading

Load structured system prompts for AI agents with dynamic context:

```typescript
import { loadPrompt } from "@nuucognition/prompt-loader"

const systemPrompt = await loadPrompt("agents/session/init", {
  agent: "Claude",
  sessionId: crypto.randomUUID(),
  person: "Nathan Luo",
  verbose: process.env.DEBUG === "true",
}, {
  basePath: import.meta.dirname,
})
```

### CI Prompt Validation

Validate all prompts in a CI pipeline without rendering:

```typescript
import { discoverPrompts } from "@nuucognition/prompt-loader"

try {
  const prompts = await discoverPrompts({ basePath: process.cwd() })
  console.log(`Validated ${prompts.length} prompts`)
  for (const p of prompts) {
    console.log(`  ${p.promptPath} (${p.promptName})`)
  }
} catch (error) {
  console.error("Prompt validation failed:", error.message)
  process.exit(1)
}
```

### Dynamic Prompt Registry

Build a runtime registry of all available prompts:

```typescript
import { discoverPrompts, loadPrompt } from "@nuucognition/prompt-loader"

const registry = await discoverPrompts({ basePath: "/app" })

// Index by name for fast lookup
const byName = new Map(registry.map(p => [p.promptName, p]))

// Check what variables a prompt needs before loading
const prompt = byName.get("task-create")
if (prompt) {
  const requiredVars = Object.entries(prompt.metadata.variables)
    .filter(([, v]) => v.required)
    .map(([k]) => k)
  console.log("Required variables:", requiredVars)

  // Load and render
  const output = await loadPrompt(prompt.promptPath, { title: "My Task" })
}
```

### Conditional Feature Sections

Use conditionals to build prompts that adapt to context:

```markdown
---
name: deploy-check
description: Pre-deployment verification prompt
variables:
  service:
    type: string
    required: true
    description: Service name
  staging:
    type: boolean
    required: false
    description: Whether this is a staging deployment
  rollbackPlan:
    type: string
    required: false
    description: Rollback instructions
---

Verify deployment of {{service}}.

{{#if staging}}
This is a STAGING deployment. Reduced verification required.
{{else}}
This is a PRODUCTION deployment. Full verification required.
{{/if}}

{{#if rollbackPlan}}
Rollback plan: {{rollbackPlan}}
{{/if}}
```

### Shipping Prompts in a Reusable Package

If you publish a library that bundles its own `prompts/` directory and is consumed by other apps, you cannot just use `import.meta.dirname` to locate them. When a downstream consumer bundles your library (with tsup, esbuild, webpack, etc.), the resulting `import.meta.url` points at the consumer's bundle, not your package — and the `prompts/` directory is no longer where the code thinks it is.

`resolvePackageBasePath` walks Node's module resolution back to the on-disk install of your package, regardless of bundling.

**1. In your package's `package.json`, expose the manifest in your `exports`:**

```json
{
  "name": "@my-org/my-lib",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": ["dist", "prompts"]
}
```

The `"./package.json"` entry is what makes the manifest resolvable. The `"prompts"` entry in `files` ensures the directory ships with the published tarball.

**2. In your library code, resolve the base path once and reuse it:**

```typescript
// my-lib/src/prompts.ts
import { loadPrompt, resolvePackageBasePath } from "@nuucognition/prompt-loader"

const PROMPTS_BASE_PATH = resolvePackageBasePath("@my-org/my-lib", import.meta.url)

export async function greetPrompt(name: string): Promise<string> {
  return loadPrompt("greet", { name }, { basePath: PROMPTS_BASE_PATH })
}
```

Always pass `import.meta.url` of the calling module as the second argument. Without it, the resolver runs from prompt-loader's own location, which only happens to find your package in hoisted layouts (npm flat, pnpm with `shamefully-hoist`). Passing your own `import.meta.url` makes resolution work in strict pnpm and other isolated layouts.

**3. Direct application consumers don't need this.** If you are an app loading prompts that live alongside your own source, keep using `basePath` (or the default `process.cwd()`). This recipe is specifically for the library-ships-assets case.

---

### Metadata-Only Prompts

Use prompts as structured metadata without a body:

```markdown
---
name: tool-config
description: Configuration prompt for tool initialization
variables: {}
---
```

```typescript
import { parsePrompt } from "@nuucognition/prompt-loader"
import { readFile } from "node:fs/promises"

const source = await readFile("prompts/tool-config.md", "utf8")
const { metadata } = parsePrompt(source)
console.log(metadata.name)        // "tool-config"
console.log(metadata.description) // "Configuration prompt for tool initialization"
```

---

## Development

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Lint
pnpm lint

# Type check
pnpm typecheck

# Build
pnpm build

# Smoke test (validates packed package can be imported and used)
pnpm test:smoke

# Full pre-release verification
pnpm verify:release
```

The `verify:release` script runs the complete gate: lint, typecheck, test, build, smoke test, and `npm pack --dry-run`.

### Test Structure

Tests are organized by concern in `tests/`:

| File | Tests |
|------|-------|
| `tests/parse.test.ts` | Frontmatter parsing, YAML validation, CRLF handling |
| `tests/render.test.ts` | Interpolation, conditionals, nesting, edge cases |
| `tests/load.test.ts` | Full load pipeline, required/unknown variables, nested paths, discovery |
| `tests/validation.test.ts` | Body validation, undeclared variables, malformed tokens |

### Package Outputs

| File | Description |
|------|-------------|
| `dist/index.js` | ES module bundle |
| `dist/index.d.ts` | TypeScript declarations |

The package ships ESM only. No CommonJS build is provided.

---

## License

[MIT](LICENSE)
