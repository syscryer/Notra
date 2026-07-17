#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const updaterTargets = [
  {
    platform: "windows-x86_64",
    matches: (name) => name.endsWith("-windows-x64.exe"),
  },
  {
    platform: "darwin-aarch64",
    matches: (name) => name.endsWith("-macos-arm64.app.tar.gz"),
  },
  {
    platform: "linux-x86_64",
    matches: (name) => name.endsWith("-linux-x64.AppImage"),
  },
];

export async function generateLatestJson({ assetsDir, repository, releaseTag, version, publishedAt = new Date() }) {
  const fileNames = await readdir(assetsDir);
  const platforms = {};

  for (const target of updaterTargets) {
    const artifact = fileNames.find((name) => target.matches(name));
    if (!artifact) throw new Error(`缺少 ${target.platform} 更新产物`);
    const signatureFile = `${artifact}.sig`;
    if (!fileNames.includes(signatureFile)) throw new Error(`缺少更新签名: ${signatureFile}`);
    const signature = (await readFile(path.join(assetsDir, signatureFile), "utf8")).trim();
    if (!signature) throw new Error(`更新签名为空: ${signatureFile}`);

    platforms[target.platform] = {
      signature,
      url: `https://github.com/${repository}/releases/download/${releaseTag}/${encodeURIComponent(artifact)}`,
    };
  }

  const manifest = {
    version,
    notes: `完整更新说明：https://github.com/${repository}/releases/tag/${releaseTag}`,
    pub_date: publishedAt.toISOString(),
    platforms,
  };
  const outputPath = path.join(assetsDir, "latest.json");
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { outputPath, manifest };
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 4 || argv.some((value) => !value)) {
    throw new Error("用法: generate-latest-json.mjs <assets-dir> <repository> <release-tag> <version>");
  }
  const [assetsDir, repository, releaseTag, version] = argv;
  const { outputPath } = await generateLatestJson({ assetsDir, repository, releaseTag, version });
  console.log(outputPath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
