import path from "node:path"
import { fileURLToPath } from "node:url"

const FIXTURES_DIR = fileURLToPath(new URL("./fixtures/", import.meta.url))

export function fixturePath(...segments: string[]): string {
  return path.join(FIXTURES_DIR, ...segments)
}
