"""Карточки массовой ленты сохраняют факты и не перечитывают всю историю для каждой встречи."""

import copy
from collections import Counter
from types import SimpleNamespace

import pytest

from app.core.errors import AppError
from app.domain import clock, core, provider, seed, store
from app.domain.core import Domain
from app.domain.features import calendar, inventory, payments, reliability, match as matching
from app.domain.lib.cities import city_by_id, point_in_city
from app.domain.schema import COLLECTIONS


class CountingEvents(list):
    def __init__(self, rows):
        super().__init__(rows)
        self.iterations = 0
        self.visited = 0

    def __iter__(self):
        self.iterations += 1
        for row in super().__iter__():
            self.visited += 1
            yield row


@pytest.fixture
def calendar_domain(monkeypatch):
    now = clock.parse("2026-10-19T03:00:00.000Z")
    monkeypatch.setattr(clock, "_frozen", now)
    source = seed.build_seed(now)
    # Настоящие правила карточек, включая модули, работают на тех же коллекциях,
    # что и DomainStore, но тесту не нужна отдельная база PostgreSQL.
    database = store.Database(None, strict=True)
    for path in COLLECTIONS:
        rows = source
        for part in path.split("."):
            rows = rows.get(part, []) if isinstance(rows, dict) else []
        database._data[path] = rows
    database._state = {"settings": source["settings"]}
    monkeypatch.setattr(store, "data", lambda: database)
    domain = Domain()
    monkeypatch.setattr(core, "domain", domain)
    monkeypatch.setattr(provider, "registry", provider._core_resources)
    return domain, database


@pytest.mark.parametrize(
    "query",
    [{}, {"q": "Ладья"}, {"sportId": "s-running"}, {"scope": "org", "orgId": "o-ladya"}],
)
def test_feed_cards_equal_individually_loaded_cards(calendar_domain, query):
    domain, database = calendar_domain
    rows = domain.list_events(None, query)
    assert rows
    by_id = {event["id"]: event for event in database.events}
    assert rows == sorted(
        (domain.event_view(None, by_id[row["id"]]) for row in rows),
        key=lambda view: view["startsAt"],
    )
    # Изменение ответа одной карточки не портит другую карточку того же организатора.
    siblings = [row for row in rows if row["organizer"] == rows[0]["organizer"]]
    if len(siblings) > 1:
        original = siblings[1]["organizerView"]["facts"]["held"]
        siblings[0]["organizerView"]["facts"]["held"] = -1
        assert siblings[1]["organizerView"]["facts"]["held"] == original


def test_large_feed_scans_history_twice_not_once_per_card(calendar_domain, monkeypatch):
    domain, database = calendar_domain
    original = next(e for e in database.events if e["id"] == "e-run-tatyshev")
    rows = []
    for index in range(2048):
        event = copy.deepcopy(original)
        event.update(
            id=f"e-calendar-scaling-{index}",
            startsAt="2040-01-01T12:00:00.000Z",
            organizer=(
                {"kind": "user", "id": "u-dmitry"}
                if index % 2
                else {"kind": "org", "id": "o-ladya"}
            ),
            venueId=None,
            visibility="public",
        )
        rows.append(event)
    # История и отзывы организаторов остаются: факты нельзя считать только по видимой выборке.
    events = CountingEvents([*database.events, *rows])
    database.events = events
    calls = Counter()
    actual_facts = domain._organizer_facts

    def counted(ref, own=None):
        calls[(ref["kind"], ref["id"])] += 1
        return actual_facts(ref, own)

    monkeypatch.setattr(domain, "_organizer_facts", counted)
    views = domain.list_events(None, {"ids": [e["id"] for e in rows]})
    assert len(views) == 2048
    assert calls == {("user", "u-dmitry"): 1, ("org", "o-ladya"): 1}
    assert events.iterations == 2
    assert events.visited == 2 * len(events)
    for ref in ({"kind": "user", "id": "u-dmitry"}, {"kind": "org", "id": "o-ladya"}):
        view = next(row for row in views if row["organizer"] == ref)
        assert view["organizerView"]["facts"] == actual_facts(ref)


def test_search_without_matches_does_not_compute_organizer_facts(calendar_domain, monkeypatch):
    domain, _database = calendar_domain

    def unexpected(*_args):
        pytest.fail("Поиск имени не должен рассчитывать историю организатора")

    monkeypatch.setattr(domain, "_organizer_facts", unexpected)
    assert domain.list_events(None, {"q": "несуществующийклубqwertyx"}) == []


def test_next_list_call_recalculates_organizer_facts(calendar_domain):
    domain, database = calendar_domain
    query = {"ids": ["e-run-tatyshev"]}
    first = domain.list_events(None, query)[0]["organizerView"]["facts"]
    past = copy.deepcopy(next(e for e in database.events if e["id"] == "e-run-tatyshev"))
    past.update(id="e-newly-finished", startsAt="2020-01-01T12:00:00.000Z")
    database.events.append(past)
    second = domain.list_events(None, query)[0]["organizerView"]["facts"]
    assert second["held"] == first["held"] + 1
    assert second["upcoming"] == first["upcoming"]
    assert domain.event_view(None, past)["organizerView"]["facts"] == second


def legacy_page(domain, filters, sorters, pagination):
    views = domain.list_events(provider.actor(), provider.filters_to_params(filters))
    filtered = provider.sort_rows(provider.apply_rest(views, filters, provider.EVENT_FILTER_KEYS), sorters)
    return {"data": provider.paginate(filtered, pagination), "total": len(filtered)}


@pytest.mark.parametrize("user_id", [None, "u-anna", "u-maria"])
def test_server_page_matches_full_feed_for_city_date_and_sorting(calendar_domain, monkeypatch, user_id):
    domain, _database = calendar_domain
    filters = [
        {"field": "place@city", "operator": "eq", "value": "moscow"},
        {"field": "startsAt", "operator": "gte", "value": "2026-10-19"},
        {"field": "startsAt", "operator": "lte", "value": "2026-12-31"},
        {"field": "point", "operator": "eq", "value": {"lat": 55.75, "lng": 37.61}},
    ]
    sorters = [{"field": "startsAt", "order": "desc"}, {"field": "title", "order": "asc"}]
    pagination = {"currentPage": 2, "pageSize": 3}
    with provider.acting_as(user_id):
        expected = legacy_page(domain, filters, sorters, pagination)
        calls = []
        event_view = domain.event_view

        def counted(actor, event, opts=None):
            calls.append(event["id"])
            return event_view(actor, event, opts)

        monkeypatch.setattr(domain, "event_view", counted)
        actual = provider.get_list("events", filters, sorters, pagination)
    assert actual == expected
    assert expected["total"] > 6
    assert len(calls) == 3
    assert calls == [event["id"] for event in actual["data"]]


def test_large_server_page_only_builds_requested_cards(calendar_domain, monkeypatch):
    domain, database = calendar_domain
    template = next(e for e in database.events if e["id"] == "e-run-tatyshev")
    for index in range(2048):
        event = copy.deepcopy(template)
        event.update(id=f"e-page-{index}", startsAt="2040-01-01T12:00:00.000Z", visibility="public")
        database.events.append(event)
    calls = []
    event_view = domain.event_view

    def counted(actor, event, opts=None):
        calls.append(event["id"])
        return event_view(actor, event, opts)

    monkeypatch.setattr(domain, "event_view", counted)
    filters = [{"field": "startsAt", "operator": "gte", "value": "2040-01-01"}]
    actual = provider.get_list("events", filters, pagination={"currentPage": 10, "pageSize": 11})
    assert actual["total"] == 2048
    assert len(calls) == len(actual["data"]) == 11
    assert calls == [f"e-page-{index}" for index in range(99, 110)]


@pytest.mark.parametrize(
    ("filters", "sorters", "pagination"),
    [
        ([{"field": "counts.spotsLeft", "operator": "gte", "value": 1}], [], {"pageSize": 2}),
        ([], [{"field": "organizerView.facts.upcoming", "order": "desc"}], {"pageSize": 2}),
        ([{"field": "forYou", "operator": "eq", "value": True}], [], {"pageSize": 2}),
        ([], [], {"mode": "off", "pageSize": 2}),
        ([], [], {"mode": "client", "pageSize": 2}),
        ([{"field": "unknownField", "operator": "null"}], [], {"pageSize": 2}),
    ],
)
def test_computed_filters_and_client_pages_keep_legacy_path(
    calendar_domain, monkeypatch, filters, sorters, pagination
):
    domain, _database = calendar_domain
    expected = legacy_page(domain, filters, sorters, pagination)
    flags = []
    list_events = domain.list_events

    def counted(actor, query=None, *, raw=False):
        flags.append(raw)
        return list_events(actor, query, raw=raw)

    monkeypatch.setattr(domain, "list_events", counted)
    assert provider.get_list("events", filters, sorters, pagination) == expected
    assert flags == ([True] if any(f.get("field") == "forYou" for f in filters) else [False])


def test_raw_paging_does_not_filter_on_hidden_author(calendar_domain, monkeypatch):
    domain, _database = calendar_domain
    filters = [{"field": "createdBy", "operator": "eq", "value": "u-dmitry"}]
    flags = []
    list_events = domain.list_events

    def counted(actor, query=None, *, raw=False):
        flags.append(raw)
        return list_events(actor, query, raw=raw)

    monkeypatch.setattr(domain, "list_events", counted)
    assert provider.get_list("events", filters, pagination={"pageSize": 5}) == {"data": [], "total": 0}
    assert flags == [False]


def test_raw_paging_preserves_admin_scope_permissions(calendar_domain):
    with pytest.raises(AppError) as error:
        provider.get_list(
            "events", [{"field": "scope", "operator": "eq", "value": "admin"}], pagination={"pageSize": 5}
        )
    assert error.value.status == 401


def use_scoped_event_sql(database):
    """Real row encoding/decoding, but reject any unbounded calendar SELECT."""
    events = database._data.pop("events")
    orders = {event["id"]: index * 1024 for index, event in enumerate(events)}
    collection = COLLECTIONS["events"]
    calls = []

    class Result(list):
        def first(self):
            return self[0] if self else None

    class Connection:
        def execute(self, query):
            params = query.compile().params
            calls.append(params)
            if "organizer_kind_2" in params and "id_1" in params:
                rows = [event for event in events if
                        event["id"] in params["id_1"] or
                        event["organizer"] == {"kind": params["organizer_kind_1"], "id": params["organizer_id_1"]} or
                        (event["organizer"]["kind"] == params["organizer_kind_2"] and event["organizer"]["id"] in params["organizer_id_2"])]
            elif "id_1" in params:
                ids = params["id_1"]
                ids = set(ids) if isinstance(ids, (list, set, tuple)) else {ids}
                rows = [event for event in events if event["id"] in ids]
            elif "payment_mode_1" in params:
                rows = [event for event in events if event.get("paymentMode") == params["payment_mode_1"]]
            elif {"organizer_kind_1", "organizer_id_1"} <= params.keys():
                rows = [
                    event for event in events
                    if event["organizer"] == {
                        "kind": params["organizer_kind_1"], "id": params["organizer_id_1"]
                    }
                ]
            else:
                pytest.fail("A detail request must not load the entire calendar")
            return Result(
                SimpleNamespace(_mapping={
                    **database._values(collection, copy.deepcopy(event)), "ord": orders[event["id"]]
                })
                for event in rows
            )

    database._conn = Connection()
    return events, calls


@pytest.mark.parametrize("user_id", [None, "u-anna", "u-maria"])
def test_event_details_sql_reads_equal_tracked_cards_without_full_calendar(calendar_domain, user_id):
    domain, database = calendar_domain
    collection = COLLECTIONS["events"]
    # Include SQL NULL columns too, exactly as a real tracked load would.
    database.events = [
        database._row(collection, database._values(collection, event)) for event in database.events
    ]
    actor = domain.user(user_id) if user_id else None
    expected = domain.event_details(actor, "e-run-tatyshev")
    _events, calls = use_scoped_event_sql(database)
    assert domain.event_details(actor, "e-run-tatyshev") == expected
    assert "events" not in database._data
    assert calls[0] == {"id_1": "e-run-tatyshev"}
    assert any("organizer_kind_1" in call for call in calls)


def test_detached_detail_keeps_invite_permissions_and_hidden_fields(calendar_domain):
    domain, database = calendar_domain
    event = next(e for e in database.events if e["id"] == "e-run-tatyshev")
    event.update(visibility="invite", inviteCode="test-invite", privateInfo="private address")
    use_scoped_event_sql(database)
    with pytest.raises(AppError) as error:
        domain.event_details(None, event["id"])
    assert error.value.code == "invite_required"
    view = domain.event_details(None, event["id"], {"invite": "test-invite"})
    assert view["inviteCode"] == view["privateInfo"] == view["createdBy"] == ""
    assert "events" not in database._data


def test_invite_redemption_does_not_load_calendar(calendar_domain):
    domain, database = calendar_domain
    event = next(e for e in database.events if e["id"] == "e-run-tatyshev")
    event.update(visibility="invite", inviteCode="test-invite")
    use_scoped_event_sql(database)
    with provider.acting_as("u-anna"):
        view = provider.get_one("events", event["id"], {"invite": "test-invite"})
    assert view["id"] == event["id"]
    assert any(
        row["eventId"] == event["id"] and row["userId"] == "u-anna"
        for row in database.invite_grants
    )
    assert "events" not in database._data


def test_month_filter_uses_city_timezone_before_hydration(calendar_domain, monkeypatch):
    domain, database = calendar_domain
    template = next(e for e in database.events if e["id"] == "e-run-tatyshev")
    rows = []
    for id_, starts in [
        ("before-month", "2027-01-31T20:59:59.000Z"),
        ("in-month", "2027-01-31T21:00:00.000Z"),
        ("after-month", "2027-02-28T21:00:00.000Z"),
    ]:
        event = copy.deepcopy(template)
        event.update(id=id_, startsAt=starts, visibility="public")
        rows.append(event)
    database.events = rows
    calls = []
    event_view = domain.event_view

    def counted(actor, event, opts=None):
        calls.append(event["id"])
        return event_view(actor, event, opts)

    monkeypatch.setattr(domain, "event_view", counted)
    with clock.zone("Europe/Moscow"):
        page = provider.get_list(
            "events", [{"field": "month", "operator": "eq", "value": "2027-02"}],
            pagination={"pageSize": 20},
        )
    assert page["total"] == 1
    assert calls == ["in-month"]


def test_reliability_tick_reads_confirmed_events_and_sends_once(calendar_domain, monkeypatch):
    domain, database = calendar_domain
    event = next(e for e in database.events if e["id"] == "e-run-tatyshev")
    event.update(startsAt="2026-10-19T01:00:00.000Z", durationMin=30)
    participant = copy.deepcopy(database.participations[0])
    participant.update(eventId=event["id"], userId="u-anna", status="confirmed")
    database.participations = [participant]
    database.engagement.held_asked = []
    database.engagement.held_votes = []
    database.notifications = []
    monkeypatch.setattr(store, "next_id", lambda prefix: f"{prefix}-tick-test")
    _events, calls = use_scoped_event_sql(database)
    reliability.reliability_tick(domain)
    reliability.reliability_tick(domain)
    assert len(database.notifications) == 1
    assert database.notifications[0]["type"] == "held_question"
    assert database.engagement.held_asked == [f"u-anna|{event['id']}"]
    assert all(set(call["id_1"]) == {event["id"]} for call in calls)
    assert "events" not in database._data


def test_payment_tick_expires_pending_payment_without_loading_offline_calendar(calendar_domain):
    domain, database = calendar_domain
    for event in database.events:
        event["paymentMode"] = "offline"
    payment = {
        "id": "pending-tick-test", "status": "pending",
        "createdAt": "2020-01-01T00:00:00.000Z", "reason": "", "updatedAt": "",
    }
    database.payments = [payment]
    database.payment_dues = []
    database.orders = []
    _events, calls = use_scoped_event_sql(database)
    assert payments.payments_tick(domain)
    assert payment["status"] == "expired"
    assert payment["reason"] == "Оплату не завершили"
    assert calls == [{"payment_mode_1": "online"}]
    assert "events" not in database._data


def test_reminders_use_bounded_host_lookup(calendar_domain, monkeypatch):
    domain, database = calendar_domain
    event = next(e for e in database.events if e["id"] == "e-run-tatyshev")
    event.update(startsAt="2026-10-19T04:00:00.000Z")
    participant = copy.deepcopy(database.participations[0])
    participant.update(
        eventId=event["id"], userId="u-anna", status="confirmed",
        createdAt="2020-01-01T00:00:00.000Z", decidedAt="2020-01-01T00:00:00.000Z",
    )
    database.participations = [participant]
    database.reminders = []
    database.notifications = []
    monkeypatch.setattr(store, "next_id", lambda prefix: f"{prefix}-reminder-test")
    _events, calls = use_scoped_event_sql(database)
    assert calendar.generate_reminders(domain.participation_host) == ["u-anna"]
    assert calendar.generate_reminders(domain.participation_host) == []
    assert database.notifications[0]["type"] == "reminder"
    assert calls == [{"id_1": event["id"]}]
    assert "events" not in database._data


def test_landing_organizations_read_only_their_own_events(calendar_domain):
    domain, database = calendar_domain
    expected = domain.list_organizations(None)
    assert expected
    _events, calls = use_scoped_event_sql(database)
    assert domain.list_organizations(None) == expected
    assert calls
    assert all("organizer_id_1" in call for call in calls)
    assert "events" not in database._data


@pytest.mark.parametrize("user_id", ["u-anna", "u-dmitry", "u-petr"])
def test_public_profile_preserves_facts_without_reading_full_calendar(calendar_domain, user_id):
    domain, database = calendar_domain
    expected = domain.user_profile(user_id)
    _events, calls = use_scoped_event_sql(database)
    assert domain.user_profile(user_id) == expected
    assert "events" not in database._data
    assert calls


def test_companion_city_filter_runs_before_card_hydration(calendar_domain, monkeypatch):
    domain, database = calendar_domain
    expected = [c for c in domain.list_companions(None) if domain.user(c["authorId"])["city"] == "Москва"]
    calls = []
    original = domain.companion_view
    def counted(actor, companion, match=None):
        calls.append(companion["id"])
        return original(actor, companion, match)
    monkeypatch.setattr(domain, "companion_view", counted)
    assert domain.list_companions(None, {"city": "Москва"}) == expected
    assert set(calls) == {c["id"] for c in expected}


@pytest.mark.parametrize("query", [{"scope": "user", "organizerUserId": "u-anna"},
                                   {"scope": "user", "organizerUserId": "u-compdemo-0001"},
                                   {"scope": "org", "orgId": "o-ladya"}])
def test_public_profile_event_list_never_loads_unrelated_calendar(calendar_domain, query):
    domain, database = calendar_domain
    collection = COLLECTIONS["events"]
    database.events = [database._row(collection, database._values(collection, event)) for event in database.events]
    expected = domain.list_events(None, query)
    use_scoped_event_sql(database)
    assert domain.list_events(None, query) == expected
    assert "events" not in database._data


@pytest.mark.parametrize("user_id", [None, "u-anna", "u-maria"])
@pytest.mark.parametrize("text", ["Хочу заниматься спортом", "Бег для новичков", "Волейбол вечером"])
def test_assistant_match_preserves_ranking_counts_and_questions(calendar_domain, monkeypatch, user_id, text):
    domain, database = calendar_domain
    actor = domain.user(user_id)
    request = {"text": text, "cityId": "krasnoyarsk"}
    actual = matching.match_events(domain, actor, request)

    def legacy(ctx, filters):
        city = city_by_id(ctx.city_id)
        rows = domain.list_events(ctx.actor, matching._to_query(filters))
        if filters.get("aroundDistrictId"):
            rest = {k: v for k, v in filters.items() if k not in {"aroundDistrictId", "near", "radiusKm"}}
            inside = domain.list_events(ctx.actor, {**rest, "scope": "feed", "districtId": filters["aroundDistrictId"]})
            ids = {r["id"] for r in rows}
            rows = sorted([*rows, *(e for e in inside if e["id"] not in ids)], key=matching._starts)
        return [e for e in rows if not city or point_in_city(e["place"], city)]

    hydrate = domain.event_views
    monkeypatch.setattr(matching, "_in_city", legacy)
    monkeypatch.setattr(domain, "event_views", lambda actor, rows, opts=None: rows if rows and "organizerView" in rows[0] else hydrate(actor, rows, opts))
    assert matching.match_events(domain, actor, request) == actual


def test_assistant_only_hydrates_three_cards_for_large_catalogue(calendar_domain, monkeypatch):
    domain, database = calendar_domain
    template = next(e for e in database.events if e["id"] == "e-run-tatyshev")
    for i in range(2048):
        row = copy.deepcopy(template)
        row.update(id=f"match-large-{i}", startsAt="2040-01-01T10:00:00.000Z", status="published", visibility="public", series=None)
        database.events.append(row)
    calls=[]
    view=domain.event_view
    def counted(actor, event, opts=None):
        calls.append(event["id"])
        return view(actor, event, opts)
    monkeypatch.setattr(domain,"event_view",counted)
    result=matching.match_events(domain,None,{"text":"Хочу заниматься спортом","cityId":"krasnoyarsk", "steps":[{"id":"test:all", "patch":{"drop":list(matching.FILTER_TYPES)}}]})
    assert result["total"] >= 2048
    assert len(result["items"]) == len(calls) == 3


def test_assistant_sql_candidates_are_untracked_and_reused(calendar_domain):
    domain, database = calendar_domain
    collection = COLLECTIONS["events"]
    events = database._data.pop("events")
    selected = [e for e in events if e["status"] == "published" and e.get("visibility") != "invite"
                and domain.event_state(e) == "upcoming" and point_in_city(e["place"], city_by_id("krasnoyarsk"))]
    calls = []
    class Connection:
        def execute(self, query):
            calls.append(query)
            return [SimpleNamespace(_mapping=database._values(collection, event)) for event in selected]
    database._conn = Connection()
    context = matching._Ctx(domain, None, "krasnoyarsk")
    pool = matching._candidates(context, {})
    assert pool and len(pool) == len(selected)
    narrowed = matching._candidates(context, {"sportIds": [pool[0]["sportId"]], "when": "weekend"})
    when = core._when_range("weekend", None)
    assert narrowed == [e for e in pool if e["sportId"] == pool[0]["sportId"] and when[0] <= clock.parse(e["startsAt"]) <= when[1]]
    assert len(calls) == 1
    sql = str(calls[0])
    assert "status" in sql and "visibility" in sql and "starts_at >" in sql and "asin" in sql
    assert "events" not in database._data and not database._partial.get("events")


@pytest.mark.parametrize("phrase", ["Подберите мне встречу", "Подберите спортивную встречу", "Хочу заниматься спортом"])
def test_assistant_generic_request_is_not_a_required_event_title(calendar_domain, phrase):
    domain, _database = calendar_domain
    assert not matching.filters_from_text(domain, None, phrase)["filters"].get("q")


def test_assistant_keeps_meaningful_place_words(calendar_domain):
    domain, _database = calendar_domain
    assert matching.filters_from_text(domain, None, "Подберите встречу на набережной")["filters"]["q"] == "набережной"


def test_fuzzy_text_matching_preserves_stems_and_typos():
    from app.domain.text import word_matches, text_matches
    assert text_matches("хочу на йогу", "Йога на набережной")
    assert word_matches("волейбольный", "волейбол")
    assert word_matches("марафоны", "марафаны")
    assert not word_matches("марафон", "веломарафон")


@pytest.mark.parametrize("user_id", [None, "u-anna", "u-olga", "u-andrey", "u-maria"])
@pytest.mark.parametrize("status", ["open", "closed"])
def test_support_needs_keep_cards_and_offer_privacy_without_full_calendar(calendar_domain, user_id, status):
    domain, database = calendar_domain
    actor = domain.user(user_id)
    expected = inventory.list_support(actor, {"status": status})
    _events, calls = use_scoped_event_sql(database)
    assert inventory.list_support(actor, {"status": status}) == expected
    expected_ids = {n["eventId"] for n in expected if n["eventId"]}
    assert {call["id_1"] for call in calls} == expected_ids
    assert "events" not in database._data


@pytest.mark.parametrize("user_id", [None, "u-anna", "u-olga", "u-andrey", "u-maria"])
def test_inventory_me_only_reads_related_events(calendar_domain, user_id):
    domain, database = calendar_domain
    actor = domain.user(user_id)
    expected = inventory.inventory_me(actor)
    _events, calls = use_scoped_event_sql(database)
    assert inventory.inventory_me(actor) == expected
    assert "events" not in database._data
    assert bool(calls) == bool(actor)


def test_inventory_me_includes_club_manager_events(calendar_domain):
    domain, database = calendar_domain
    actor = domain.user("u-anna")
    database.engagement.managers.append({"orgId": "o-ladya", "userId": actor["id"]})
    expected = inventory.inventory_me(actor)
    use_scoped_event_sql(database)
    assert inventory.inventory_me(actor) == expected
    assert "events" not in database._data


def test_inventory_event_lookup_keeps_tracked_edits(calendar_domain):
    _domain, database = calendar_domain
    use_scoped_event_sql(database)
    event = inventory._get_event("e-run-tatyshev")
    event["title"] = "Changed in this transaction"
    assert inventory._get_event(event["id"]) is event
    assert "events" not in database._data
