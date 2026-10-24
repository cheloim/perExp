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
import time

import pytest
import yaml

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
DEPLOY_YML = os.path.join(REPO_ROOT, ".github", "workflows", "deploy.yml")
LOGROTATE = os.path.join(REPO_ROOT, "docker", "ops", "logrotate-oikonomia")
HOUSEKEEPING = os.path.join(REPO_ROOT, "scripts", "housekeeping.sh")
NGINX_CONF = os.path.join(REPO_ROOT, "docker", "nginx", "nginx.conf")
LANDING_COMPOSE = os.path.join(REPO_ROOT, "docker", "docker-compose.web-landing.yml")
MONITORING_COMPOSE = os.path.join(REPO_ROOT, "docker", "docker-compose.monitoring.yml")


def _read(path: str) -> str:
    with open(path) as f:
        return f.read()


def _server_blocks(conf: str) -> list[str]:
    """Return every top-level `server { ... }` block of an nginx config."""
    blocks = []
    for match in re.finditer(r"\bserver\s*\{", conf):
        depth = 0
        for i in range(match.end() - 1, len(conf)):
            if conf[i] == "{":
                depth += 1
            elif conf[i] == "}":
                depth -= 1
                if depth == 0:
                    blocks.append(conf[match.start() : i + 1])
                    break
    return blocks


def _block_containing(conf: str, marker: str) -> str:
    for block in _server_blocks(conf):
        if marker in block:
            return block
    raise AssertionError(f"no server block contains {marker!r}")


# ── housekeeping.sh ────────────────────────────────────────────────


def _run_housekeeping(
    images: list[str],
    running: list[str],
    rollback: str,
    journal_size: int = 0,
    *extra: str,
    tsfile_dir: str | None = None,
    root: str | None = None,
):
    """Run housekeeping.sh --dry-run against a fake podman.

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


# ── nginx edge ─────────────────────────────────────────────────────


class TestNginxEdge:
    def test_apex_vhost_proxies_to_the_landing(self):
        """The apex must survive platform deploys, so it cannot use its container.

        During deploy-platform the platform-frontend container is stopped: if the
        apex points at it, oikonomia.ar falls over alongside the app.
        """
        conf = _read(NGINX_CONF)
        apex = _block_containing(conf, "listen 443 ssl default_server")
        assert "landing:80" in apex, "the apex must proxy to the landing service"
        assert "platform-frontend" not in apex, "the apex must not depend on the app"

    def test_apex_keeps_the_maintenance_fallback(self):
        """If the landing itself dies, the apex must degrade to the maintenance page."""
        apex = _block_containing(_read(NGINX_CONF), "listen 443 ssl default_server")
        assert "platform-maintenance.html" in apex
        assert "proxy_intercept_errors on" in apex

    def test_http_redirect_preserves_the_requested_host(self):
        """`http://grafana.<domain>/x` must not redirect to the apex domain."""
        conf = _read(NGINX_CONF)
        port80 = _block_containing(conf, "listen 80 default_server")
        assert "$host" in port80, "the redirect must keep the original Host"
        assert "https://${DOMAIN_NAME}$request_uri" not in port80

    def test_grafana_vhost_denies_public_metrics(self):
        """Grafana exposes /metrics by default; the vhost must not publish it."""
        grafana = _block_containing(_read(NGINX_CONF), "server_name grafana.")
        assert re.search(
            r"location\s*=\s*/metrics\s*\{[^}]*deny all", grafana
        ), "the Grafana vhost must deny /metrics"

    def test_grafana_live_gets_a_long_proxy_timeout(self):
        """Without it nginx closes the Live websocket every 60s and Grafana reconnects."""
        grafana = _block_containing(_read(NGINX_CONF), "server_name grafana.")
        live = re.search(r"location\s+/api/live/\s*\{([^}]*)\}", grafana)
        assert live, "the Grafana vhost must handle /api/live/ websockets"
        timeout = re.search(r"proxy_read_timeout\s+(\d+)", live.group(1))
        assert timeout, "the websocket location needs an explicit proxy_read_timeout"
        assert int(timeout.group(1)) >= 300

    def test_grafana_vhost_has_query_timeouts(self):
        """Long Loki queries must not 504 on nginx's 60s default."""
        grafana = _block_containing(_read(NGINX_CONF), "server_name grafana.")
        root = re.search(r"location\s+/\s*\{([^}]*)\}", grafana)
        assert root
        assert re.search(r"proxy_read_timeout\s+\d+", root.group(1))

    def test_platform_vhost_intercepts_oauth_errors_too(self):
        """An OAuth callback during maintenance must show the page, not a raw 502."""
        platform = _block_containing(_read(NGINX_CONF), "server_name ${PLATFORM_DOMAIN}")
        oauth = re.search(r"location\s+/oauth/\s*\{([^}]*)\}", platform)
        assert oauth
        assert "proxy_intercept_errors on" in oauth.group(1)

    def test_grafana_is_not_published_on_all_interfaces(self):
        """Port 3000 on 0.0.0.0 relies on firewalld to stay private."""
        compose = _read(MONITORING_COMPOSE)
        assert re.search(r'- "3000:3000"', compose) is None, (
            "Grafana must not be published on all interfaces"
        )
        assert "127.0.0.1:3000:3000" in compose or "3000" not in compose


class TestLandingIndependence:
    def test_landing_reuses_the_frontend_image(self):
        """No separate landing build: the SPA already renders the institutional site."""
        compose = _read(LANDING_COMPOSE)
        assert "FRONTEND_IMAGE" in compose, "the landing must run the frontend image"
        assert "LANDING_IMAGE" not in compose

    def test_landing_deploys_after_the_platform(self):
        """The landing must only move to a new bundle once the platform is healthy."""
        deploy = _read(DEPLOY_YML)
        job = deploy.split("deploy-landing:")[1]
        assert "deploy-platform" in job.split("steps:")[0], (
            "deploy-landing must depend on deploy-platform"
        )

    def test_landing_health_check_is_critical(self):
        """A dead landing is an outage, not a warning."""
        deploy = _read(DEPLOY_YML)
        landing = deploy.split("# Check landing site")[1].split("# Check platform")[0]
        assert "::error::" in landing, "an unreachable landing must fail the health check"
        assert "::warning::" not in landing

    def test_error_counter_is_initialized_before_use(self):
        """The legacy-container check incremented ERRORS before ERRORS=0 reset it."""
        deploy = _read(DEPLOY_YML)
        init_at = deploy.find("ERRORS=0")
        increment_at = deploy.find("ERRORS=$((ERRORS + 1))")
        assert init_at != -1 and increment_at != -1
        assert init_at < increment_at, "ERRORS must be initialized before it is used"

    def test_nginx_reloads_instead_of_recreating(self):
        """Recreating the container that owns :443 is a gap, not a rolling restart."""
        deploy = _read(DEPLOY_YML)
        job = deploy.split("deploy-nginx:")[1]
        assert "nginx -s reload" in job, "config changes must be applied with a hot reload"

        # Creating the container is only legitimate when there is nothing to
        # reload — i.e. inside the guarded first-deploy branch.
        guard = re.search(r'if \[ -z "\$NGINX_CONTAINER" \]; then(.*?)\n\s*else', job, re.DOTALL)
        assert guard, "creating the nginx container must be guarded by an existence check"
        assert "up -d" in guard.group(1), "the first deploy still needs to create the container"
        outside = job.replace(guard.group(1), "")
        assert "podman-compose -p oikonomia-nginx -f docker-compose.nginx.yml up -d" not in outside


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
        assert not os.path.exists(
            os.path.join(REPO_ROOT, "docker", "prometheus", "rules.yml")
        )
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


def _backup_job() -> str:
    return _read(DEPLOY_YML).split("backup-db:")[1].split("\n  deploy-infra:")[0]


class TestDatabaseBackups:
    def test_uses_custom_format_and_verifies_the_dump(self):
        """A plain SQL dump can be truncated and still look non-empty. The
        custom format is what lets the dump be *verified*."""
        job = _backup_job()
        assert "pg_dump" in job
        assert re.search(r"pg_dump[^\n]*-Fc", job), "must use pg_dump -Fc"
        assert "pg_restore" in job and "--list" in job, "the dump must be verified"

    def test_fails_loudly(self):
        """`pg_dump ... 2>/dev/null` hides the error and a truncated file still
        passes a non-empty check. The 2026-10-23 disk-full case produced
        exactly that."""
        job = _backup_job()
        assert not re.search(r"pg_dump[^\n]*2>/dev/null", job), (
            "the dump must not swallow stderr"
        )
        assert "pipefail" in job or re.search(r"if\s+\[\s+\$\?\s+-ne\s+0", job), (
            "a failed dump must fail the job"
        )
        assert "pg_restore --list" in job

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
        assert not re.search(r"mtime \+\d+", job), (
            "backup retention must not live in deploy.yml"
        )
        assert "HOUSEKEEPING_RETENTION_DAYS:-15" in _read(HOUSEKEEPING), (
            "housekeeping owns the retention window"
        )


# ── deploy job graph ───────────────────────────────────────────────


class TestDeployJobGraph:
    def test_platform_containers_are_only_killed_before_a_redeploy(self):
        """deploy-infra stops and removes the platform containers so
        deploy-platform can recreate them. If it runs without deploy-platform
        following — an infra-only or monitoring-only change — production stays
        down: nothing brings the app back.
        """
        deploy = _read(DEPLOY_YML)
        infra = deploy.split("deploy-infra:")[1].split("\n  deploy-platform:")[0]
        marker = infra.split("Cleaning up orphaned containers")[1]

        guard = re.search(
            r'if \[ "\$\{\{ needs\.detect-changes\.outputs\.platform \}\}" = "true" \]'
            r'[\s\S]*?; then([\s\S]*?)\n\s*fi',
            marker,
        )
        assert guard, (
            "killing the platform containers must be guarded so it only happens "
            "when a redeploy follows"
        )
        inside = guard.group(1)
        assert 'podman stop "oikonomia-platform_' in inside

        outside = marker.replace(inside, "")
        assert 'podman stop "oikonomia-platform_' not in outside, (
            "nothing outside the guard may stop the platform containers"
        )
