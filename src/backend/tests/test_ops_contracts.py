"""Behavioral tests for the production ops scripts.

They run `housekeeping.sh` and `backup-db.sh` against a fake `podman`/`stat` and
assert the outcome: which images are kept or removed, whether a dry run touches
anything, whether metrics and backups land where alerting expects.

They deliberately do not assert the text of `deploy.yml` or `nginx.conf`. Those
checks broke on every pipeline edit without proving the pipeline worked; the
workflow itself is the place to enforce its own structure.
"""

import os
import re
import stat
import subprocess
import textwrap
import time

import yaml

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
DEPLOY_YML = os.path.join(REPO_ROOT, ".github", "workflows", "deploy.yml")
LOGROTATE = os.path.join(REPO_ROOT, "docker", "ops", "logrotate-oikonomia")
HOUSEKEEPING = os.path.join(REPO_ROOT, "scripts", "housekeeping.sh")
MONITORING_COMPOSE = os.path.join(REPO_ROOT, "docker", "docker-compose.monitoring.yml")
PLATFORM_COMPOSE = os.path.join(REPO_ROOT, "docker", "docker-compose.platform.yml")
CELERY_SCHEDULE = os.path.join(REPO_ROOT, "src", "backend", "app", "celery_schedule.py")


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
    tsfile_dir: str | None = None,
    root: str | None = None,
    backup_script: str | None = None,
    dry_run: bool = True,
):
    """Run housekeeping.sh against a fake podman.

    Everything destructive goes through `podman`, which is faked here, and the
    root is a temp dir, so `dry_run=False` is still safe.

    Returns (returncode, stdout, stderr).
    """
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        bin_dir = os.path.join(tmp, "bin")
        os.makedirs(bin_dir)
        if root is None:
            root = os.path.join(tmp, "root")
            os.makedirs(root)
        os.makedirs(os.path.join(root, "logs"), exist_ok=True)
        os.makedirs(os.path.join(root, "backups"), exist_ok=True)

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
        env["HOUSEKEEPING_TSFILE_DIR"] = tsfile_dir or os.path.join(tmp, "no-textfile")
        if backup_script:
            env["HOUSEKEEPING_BACKUP_SCRIPT"] = backup_script

        cmd = ["bash", HOUSEKEEPING]
        if dry_run:
            cmd.append("--dry-run")
        cmd.extend(extra)

        proc = subprocess.run(cmd, capture_output=True, text=True, env=env)
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

    def test_publishes_the_staleness_metrics(self):
        """Alerting needs an observable signal for 'the cleanup stopped running'
        and 'the backups stopped happening'."""
        import tempfile

        with tempfile.TemporaryDirectory() as tsdir:
            code, out, err = _run_housekeeping([], [], "", 0, tsfile_dir=tsdir)
            assert code == 0, err

            with open(os.path.join(tsdir, "oikonomia_housekeeping.prom")) as f:
                metrics = f.read()

        assert "oikonomia_housekeeping_last_success_timestamp_seconds" in metrics
        assert "oikonomia_backup_newest_timestamp_seconds" in metrics

    def test_backup_timestamp_is_the_newest_backup(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            tsdir = os.path.join(tmp, "textfile")
            os.makedirs(tsdir)
            root = os.path.join(tmp, "root")
            backups = os.path.join(root, "backups")
            os.makedirs(backups)
            os.makedirs(os.path.join(root, "logs"))

            age_seconds = 5 * 3600
            backup = os.path.join(backups, "db_20261023_010000.sql.gz")
            with open(backup, "w") as f:
                f.write("x")
            stamp = time.time() - age_seconds
            os.utime(backup, (stamp, stamp))

            code, out, err = _run_housekeeping([], [], "", 0, tsfile_dir=tsdir, root=root)
            assert code == 0, err

            with open(os.path.join(tsdir, "oikonomia_housekeeping.prom")) as f:
                metrics = f.read()

        reported = re.search(r"oikonomia_backup_newest_timestamp_seconds (\d+)", metrics)
        assert reported, metrics
        assert abs(int(reported.group(1)) - stamp) < 60

    def test_backup_timestamp_is_zero_when_there_is_no_backup(self):
        """`time() - 0` is huge, so 'never backed up' alerts on its own."""
        import tempfile

        with tempfile.TemporaryDirectory() as tsdir:
            code, out, err = _run_housekeeping([], [], "", 0, tsfile_dir=tsdir)
            assert code == 0, err

            with open(os.path.join(tsdir, "oikonomia_housekeeping.prom")) as f:
                metrics = f.read()

        assert "oikonomia_backup_newest_timestamp_seconds 0" in metrics

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
        assert not os.path.exists(os.path.join(REPO_ROOT, "docker", "logrotate-journal")), (
            "logrotate-journal is superseded by docker/ops/logrotate-oikonomia"
        )


class TestGrafanaAccess:
    def test_google_identities_link_to_provisioned_users(self):
        """Grafana identifies OAuth users by (auth_module, auth_id), not by
        email. grafana_sync pre-provisions users by email (and the ones created
        under the old Generic OAuth provider keep that binding), so a Google
        login finds no identity to attach, signup is closed, and Grafana
        answers "Sign up is disabled" — even to a provisioned admin.

        Email lookup is what joins the pre-provisioned account to the Google
        identity on the first login. It is acceptable here because Google is
        the single IdP and verifies the email; signup stays closed so only
        provisioned users can match at all."""
        compose = _read(MONITORING_COMPOSE)
        assert 'GF_AUTH_GOOGLE_ALLOW_SIGN_UP: "false"' in compose, (
            "signup must stay closed: only provisioned admins may enter"
        )
        assert 'GF_USERS_ALLOW_SIGN_UP: "false"' in compose
        assert 'GF_AUTH_OAUTH_ALLOW_INSECURE_EMAIL_LOOKUP: "true"' in compose, (
            "without email lookup a provisioned user cannot link its Google identity"
        )

    def test_admin_reconciliation_keeps_reaching_grafana(self):
        """Access is materialized from `is_admin` and reconciled hourly; if the
        task is not scheduled or the worker cannot reach Grafana, provisioned
        admins silently never appear and nobody can sign in."""
        schedule = _read(CELERY_SCHEDULE)
        assert "app.tasks.grafana_reconcile.reconcile_grafana_admins" in schedule, (
            "the hourly reconcile must stay in the beat schedule"
        )
        platform = _read(PLATFORM_COMPOSE)
        assert "GRAFANA_INTERNAL_URL" in platform
        assert "GRAFANA_ADMIN_PASSWORD" in platform


# ── alerting ───────────────────────────────────────────────────────

ALERTING_DIR = os.path.join(REPO_ROOT, "docker", "grafana", "provisioning", "alerting")
ALERTING_RULES = os.path.join(ALERTING_DIR, "rules.yml")
CONTACT_POINTS = os.path.join(ALERTING_DIR, "contact-points.yml")
POLICIES = os.path.join(ALERTING_DIR, "policies.yml")
PROMETHEUS_CONF = os.path.join(REPO_ROOT, "docker", "prometheus", "prometheus.yml")

REQUIRED_ALERTS = {
    "oikonomia-disk-critical",
    "oikonomia-disk-warning",
    "oikonomia-disk-filling",
    "oikonomia-cert-expiring",
    "oikonomia-target-down",
    "oikonomia-housekeeping-stale",
    "oikonomia-backup-stale",
}


def _alert_uids() -> set[str]:
    rules = yaml.safe_load(_read(ALERTING_RULES))
    return {r["uid"] for g in rules["groups"] for r in g["rules"]}


def test_prometheus_scrapes_the_backend_by_service_name():
    """The monitoring container shares the platform network; host-published
    ports are not reachable in production, which left the backend target down."""
    config = yaml.safe_load(_read(PROMETHEUS_CONF))
    backend = next(job for job in config["scrape_configs"] if job["job_name"] == "oikonomia-backend")
    assert backend["static_configs"][0]["targets"] == ["backend:8000"]


class TestAlerting:
    def test_rules_cover_the_incident_modes(self):
        """These are the failures that were invisible during the incident."""
        uids = _alert_uids()
        missing = REQUIRED_ALERTS - uids
        assert not missing, f"alert rules missing: {sorted(missing)}"

    def test_llm_alerts_live_with_the_others(self):
        """They were in prometheus/rules.yml, which had no Alertmanager and no
        Grafana provisioning: evaluated, firing, and delivered nowhere."""
        uids = _alert_uids()
        llm = {u for u in uids if u.startswith("oikonomia-llm-")}
        assert len(llm) >= 4, f"expected the LLM alerts to be migrated, found {sorted(llm)}"

    def test_prometheus_rules_are_not_orphaned(self):
        """One source of truth: rules that cannot notify must not exist."""
        assert not os.path.exists(os.path.join(REPO_ROOT, "docker", "prometheus", "rules.yml"))
        assert re.search(r"^rule_files:", _read(PROMETHEUS_CONF), re.MULTILINE) is None

    def test_contact_point_is_telegram_with_placeholders(self):
        """The bot token must not be committed; deploy injects it from .env."""
        contact = yaml.safe_load(_read(CONTACT_POINTS))
        receivers = contact["contactPoints"][0]["receivers"]
        telegram = [r for r in receivers if r["type"] == "telegram"]
        assert telegram, "the contact point must be Telegram"
        assert telegram[0]["uid"] == "oikonomia-telegram-admin"
        # Grafana wants the bot token in `settings`: `secureSettings` makes the
        # whole alerting provisioning fail to load.
        settings = telegram[0]["settings"]
        assert settings.get("bottoken") == "__TELEGRAM_BOT_TOKEN__"
        assert settings.get("chatid") == "__TELEGRAM_ADMIN_CHAT_ID__"

    def test_no_secret_is_committed_in_the_alerting_provisioning(self):
        for name in ("contact-points.yml", "policies.yml", "rules.yml"):
            content = _read(os.path.join(ALERTING_DIR, name))
            assert not re.search(r"\b\d{8,}:[A-Za-z0-9_-]{20,}", content), (
                f"{name} looks like it contains a bot token"
            )

    def test_policies_route_to_the_contact_point(self):
        policies = yaml.safe_load(_read(POLICIES))
        root = policies["policies"][0]
        assert root["receiver"] == "oikonomia-telegram-admin"

    def test_deploy_injects_the_telegram_secret(self):
        deploy = _read(DEPLOY_YML)
        assert "__TELEGRAM_BOT_TOKEN__" in deploy, "deploy must fill the placeholders"
        assert "__TELEGRAM_ADMIN_CHAT_ID__" in deploy

    def test_node_exporter_collects_the_staleness_metrics(self):
        """Without the textfile collector housekeeping's metrics never reach
        Prometheus and the staleness alerts have nothing to read."""
        compose = _read(MONITORING_COMPOSE)
        assert "collector.textfile.directory" in compose
        assert "node_exporter/textfile" in compose


# ── database backups ───────────────────────────────────────────────

BACKUP_SCRIPT = os.path.join(REPO_ROOT, "scripts", "backup-db.sh")


def _backup_job() -> str:
    return _read(DEPLOY_YML).split("backup-db:")[1].split("\n  deploy-infra:")[0]


class TestDatabaseBackups:
    def test_uses_custom_format_and_verifies_the_dump(self):
        """A plain SQL dump can be truncated and still look non-empty. The
        custom format is what lets the dump be *verified*."""
        script = _read(BACKUP_SCRIPT)
        assert "pg_dump" in script
        assert re.search(r"pg_dump[^\n]*-Fc", script), "must use pg_dump -Fc"
        assert "pg_restore" in script and "--list" in script, "the dump must be verified"

    def test_fails_loudly(self):
        """`pg_dump ... 2>/dev/null` hides the error and a truncated file still
        passes a non-empty check. The 2026-10-23 disk-full case produced
        exactly that."""
        script = _read(BACKUP_SCRIPT)
        assert not re.search(r"pg_dump[^\n]*2>/dev/null", script), (
            "the dump must not swallow stderr"
        )
        assert re.search(r"if ! podman exec[^\n]*pg_dump", script), (
            "a failed dump must fail the job"
        )

    def test_deploy_uses_the_same_script_as_the_daily_backup(self):
        """One implementation, two callers: deploy and the daily timer."""
        job = _backup_job()
        assert "backup-db.sh" in job, "deploy must call scripts/backup-db.sh"

    def test_gated_on_db_affecting_changes(self):
        """A landing or nginx change cannot corrupt data: the checkpoint is for
        platform and infra changes."""
        job = _backup_job()
        head = job.split("steps:")[0]
        assert "needs.detect-changes.outputs.platform" in head
        assert "needs.detect-changes.outputs.infra" in head

    def test_retention_lives_in_one_place(self):
        """Two retention rules meant neither had to be right."""
        job = _backup_job()
        assert not re.search(r"mtime \+\d+", job), "backup retention must not live in deploy.yml"
        assert "HOUSEKEEPING_RETENTION_DAYS:-15" in _read(HOUSEKEEPING), (
            "housekeeping owns the retention window"
        )


class TestHousekeepingSafety2:
    def test_never_prunes_volumes(self):
        """`podman volume prune -f` deletes every volume no container is using.
        The postgres volume is 'unused' the moment the db container is
        force-recreated — or after a failed recreate, which is exactly when the
        cleanup runs. That is data loss while 'fixing' a full disk."""
        assert (
            re.search(r"^\s*(run\s+)?podman volume prune", _read(HOUSEKEEPING), re.MULTILINE)
            is None
        )

    def test_keeps_the_tag_from_env_too(self):
        """If the cleanup races a redeploy the running containers may already be
        gone; without IMAGE_TAG from .env the current release gets deleted."""
        assert re.search(r"grep\s+['\"]?\^IMAGE_TAG=", _read(HOUSEKEEPING)), (
            "housekeeping must also keep the release named in .env"
        )

    def test_takes_the_daily_backup_when_the_newest_is_stale(self):
        """Backups are gated to data-touching deploys, so without a daily dump a
        quiet week would raise the backup-stale alert — a false positive that
        teaches people to ignore alerts."""
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            marker = os.path.join(tmp, "backup-ran")
            fake = os.path.join(tmp, "backup-db.sh")
            with open(fake, "w") as f:
                f.write(f"#!/usr/bin/env bash\ntouch {marker}\n")
            os.chmod(fake, 0o755)

            code, out, err = _run_housekeeping(
                [],
                [],
                "",
                0,
                backup_script=fake,
                root=os.path.join(tmp, "root"),
                dry_run=False,
            )
            assert code == 0, err
            assert os.path.exists(marker), "no daily backup was taken"

    def test_skips_the_daily_backup_when_one_is_fresh(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            marker = os.path.join(tmp, "backup-ran")
            fake = os.path.join(tmp, "backup-db.sh")
            with open(fake, "w") as f:
                f.write(f"#!/usr/bin/env bash\ntouch {marker}\n")
            os.chmod(fake, 0o755)

            root = os.path.join(tmp, "root")
            backups = os.path.join(root, "backups")
            os.makedirs(backups)
            os.makedirs(os.path.join(root, "logs"))
            with open(os.path.join(backups, "db_20261024_040000.dump"), "w") as f:
                f.write("x")

            code, out, err = _run_housekeeping(
                [], [], "", 0, backup_script=fake, root=root, dry_run=False
            )
            assert code == 0, err
            assert not os.path.exists(marker), "a fresh backup must not be repeated"
            assert "Backup diario al día" in out

    def test_the_backup_metric_covers_the_custom_format(self):
        """`db_*.dump` is what backup-db.sh writes now; a find that only looks
        for the old `.sql.gz` would report 'never backed up' forever."""
        assert "db_*.dump" in _read(HOUSEKEEPING)
