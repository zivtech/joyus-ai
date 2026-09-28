#!/usr/bin/env python3
"""Regression tests for scripts/check-client-abstraction.sh.

The guard must fail closed: if it cannot evaluate a pattern (unwritable temp
dir, grep error), it has to reject the content rather than let it through.
"""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_PATH = Path(__file__).resolve().with_name("check-client-abstraction.sh")

# Built by concatenation so this test file does not itself trip the guard.
FORBIDDEN_PATH = "/ho" + "me/example-user/project/notes.md"
FORBIDDEN_MSG = f"fix: update notes\n\nSee {FORBIDDEN_PATH} for details.\n"
CLEAN_MSG = "fix: update notes\n\nSee docs/notes.md for details.\n"

SYSTEM_TMP_READONLY_SANDBOX = (
    '(version 1)(allow default)(deny file-write* (subpath "/private/tmp"))'
)


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True)


class CheckClientAbstractionTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.env = dict(os.environ)

    def tearDown(self) -> None:
        for path in self.root.rglob("*"):
            if path.is_dir():
                path.chmod(stat.S_IRWXU)
        self._tmp.cleanup()

    def _msg_file(self, text: str) -> Path:
        path = self.root / "COMMIT_EDITMSG"
        path.write_text(text)
        return path

    def _staged_repo(self, text: str) -> Path:
        repo = self.root / "repo"
        repo.mkdir()
        _git(repo, "init", "-q")
        (repo / "notes.md").write_text(text)
        _git(repo, "add", "notes.md")
        return repo

    def _run(self, *args: str, cwd: Path | None = None, prefix: list[str] | None = None):
        return subprocess.run(
            [*(prefix or []), str(SCRIPT_PATH), *args],
            cwd=cwd,
            env=self.env,
            capture_output=True,
            text=True,
        )

    def _readonly_tmpdir(self) -> Path:
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            self.skipTest("read-only directories are writable by root")
        ro_dir = self.root / "readonly-tmp"
        ro_dir.mkdir()
        ro_dir.chmod(stat.S_IRUSR | stat.S_IXUSR)
        return ro_dir

    # (a) forbidden content is detected

    def test_commit_msg_with_forbidden_path_fails(self) -> None:
        result = self._run("--commit-msg", str(self._msg_file(FORBIDDEN_MSG)))
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("Client abstraction guard failed in commit message", result.stderr)
        self.assertIn(FORBIDDEN_PATH, result.stderr)

    def test_staged_file_with_forbidden_path_fails(self) -> None:
        repo = self._staged_repo(f"Notes live in {FORBIDDEN_PATH}\n")
        result = self._run("--staged", cwd=repo)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("Client abstraction guard failed in notes.md", result.stderr)
        self.assertIn(FORBIDDEN_PATH, result.stderr)

    # (b) detection survives an unwritable temp dir and fails closed on errors

    def test_detects_forbidden_path_with_unwritable_tmpdir(self) -> None:
        self.env["TMPDIR"] = str(self._readonly_tmpdir())
        repo = self._staged_repo(f"Notes live in {FORBIDDEN_PATH}\n")
        result = self._run("--staged", cwd=repo)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn(FORBIDDEN_PATH, result.stderr)

    @unittest.skipUnless(
        sys.platform == "darwin" and shutil.which("sandbox-exec"),
        "needs macOS sandbox-exec to deny writes to the system /tmp",
    )
    def test_detects_forbidden_path_with_unwritable_system_tmp(self) -> None:
        self.env["TMPDIR"] = str(self._readonly_tmpdir())
        msg = self._msg_file(FORBIDDEN_MSG)
        result = self._run(
            "--commit-msg",
            str(msg),
            prefix=["sandbox-exec", "-p", SYSTEM_TMP_READONLY_SANDBOX],
        )
        if "sandbox_apply" in result.stderr:
            self.skipTest("sandbox-exec is not permitted in this environment")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn(FORBIDDEN_PATH, result.stderr)

    def test_grep_error_fails_closed(self) -> None:
        # A grep that errors (exit 2) must not be mistaken for "no match".
        shim_dir = self.root / "bin"
        shim_dir.mkdir()
        shim = shim_dir / "grep"
        shim.write_text("#!/bin/sh\nexit 2\n")
        shim.chmod(stat.S_IRWXU)
        repo = self._staged_repo("Clean content with no forbidden patterns.\n")
        self.env["PATH"] = f"{shim_dir}{os.pathsep}{self.env['PATH']}"
        result = self._run("--staged", cwd=repo)
        self.assertNotEqual(result.returncode, 0, result.stderr)
        self.assertIn("grep exited 2", result.stderr)
        self.assertIn("failing closed", result.stderr)

    # (c) clean content passes

    def test_clean_commit_msg_passes(self) -> None:
        result = self._run("--commit-msg", str(self._msg_file(CLEAN_MSG)))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")

    def test_clean_staged_file_passes(self) -> None:
        repo = self._staged_repo("Notes live in docs/notes.md\n")
        result = self._run("--staged", cwd=repo)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")


if __name__ == "__main__":
    unittest.main()
