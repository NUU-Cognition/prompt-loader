import { access, cp, mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(import.meta.dirname, "..")

await assertBuiltPackageArtifacts()
await assertManifestReleaseShape()
await runPackedPackageSmokeTest()

async function assertBuiltPackageArtifacts() {
  await access(path.join(repoRoot, "dist", "index.js"))
  await access(path.join(repoRoot, "dist", "index.d.ts"))
}

async function assertManifestReleaseShape() {
  const packageJsonPath = path.join(repoRoot, "package.json")
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"))

  if (packageJson.main !== "./dist/index.js") {
    throw new Error(`package.json main must point to ./dist/index.js, found ${packageJson.main}`)
  }

  if (packageJson.types !== "./dist/index.d.ts") {
    throw new Error(`package.json types must point to ./dist/index.d.ts, found ${packageJson.types}`)
  }

  if (packageJson.exports?.["."]?.import !== "./dist/index.js") {
    throw new Error(
      `package.json exports["."].import must point to ./dist/index.js, found ${packageJson.exports?.["."]?.import}`,
    )
  }

  if (packageJson.exports?.["."]?.types !== "./dist/index.d.ts") {
    throw new Error(
      `package.json exports["."].types must point to ./dist/index.d.ts, found ${packageJson.exports?.["."]?.types}`,
    )
  }

  if (!Array.isArray(packageJson.files) || !packageJson.files.includes("dist")) {
    throw new Error('package.json files must include "dist"')
  }

  if (packageJson.files.includes("src")) {
    throw new Error('package.json files must not include "src"')
  }
}

async function runPackedPackageSmokeTest() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "prompt-loader-smoke-"))

  try {
    const packDirectory = path.join(tempRoot, "pack")
    const appRoot = path.join(tempRoot, "app")
    const packageRoot = path.join(appRoot, "node_modules", "@nuucognition", "prompt-loader")

    await mkdir(packDirectory, { recursive: true })
    await mkdir(path.dirname(packageRoot), { recursive: true })

    const { stdout } = await execFileAsync(
      "npm",
      ["pack", "--json", "--pack-destination", packDirectory],
      { cwd: repoRoot },
    )

    const packResult = JSON.parse(stdout)
    const tarballFile = packResult.at(-1)?.filename

    if (typeof tarballFile !== "string" || tarballFile.length === 0) {
      throw new Error("npm pack did not return a tarball filename")
    }

    const tarballPath = path.join(packDirectory, tarballFile)

    await execFileAsync("tar", ["-xzf", tarballPath, "-C", path.dirname(packageRoot)])
    await rename(path.join(path.dirname(packageRoot), "package"), packageRoot)

    await cp(path.join(repoRoot, "node_modules", "yaml"), path.join(appRoot, "node_modules", "yaml"), {
      recursive: true,
    })

    await mkdir(path.join(appRoot, "prompts"), { recursive: true })
    await writeFile(
      path.join(appRoot, "prompts", "smoke.md"),
      `---
name: smoke
description: Smoke test prompt
variables:
  tool:
    type: string
    required: true
    description: Tool name
  enabled:
    type: boolean
    description: Feature flag
---

Tool: {{tool}}
{{#if enabled}}Feature enabled{{else}}Feature disabled{{/if}}
`,
      "utf8",
    )

    await writeFile(
      path.join(appRoot, "smoke.mjs"),
      `import { discoverPrompts, loadPrompt } from "@nuucognition/prompt-loader"

const output = await loadPrompt("smoke", { tool: "prompt-loader", enabled: true }, {
  basePath: process.cwd(),
  onUnknownVariable: "error",
})

if (!output.includes("Tool: prompt-loader")) {
  throw new Error("Smoke loadPrompt output is missing the rendered tool name")
}

if (!output.includes("Feature enabled")) {
  throw new Error("Smoke loadPrompt output is missing the truthy conditional branch")
}

const prompts = await discoverPrompts({ basePath: process.cwd() })

if (prompts.length !== 1 || prompts[0]?.promptName !== "smoke") {
  throw new Error("Smoke discoverPrompts result did not include the packed package prompt")
}
`,
      "utf8",
    )

    await execFileAsync("node", ["smoke.mjs"], { cwd: appRoot })
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}
