import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
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

const DEFAULT_PROMPTS_DIR = "prompts"
const FRONTMATTER_DELIMITER = "---"
const CONDITIONAL_OPEN = "{{#if "
const CONDITIONAL_CLOSE = "{{/if}}"
const CONDITIONAL_ELSE = "{{else}}"
const INLINE_PROMPT_SOURCE = "prompt source"

export function parsePrompt(source: string): ParsedPrompt {
  assertString(source, "Prompt source")

  return parsePromptInternal(source, INLINE_PROMPT_SOURCE)
}

export function validatePrompt(source: string): ParsedPrompt {
  assertString(source, "Prompt source")

  const parsedPrompt = parsePromptInternal(source, INLINE_PROMPT_SOURCE)
  validateParsedPrompt(parsedPrompt, INLINE_PROMPT_SOURCE)

  return parsedPrompt
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

export async function loadPrompt(
  name: string,
  variables: PromptVariables = {},
  options: LoadPromptOptions = {},
): Promise<string> {
  const promptPath = normalizePromptPath(name)
  const normalizedVariables = normalizePromptVariablesInput(variables)
  const normalizedOptions = normalizeLoadOptions(options)
  const filePath = resolvePromptFilePath(promptPath, normalizedOptions)
  const source = await readPromptSource(filePath, promptPath)
  const parsedPrompt = validatePromptInternal(source, filePath)

  validateProvidedVariables(promptPath, filePath, parsedPrompt.metadata, normalizedVariables, normalizedOptions)

  return renderPrompt(parsedPrompt.body, normalizedVariables, parsedPrompt.metadata)
}

export async function discoverPrompts(
  options: PromptDiscoveryOptions = {},
): Promise<DiscoveredPrompt[]> {
  const normalizedOptions = normalizePromptDiscoveryOptions(options)
  const markdownFiles = await collectPromptFiles(normalizedOptions.promptsRoot)
  const discoveredPrompts = await Promise.all(
    markdownFiles.map(async (filePath) => {
      const source = await readPromptSource(filePath, toPromptPath(normalizedOptions.promptsRoot, filePath))
      const parsedPrompt = validatePromptInternal(source, filePath)

      return {
        ...parsedPrompt,
        promptName: parsedPrompt.metadata.name,
        promptPath: toPromptPath(normalizedOptions.promptsRoot, filePath),
        filePath,
      } satisfies DiscoveredPrompt
    }),
  )

  assertUniquePromptNames(discoveredPrompts)

  return discoveredPrompts.sort((left, right) => left.promptPath.localeCompare(right.promptPath))
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

function validatePromptInternal(source: string, sourceLabel: string): ParsedPrompt {
  const parsedPrompt = parsePromptInternal(source, sourceLabel)
  validateParsedPrompt(parsedPrompt, sourceLabel)

  return parsedPrompt
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

function validateProvidedVariables(
  promptPath: string,
  filePath: string,
  metadata: PromptMetadata,
  variables: PromptVariables,
  options: NormalizedLoadOptions,
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

function isMissingRequiredVariable(value: unknown): boolean {
  return value == null
}

function validateTemplateVariables(
  body: string,
  metadata: PromptMetadata,
  sourceLabel: string,
): void {
  const usedVariables = collectTemplateVariables(body)
  const undeclared = Array.from(usedVariables).filter((name) => !Object.hasOwn(metadata.variables, name))

  if (undeclared.length > 0) {
    throw new Error(
      `Prompt body in ${describeSource(sourceLabel)} references undeclared variable${undeclared.length === 1 ? "" : "s"}: ${undeclared.join(", ")}. Declare ${undeclared.length === 1 ? "it" : "them"} in frontmatter.variables or remove the reference${undeclared.length === 1 ? "" : "s"}.`,
    )
  }
}

function collectTemplateVariables(body: string): Set<string> {
  const usedVariables = new Set<string>()
  const pattern = /{{\s*(#if\s+)?([^}\s]+)\s*}}/g

  for (const match of body.matchAll(pattern)) {
    if (match[2] === "/if" || match[2] === "else") {
      continue
    }

    usedVariables.add(match[2])
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
    if (stopAtElse && input.startsWith(CONDITIONAL_ELSE, index)) {
      return {
        output,
        index: index + CONDITIONAL_ELSE.length,
        hitElse: true,
      }
    }

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

    if (input.startsWith(CONDITIONAL_OPEN, index)) {
      const endOfTag = input.indexOf("}}", index)

      if (endOfTag === -1) {
        throw new Error(`Unterminated conditional block in ${describeSource(sourceLabel)}`)
      }

      const variableName = input.slice(index + CONDITIONAL_OPEN.length, endOfTag).trim()

      if (variableName.length === 0) {
        throw new Error(
          `Conditional block in ${describeSource(sourceLabel)} must reference a variable name`,
        )
      }

      const truthy = renderSection(input, variables, endOfTag + 2, sourceLabel, true)
      let falsy: { output: string; index: number; hitElse: boolean } | null = null

      if (truthy.hitElse) {
        falsy = renderSection(input, variables, truthy.index, sourceLabel)
      }

      if (Boolean(variables[variableName])) {
        output += truthy.output
      } else if (falsy) {
        output += falsy.output
      }

      index = falsy ? falsy.index : truthy.index
      continue
    }

    if (input.startsWith("{{", index)) {
      const endOfTag = input.indexOf("}}", index)

      if (endOfTag === -1) {
        throw new Error(`Unterminated placeholder in ${describeSource(sourceLabel)}`)
      }

      const token = input.slice(index + 2, endOfTag).trim()

      if (token === "/if") {
        if (startIndex === 0) {
          throw new Error(
            `Unexpected closing {{/if}} without a matching {{#if}} in ${describeSource(sourceLabel)}`,
          )
        }

        return {
          output,
          index: endOfTag + 2,
          hitElse: false,
        }
      }

      if (token === "else") {
        if (!stopAtElse) {
          throw new Error(
            `Unexpected {{else}} outside of a conditional block in ${describeSource(sourceLabel)}`,
          )
        }

        return {
          output,
          index: endOfTag + 2,
          hitElse: true,
        }
      }

      if (token.length === 0) {
        throw new Error(`Placeholder in ${describeSource(sourceLabel)} must reference a variable name`)
      }

      output += stringifyTemplateValue(variables[token])
      index = endOfTag + 2
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

function stringifyTemplateValue(value: unknown): string {
  if (value == null) {
    return ""
  }

  return String(value)
}

async function collectPromptFiles(promptsRoot: string): Promise<string[]> {
  let entries

  try {
    entries = await readdir(promptsRoot, { withFileTypes: true })
  } catch (error) {
    const errorWithCode = error as NodeJS.ErrnoException

    if (errorWithCode.code === "ENOENT") {
      throw new Error(
        `Prompts directory "${promptsRoot}" does not exist. Create it or set options.promptsDir to the correct location.`,
      )
    }

    throw error
  }

  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(promptsRoot, entry.name)

      if (entry.isDirectory()) {
        return collectPromptFiles(entryPath)
      }

      if (entry.isFile() && entry.name.endsWith(".md")) {
        return [entryPath]
      }

      return []
    }),
  )

  return files.flat().sort((left, right) => left.localeCompare(right))
}

async function readPromptSource(filePath: string, promptPath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8")
  } catch (error) {
    const errorWithCode = error as NodeJS.ErrnoException

    if (errorWithCode.code === "ENOENT") {
      throw new Error(
        `Prompt "${promptPath}" could not be found at "${filePath}". Check the prompt name or configure basePath/promptsDir correctly.`,
      )
    }

    throw error
  }
}

function assertUniquePromptNames(prompts: DiscoveredPrompt[]): void {
  const groupedByName = new Map<string, string[]>()

  for (const prompt of prompts) {
    const existing = groupedByName.get(prompt.promptName) ?? []
    existing.push(prompt.filePath)
    groupedByName.set(prompt.promptName, existing)
  }

  const duplicates = Array.from(groupedByName.entries()).filter(([, filePaths]) => filePaths.length > 1)

  if (duplicates.length === 0) {
    return
  }

  const details = duplicates
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([name, filePaths]) =>
        `- "${name}" is declared in:\n${filePaths
          .sort((left, right) => left.localeCompare(right))
          .map((filePath) => `  - ${filePath}`)
          .join("\n")}`,
    )
    .join("\n")

  throw new Error(
    `Duplicate prompt name${duplicates.length === 1 ? "" : "s"} found during discovery:\n${details}\nEach prompt frontmatter "name" must be unique across the prompts directory. Rename one of the prompts or change its frontmatter name.`,
  )
}

function normalizePromptVariablesInput(value: PromptVariables | undefined): PromptVariables {
  if (value === undefined) {
    return {}
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Prompt variables must be an object map")
  }

  return value
}

function normalizeLoadOptions(options: LoadPromptOptions): NormalizedLoadOptions {
  const normalizedOptions = normalizeOptionsObject(options)
  const discoveryOptions = normalizePromptDiscoveryOptions(normalizedOptions)

  return {
    ...discoveryOptions,
    onUnknownVariable: normalizeUnknownVariableMode(normalizedOptions.onUnknownVariable),
    logger: normalizeLogger(normalizedOptions.logger),
  }
}

function normalizePromptDiscoveryOptions(options: PromptDiscoveryOptions): NormalizedPromptDiscoveryOptions {
  const normalizedOptions = normalizeOptionsObject(options)
  const basePath = normalizeDirectoryOption(
    normalizedOptions.basePath,
    "options.basePath",
    process.cwd(),
  )
  const promptsDir = normalizeDirectoryOption(
    normalizedOptions.promptsDir,
    "options.promptsDir",
    DEFAULT_PROMPTS_DIR,
  )

  return {
    basePath,
    promptsDir,
    promptsRoot: path.resolve(basePath, promptsDir),
  }
}

function normalizeDirectoryOption(
  value: unknown,
  optionName: string,
  defaultValue: string,
): string {
  if (value === undefined) {
    return defaultValue
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${optionName} must be a non-empty string`)
  }

  return value.trim()
}

function normalizeUnknownVariableMode(
  value: LoadPromptOptions["onUnknownVariable"],
): NonNullable<LoadPromptOptions["onUnknownVariable"]> {
  if (value === undefined) {
    return "warn"
  }

  if (value === "warn" || value === "error" || value === "ignore") {
    return value
  }

  throw new TypeError('options.onUnknownVariable must be one of "warn", "error", or "ignore"')
}

function normalizeLogger(value: LoadPromptOptions["logger"]): Pick<Console, "warn"> {
  if (value === undefined) {
    return console
  }

  if (typeof value !== "object" || value === null || typeof value.warn !== "function") {
    throw new TypeError('options.logger must be an object with a "warn" method')
  }

  return value
}

function normalizeOptionsObject<T extends object>(value: T): T {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("options must be an object if provided")
  }

  return value
}

function normalizePromptPath(name: string): string {
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

function resolvePromptFilePath(name: string, options: NormalizedPromptDiscoveryOptions): string {
  const filePath = path.resolve(options.promptsRoot, `${path.join(...name.split("/"))}.md`)

  if (!isPathInsideDirectory(options.promptsRoot, filePath)) {
    throw new Error(`Prompt "${name}" resolves outside the prompts directory, which is not allowed`)
  }

  return filePath
}

function toPromptPath(promptsRoot: string, filePath: string): string {
  const relativePath = path.relative(promptsRoot, filePath)

  return relativePath.replace(/\\/g, "/").replace(/\.md$/u, "")
}

function isPathInsideDirectory(directory: string, candidate: string): boolean {
  const relativePath = path.relative(directory, candidate)

  return relativePath.length > 0 && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)
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

interface NormalizedPromptDiscoveryOptions {
  basePath: string
  promptsDir: string
  promptsRoot: string
}

interface NormalizedLoadOptions extends NormalizedPromptDiscoveryOptions {
  onUnknownVariable: NonNullable<LoadPromptOptions["onUnknownVariable"]>
  logger: Pick<Console, "warn">
}
