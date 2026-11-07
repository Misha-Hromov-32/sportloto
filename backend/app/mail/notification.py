# ruff: noqa: E501  вёрстка письма: длинные строки HTML со стилями в атрибутах читаются лучше целиком
"""Письмо с уведомлением сайта: то же, что появилось под колокольчиком, и кнопка «Открыть».

Вёрстка — как у остальных писем (app/mail/templates.py): таблицы и стили в атрибутах.
Заголовок и текст уведомления собраны из данных людей (названия встреч, имена) и экранируются.
"""

from html import escape

from app.mail.templates import (
    _PREHEADER_FILL,
    ACCENT,
    BG,
    BRAND,
    CARD,
    HEADING_FONT,
    INK,
    LINE,
    MUTED,
    TEXT_FONT,
    RenderedMail,
    _greeting,
    _site_label,
)

SETTINGS_PATH = "/settings#notifications"
WHY = "Письмо пришло, потому что в настройках включены уведомления на почту."


def _html(subject: str, greeting: str, body: str, link: str, site: str) -> str:
    e = escape
    href = e(link, quote=True)
    site_href = e(site, quote=True)
    logo = e(f"{site}/icon-192.png", quote=True)
    prefs = e(f"{site}{SETTINGS_PATH}", quote=True)
    text = f"font-family:{TEXT_FONT};color:{INK};"
    return f"""<!DOCTYPE html>
<html lang="ru" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>{e(subject)}</title>
<style>
:root {{ color-scheme: light only; supported-color-schemes: light only; }}
body {{ margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; }}
a[x-apple-data-detectors] {{ color: inherit !important; text-decoration: none !important; }}
@media only screen and (max-width: 620px) {{
  .card {{ padding: 28px 20px !important; }}
  .title {{ font-size: 26px !important; line-height: 30px !important; }}
}}
</style>
</head>
<body style="margin:0;padding:0;background-color:{BG};" bgcolor="{BG}">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">{e(body)}{_PREHEADER_FILL}</div>
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="{BG}" style="background-color:{BG};">
<tr>
<td align="center" style="padding:32px 12px;">
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;">
<tr>
<td style="padding:0 8px 20px 8px;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0">
<tr>
<td width="48" style="width:48px;vertical-align:middle;">
<a href="{site_href}" target="_blank" style="text-decoration:none;"><img src="{logo}" width="48" height="48" alt="{BRAND}" style="display:block;width:48px;height:48px;border:0;border-radius:12px;"></a>
</td>
<td style="padding-left:12px;vertical-align:middle;font-family:{HEADING_FONT};font-size:22px;line-height:26px;font-weight:900;color:{INK};text-transform:uppercase;">
<a href="{site_href}" target="_blank" style="color:{INK};text-decoration:none;">{BRAND}</a>
</td>
</tr>
</table>
</td>
</tr>
<tr>
<td class="card" bgcolor="{CARD}" style="background-color:{CARD};border-radius:24px;padding:40px 40px 32px 40px;">
<h1 class="title" style="margin:0 0 24px 0;font-family:{HEADING_FONT};font-size:30px;line-height:34px;font-weight:900;color:{INK};">{e(subject)}</h1>
<p style="margin:0 0 12px 0;{text}font-size:18px;line-height:28px;">{e(greeting)}</p>
<p style="margin:0 0 32px 0;{text}font-size:18px;line-height:28px;">{e(body)}</p>
<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 32px 0;">
<tr>
<td align="center" bgcolor="{ACCENT}" style="background-color:{ACCENT};border-radius:999px;">
<a href="{href}" target="_blank" style="display:inline-block;padding:18px 40px;font-family:{TEXT_FONT};font-size:19px;line-height:24px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px;">Открыть</a>
</td>
</tr>
</table>
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
<tr><td style="border-top:1px solid {LINE};font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>
</table>
<p style="margin:20px 0 0 0;font-family:{TEXT_FONT};color:{MUTED};font-size:15px;line-height:22px;">{WHY} <a href="{prefs}" target="_blank" style="color:{MUTED};text-decoration:underline;">Настроить уведомления</a></p>
</td>
</tr>
<tr>
<td align="center" style="padding:24px 16px 0 16px;font-family:{TEXT_FONT};color:{MUTED};font-size:13px;line-height:20px;">
«{BRAND}»: совместные тренировки рядом с домом<br>
<a href="{site_href}" target="_blank" style="color:{MUTED};text-decoration:underline;">{e(_site_label(site))}</a><br>
Письмо отправлено автоматически.
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>
"""


def _text(greeting: str, body: str, link: str, site: str) -> str:
    return "\n".join(
        [
            greeting,
            "",
            body,
            "",
            f"Открыть: {link}",
            "",
            WHY,
            f"Настроить уведомления: {site}{SETTINGS_PATH}",
            "",
            "--",
            f"«{BRAND}»: совместные тренировки рядом с домом",
            site,
            "",
        ]
    )


def notification_mail(name: str, title: str, text: str, link: str, site: str) -> RenderedMail:
    """Тема письма — заголовок уведомления. `link` — полный адрес страницы на сайте."""
    subject = " ".join(title.split()) or BRAND
    body = " ".join(text.split())
    greeting = _greeting(name)
    return RenderedMail(
        subject=subject,
        text=_text(greeting, body, link, site),
        html=_html(subject, greeting, body, link, site),
    )
