#!/usr/bin/env python3
"""Install Stack's complete, digest-pinned official Codex package. Never start it."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import subprocess
import tarfile
import tempfile


def target():
    pairs = {("Darwin", "arm64"): "aarch64-apple-darwin",
             ("Linux", "x86_64"): "x86_64-unknown-linux-musl"}
    value = pairs.get((platform.system(), platform.machine()))
    if not value:
        raise RuntimeError("official Codex installation supports macOS arm64 and Linux x64")
    return value


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def extract(archive, destination):
    # Full packages include native companions, resource trees and licenses.
    # Accept only ordinary paths; never publish an archive link or special file.
    with tarfile.open(archive, "r:gz") as bundle:
        size = 0
        seen = set()
        for member in bundle:
            parts = PurePosixPath(member.name).parts
            size += member.size
            if (not parts or member.name.startswith("/") or "\\" in member.name
                    or ".." in parts or member.name in seen
                    or not (member.isfile() or member.isdir())
                    or len(seen) >= 100000 or size > 2_000_000_000):
                raise RuntimeError("unsafe official Codex package entry")
            seen.add(member.name)
            path = destination.joinpath(*parts)
            if member.isdir():
                path.mkdir(parents=True, exist_ok=True, mode=0o700)
            else:
                path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                with bundle.extractfile(member) as source, path.open("xb") as output:
                    shutil.copyfileobj(source, output)
                path.chmod(0o700 if member.mode & 0o111 else 0o600)


def verify(directory, pin, triple, receipt):
    if directory.is_symlink() or not directory.is_dir():
        raise RuntimeError("official Codex release must be a real directory")
    manifest = json.loads((directory / "codex-package.json").read_text())
    if (manifest.get("layoutVersion") != 1 or manifest.get("version") != pin["version"]
            or manifest.get("target") != triple or manifest.get("variant") != "codex"
            or manifest.get("entrypoint") != "bin/codex"
            or manifest.get("resourcesDir") != "codex-resources"
            or manifest.get("pathDir") != "codex-path"):
        raise RuntimeError("official Codex package manifest does not match the pin")
    required = ["bin/codex", "bin/codex-code-mode-host", "codex-path/rg"]
    if triple.endswith("apple-darwin"):
        required.append("codex-resources/voice/bin/codex-voice-host")
    for relative in required:
        path = directory / relative
        if path.is_symlink() or not path.is_file() or not os.access(path, os.X_OK):
            raise RuntimeError("official Codex package is missing an executable companion: " + relative)
    if receipt and json.loads((directory / "stack-runtime.json").read_text()) != receipt:
        raise RuntimeError("installed Codex receipt does not match the pin")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--print-bin", action="store_true")
    parser.add_argument("--version", help="Require this exact bundle pin")
    parser.add_argument("--commit", help="Require this exact upstream source revision")
    parser.add_argument("--archive", type=Path, help="Use an already downloaded archive; the pinned digest is still required")
    args = parser.parse_args()
    pin = json.loads(Path(__file__).with_name("codex-release.json").read_text())
    if args.version and args.version != pin["version"] or args.commit and args.commit != pin["commit"]:
        raise RuntimeError("requested official Codex version does not match the bundled pin")
    triple = target()
    asset = pin["assets"][triple]
    root = Path.home() / ".local/libexec/stack/codex"
    link = root / "codex"
    directory = root / (pin["version"] + "-" + triple)
    receipt = {"owner": "stack-official-codex-v1", "repository": pin["repository"],
               "tag": pin["tag"], "version": pin["version"], "commit": pin["commit"],
               "target": triple, "sha256": asset["sha256"]}
    if args.print_bin:
        print(link)
        return
    if not args.install:
        print(f'Install official {pin["repository"]} {pin["tag"]} ({pin["commit"]}) at {directory}.')
        print(f'Verify {asset["name"]}, SHA-256 {asset["sha256"]}; select {link}. No processes restarted.')
        return
    if os.geteuid() == 0:
        raise RuntimeError("run as the target user, not root")
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (root / ".install.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if link.is_symlink() and not link.resolve().is_relative_to(root.resolve()):
            raise RuntimeError("refusing to replace an independent Codex executable")
        if link.exists() and not link.is_symlink():
            raise RuntimeError("refusing to replace an independent Codex executable")
        if directory.exists():
            verify(directory, pin, triple, receipt)
        else:
            with tempfile.TemporaryDirectory(prefix=".install-", dir=root) as temporary:
                staging = Path(temporary)
                archive = args.archive.resolve() if args.archive else staging / asset["name"]
                if not args.archive:
                    subprocess.run(["gh", "release", "download", pin["tag"], "--repo", pin["repository"],
                                    "--pattern", asset["name"], "--dir", str(staging)], check=True, timeout=600)
                if archive.stat().st_size != asset["bytes"] or digest(archive) != asset["sha256"]:
                    raise RuntimeError("official Codex archive size or SHA-256 mismatch")
                unpacked = staging / "package"
                unpacked.mkdir(mode=0o700)
                extract(archive, unpacked)
                verify(unpacked, pin, triple, None)
                (unpacked / "stack-runtime.json").write_text(json.dumps(receipt) + "\n")
                (unpacked / "stack-runtime.json").chmod(0o600)
                unpacked.rename(directory)
        temporary_link = root / (".codex-" + str(os.getpid()))
        try:
            temporary_link.symlink_to(directory / "bin/codex")
            temporary_link.replace(link)
        finally:
            temporary_link.unlink(missing_ok=True)
    print(f'Installed official Codex {pin["version"]} at {link}. Running processes were not restarted.')


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError, tarfile.TarError) as error:
        raise SystemExit(str(error))
