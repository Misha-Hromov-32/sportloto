import pytest

from app.core.config import Settings
from app.core.errors import AppError
from app.domain.features import payments
from app.services.payments import build_gateway


def test_production_cannot_expose_demo_or_accidentally_use_gateway():
    settings = Settings(
        _env_file=None,
        app_env="prod",
        demo_login_enabled=True,
        demo_reset_enabled=True,
        demo_shift_dates=True,
        demo_seed_on_start=True,
        payments_provider="yookassa",
        yookassa_shop_id="dummy-shop",
        yookassa_secret_key="dummy-secret",
    )
    assert not any(
        [
            settings.demo_login_enabled,
            settings.demo_reset_enabled,
            settings.demo_shift_dates,
            settings.demo_seed_on_start,
        ]
    )
    assert settings.payments_provider == "disabled"
    assert not settings.yookassa_secret_key.get_secret_value()
    assert not settings.yookassa_shop_id
    assert build_gateway(settings) is None


def test_disabled_payment_actions_do_not_depend_on_login_or_write_data(monkeypatch):
    monkeypatch.setitem(payments._config, "provider", "disabled")
    for action in [
        lambda: payments.start_payment(None, None, {}),
        lambda: payments.fake_outcome(None, None, "missing", {}),
        lambda: payments.request_payout(None, None, {}),
        lambda: payments.buy_item(None, None, "missing", {}),
    ]:
        with pytest.raises(AppError) as error:
            action()
        assert error.value.status == 503
    assert payments.payments_tick(None) is False


def test_fake_payments_are_explicitly_available_for_isolated_tests():
    settings = Settings(_env_file=None, app_env="test", payments_provider="fake", payments_enabled=True)
    assert settings.payments_provider == "fake"
    assert settings.payments_enabled
