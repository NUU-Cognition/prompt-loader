import { readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { describe, expect, it } from "vitest"

import { resolvePackageBasePath } from "../src/index"
import { fixturePath } from "./helpers"

describe("resolvePackageBasePath", () => {
  it("returns the on-disk root of an installed package", async () => {
    const basePath = resolvePackageBasePath("yaml")
    const manifest = JSON.parse(await readFile(path.join(basePath, "package.json"), "utf8"))

    expect(manifest.name).toBe("yaml")
    expect(path.isAbsolute(basePath)).toBe(true)
  })

  it("resolves from parentURL when provided", async () => {
    const fromHere = resolvePackageBasePath("yaml")
    const fromHelpers = resolvePackageBasePath(
      "yaml",
      pathToFileURL(fixturePath("default", "prompts", "basic.md")).href,
    )

    expect(fromHelpers).toBe(fromHere)
  })

  it("trims surrounding whitespace from packageName", () => {
    const trimmed = resolvePackageBasePath("  yaml  ")
    const direct = resolvePackageBasePath("yaml")

    expect(trimmed).toBe(direct)
  })

  it("throws when packageName is not a non-empty string", () => {
    expect(() => resolvePackageBasePath("")).toThrow(TypeError)
    expect(() => resolvePackageBasePath("   ")).toThrow(TypeError)
    expect(() => resolvePackageBasePath(undefined as unknown as string)).toThrow(TypeError)
    expect(() => resolvePackageBasePath(123 as unknown as string)).toThrow(TypeError)
  })

  it("throws when parentURL is provided but invalid", () => {
    expect(() => resolvePackageBasePath("yaml", "")).toThrow(TypeError)
    expect(() => resolvePackageBasePath("yaml", "   ")).toThrow(TypeError)
    expect(() => resolvePackageBasePath("yaml", 42 as unknown as string)).toThrow(TypeError)
  })

  it("throws when the target package is not installed", () => {
    expect(() =>
      resolvePackageBasePath("@no-such-scope/definitely-not-installed-xyz"),
    ).toThrow()
  })
})
