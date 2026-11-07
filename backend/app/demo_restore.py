"""Восстановить демо на сервере: `python -m app.demo_restore [--dry-run] [--json]`.

Работает с той же базой и под той же блокировкой изменяющих транзакций, что сервер (DomainStore).
Сервер данные в памяти не держит: следующий запрос видит восстановленное, а открытые вкладки
перечитают экраны после ближайшей фоновой проверки сервера (DOMAIN_TICK_SECONDS).
"""

import argparse
import logging
import sys

from sqlalchemy import create_engine

from app.core.config import Settings
from app.domain import clock, demo_restore, provider
from app.domain.store import DomainStore


def run(settings: Settings, *, dry_run: bool) -> demo_restore.RestoreReport:
    engine = create_engine(
        settings.sync_database_url,
        pool_size=1,
        connect_args={"connect_timeout": max(1, int(settings.database_connect_timeout))},
    )
    provider.configure_demo(
        reset_enabled=settings.demo_reset_enabled, backup_dir=settings.domain_backup_dir.strip()
    )
    if settings.domain_frozen_now:
        clock.set_frozen(clock.parse(settings.domain_frozen_now))
    domain_store = DomainStore(engine, strict=settings.domain_strict)
    try:
        with clock.zone(clock.DEFAULT_ZONE):
            return domain_store.write(lambda: demo_restore.restore_demo(dry_run=dry_run))
    finally:
        domain_store.dispose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.demo_restore",
        description="Вернуть демо-данные к сидам и убрать то, что посетители создали через демо-аккаунты. "
        "Записи зарегистрированных людей, импорт из сообществ и оплата остаются.",
    )
    parser.add_argument("--dry-run", action="store_true", help="только показать, что изменится")
    parser.add_argument("--json", action="store_true", help="сводка в JSON")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    try:
        report = run(Settings(), dry_run=args.dry_run)
    except RuntimeError as exc:
        sys.stderr.write(f"{exc}\n")
        return 1
    sys.stdout.write(
        (demo_restore.report_json(report) if args.json else demo_restore.format_report(report)) + "\n"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
