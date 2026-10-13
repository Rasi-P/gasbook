import json
import sys

from django.core.management.base import BaseCommand, CommandError

from core.integrity import REPORT_FORMAT, ReadOnlyUnavailable, build_report, compare_fingerprints, run_read_only


class Command(BaseCommand):
    help = (
        "Report sales/payment/stock invariant violations and a data fingerprint. "
        "Runs inside a read-only PostgreSQL transaction and never writes."
    )

    def add_arguments(self, parser):
        parser.add_argument("--json", action="store_true", help="Print the full report as JSON.")
        parser.add_argument(
            "--compare", metavar="FILE",
            help="A previous --json report; fail if the fingerprint differs ('-' reads it from stdin).",
        )
        parser.add_argument(
            "--fail-on-violations", action="store_true", help="Exit with an error if any invariant is violated.",
        )

    def handle(self, *args, **options):
        baseline = self.load_baseline(options["compare"]) if options["compare"] else None
        try:
            report = run_read_only(build_report)
        except ReadOnlyUnavailable as exc:
            raise CommandError(f"Refusing to report: {exc}") from exc
        report["read_only_transaction"] = True

        changes = None
        if baseline is not None:
            changes = compare_fingerprints(baseline["fingerprint"], report["fingerprint"])
            report["comparison"] = {"baseline_sha256": baseline.get("fingerprint_sha256"), "changes": changes}

        if options["json"]:
            self.stdout.write(json.dumps(report, indent=2, sort_keys=True, default=str))
        else:
            self.print_summary(report)

        failures = []
        if changes:
            failures.append(f"fingerprint differs from baseline in: {', '.join(c['table'] for c in changes)}")
        if options["fail_on_violations"] and report["violations"]:
            failures.append(f"{len(report['violations'])} invariant violation(s)")
        if failures:
            raise CommandError("; ".join(failures))

    def load_baseline(self, path):
        try:
            if path == "-":
                baseline = json.load(sys.stdin)
            else:
                with open(path, encoding="utf-8") as handle:
                    baseline = json.load(handle)
        except (OSError, ValueError) as exc:
            raise CommandError(f"Could not read baseline report: {exc}") from exc
        if not isinstance(baseline, dict) or not isinstance(baseline.get("fingerprint"), dict):
            raise CommandError("Baseline is not a check_sales_integrity --json report (no fingerprint).")
        if baseline.get("format") != REPORT_FORMAT:
            raise CommandError(
                f"Baseline report format {baseline.get('format')!r} differs from this checker's format "
                f"{REPORT_FORMAT}; take a new baseline with this version."
            )
        fingerprint = baseline["fingerprint"]
        if not isinstance(fingerprint.get("tables"), dict) or not isinstance(fingerprint.get("database"), dict):
            raise CommandError("Baseline fingerprint is incomplete (missing tables or database section).")
        return baseline

    def print_summary(self, report):
        fingerprint = report["fingerprint"]
        self.stdout.write(
            f"Database: {report['database']} ({report['vendor']}), "
            f"read-only transaction: {report['read_only_transaction']}"
        )
        self.stdout.write(f"Violations: {len(report['violations'])}")
        for problem in report["violations"]:
            ids = ", ".join(f"{key}={value}" for key, value in problem.items() if key not in ("check", "detail"))
            self.stdout.write(f"  - {problem['check']} ({ids}): {problem['detail']}")
        self.stdout.write("Notices: " + json.dumps(report["notices"], sort_keys=True))
        self.stdout.write("Rows: " + ", ".join(f"{name}={data['rows']}" for name, data in fingerprint["tables"].items()))
        self.stdout.write(f"Whole-database coverage: {len(fingerprint['database'])} tables, every column")
        self.stdout.write("Stock totals: " + json.dumps(fingerprint["stock_totals"], sort_keys=True))
        self.stdout.write(f"Fingerprint: {report['fingerprint_sha256']}")
        comparison = report.get("comparison")
        if comparison is not None:
            if comparison["changes"]:
                for change in comparison["changes"]:
                    self.stdout.write(f"  changed: {change['table']}{self.row_change(change)}")
            else:
                self.stdout.write(f"Matches baseline {comparison['baseline_sha256']}")

    @staticmethod
    def row_change(change):
        before, after = change["before"], change["after"]
        if isinstance(before, dict) and isinstance(after, dict) and "rows" in before and "rows" in after:
            return f" (rows {before['rows']} -> {after['rows']})"
        return ""
