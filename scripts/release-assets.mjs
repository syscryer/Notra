#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const compoundExtensions = [".app.tar.gz", ".tar.gz"];
const supportedAssetExtensions = [
  ".AppImage",
  ".app.tar.gz",
  ".deb",
  ".dmg",
  ".exe",
  ".msi",
  ".rpm",
  ".zip",
];
const requiredCliOptions = ["bundleRoot", "outDir", "artifact"];

export function splitAssetName(fileName) {
  for (const extension of compoundExtensions) {
    if (fileName.endsWith(extension)) {
      return {
        stem: fileName.slice(0, -extension.length),
        extension,
      };
    }
  }

  const lastDotIndex = fileName.lastIndexOf(".");
  if (lastDotIndex <= 0) {
    return { stem: fileName, extension: "" };
  }

  return {
    stem: fileName.slice(0, lastDotIndex),
    extension: fileName.slice(lastDotIndex),
  };
}

export function buildReleaseAssetName(fileName, artifact) {
  const { stem, extension } = splitAssetName(fileName);
  return `${stem}-${artifact}${extension}`;
}

export function isSupportedAssetFile(fileName) {
  return (
    !fileName.endsWith(".sig") &&
    supportedAssetExtensions.some((extension) => fileName.endsWith(extension))
  );
}

export async function collectBundleAssetFiles(bundleRoot) {
  const assetFiles = [];
  const pendingDirs = [bundleRoot];

  while (pendingDirs.length > 0) {
    const currentDir = pendingDirs.pop();
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        pendingDirs.push(fullPath);
      } else if (entry.isFile() && isSupportedAssetFile(entry.name)) {
        assetFiles.push(fullPath);
      }
    }
  }

  return assetFiles.sort((left, right) => left.localeCompare(right));
}

export async function collectAndCopyReleaseAssets({ bundleRoot, outDir, artifact }) {
  const assetFiles = await collectBundleAssetFiles(bundleRoot);
  await mkdir(outDir, { recursive: true });

  const copiedAssets = [];
  for (const source of assetFiles) {
    const destination = path.join(outDir, buildReleaseAssetName(path.basename(source), artifact));
    await copyFile(source, destination);
    copiedAssets.push({ source, destination });
  }

  return copiedAssets;
}

export function parseCliArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`不支持的位置参数: ${token}`);
    }

    const optionName = token
      .slice(2)
      .replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const optionValue = argv[index + 1];
    if (!optionValue || optionValue.startsWith("--")) {
      throw new Error(`缺少参数值: ${token}`);
    }

    options[optionName] = optionValue;
    index += 1;
  }

  for (const requiredOption of requiredCliOptions) {
    if (!options[requiredOption]) {
      const flagName = requiredOption.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
      throw new Error(`缺少必填参数: --${flagName}`);
    }
  }

  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);
  const copiedAssets = await collectAndCopyReleaseAssets(options);

  if (copiedAssets.length === 0) {
    throw new Error(`未在目录中找到可发布产物: ${options.bundleRoot}`);
  }

  for (const asset of copiedAssets) {
    console.log(asset.destination);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
