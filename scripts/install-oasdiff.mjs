import { chmod, mkdir, readdir, rm } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { arch, platform } from "node:process";
import { execFileSync } from "node:child_process";

const version = "1.35.0";
const assets = {
  "win32-x64": ["windows_amd64", "5cdea2b64bd083d16dff19dba3aae011a0b7388ab33df81051cfc76800bf73e0"],
  "win32-arm64": ["windows_arm64", "da981a1d29092d43e692e65f90c5ce90232849e2aa9a7c1e417bd85108e58d98"],
  "linux-x64": ["linux_amd64", "a8023002fcb2eaa7f5758148a9303cb63d33b939886df312268bc0fc7b939140"],
  "linux-arm64": ["linux_arm64", "1f8b5aa033cd0240e6c53460268bcd6e578526666a4487a781ece8cef39fbdd"],
  "darwin-x64": ["darwin_all", "964ad2c0331768c4515fc49779827094bc89a65b1d309dac28886d1c3faf305c"],
  "darwin-arm64": ["darwin_all", "964ad2c0331768c4515fc49779827094bc89a65b1d309dac28886d1c3faf305c"],
};

const asset = assets[`${platform}-${arch}`];
if (!asset) throw new Error(`oasdiff ${version} is not pinned for ${platform}/${arch}. Set OASDIFF_PATH to a verified binary.`);

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const toolDirectory = join(repositoryRoot, ".tools", `oasdiff-${version}`);
const archiveName = `oasdiff_${version}_${asset[0]}.tar.gz`;
const archivePath = join(toolDirectory, archiveName);
const downloadUrl = `https://github.com/oasdiff/oasdiff/releases/download/v${version}/${archiveName}`;

await mkdir(toolDirectory, { recursive: true });
await rm(archivePath, { force: true });
const response = await fetch(downloadUrl, { redirect: "follow" });
if (!response.ok || !response.body) throw new Error(`Could not download the pinned oasdiff release (${response.status}).`);
await pipeline(response.body, createWriteStream(archivePath, { flags: "wx" }));

const hash = createHash("sha256");
for await (const chunk of createReadStream(archivePath)) hash.update(chunk);
if (hash.digest("hex") !== asset[1]) {
  await rm(archivePath, { force: true });
  throw new Error("The oasdiff archive checksum did not match the official v1.35.0 checksum.");
}

try {
  execFileSync("tar", ["-xzf", archivePath, "-C", toolDirectory], { stdio: "ignore" });
} catch {
  throw new Error("Could not extract the verified oasdiff archive; install a tar utility and retry.");
}
await rm(archivePath, { force: true });

async function findExecutable(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) {
      const found = await findExecutable(path);
      if (found) return found;
    } else if (item.name.toLowerCase() === (platform === "win32" ? "oasdiff.exe" : "oasdiff")) {
      return path;
    }
  }
  return null;
}

const executable = await findExecutable(toolDirectory);
if (!executable) throw new Error("The verified oasdiff archive did not contain its executable.");
if (platform !== "win32") await chmod(executable, 0o755);
console.log(`oasdiff ${version} is ready at ${executable}`);
