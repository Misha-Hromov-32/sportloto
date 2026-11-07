"""Брокер живых обновлений внутри процесса.

Работает только при одном экземпляре бэкенда: подписки и буфер повторной доставки живут в памяти.
Для нескольких экземпляров брокер заменяется на Postgres LISTEN/NOTIFY или Redis с тем же интерфейсом.
"""

import asyncio
import time
from collections import deque
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any


@dataclass(frozen=True, slots=True)
class LiveMessage:
    id: str
    seq: int
    topics: frozenset[str]
    event: str
    data: dict[str, Any]


@dataclass(eq=False, slots=True)
class Subscription:
    topics: frozenset[str]
    queue: asyncio.Queue[LiveMessage | None] = field(default_factory=asyncio.Queue)
    closed: bool = False


@dataclass(frozen=True, slots=True)
class SubscribeResult:
    subscription: Subscription
    replay: list[LiveMessage]
    # Клиент пропустил больше, чем хранит буфер, или сервер перезапускался: нужно перечитать данные целиком.
    resync: bool
    last_id: str


class Broker:
    def __init__(self, *, replay_size: int = 1000, queue_size: int = 256) -> None:
        # Эпоха отличает идентификаторы событий разных запусков процесса.
        self.epoch = format(time.time_ns() // 1_000_000, "x")
        self._seq = 0
        self._history: deque[LiveMessage] = deque(maxlen=replay_size)
        self._by_topic: dict[str, set[Subscription]] = {}
        self._queue_size = queue_size

    @property
    def last_id(self) -> str:
        return f"{self.epoch}-{self._seq}"

    def subscriber_count(self, topic: str | None = None) -> int:
        if topic is not None:
            return len(self._by_topic.get(topic, ()))
        return len({sub for subs in self._by_topic.values() for sub in subs})

    def publish(self, topics: Iterable[str], data: dict[str, Any], *, event: str = "live") -> LiveMessage:
        self._seq += 1
        message = LiveMessage(
            id=f"{self.epoch}-{self._seq}", seq=self._seq, topics=frozenset(topics), event=event, data=data
        )
        self._history.append(message)
        targets = {sub for topic in message.topics for sub in self._by_topic.get(topic, ())}
        for sub in targets:
            if sub.queue.qsize() >= self._queue_size:
                # Медленный клиент: закрываем поток, браузер переподключится и дочитает из буфера.
                self.unsubscribe(sub)
                continue
            sub.queue.put_nowait(message)
        return message

    def subscribe(self, topics: Iterable[str], last_event_id: str | None = None) -> SubscribeResult:
        sub = Subscription(topics=frozenset(topics))
        replay: list[LiveMessage] = []
        resync = False
        if last_event_id:
            last_seq = self._parse_seq(last_event_id)
            oldest = self._history[0].seq if self._history else self._seq + 1
            if last_seq is None or last_seq > self._seq or last_seq < oldest - 1:
                resync = True
            else:
                replay = [m for m in self._history if m.seq > last_seq and m.topics & sub.topics]
        # Между снимком буфера и регистрацией нет await, поэтому событие не потеряется и не задвоится.
        for topic in sub.topics:
            self._by_topic.setdefault(topic, set()).add(sub)
        return SubscribeResult(subscription=sub, replay=replay, resync=resync, last_id=self.last_id)

    def unsubscribe(self, sub: Subscription) -> None:
        if sub.closed:
            return
        sub.closed = True
        for topic in sub.topics:
            subs = self._by_topic.get(topic)
            if subs is not None:
                subs.discard(sub)
                if not subs:
                    del self._by_topic[topic]
        sub.queue.put_nowait(None)

    def close_all(self) -> None:
        for sub in {sub for subs in self._by_topic.values() for sub in subs}:
            self.unsubscribe(sub)

    def _parse_seq(self, event_id: str) -> int | None:
        epoch, _, seq = event_id.partition("-")
        if epoch != self.epoch or not seq.isdigit():
            return None
        return int(seq)


def live_event(resource: str, ids: Iterable[str] = (), type_: str = "updated") -> dict[str, Any]:
    """Данные события в формате LiveEvent Refine: канал `resources/<ресурс>`, тип и изменённые id."""
    return {
        "channel": f"resources/{resource}",
        "type": type_,
        "payload": {"ids": list(ids)},
        "date": datetime.now(UTC).isoformat(),
    }
