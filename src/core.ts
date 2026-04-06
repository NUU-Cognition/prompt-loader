import { parse as parseYaml } from "yaml"

export interface PromptVariable {
  type: string
  description: string
  required?: boolean
}

export interface PromptMetadata {
  name: string
  description: string
  variables: Record<string, PromptVariable>
}

export interface ParsedPrompt {
  metadata: PromptMetadata
  body: string
}

export interface PromptDiscoveryOptions {
  basePath?: string
  promptsDir?: string
}

export interface DiscoveredPrompt extends ParsedPrompt {
  promptName: string
  promptPath: string
  filePath: string
}

export interface LoadPromptOptions extends PromptDiscoveryOptions {
  onUnknownVariable?: "warn" | "error" | "ignore"
  logger?: Pick<Console, "warn">
}

export type PromptVariables = Record<string, unknown>

const FRONTMATTER_DELIMITER = "---"
const CONDITIONAL_CLOSE = "{{/if}}"
const INLINE_PROMPT_SOURCE = "prompt source"

export function parsePrompt(source: string): ParsedPrompt {
  assertString(source, "Prompt source")

  return parsePromptInternal(source, INLINE_PROMPT_SOURCE)
}

export function validatePrompt(source: string): ParsedPrompt {
  assertString(source, "Prompt source")

  return validatePromptInternal(source, INLINE_PROMPT_SOURCE)
}

export function renderPrompt(
  body: string,
  variables: PromptVariables = {},
  metadata?: PromptMetadata,
): string {
  assertString(body, "Prompt body")

  const normalizedVariables = normalizePromptVariablesInput(variables)

  if (metadata) {
    validateTemplateVariables(body, metadata, INLINE_PROMPT_SOURCE)
  }

  const { output, index } = renderSection(body, normalizedVariables, 0, INLINE_PROMPT_SOURCE)

  if (index !== body.length) {
    throw new Error("Unexpected closing {{/if}} without a matching {{#if}} in prompt body")
  }

  return output
}

export function validatePromptInternal(source: string, sourceLabel: string): ParsedPrompt {
  const parsedPrompt = parsePromptInternal(source, sourceLabel)
  validateParsedPrompt(parsedPrompt, sourceLabel)

  return parsedPrompt
}

export function validateProvidedVariables(
  promptPath: string,
  filePath: string,
  metadata: PromptMetadata,
  variables: PromptVariables,
  options: Pick<Required<LoadPromptOptions>, "onUnknownVariable" | "logger">,
): void {
  const missing = Object.entries(metadata.variables)
    .filter(([key, definition]) => definition.required && isMissingRequiredVariable(variables[key]))
    .map(([key]) => key)

  if (missing.length > 0) {
    throw new Error(
      `Missing required prompt variable${missing.length === 1 ? "" : "s"} for "${promptPath}" in "${filePath}": ${missing.join(", ")}. Provide ${missing.length === 1 ? "it" : "them"} in the variables argument.`,
    )
  }

  const unknown = Object.keys(variables).filter((key) => !Object.hasOwn(metadata.variables, key))

  if (unknown.length === 0) {
    return
  }

  const message = `Unknown prompt variable${unknown.length === 1 ? "" : "s"} for "${promptPath}" in "${filePath}": ${unknown.join(", ")}. Declare ${unknown.length === 1 ? "it" : "them"} in frontmatter.variables or remove ${unknown.length === 1 ? "it" : "them"} from the call.`

  switch (options.onUnknownVariable) {
    case "error":
      throw new Error(message)
    case "warn":
      options.logger.warn(message)
      return
    case "ignore":
      return
  }
}

export function normalizePromptVariablesInput(value: PromptVariables | undefined): PromptVariables {
  if (value === undefined) {
    return {}
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Prompt variables must be an object map")
  }

  return value
}

export function normalizePromptPath(name: string): string {
  if (typeof name !== "string") {
    throw new TypeError("Prompt name must be a string")
  }

  const normalizedName = name.trim().replaceAll("\\", "/")

  if (normalizedName.length === 0) {
    throw new TypeError("Prompt name must be a non-empty string")
  }

  if (normalizedName.startsWith("/")) {
    throw new Error("Prompt name must be a relative prompt path")
  }

  const segments = normalizedName.split("/")

  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error(
      'Prompt name must be a relative prompt path without empty, "." or ".." segments',
    )
  }

  return segments.join("/")
}

function parsePromptInternal(source: string, sourceLabel: string): ParsedPrompt {
  const { frontmatter, body } = splitFrontmatter(source, sourceLabel)
  let parsed: unknown

  try {
    parsed = parseYaml(frontmatter)
  } catch (error) {
    throw new Error(
      `Failed to parse YAML frontmatter in ${describeSource(sourceLabel)}: ${getErrorMessage(error)}`,
    )
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Prompt frontmatter in ${describeSource(sourceLabel)} must be a YAML object`)
  }

  const metadata = normalizeMetadata(parsed as Record<string, unknown>, sourceLabel)

  return {
    metadata,
    body,
  }
}

function validateParsedPrompt(parsedPrompt: ParsedPrompt, sourceLabel: string): void {
  validateTemplateVariables(parsedPrompt.body, parsedPrompt.metadata, sourceLabel)
  const { index } = renderSection(parsedPrompt.body, {}, 0, sourceLabel)

  if (index !== parsedPrompt.body.length) {
    throw new Error(
      `Unexpected closing {{/if}} without a matching {{#if}} in ${describeSource(sourceLabel)}`,
    )
  }
}

function splitFrontmatter(source: string, sourceLabel: string): { frontmatter: string; body: string } {
  const openingDelimiter = `${FRONTMATTER_DELIMITER}\n`
  const openingDelimiterWithCr = `${FRONTMATTER_DELIMITER}\r\n`

  if (!source.startsWith(openingDelimiter) && !source.startsWith(openingDelimiterWithCr)) {
    throw new Error(
      `${capitalizeSourceLabel(sourceLabel)} must start with YAML frontmatter delimited by ---`,
    )
  }

  const frontmatterStart = source.startsWith(openingDelimiterWithCr)
    ? openingDelimiterWithCr.length
    : openingDelimiter.length
  const closingMatch = /\r?\n---(?=\r?\n|$)/u.exec(source.slice(frontmatterStart))

  if (!closingMatch || closingMatch.index === undefined) {
    throw new Error(
      `${capitalizeSourceLabel(sourceLabel)} is missing a closing frontmatter delimiter (---)`,
    )
  }

  const closingIndex = frontmatterStart + closingMatch.index
  const frontmatter = source.slice(frontmatterStart, closingIndex)
  const bodyStart = closingIndex + closingMatch[0].length
  const body =
    source.startsWith("\r\n", bodyStart)
      ? source.slice(bodyStart + 2)
      : source.startsWith("\n", bodyStart)
        ? source.slice(bodyStart + 1)
        : source.slice(bodyStart)

  return {
    frontmatter,
    body,
  }
}

function normalizeMetadata(value: Record<string, unknown>, sourceLabel: string): PromptMetadata {
  const name = normalizeRequiredString(value.name, "name", sourceLabel)
  const description = normalizeRequiredString(value.description, "description", sourceLabel)
  const variables = normalizeVariables(value.variables, sourceLabel)

  return {
    name,
    description,
    variables,
  }
}

function normalizeVariables(
  value: unknown,
  sourceLabel: string,
): Record<string, PromptVariable> {
  if (value == null) {
    return {}
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `Prompt frontmatter field "variables" in ${describeSource(sourceLabel)} must be a YAML object`,
    )
  }

  const entries = Object.entries(value as Record<string, unknown>).map(([key, variable]) => {
    if (!variable || typeof variable !== "object" || Array.isArray(variable)) {
      throw new Error(
        `Prompt variable "${key}" in ${describeSource(sourceLabel)} must be a YAML object`,
      )
    }

    const record = variable as Record<string, unknown>

    return [
      key,
      {
        type: normalizeRequiredString(record.type, `variables.${key}.type`, sourceLabel),
        description: normalizeRequiredString(
          record.description,
          `variables.${key}.description`,
          sourceLabel,
        ),
        required: normalizeRequiredFlag(record.required, key, sourceLabel),
      },
    ] satisfies [string, PromptVariable]
  })

  return Object.fromEntries(entries)
}

function normalizeRequiredFlag(
  value: unknown,
  variableName: string,
  sourceLabel: string,
): boolean | undefined {
  if (value == null) {
    return undefined
  }

  if (typeof value !== "boolean") {
    throw new Error(
      `Prompt variable "${variableName}" field "required" in ${describeSource(sourceLabel)} must be a boolean`,
    )
  }

  return value
}

function normalizeRequiredString(value: unknown, fieldName: string, sourceLabel: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `Prompt frontmatter field "${fieldName}" in ${describeSource(sourceLabel)} must be a non-empty string`,
    )
  }

  return value.trim()
}

function isMissingRequiredVariable(value: unknown): boolean {
  return value == null
}

function validateTemplateVariables(
  body: string,
  metadata: PromptMetadata,
  sourceLabel: string,
): void {
  const usedVariables = collectTemplateVariables(body, sourceLabel)
  const undeclared = Array.from(usedVariables).filter((name) => !Object.hasOwn(metadata.variables, name))

  if (undeclared.length > 0) {
    throw new Error(
      `Prompt body in ${describeSource(sourceLabel)} references undeclared variable${undeclared.length === 1 ? "" : "s"}: ${undeclared.join(", ")}. Declare ${undeclared.length === 1 ? "it" : "them"} in frontmatter.variables or remove the reference${undeclared.length === 1 ? "" : "s"}.`,
    )
  }
}

function collectTemplateVariables(body: string, sourceLabel: string): Set<string> {
  const usedVariables = new Set<string>()
  let index = 0

  while (index < body.length) {
    if (!body.startsWith("{{", index)) {
      index += 1
      continue
    }

    const token = parseTemplateTokenAt(body, index, sourceLabel)

    if (token.kind === "placeholder" || token.kind === "conditional-open") {
      usedVariables.add(token.variableName)
    }

    index = token.nextIndex
  }

  return usedVariables
}

function renderSection(
  input: string,
  variables: PromptVariables,
  startIndex: number,
  sourceLabel: string,
  stopAtElse = false,
): { output: string; index: number; hitElse: boolean } {
  let output = ""
  let index = startIndex

  while (index < input.length) {
    if (input.startsWith(CONDITIONAL_CLOSE, index)) {
      if (startIndex === 0) {
        throw new Error(
          `Unexpected closing {{/if}} without a matching {{#if}} in ${describeSource(sourceLabel)}`,
        )
      }

      return {
        output,
        index: index + CONDITIONAL_CLOSE.length,
        hitElse: false,
      }
    }

    if (input.startsWith("{{", index)) {
      const token = parseTemplateTokenAt(input, index, sourceLabel)

      if (stopAtElse && token.kind === "conditional-else") {
        return {
          output,
          index: token.nextIndex,
          hitElse: true,
        }
      }

      if (token.kind === "conditional-close") {
        if (startIndex === 0) {
          throw new Error(
            `Unexpected closing {{/if}} without a matching {{#if}} in ${describeSource(sourceLabel)}`,
          )
        }

        return {
          output,
          index: token.nextIndex,
          hitElse: false,
        }
      }

      if (token.kind === "conditional-else") {
        if (!stopAtElse) {
          throw new Error(
            `Unexpected {{else}} outside of a conditional block in ${describeSource(sourceLabel)}`,
          )
        }

        return {
          output,
          index: token.nextIndex,
          hitElse: true,
        }
      }

      if (token.kind === "conditional-open") {
        const truthy = renderSection(input, variables, token.nextIndex, sourceLabel, true)
        let falsy: { output: string; index: number; hitElse: boolean } | null = null

        if (truthy.hitElse) {
          falsy = renderSection(input, variables, truthy.index, sourceLabel)
        }

        if (Boolean(variables[token.variableName])) {
          output += truthy.output
        } else if (falsy) {
          output += falsy.output
        }

        index = falsy ? falsy.index : truthy.index
        continue
      }

      output += stringifyTemplateValue(variables[token.variableName])
      index = token.nextIndex
      continue
    }

    output += input[index]
    index += 1
  }

  if (startIndex !== 0) {
    throw new Error(`Unclosed conditional block in ${describeSource(sourceLabel)}`)
  }

  return { output, index, hitElse: false }
}

function parseTemplateTokenAt(
  input: string,
  startIndex: number,
  sourceLabel: string,
):
  | { kind: "placeholder"; variableName: string; nextIndex: number }
  | { kind: "conditional-open"; variableName: string; nextIndex: number }
  | { kind: "conditional-close"; nextIndex: number }
  | { kind: "conditional-else"; nextIndex: number } {
  const endOfTag = input.indexOf("}}", startIndex)

  if (endOfTag === -1) {
    if (input.startsWith("{{#if", startIndex)) {
      throw new Error(`Unterminated conditional block in ${describeSource(sourceLabel)}`)
    }

    throw new Error(`Unterminated placeholder in ${describeSource(sourceLabel)}`)
  }

  const rawToken = input.slice(startIndex, endOfTag + 2)
  const token = input.slice(startIndex + 2, endOfTag).trim()
  const nextIndex = endOfTag + 2

  if (token === "/if") {
    return { kind: "conditional-close", nextIndex }
  }

  if (token === "else") {
    return { kind: "conditional-else", nextIndex }
  }

  if (token === "#if" || /^#if\s+/u.test(token)) {
    return {
      kind: "conditional-open",
      variableName: normalizeTemplateVariableName(
        token.slice(3).trim(),
        rawToken,
        sourceLabel,
        "Conditional block",
      ),
      nextIndex,
    }
  }

  return {
    kind: "placeholder",
    variableName: normalizeTemplateVariableName(token, rawToken, sourceLabel, "Placeholder"),
    nextIndex,
  }
}

function normalizeTemplateVariableName(
  value: string,
  rawToken: string,
  sourceLabel: string,
  tokenType: "Placeholder" | "Conditional block",
): string {
  if (value.length === 0) {
    throw new Error(`${tokenType} ${rawToken} in ${describeSource(sourceLabel)} must reference a variable name`)
  }

  if (/\s/u.test(value)) {
    throw new Error(
      `${tokenType} ${rawToken} in ${describeSource(sourceLabel)} must reference a single variable name without whitespace`,
    )
  }

  return value
}

function stringifyTemplateValue(value: unknown): string {
  if (value == null) {
    return ""
  }

  return String(value)
}

function describeSource(sourceLabel: string): string {
  return sourceLabel === INLINE_PROMPT_SOURCE ? sourceLabel : `prompt file "${sourceLabel}"`
}

function capitalizeSourceLabel(sourceLabel: string): string {
  const label = describeSource(sourceLabel)

  return `${label[0].toUpperCase()}${label.slice(1)}`
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function assertString(value: unknown, label: string): void {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`)
  }
}
