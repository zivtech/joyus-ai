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
# bash falls back to other directories when /tmp is unwritable, so only a
# sandbox with no writable location at all makes a heredoc fail. git still
# needs to open /dev/null read-write.
NO_WRITES_SANDBOX = (
    "(version 1)(allow default)(deny file-write*)"
    '(allow file-write* (subpath "/dev"))'
)


def _git(repo: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-c", "user.name=Test", "-c", "user.email=test@example.com", *args],
        cwd=repo,
        check=True,
        capture_output=True,
    )


class GuardTestBase(unittest.TestCase):
    """Shared fixtures; defines no tests of its own."""

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

    def _committed_repo(self, files: dict[str, str]) -> Path:
        repo = self.root / "repo"
        repo.mkdir()
        _git(repo, "init", "-q")
        for rel, text in files.items():
            path = repo / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        _git(repo, "add", "-A")
        _git(repo, "commit", "-q", "--no-verify", "-m", "chore: seed")
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


class CheckClientAbstractionTest(GuardTestBase):
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



class CheckClientAbstractionAllModeTest(GuardTestBase):
    """--all scans every tracked file, not just the staged diff."""

    def test_flags_committed_file_that_staged_mode_misses(self) -> None:
        repo = self._committed_repo({"docs/notes.md": f"See {FORBIDDEN_PATH}\n"})
        staged = self._run("--staged", cwd=repo)
        self.assertEqual(staged.returncode, 0, staged.stderr)
        result = self._run("--all", cwd=repo)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("Client abstraction guard failed in docs/notes.md", result.stderr)
        self.assertIn(FORBIDDEN_PATH, result.stderr)

    def test_clean_tree_passes(self) -> None:
        repo = self._committed_repo({"docs/notes.md": "See docs/other.md\n"})
        result = self._run("--all", cwd=repo)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")

    def test_reports_every_offending_file(self) -> None:
        repo = self._committed_repo(
            {
                "a.md": f"See {FORBIDDEN_PATH}\n",
                "nested/dir/b.ts": f"const p = '{FORBIDDEN_PATH}';\n",
                "clean.md": "nothing to see\n",
            }
        )
        result = self._run("--all", cwd=repo)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("failed in a.md", result.stderr)
        self.assertIn("failed in nested/dir/b.ts", result.stderr)
        self.assertNotIn("clean.md", result.stderr)

    def test_respects_exempt_paths(self) -> None:
        repo = self._committed_repo(
            {
                "CLAUDE.md": f"See {FORBIDDEN_PATH}\n",
                "kitty-specs/001-example/tasks/WP01.md": f"See {FORBIDDEN_PATH}\n",
            }
        )
        result = self._run("--all", cwd=repo)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_scans_whole_repo_from_subdirectory(self) -> None:
        repo = self._committed_repo(
            {"top.md": f"See {FORBIDDEN_PATH}\n", "sub/clean.md": "ok\n"}
        )
        result = self._run("--all", cwd=repo / "sub")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("failed in top.md", result.stderr)

    def test_ignores_untracked_files(self) -> None:
        repo = self._committed_repo({"clean.md": "ok\n"})
        (repo / "scratch.md").write_text(f"See {FORBIDDEN_PATH}\n")
        result = self._run("--all", cwd=repo)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_handles_paths_with_spaces_and_non_ascii(self) -> None:
        repo = self._committed_repo({"notes dir/café notes.md": f"See {FORBIDDEN_PATH}\n"})
        result = self._run("--all", cwd=repo)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("failed in notes dir/café notes.md", result.stderr)
        self.assertNotIn("failing closed", result.stderr)

    def test_detects_with_unwritable_tmpdir(self) -> None:
        repo = self._committed_repo({"a.md": f"See {FORBIDDEN_PATH}\n"})
        self.env["TMPDIR"] = str(self._readonly_tmpdir())
        result = self._run("--all", cwd=repo)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn(FORBIDDEN_PATH, result.stderr)

    @unittest.skipUnless(
        sys.platform == "darwin" and shutil.which("sandbox-exec") and Path("/bin/bash").exists(),
        "needs macOS sandbox-exec and the system bash 3.2",
    )
    def test_detects_with_no_writable_filesystem(self) -> None:
        # Regression guard: iterating candidates via a heredoc fails open here,
        # because bash cannot create the heredoc's temp file. Run under the
        # system bash 3.2, which always backs heredocs with a temp file; bash
        # 5.1+ uses a pipe for small ones.
        repo = self._committed_repo({"a.md": f"See {FORBIDDEN_PATH}\n"})
        result = self._run(
            "--all",
            cwd=repo,
            prefix=["sandbox-exec", "-p", NO_WRITES_SANDBOX, "/bin/bash"],
        )
        if "sandbox_apply" in result.stderr:
            self.skipTest("sandbox-exec is not permitted in this environment")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn(FORBIDDEN_PATH, result.stderr)

    def test_git_grep_error_fails_closed(self) -> None:
        # A git grep that errors (exit 2) must not be mistaken for "no match".
        real_git = shutil.which("git")
        assert real_git
        shim_dir = self.root / "bin"
        shim_dir.mkdir()
        shim = shim_dir / "git"
        shim.write_text(
            "#!/bin/sh\n"
            'for arg in "$@"; do [ "$arg" = grep ] && exit 2; done\n'
            f'exec "{real_git}" "$@"\n'
        )
        shim.chmod(stat.S_IRWXU)
        repo = self._committed_repo({"clean.md": "ok\n"})
        self.env["PATH"] = f"{shim_dir}{os.pathsep}{self.env['PATH']}"
        result = self._run("--all", cwd=repo)
        self.assertNotEqual(result.returncode, 0, result.stderr)
        self.assertIn("git grep exited 2", result.stderr)

    def test_outside_git_work_tree_fails_closed(self) -> None:
        outside = self.root / "not-a-repo"
        outside.mkdir()
        self.env["GIT_CEILING_DIRECTORIES"] = str(self.root)
        result = self._run("--all", cwd=outside)
        self.assertNotEqual(result.returncode, 0, result.stderr)
        self.assertIn("failing closed", result.stderr)


if __name__ == "__main__":
    unittest.main()
