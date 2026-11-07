"""Email-only confirmation must work while both SMS endpoints stay disabled."""
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi import FastAPI

from app.core.config import Settings
from tests.conftest import CONSENTS, make_settings


@pytest.fixture
def settings(database_url: str) -> Settings:
    return make_settings(database_url, email_verification=True, sms_verification_enabled=False)


class Mailbox:
    def __init__(self):
        self.messages = []

    async def send(self, message):
        self.messages.append(message)
        return True


class NoSms:
    async def send(self, *_args, **_kwargs):
        raise AssertionError("SMS provider must not be called")


@pytest.mark.parametrize("email,sms,expected", [(True, False, False), (True, True, True), (False, True, False), (False, False, False)])
def test_confirmation_channels_are_independent(email, sms, expected):
    settings = Settings(_env_file=None, email_verification=email, sms_verification_enabled=sms, sms_provider="log")
    assert settings.phone_verification is expected
    assert settings.email_verification is email


async def test_email_confirmation_registration_login_and_password_reset(app: FastAPI, client: httpx.AsyncClient):
    mailbox = Mailbox()
    app.state.mailer = mailbox
    app.state.sms = NoSms()
    config = await client.get("/api/auth/config")
    assert config.json() == {"emailVerification": True, "passwordReset": True, "phoneVerification": False}
    email = "sport-qa-confirm@inbox.ru"
    response = await client.post("/api/auth/register", json={"name": "Проверка почты", "email": email, "password": "qa-secret-pass-123", **CONSENTS})
    assert response.status_code == 202, response.text
    assert len(mailbox.messages) == 1
    denied = await client.post("/api/auth/login", json={"email": email, "password": "qa-secret-pass-123"})
    assert denied.status_code == 403 and denied.json()["code"] == "email_not_verified"
    token = parse_qs(urlparse(mailbox.messages[-1].link).query)["token"][0]
    confirmed = await client.post("/api/auth/verify-email", json={"token": token})
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["identity"]["name"] == "Проверка почты"
    old_token = confirmed.json()["token"]
    requested = await client.post("/api/auth/password/forgot", json={"email": email})
    assert requested.status_code == 200 and len(mailbox.messages) == 2
    reset_token = parse_qs(urlparse(mailbox.messages[-1].link).query)["token"][0]
    reset = await client.post("/api/auth/password/reset", json={"token": reset_token, "password": "qa-new-pass-456"})
    assert reset.status_code == 200, reset.text
    client.cookies.clear()
    assert (await client.get("/api/auth/me", headers={"Authorization": "Bearer " + old_token})).status_code == 401
    assert (await client.post("/api/auth/login", json={"email": email, "password": "qa-secret-pass-123"})).status_code == 401
    assert (await client.post("/api/auth/login", json={"email": email, "password": "qa-new-pass-456"})).status_code == 200


@pytest.mark.parametrize("path,extra", [("send", {"password": "qa-secret-pass-123"}), ("verify", {"code": "123456"})])
async def test_sms_endpoints_cannot_bypass_email_only_setting(app: FastAPI, client: httpx.AsyncClient, path, extra):
    app.state.sms = NoSms()
    response = await client.post("/api/auth/phone/" + path, json={"email": "sport-qa-confirm@inbox.ru", "phone": "+79009990000", **extra})
    assert response.status_code == 503
    assert response.json()["code"] == "sms_unavailable"
