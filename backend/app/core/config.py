from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

AiProviderName = Literal["fake", "gigachat", "yandexgpt", "off"]
FakeFailure = Literal["none", "timeout", "error", "invalid"]
SmsProviderName = Literal["log", "smsaero"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: Literal["dev", "test", "prod"] = "dev"
    app_version: str = "0.1.0"
    log_level: str = "INFO"

    database_url: str = "postgresql+asyncpg://vmeste:vmeste@localhost:5433/vmeste"
    database_echo: bool = False
    database_pool_size: int = 10
    database_connect_timeout: float = 5.0

    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=list)
    # Адрес сайта для ссылок в снимках для ботов, sitemap и robots.txt (https://example.ru).
    # Пусто — берётся из запроса: X-Forwarded-Proto и Host.
    site_url: str = ""

    session_cookie_name: str = "vmeste_session"
    session_ttl_hours: int = 24 * 14
    cookie_secure: bool = False
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    demo_login_enabled: bool = True

    # Почта. Выключена — письма пишутся в журнал (тема и ссылка), так удобно в разработке.
    mail_enabled: bool = False
    smtp_host: str = "localhost"
    smtp_port: int = 587
    # Пустые логин и пароль — отправка без входа (свой почтовый сервер в той же сети).
    smtp_username: str = ""
    smtp_password: SecretStr = SecretStr("")
    smtp_starttls: bool = False
    smtp_ssl: bool = False
    smtp_timeout_seconds: float = 15.0
    mail_from: str = "Спорт и точка <noreply@sport.up-point.tech>"
    mail_reply_to: str = ""
    # Подтверждение почты при регистрации: до подтверждения сессия не начинается.
    email_verification: bool = False
    # Отдельный переключатель запасного подтверждения; почта работает независимо.
    sms_verification_enabled: bool = False

    # SMS с кодом — запасной путь подтверждения, если письмо не дошло.
    # log — код пишется в журнал (разработка и тесты), smsaero — отправка через SMS Aero.
    sms_provider: SmsProviderName = "log"
    smsaero_email: str = ""
    smsaero_api_key: SecretStr = SecretStr("")
    # «SMS Aero» — бесплатная подпись для проверки; для работы — своя подпись из кабинета SMS Aero.
    smsaero_sign: str = "SMS Aero"
    smsaero_api_url: str = "https://gate.smsaero.ru/v2"
    sms_timeout_seconds: float = 10.0
    # Общий потолок отправок за сутки: защита бюджета от перебора номеров.
    sms_daily_limit: int = 100
    # Секрет для хешей кодов. Пусто — случайный на время работы процесса (коды гаснут при перезапуске).
    sms_code_pepper: SecretStr = SecretStr("")

    # Доменные правила (app/domain). Строгая схема: поле записи без колонки — ошибка, а не предупреждение.
    domain_strict: bool = False
    # Пустая база при старте — загрузить демо-данные.
    demo_seed_on_start: bool = True
    # Демо-данные открыли в другой календарный день — сдвинуть даты, чтобы встречи снова были впереди.
    demo_shift_dates: bool = True
    # POST /demo/reset и переключатели демо (сбой помощника). На публичном сервере — false: иначе любой гость
    # одним запросом стирает зарегистрированных людей. Разработка и сценарии запросов работают с true.
    demo_reset_enabled: bool = True
    # Каталог для снимков записей людей перед обновлением демо-данных до новой версии. Пусто — не сохранять.
    domain_backup_dir: str = ""
    # Как часто проверять истёкшие резервы, напоминания и места команд.
    domain_tick_seconds: float = 15.0
    # Замороженные часы правил (ISO): тесты и показ.
    domain_frozen_now: str | None = None

    sse_heartbeat_seconds: float = 15.0
    sse_retry_ms: int = 3000
    sse_replay_size: int = 1000
    sse_queue_size: int = 256
    sse_max_topics: int = 50

    ai_provider: AiProviderName = "fake"
    ai_timeout_seconds: float = 8.0
    ai_cache_ttl_seconds: int = 600
    ai_cache_max_items: int = 512
    ai_user_limit_per_minute: int = 10
    ai_user_limit_per_day: int = 200
    ai_max_input_chars: int = 2000
    ai_embedding_dim: int = 256
    ai_fake_delay_ms: int = 0
    ai_fake_failure: FakeFailure = "none"

    gigachat_auth_key: SecretStr | None = None
    gigachat_scope: str = "GIGACHAT_API_PERS"
    gigachat_model: str = "GigaChat"
    gigachat_embeddings_model: str = "Embeddings"
    gigachat_oauth_url: str = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
    gigachat_api_url: str = "https://gigachat.devices.sberbank.ru/api/v1"
    gigachat_ca_bundle: str | None = None
    gigachat_verify_ssl: bool = True

    yandex_api_key: SecretStr | None = None
    yandex_folder_id: str | None = None
    yandex_model: str = "yandexgpt-lite/latest"
    yandex_embed_doc_model: str = "text-search-doc/latest"
    yandex_embed_query_model: str = "text-search-query/latest"
    yandex_api_url: str = "https://llm.api.cloud.yandex.net/foundationModels/v1"

    # Заполнение профиля из ВКонтакте: сервисный ключ приложения VK (dev.vk.com → приложение → ключи).
    # Пусто — кнопка «Заполнить из ВКонтакте» скрыта.
    vk_service_token: SecretStr | None = None
    vk_api_url: str = "https://api.vk.com/method"

    # Боты Telegram и VK: общий секрет, которым бот подписывает запросы привязки (заголовок X-Bot-Secret).
    # Пусто — привязка выключена, эндпоинты бота отвечают 503 bots_disabled.
    bot_api_secret: SecretStr = SecretStr("")
    # Ник Telegram-бота без @ для ссылки t.me/<ник>?start=<код>. Пусто — на сайте только код.
    telegram_bot_username: str = ""
    vk_group_id: int = 242415813

    # Уведомления в браузер (Web Push): ключи VAPID, пара из scripts/generate-vapid-keys.py.
    # Пусто — канал «В браузере» выключен. Subject — mailto: или https: адрес владельца сайта.
    web_push_public_key: str = ""
    web_push_private_key: SecretStr = SecretStr("")
    web_push_subject: str = "mailto:noreply@sport.up-point.tech"
    # Как часто проверять новые уведомления для почты и браузера; 0 — доставка выключена.
    delivery_poll_seconds: float = 60.0

    # Оплата на сайте (docs/features/payments.md). fake — встроенная тестовая страница без списания денег,
    # yookassa — настоящий шлюз. Ключ магазина `test_…` — тестовый магазин ЮKassa.
    payments_provider: Literal["disabled", "fake", "yookassa"] = "fake"
    # На рабочем сервере оплата закрыта, пока её явно не включили при развёртывании.
    payments_enabled: bool | None = None
    yookassa_shop_id: str = ""
    yookassa_secret_key: SecretStr = SecretStr("")
    # «Чеки от ЮKassa» (54-ФЗ): к платежу прикладывается чек с почтой или телефоном покупателя.
    yookassa_receipts: bool = False
    yookassa_tax_system_code: int | None = None
    # Ставка НДС позиции чека: 1 — без НДС.
    yookassa_vat_code: int = 1
    # Шлюз «Выплаты» (отдельный договор): пусто — выплаты переводит администратор и отмечает вручную.
    yookassa_payout_agent_id: str = ""
    yookassa_payout_secret_key: SecretStr = SecretStr("")
    # Принимать уведомления только с адресов ЮKassa (за nginx — по X-Real-IP). Основная защита — перезапрос.
    yookassa_check_ip: bool = False
    yookassa_api_url: str = "https://api.yookassa.ru/v3"
    # Как часто исполнитель проверяет очередь операций (списание, возврат, выплата).
    payments_poll_seconds: float = 30.0

    @model_validator(mode="after")
    def _production_boundaries(self) -> "Settings":
        if self.app_env == "prod":
            self.demo_login_enabled = False
            self.demo_reset_enabled = False
            self.demo_shift_dates = False
            self.demo_seed_on_start = False
        if self.payments_enabled is None:
            self.payments_enabled = self.app_env != "prod"
        if not self.payments_enabled or self.payments_provider == "disabled":
            self.payments_enabled = False
            self.payments_provider = "disabled"
            self.yookassa_shop_id = ""
            self.yookassa_secret_key = SecretStr("")
            self.yookassa_payout_agent_id = ""
            self.yookassa_payout_secret_key = SecretStr("")
        # Сервис использует только ВКонтакте.
        self.telegram_bot_username = ""
        return self

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("yookassa_tax_system_code", mode="before")
    @classmethod
    def _empty_tax_code(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value

    @field_validator("smsaero_sign", mode="after")
    @classmethod
    def _default_sign(cls, value: str) -> str:
        return value.strip() or "SMS Aero"

    @field_validator("site_url", mode="after")
    @classmethod
    def _strip_site_url(cls, value: str) -> str:
        return value.strip().rstrip("/")

    @field_validator("telegram_bot_username", mode="after")
    @classmethod
    def _strip_bot_username(cls, value: str) -> str:
        return value.strip().lstrip("@")

    @property
    def web_push_enabled(self) -> bool:
        return bool(self.web_push_public_key.strip() and self.web_push_private_key.get_secret_value().strip())

    @property
    def bots_enabled(self) -> bool:
        return bool(self.bot_api_secret.get_secret_value())

    @property
    def sms_configured(self) -> bool:
        if self.sms_provider == "smsaero":
            return bool(self.smsaero_email and self.smsaero_api_key.get_secret_value())
        return True

    @property
    def phone_verification(self) -> bool:
        """Подтверждение кодом по SMS доступно, когда включено подтверждение почты и настроена отправка."""
        return self.sms_verification_enabled and self.email_verification and self.sms_configured

    @property
    def session_ttl_seconds(self) -> int:
        return self.session_ttl_hours * 3600

    @property
    def sync_database_url(self) -> str:
        """Адрес для синхронного движка доменных правил (psycopg) — та же база, другой драйвер."""
        return self.database_url.replace("+asyncpg", "+psycopg", 1)


@lru_cache
def get_settings() -> Settings:
    return Settings()
