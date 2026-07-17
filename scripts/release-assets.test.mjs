import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildReleaseAssetName,
  collectAndCopyReleaseAssets,
  isSupportedAssetFile,
  splitAssetName,
} from "./release-assets.mjs";

test("复合扩展名保持完整", () => {
  assert.deepEqual(splitAssetName("Notra.app.tar.gz"), {
    stem: "Notra",
    extension: ".app.tar.gz",
  });
  assert.deepEqual(splitAssetName("Notra_0.1.0_amd64.AppImage"), {
    stem: "Notra_0.1.0_amd64",
    extension: ".AppImage",
  });
});

test("产物名称附加平台标识", () => {
  assert.equal(
    buildReleaseAssetName("Notra_0.1.0_x64-setup.exe", "windows-x64"),
    "Notra_0.1.0_x64-setup-windows-x64.exe",
  );
  assert.equal(
    buildReleaseAssetName("Notra_0.1.0_aarch64.dmg", "macos-arm64"),
    "Notra_0.1.0_aarch64-macos-arm64.dmg",
  );
  assert.equal(
    buildReleaseAssetName("Notra_0.1.0_amd64.AppImage", "linux-x64"),
    "Notra_0.1.0_amd64-linux-x64.AppImage",
  );
});

test("只识别可发布安装包", () => {
  for (const fileName of [
    "Notra.exe",
    "Notra.msi",
    "Notra.dmg",
    "Notra.deb",
    "Notra.rpm",
    "Notra.AppImage",
  ]) {
    assert.equal(isSupportedAssetFile(fileName), true);
  }
  assert.equal(isSupportedAssetFile("Notra.AppImage.sig"), false);
  assert.equal(isSupportedAssetFile("Notra.txt"), false);
});

test("递归收集并复制安装包及其更新签名", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "notra-release-assets-"));
  const bundleRoot = path.join(root, "bundle");
  const nested = path.join(bundleRoot, "nsis");
  const outDir = path.join(root, "out");

  try {
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, "Notra_0.1.0_x64-setup.exe"), "installer");
    await writeFile(path.join(nested, "Notra_0.1.0_x64-setup.exe.sig"), "signature");
    await writeFile(path.join(nested, "ignored.txt"), "ignored");

    const copied = await collectAndCopyReleaseAssets({
      bundleRoot,
      outDir,
      artifact: "windows-x64",
    });

    assert.equal(copied.length, 2);
    const destination = path.join(outDir, "Notra_0.1.0_x64-setup-windows-x64.exe");
    assert.equal(await readFile(destination, "utf8"), "installer");
    assert.equal(await readFile(`${destination}.sig`, "utf8"), "signature");
    assert.equal(existsSync(path.join(outDir, "ignored-windows-x64.txt")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
