"""Ресурсы и действия В6, В8, С16, С17: импорт из сообществ, жалобы, приостановка допуска, спрос.

Контракт описан в docs/architecture/api.md, раздел «Сообщества, аналитика, жалобы».
"""

import contextlib
from collections.abc import Callable
from typing import Any

from app.domain import core
from app.domain.features import analytics, imports, org_suspend, reports
from app.domain.features.participation_host import input_text
from app.domain.routing import Handle, Listed, Lister, Params, Resources, Route, route
from app.domain.types import Actor


def community_resources(actor: Callable[[], Actor]) -> Resources:
    listers: dict[str, Lister] = {
        "community-imports": lambda p: Listed(
            imports.list_imports(core.domain, actor(), p), ["status", "sourceId", "meeting"]
        ),
        "community-sources": lambda _p: Listed(imports.list_sources(actor()), []),
        "reports": lambda p: Listed(
            reports.list_report_groups(core.domain, actor(), p), ["status", "targetType", "eventId"]
        ),
    }
    getters = {
        "community-imports": lambda id_, _meta=None: imports.import_details(core.domain, actor(), id_),
    }
    return Resources(listers=listers, getters=getters)


def community_routes(actor: Callable[[], Actor]) -> list[Route]:
    return [
        # ---------- В8: импорт из сообществ ----------
        route("post", r"^/imports/upload$", lambda _p, b, _q: imports.upload_import(core.domain, actor(), b)),
        route(
            "put", r"^/imports/([^/]+)$", lambda p, b, _q: imports.save_import(core.domain, actor(), p[0], b)
        ),
        route(
            "post",
            r"^/imports/([^/]+)/publish$",
            lambda p, b, _q: imports.publish_import(core.domain, actor(), p[0], b),
        ),
        route(
            "post",
            r"^/imports/([^/]+)/reject$",
            lambda p, b, _q: imports.reject_import(core.domain, actor(), p[0], b),
        ),
        route(
            "post",
            r"^/imports/([^/]+)/restore$",
            lambda p, _b, _q: imports.restore_import(core.domain, actor(), p[0]),
        ),
        route(
            "put",
            r"^/community-sources/([^/]+)$",
            lambda p, b, _q: imports.update_source(core.domain, actor(), p[0], b),
        ),
        route(
            "post",
            r"^/community-sources/([^/]+)/transfer$",
            lambda p, b, _q: imports.transfer_source(core.domain, actor(), p[0], b),
        ),
        route("get", r"^/events/([^/]+)/source$", lambda p, _b, _q: {"source": imports.event_source(p[0])}),
        # ---------- С16: жалобы ----------
        route("post", r"^/reports$", lambda _p, b, _q: reports.create_report(core.domain, actor(), b)),
        route(
            "get", r"^/events/([^/]+)/my-report$", lambda p, _b, _q: reports.my_report(actor(), "event", p[0])
        ),
        route(
            "get",
            r"^/events/([^/]+)/my-message-reports$",
            lambda p, _b, _q: {"ids": reports.my_message_reports(actor(), p[0])},
        ),
        route(
            "post", r"^/reports/decide$", lambda _p, b, _q: reports.decide_reports(core.domain, actor(), b)
        ),
        route("get", r"^/admin/community-stats$", lambda _p, _b, _q: reports.community_stats(actor())),
        # ---------- С17: приостановка допуска ----------
        route(
            "post",
            r"^/organizations/([^/]+)/suspend$",
            lambda p, b, _q: org_suspend.suspend_organization(core.domain, actor(), p[0], b),
        ),
        route(
            "post",
            r"^/organizations/([^/]+)/resume$",
            lambda p, b, _q: org_suspend.resume_organization(core.domain, actor(), p[0], b),
        ),
        # ---------- В6: спрос и инфраструктура ----------
        route(
            "get", r"^/admin/analytics$", lambda _p, _b, _q: analytics.analytics_view(core.domain, actor())
        ),
    ]


def _track_feed(list_events: Lister, actor: Callable[[], Actor]) -> Lister:
    def lister(p: Params) -> Listed:
        res = list_events(p)
        # журнал спроса не должен мешать поиску
        with contextlib.suppress(Exception):
            analytics.record_feed_search(core.domain, actor(), p, len(res.rows))
        return res

    return lister


def _track_phrase(handle: Handle, actor: Callable[[], Actor]) -> Handle:
    def wrapped(params: list[str], payload: Params, query: Params) -> Any:
        res = handle(params, payload, query)
        # журнал спроса не должен мешать помощнику
        with contextlib.suppress(Exception):
            filters = res.get("filters") if isinstance(res, dict) else None
            analytics.record_phrase(
                core.domain, actor(), input_text(payload.get("text")), filters if filters is not None else {}
            )
        return res

    return wrapped


def track_demand(listers: dict[str, Lister], routes: list[Route], actor: Callable[[], Actor]) -> None:
    """В6: поиски в ленте и фразы помощнику попадают в журнал спроса.

    Обёртка над уже существующими обработчиками: сами поиск и разбор фразы не меняются,
    сбой журнала их не ломает. Словарь листеров и маршруты меняются на месте.
    """
    list_events = listers.get("events")
    if list_events is not None:
        listers["events"] = _track_feed(list_events, actor)
    for r in routes:
        if r.assistant != "search" and not r.pattern.search("/assistant/match"):
            continue
        r.handle = _track_phrase(r.handle, actor)
