// Copies Steam Audio's shared library next to the built `.node`.
//
// Run as part of `postbuild`. Without it the addon does not load *at all* —
// not "spatial audio is unavailable", but a hard failure on `require`, because
// `phonon` is a load-time dependency of the `.node` once anything references a
// Steam Audio symbol. The napi loader reports that as its generic "Cannot find
// native binding" message, which points nowhere near the real cause, so this
// script existing is what keeps that confusion from recurring.
//
// The library is produced by `audionimbus-sys`'s `auto-install` build script,
// which downloads Valve's release and drops it in its OUT_DIR. That path
// contains a build hash, so it is discovered rather than hardcoded.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "..");

/** Platform-specific name of the Steam Audio shared library. */
const LIB = process.platform === "win32"
    ? "phonon.dll"
    : process.platform === "darwin"
      ? "libphonon.dylib"
      : "libphonon.so";

/** Finds the newest `out/lib/<LIB>` under any cargo target profile. */
function findLibrary() {
    const target = join(PKG, "target");
    if (!existsSync(target)) return null;

    const candidates = [];
    const walkBuildDirs = (profileDir) => {
        const build = join(profileDir, "build");
        if (!existsSync(build)) return;
        for (const entry of readdirSync(build)) {
            if (!entry.startsWith("audionimbus-sys-")) continue;
            const candidate = join(build, entry, "out", "lib", LIB);
            if (existsSync(candidate)) {
                candidates.push({ path: candidate, mtime: statSync(candidate).mtimeMs });
            }
        }
    };

    for (const entry of readdirSync(target)) {
        const dir = join(target, entry);
        if (!statSync(dir).isDirectory()) continue;
        walkBuildDirs(dir);
        // Cross-compilation nests one level deeper: target/<triple>/<profile>/.
        for (const sub of readdirSync(dir)) {
            const subdir = join(dir, sub);
            try {
                if (statSync(subdir).isDirectory()) walkBuildDirs(subdir);
            } catch {
                // Racing a concurrent cargo build; skip whatever vanished.
            }
        }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.mtime - a.mtime);
    return candidates[0].path;
}

const source = findLibrary();
if (!source) {
    // A warning rather than a hard failure: `cargo check` does not run the
    // auto-install step, so a tree that has only been checked legitimately has
    // no library yet.
    console.warn(
        `[copy-phonon] ${LIB} not found under target/. Spatial audio will not load. ` +
            `Run a full build (\`bun run build\`) to fetch it.`,
    );
    process.exit(0);
}

const dest = join(PKG, LIB);
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(source, dest);
console.log(`[copy-phonon] ${LIB} -> ${dest}`);
