"""Отправка писем по SMTP (стандартный smtplib в потоке) или в журнал, когда почта выключена."""

import asyncio
import logging
import smtplib
import ssl
from dataclasses import dataclass
from datetime import UTC, datetime
from email.message import EmailMessage
from email.policy import SMTP
from email.utils import format_datetime, make_msgid, parseaddr
from typing import Protocol

from app.core.config import Settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class OutgoingMail:
    to: str
    subject: str
    text: str
    html: str
    # Ссылка из письма: при выключенной почте её пишут в журнал, чтобы пройти сценарий без SMTP.
    link: str = ""


def mask_email(address: str) -> str:
    """anna.petrova@example.ru → a***@e***.ru: в журнале видно, куда ушло, но не сам адрес."""
    local, _, domain = address.partition("@")
    if not domain:
        return f"{local[:1]}***"
    host, dot, tld = domain.rpartition(".")
    if not dot:
        host, tld = domain, ""
    return f"{local[:1]}***@{host[:1]}***{dot}{tld}"


class Mailer(Protocol):
    async def send(self, mail: OutgoingMail) -> bool: ...


def build_message(mail: OutgoingMail, settings: Settings) -> EmailMessage:
    message = EmailMessage(policy=SMTP)
    message["Subject"] = mail.subject
    message["From"] = settings.mail_from
    message["To"] = mail.to
    if settings.mail_reply_to:
        message["Reply-To"] = settings.mail_reply_to
    message["Date"] = format_datetime(datetime.now(UTC))
    domain = parseaddr(settings.mail_from)[1].rpartition("@")[2] or None
    message["Message-ID"] = make_msgid(domain=domain)
    message["Auto-Submitted"] = "auto-generated"
    message.set_content(mail.text, cte="quoted-printable")
    message.add_alternative(mail.html, subtype="html", cte="quoted-printable")
    return message


class LogMailer:
    """Почта выключена: тема и ссылка уходят в журнал (разработка и автономные запуски)."""

    async def send(self, mail: OutgoingMail) -> bool:
        logger.info(
            "Почта выключена, письмо не отправлено: «%s» для %s, ссылка: %s",
            mail.subject,
            mask_email(mail.to),
            mail.link,
        )
        return True


class SmtpMailer:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _deliver(self, message: EmailMessage) -> None:
        s = self.settings
        context = ssl.create_default_context()
        smtp: smtplib.SMTP
        if s.smtp_ssl:
            smtp = smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, timeout=s.smtp_timeout_seconds, context=context)
        else:
            smtp = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=s.smtp_timeout_seconds)
        with smtp:
            if s.smtp_starttls and not s.smtp_ssl:
                smtp.starttls(context=context)
            if s.smtp_username:
                smtp.login(s.smtp_username, s.smtp_password.get_secret_value())
            smtp.send_message(message)

    async def send(self, mail: OutgoingMail) -> bool:
        message = build_message(mail, self.settings)
        try:
            await asyncio.to_thread(self._deliver, message)
        except (smtplib.SMTPException, OSError) as exc:
            # Запрос не роняем: человек может нажать «Отправить ещё раз».
            # Ответ сервера может содержать адрес получателя — в журнал только маска.
            masked = mask_email(mail.to)
            detail = str(exc).replace(mail.to, masked).replace(mail.to.lower(), masked)
            logger.warning(
                "Письмо «%s» для %s не отправлено: %s: %s", mail.subject, masked, type(exc).__name__, detail
            )
            return False
        logger.info("Письмо «%s» отправлено: %s", mail.subject, mask_email(mail.to))
        return True


def build_mailer(settings: Settings) -> Mailer:
    return SmtpMailer(settings) if settings.mail_enabled else LogMailer()
