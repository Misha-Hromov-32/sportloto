"""Сквозная проверка в браузере: фронтенд в Docker ходит в бэкенд через nginx.

Две «вкладки» (отдельные контексты браузера): участница записывается на встречу кнопкой в интерфейсе,
организатор видит уведомление; затем вопрос участницы приходит организатору живым обновлением (SSE)
без перезагрузки страницы. Ошибки консоли и ответы 5xx считаются провалом.

    docker compose -f deploy/docker-compose.yml up -d --wait
    scripts/e2e/run.sh
"""

import asyncio
import os
import re
import sys
from pathlib import Path

from playwright.async_api import Page, async_playwright, expect

BASE = os.environ.get("E2E_BASE_URL", "http://web")
SHOTS = Path(os.environ.get("E2E_SHOTS", "/shots"))
EVENT = "e-run-tatyshev"


def watch(page: Page, name: str, problems: list[str]) -> None:
    page.on("console", lambda m: problems.append(f"{name}: консоль: {m.text}") if m.type == "error" else None)
    page.on(
        "response",
        lambda r: problems.append(f"{name}: {r.status} {r.request.method} {r.url}") if r.status >= 500 else None,
    )


async def sign_in_by_email(page: Page, email: str) -> None:
    """Форма входа: у демо-аккаунтов пароля нет — поле оставляют пустым."""
    await page.goto(f"{BASE}/login")
    await page.get_by_label("Электронная почта").fill(email)
    await page.get_by_role("button", name="Войти", exact=True).last.click()
    await page.wait_for_url(re.compile(r"/(me|admin)"))


async def main() -> int:
    problems: list[str] = []
    SHOTS.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        options = {"locale": "ru-RU", "timezone_id": "Asia/Krasnoyarsk", "viewport": {"width": 1280, "height": 900}}
        anna = await (await browser.new_context(**options)).new_page()
        dmitry = await (await browser.new_context(**options)).new_page()
        watch(anna, "Анна", problems)
        watch(dmitry, "Дмитрий", problems)

        # Демо-данные заново: прошлые прогоны могли уже записать участницу.
        # Сброс доступен только администратору: отдельный контекст запросов, чтобы не задеть cookie вкладок.
        admin = await p.request.new_context()
        login = await admin.post(f"{BASE}/api/auth/demo-login", data={"userId": "u-maria"})
        assert login.ok, await login.text()
        token = (await login.json())["token"]
        reset = await admin.post(f"{BASE}/api/demo/reset", data={}, headers={"Authorization": f"Bearer {token}"})
        assert reset.ok, await reset.text()
        await admin.dispose()

        await anna.goto(BASE)
        await expect(anna.get_by_role("link", name=re.compile("Найти занятие|События")).first).to_be_visible()
        await sign_in_by_email(anna, "anna@vmeste.demo")
        print("ок  вход участницы по почте (демо-аккаунт без пароля)")  # noqa: T201

        await anna.goto(f"{BASE}/events")
        await expect(anna.get_by_text("Утренняя пробежка по острову Татышев").first).to_be_visible(timeout=15000)
        print("ок  лента событий с сервера")  # noqa: T201

        await anna.goto(f"{BASE}/events/{EVENT}")
        await anna.get_by_role("button", name=re.compile(r"^Записаться$")).first.click()
        # Интерфейс может переспросить про пересечение по времени — соглашаемся записаться.
        anyway = anna.get_by_role("button", name=re.compile("Всё равно записаться"))
        confirm = anna.get_by_role("button", name=re.compile(r"^Записаться$"))
        try:
            await expect(anna.get_by_text("Вы участник").first).to_be_visible(timeout=4000)
        except AssertionError:
            if await anyway.count():
                await anyway.first.click()
            elif await confirm.count():
                await confirm.first.click()
            await expect(anna.get_by_text("Вы участник").first).to_be_visible(timeout=10000)
        await anna.screenshot(path=str(SHOTS / "anna-joined.png"), full_page=True)
        print("ок  запись на встречу кнопкой в карточке")  # noqa: T201

        await sign_in_by_email(dmitry, "dmitry@vmeste.demo")
        print("ок  вход организатора по демопочте")  # noqa: T201
        await dmitry.goto(f"{BASE}/notifications")
        await expect(dmitry.get_by_text(re.compile("Анна Соколова записал")).first).to_be_visible(timeout=15000)
        print("ок  организатор видит уведомление о записи")  # noqa: T201

        question = "Где встречаемся, у указателя?"
        posted = await anna.evaluate(
            """async ([eventId, text]) => {
                const token = JSON.parse(sessionStorage.getItem('vmeste.api.session')).token;
                const res = await fetch('/api/messages', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ eventId, text, replyTo: null }),
                });
                return res.status;
            }""",
            [EVENT, question],
        )
        assert posted == 200, posted
        await expect(dmitry.get_by_text(re.compile(question[:20])).first).to_be_visible(timeout=10000)
        await dmitry.screenshot(path=str(SHOTS / "dmitry-live.png"), full_page=True)
        print("ок  вопрос пришёл организатору живым обновлением без перезагрузки")  # noqa: T201

        await browser.close()
    for line in problems:
        print(f"!!  {line}")  # noqa: T201
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
