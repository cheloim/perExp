"""Contract tests for production ops configuration.

These guard the failure modes of the 2026-10-23 incident: unbounded log growth,
image tags that were never pruned, and a deploy pipeline that could not fail
loudly. They assert structural invariants of the ops files so a future edit
cannot silently reintroduce them.
"""

import os
import re
import stat
import subprocess
import textwrap

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
DEPLOY_YML = os.path.join(REPO_ROOT, ".github", "workflows", "deploy.yml")
LOGROTATE = os.path.join(REPO_ROOT, "docker", "ops", "logrotate-oikonomia")
HOUSEKEEPING = os.path.join(REPO_ROOT, "scripts", "housekeeping.sh")


def _read(path: str) -> str:
    with open(path) as f:
        return f.read()


# ── housekeeping.sh ────────────────────────────────────────────────


def _run_housekeeping(
    images: list[str],
    running: list[str],
    rollback: str,
    journal_size: int = 0,
    *extra: str,
):
    """Run housekeeping.sh --dry-run against a fake podman.

    Returns (returncode, stdout, stderr).
    """
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        root = os.path.join(tmp, "root")
        bin_dir = os.path.join(tmp, "bin")
        os.makedirs(root)
        os.makedirs(bin_dir)
        os.makedirs(os.path.join(root, "logs"))
        os.makedirs(os.path.join(root, "backups"))

        if rollback:
            with open(os.path.join(root, ".rollback_platform_tag"), "w") as f:
                f.write(rollback)
        if journal_size:
            with open(os.path.join(root, "logs", "journal.log"), "w") as f:
                f.write("x")

        fake_podman = os.path.join(bin_dir, "podman")
        images_args = " ".join(f"'{i}'" for i in images) or "''"
        running_args = " ".join(f"'{r}'" for r in running) or "''"
        with open(fake_podman, "w") as f:
            f.write(
                textwrap.dedent(
                    f"""\
                    #!/usr/bin/env bash
                    case "$1" in
                      images) printf '%s\\n' {images_args} ;;
                      ps) printf '%s\\n' {running_args} ;;
                      *) echo "FAKE-PODMAN $*" ;;
                    esac
                    """
                )
            )
        os.chmod(fake_podman, os.stat(fake_podman).st_mode | stat.S_IEXEC)

        # Fake `stat` so the journal-size guard can be exercised without
        # creating a 200MB file on disk.
        fake_stat = os.path.join(bin_dir, "stat")
        with open(fake_stat, "w") as f:
            f.write(
                textwrap.dedent(
                    f"""\
                    #!/usr/bin/env bash
                    echo "{journal_size}"
                    """
                )
            )
        os.chmod(fake_stat, os.stat(fake_stat).st_mode | stat.S_IEXEC)

        env = dict(os.environ)
        env["PATH"] = bin_dir + os.pathsep + env["PATH"]
        env["HOUSEKEEPING_ROOT"] = root
        env["HOUSEKEEPING_TSFILE_DIR"] = os.path.join(tmp, "no-textfile")

        proc = subprocess.run(
            ["bash", HOUSEKEEPING, "--dry-run", *extra],
            capture_output=True,
            text=True,
            env=env,
        )
        return proc.returncode, proc.stdout, proc.stderr


class TestHousekeepingImages:
    def test_keeps_current_and_rollback_releases(self):
        """A release is a coherent set: keep current + rollback tags in every repo.

        `IMAGE_TAG` is shared by backend/frontend/landing and
        `.rollback_platform_tag` holds the previous tag, so keeping only the
        running container's image would leave the rollback release half deleted.
        """
        images = [
            "ghcr.io/cheloim/perexp/backend:aaa1111",  # two releases back
            "ghcr.io/cheloim/perexp/frontend:aaa1111",
            "ghcr.io/cheloim/perexp/backend:bbb2222",  # rollback release
            "ghcr.io/cheloim/perexp/frontend:bbb2222",
            "ghcr.io/cheloim/perexp/landing:bbb2222",
            "ghcr.io/cheloim/perexp/backend:ccc3333",  # running release
            "ghcr.io/cheloim/perexp/frontend:ccc3333",
            "ghcr.io/cheloim/perexp/landing:ddd4444",  # orphan from a failed release
        ]
        running = ["ghcr.io/cheloim/perexp/backend:ccc3333"]

        code, out, err = _run_housekeeping(images, running, "bbb2222")

        assert code == 0, err
        kept = set(re.findall(r"^KEEP (\S+)$", out, re.MULTILINE))
        removed = set(re.findall(r"^REMOVE (\S+)$", out, re.MULTILINE))

        assert kept == {
            "ghcr.io/cheloim/perexp/backend:bbb2222",
            "ghcr.io/cheloim/perexp/frontend:bbb2222",
            "ghcr.io/cheloim/perexp/landing:bbb2222",
            "ghcr.io/cheloim/perexp/backend:ccc3333",
            "ghcr.io/cheloim/perexp/frontend:ccc3333",
        }
        assert removed == {
            "ghcr.io/cheloim/perexp/backend:aaa1111",
            "ghcr.io/cheloim/perexp/frontend:aaa1111",
            "ghcr.io/cheloim/perexp/landing:ddd4444",
        }
        assert not (kept & removed), "an image cannot be both kept and removed"

    def test_never_touches_non_app_images(self):
        """Base images (postgres, redis, nginx...) must not be candidates."""
        images = [
            "ghcr.io/cheloim/perexp/backend:aaa1111",
            "docker.io/library/postgres:16-alpine",
            "docker.io/library/redis:7-alpine",
            "docker.io/library/nginx:alpine",
            "docker.io/grafana/grafana:11.2.0",
        ]

        code, out, err = _run_housekeeping(images, [], "")

        assert code == 0, err
        removed = set(re.findall(r"^REMOVE (\S+)$", out, re.MULTILINE))
        assert removed == {"ghcr.io/cheloim/perexp/backend:aaa1111"}
        for base in (
            "docker.io/library/postgres:16-alpine",
            "docker.io/library/redis:7-alpine",
            "docker.io/library/nginx:alpine",
            "docker.io/grafana/grafana:11.2.0",
        ):
            assert base not in out, f"{base} is a base image and must never be a candidate"

    def test_is_executable(self):
        assert os.access(HOUSEKEEPING, os.X_OK), "housekeeping.sh must be executable"


class TestHousekeepingSafety:
    def test_dry_run_never_executes_destructive_commands(self):
        """--dry-run must be side-effect free: nothing gets removed."""
        images = ["ghcr.io/cheloim/perexp/backend:aaa1111"]

        code, out, err = _run_housekeeping(images, [], "")

        assert code == 0, err
        assert "DRY-RUN podman rmi" in out
        assert "FAKE-PODMAN rmi" not in out, "--dry-run must not call podman rmi"
        assert "FAKE-PODMAN volume" not in out, "--dry-run must not prune volumes"
        assert "FAKE-PODMAN image" not in out, "--dry-run must not prune images"

    def test_warns_when_journal_log_exceeds_the_cap(self):
        """Unbounded log growth must be reported before the disk fills."""
        code, out, err = _run_housekeeping([], [], "", 300 * 1024 * 1024)

        assert code == 0, err
        assert "journal.log ocupa" in out, "an oversized journal.log must be reported"

    def test_stays_silent_when_journal_log_is_small(self):
        code, out, err = _run_housekeeping([], [], "", 1024)

        assert code == 0, err
        assert "journal.log ocupa" not in out
        assert "journal.log dentro del tope" in out


# ── logrotate ──────────────────────────────────────────────────────


class TestLogRotation:
    def test_keeps_15_days(self):
        """journal.log is rotated daily and history is capped at 15 days."""
        conf = _read(LOGROTATE)
        assert "/opt/creditcardanalyzer/logs/journal.log" in conf
        assert re.search(r"^\s*daily\s*$", conf, re.MULTILINE), "must rotate daily"
        assert re.search(r"^\s*rotate\s+14\s*$", conf, re.MULTILINE), (
            "rotate 14 keeps the live file plus 14 rotated copies = 15 days"
        )
        assert re.search(r"^\s*compress\s*$", conf, re.MULTILINE)
        assert re.search(r"^\s*copytruncate\s*$", conf, re.MULTILINE), (
            "the exporter appends with >> so the file must be truncated, not moved"
        )
        assert re.search(r"^\s*maxsize\s+\S+\s*$", conf, re.MULTILINE), (
            "a maxsize guard caps runaway growth between daily runs"
        )
        assert "missingok" in conf and "notifempty" in conf

    def test_legacy_config_is_gone(self):
        """The old config had no rotation trigger and was never installed."""
        assert not os.path.exists(
            os.path.join(REPO_ROOT, "docker", "logrotate-journal")
        ), "logrotate-journal is superseded by docker/ops/logrotate-oikonomia"


# ── deploy.yml ─────────────────────────────────────────────────────


class TestDeployDiskPreflight:
    def test_fails_loudly_when_disk_is_almost_full(self):
        """A near-full disk must stop the deploy with an explicit error."""
        deploy = _read(DEPLOY_YML)
        assert "MIN_FREE_MB" in deploy, "deploy must declare a hard free-space floor"
        assert re.search(r"::error::", deploy), "a failing preflight must use ::error::"

    def test_runs_housekeeping_before_pulling_images(self):
        """Housekeeping must run before new images consume the disk."""
        deploy = _read(DEPLOY_YML)
        pull_at = deploy.find("pull-images:")
        assert pull_at != -1
        preflight_at = deploy.find("MIN_FREE_MB")
        assert preflight_at != -1
        assert preflight_at > pull_at, "the preflight must live inside the pull-images job"

    def test_cleanup_is_installed_with_sudo(self):
        """The old logrotate install used `cp ... || true` and silently never ran."""
        deploy = _read(DEPLOY_YML)
        assert re.search(r"sudo\s+cp\s+\S*logrotate\S*\s+/etc/logrotate\.d/", deploy), (
            "installing into /etc/logrotate.d requires sudo"
        )
        assert not re.search(
            r"cp\s+\S*logrotate\S*\s+/etc/logrotate\.d/\S*\s*2>/dev/null\s*\|\|\s*true",
            deploy,
        ), "the logrotate install must not swallow its errors"
