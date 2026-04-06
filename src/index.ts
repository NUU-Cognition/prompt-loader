import { readFile, readdir } from "node:fs/promises"
import path from "node:path"

import {
  normalizePromptPath,
  normalizePromptVariablesInput,
  renderPrompt,
  validatePromptInternal,
  validateProvidedVariables,
  type DiscoveredPrompt,
  type LoadPromptOptions,
  type PromptDiscoveryOptions,
} from "./core"

export { parsePrompt, renderPrompt, validatePrompt } from "./core"
export type {
  DiscoveredPrompt,
  LoadPromptOptions,
  ParsedPrompt,
  PromptDiscoveryOptions,
  PromptMetadata,
  PromptVariable,
  PromptVariables,
} from "./core"

const DEFAULT_PROMPTS_DIR = "prompts"

export async function loadPrompt(
  name: string,
  variables = {},
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

interface NormalizedPromptDiscoveryOptions {
  basePath: string
  promptsDir: string
  promptsRoot: string
}

interface NormalizedLoadOptions extends NormalizedPromptDiscoveryOptions {
  onUnknownVariable: NonNullable<LoadPromptOptions["onUnknownVariable"]>
  logger: Pick<Console, "warn">
}
