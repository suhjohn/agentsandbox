#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const version = process.env.PI_AI_VERSION || "0.52.12";
const outputPath = path.resolve(
  process.cwd(),
  "internal/modelcatalog/models.generated.json",
);

const tempDir = mkdtempSync(path.join(os.tmpdir(), "pi-ai-models-"));

try {
  const tarballUrl = JSON.parse(
    execFileSync(
      "npm",
      ["view", `@mariozechner/pi-ai@${version}`, "dist.tarball", "--json"],
      { encoding: "utf8" },
    ),
  );
  const tarballPath = path.join(tempDir, "package.tgz");
  execFileSync("curl", ["-L", "--silent", tarballUrl, "-o", tarballPath], {
    stdio: "inherit",
  });
  execFileSync("tar", ["-xzf", tarballPath, "-C", tempDir], {
    stdio: "inherit",
  });

  const modulePath = path.join(tempDir, "package", "dist", "models.generated.js");
  const mod = await import(pathToFileURL(modulePath).href);
  const models = [];
  for (const providerModels of Object.values(mod.MODELS || {})) {
    for (const model of Object.values(providerModels)) {
      models.push({
        provider: String(model.provider || "").trim(),
        id: String(model.id || "").trim(),
        name: String(model.name || "").trim(),
        reasoning: Boolean(model.reasoning),
      });
    }
  }
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        sourcePackage: "@mariozechner/pi-ai",
        sourceVersion: version,
        models,
      },
      null,
      2,
    ) + "\n",
  );
  const payload = JSON.parse(readFileSync(outputPath, "utf8"));
  if (!Array.isArray(payload.models) || payload.models.length === 0) {
    throw new Error("generated model catalog is empty");
  }
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}
