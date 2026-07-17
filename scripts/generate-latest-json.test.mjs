import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { generateLatestJson } from "./generate-latest-json.mjs";

test("生成三个平台的 Tauri 更新清单", async () => {
  const assetsDir = await mkdtemp(path.join(os.tmpdir(), "notra-latest-json-"));
  const artifacts = [
    "Notra_0.1.3_x64-setup-windows-x64.exe",
    "Notra_0.1.3_aarch64-macos-arm64.app.tar.gz",
    "Notra_0.1.3_amd64-linux-x64.AppImage",
  ];

  try {
    await mkdir(assetsDir, { recursive: true });
    for (const artifact of artifacts) {
      await writeFile(path.join(assetsDir, artifact), "bundle");
      await writeFile(path.join(assetsDir, `${artifact}.sig`), `signature-${artifact}`);
    }

    const publishedAt = new Date("2026-07-17T08:00:00.000Z");
    const { manifest } = await generateLatestJson({
      assetsDir,
      repository: "syscryer/Notra",
      releaseTag: "v0.1.3",
      version: "0.1.3",
      publishedAt,
    });

    assert.equal(manifest.version, "0.1.3");
    assert.equal(manifest.pub_date, publishedAt.toISOString());
    assert.deepEqual(Object.keys(manifest.platforms).sort(), [
      "darwin-aarch64",
      "linux-x86_64",
      "windows-x86_64",
    ]);
    assert.match(manifest.platforms["windows-x86_64"].url, /v0\.1\.3\/Notra_0\.1\.3_x64-setup-windows-x64\.exe$/);
    const fileManifest = JSON.parse(await readFile(path.join(assetsDir, "latest.json"), "utf8"));
    assert.deepEqual(fileManifest, manifest);
  } finally {
    await rm(assetsDir, { recursive: true, force: true });
  }
});

test("缺少签名时拒绝生成更新清单", async () => {
  const assetsDir = await mkdtemp(path.join(os.tmpdir(), "notra-latest-json-missing-"));
  try {
    await writeFile(path.join(assetsDir, "Notra_0.1.3_x64-setup-windows-x64.exe"), "bundle");
    await assert.rejects(
      generateLatestJson({
        assetsDir,
        repository: "syscryer/Notra",
        releaseTag: "v0.1.3",
        version: "0.1.3",
      }),
      /缺少更新签名/,
    );
  } finally {
    await rm(assetsDir, { recursive: true, force: true });
  }
});
