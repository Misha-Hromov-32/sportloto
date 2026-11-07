"""Проверка адреса не зависит от перебора вариантов регулярного выражения."""

import pytest

from app.services.email_policy import email_domain, is_allowed_email


@pytest.mark.parametrize(
    ("email", "domain"),
    [
        ("user@mail.ru", "mail.ru"),
        (" USER@YANDEX.RU ", "yandex.ru"),
        ("почта@пример.рф", "xn--e1afmkfd.xn--p1ai"),
        ("user@sub.example.test", "sub.example.test"),
        ("user@mail.ru.", "mail.ru"),
        ("", None),
        ("@mail.ru", None),
        ("user@mail", None),
        ("user@@mail.ru", None),
        ("user@mail. ru", None),
        ("!@!." + "!." * 10000, None),
    ],
)
def test_email_domain(email: str, domain: str | None) -> None:
    assert email_domain(email) == domain


def test_allowed_domains_are_unchanged() -> None:
    assert is_allowed_email("user@mail.ru")
    assert is_allowed_email("user@yandex.com")
    assert not is_allowed_email("user@gmail.com")
    assert not is_allowed_email("user@mail.ru.evil.com")
