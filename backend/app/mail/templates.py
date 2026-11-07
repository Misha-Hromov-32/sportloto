"""Письма «Спорт и точка»: текст и HTML.

HTML свёрстан таблицами со стилями в атрибутах: так его одинаково показывают Gmail, Яндекс Почта,
Mail.ru, Outlook и Apple Mail. Всё, что приходит от пользователя (имя), экранируется.
"""

from dataclasses import dataclass
from html import escape
from urllib.parse import urlsplit

BRAND = "Спорт и точка"
BG = "#F5F3EF"
CARD = "#FFFFFF"
INK = "#212121"
MUTED = "#5C5C5C"
ACCENT = "#D63B41"
LINE = "#E8E4DC"
HEADING_FONT = "'Roboto Condensed', 'Arial Narrow', Arial, sans-serif"
TEXT_FONT = "Onest, Arial, Helvetica, sans-serif"

VERIFY_HOURS = 48
RESET_HOURS = 1


@dataclass(frozen=True, slots=True)
class RenderedMail:
    subject: str
    text: str
    html: str


@dataclass(frozen=True, slots=True)
class _Letter:
    subject: str
    preheader: str
    title: str
    greeting: str
    lead: str
    button: str
    link: str
    expires: str
    ignore: str


def _greeting(name: str) -> str:
    name = " ".join(name.split())
    return f"Здравствуйте, {name}." if name else "Здравствуйте."


def _hours(hours: int) -> str:
    tail, tens = hours % 10, hours % 100 // 10
    if tens == 1 or tail == 0 or tail > 4:  # noqa: PLR2004
        return f"{hours} часов"
    return f"{hours} час" if tail == 1 else f"{hours} часа"


def _site_label(site: str) -> str:
    return urlsplit(site).netloc or site


# Невидимые символы после прехедера: почтовые программы не дотягивают в превью начало письма.
_PREHEADER_FILL = "&#847;&zwnj;&nbsp;" * 60


def _html(letter: _Letter, site: str) -> str:
    e = escape
    link = e(letter.link, quote=True)
    site_href = e(site, quote=True)
    logo = e(f"{site}/icon-192.png", quote=True)
    text = f"font-family:{TEXT_FONT};color:{INK};"
    return f"""<!DOCTYPE html>
<html lang="ru" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>{e(letter.subject)}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<style>table, td, p, a, h1, span {{ font-family: Arial, Helvetica, sans-serif !important; }}</style>
<![endif]-->
<style>
:root {{ color-scheme: light only; supported-color-schemes: light only; }}
body {{ margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; }}
a[x-apple-data-detectors] {{ color: inherit !important; text-decoration: none !important; }}
@media only screen and (max-width: 620px) {{
  .card {{ padding: 32px 20px !important; }}
  .title {{ font-size: 28px !important; line-height: 32px !important; }}
}}
</style>
</head>
<body style="margin:0;padding:0;background-color:{BG};" bgcolor="{BG}">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">{e(letter.preheader)}{_PREHEADER_FILL}</div>
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="{BG}" style="background-color:{BG};">
<tr>
<td align="center" style="padding:32px 12px;">
<!--[if mso]><table role="presentation" width="600" align="center" border="0" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;">
<tr>
<td style="padding:0 8px 20px 8px;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0">
<tr>
<td width="48" style="width:48px;vertical-align:middle;">
<a href="{site_href}" target="_blank" style="text-decoration:none;"><img src="{logo}" width="48" height="48" alt="{BRAND}" style="display:block;width:48px;height:48px;border:0;border-radius:12px;outline:none;text-decoration:none;"></a>
</td>
<td style="padding-left:12px;vertical-align:middle;font-family:{HEADING_FONT};font-size:22px;line-height:26px;font-weight:900;color:{INK};text-transform:uppercase;">
<a href="{site_href}" target="_blank" style="color:{INK};text-decoration:none;">{BRAND}</a>
</td>
</tr>
</table>
</td>
</tr>
<tr>
<td class="card" bgcolor="{CARD}" style="background-color:{CARD};border-radius:24px;padding:40px 40px 36px 40px;">
<h1 class="title" style="margin:0 0 24px 0;font-family:{HEADING_FONT};font-size:34px;line-height:38px;font-weight:900;color:{INK};text-transform:uppercase;letter-spacing:0.5px;">{e(letter.title.upper())}</h1>
<p style="margin:0 0 12px 0;{text}font-size:18px;line-height:28px;">{e(letter.greeting)}</p>
<p style="margin:0 0 32px 0;{text}font-size:18px;line-height:28px;">{e(letter.lead)}</p>
<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 28px 0;">
<tr>
<td align="center" bgcolor="{ACCENT}" style="background-color:{ACCENT};border-radius:999px;mso-padding-alt:18px 40px;">
<a href="{link}" target="_blank" style="display:inline-block;padding:18px 40px;font-family:{TEXT_FONT};font-size:19px;line-height:24px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px;mso-padding-alt:0;">{e(letter.button)}</a>
</td>
</tr>
</table>
<p style="margin:0 0 24px 0;{text}font-size:16px;line-height:24px;">{e(letter.expires)}</p>
<p style="margin:0 0 6px 0;font-family:{TEXT_FONT};color:{MUTED};font-size:15px;line-height:22px;">Если кнопка не нажимается, скопируйте ссылку в адресную строку браузера:</p>
<p style="margin:0 0 28px 0;font-family:{TEXT_FONT};font-size:15px;line-height:22px;word-break:break-all;"><a href="{link}" target="_blank" style="color:{ACCENT};text-decoration:underline;">{link}</a></p>
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
<tr><td style="border-top:1px solid {LINE};font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>
</table>
<p style="margin:20px 0 0 0;font-family:{TEXT_FONT};color:{MUTED};font-size:15px;line-height:22px;">{e(letter.ignore)}</p>
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
<!--[if mso]></td></tr></table><![endif]-->
</td>
</tr>
</table>
</body>
</html>
"""


def _text(letter: _Letter, site: str) -> str:
    return "\n".join(
        [
            letter.greeting,
            "",
            letter.lead,
            "",
            f"{letter.button}: {letter.link}",
            "",
            letter.expires,
            "",
            letter.ignore,
            "",
            "--",
            f"«{BRAND}»: совместные тренировки рядом с домом",
            site,
            "",
        ]
    )


def _render(letter: _Letter, site: str) -> RenderedMail:
    return RenderedMail(subject=letter.subject, text=_text(letter, site), html=_html(letter, site))


def verify_email(name: str, link: str, site: str) -> RenderedMail:
    return _render(
        _Letter(
            subject=f"Подтвердите почту для «{BRAND}»",
            preheader=f"Один шаг до входа: нажмите кнопку в письме. Ссылка действует {_hours(VERIFY_HOURS)}.",
            title="Подтвердите почту",
            greeting=_greeting(name),
            lead=f"Остался один шаг: подтвердите почту, и вы сразу войдёте в «{BRAND}».",
            button="Подтвердить почту",
            link=link,
            expires=f"Ссылка действует {_hours(VERIFY_HOURS)}.",
            ignore=f"Если вы не регистрировались на «{BRAND}», просто удалите письмо.",
        ),
        site,
    )


def reset_password(name: str, link: str, site: str) -> RenderedMail:
    return _render(
        _Letter(
            subject=f"Сброс пароля на «{BRAND}»",
            preheader=f"Нажмите кнопку в письме и придумайте новый пароль. Ссылка действует {_hours(RESET_HOURS)}.",
            title="Новый пароль",
            greeting=_greeting(name),
            lead="Вы попросили сбросить пароль. Нажмите кнопку и придумайте новый.",
            button="Задать новый пароль",
            link=link,
            expires=f"Ссылка действует {_hours(RESET_HOURS)} и сработает один раз.",
            ignore="Если вы не просили сбросить пароль, просто удалите письмо. Старый пароль продолжит работать.",
        ),
        site,
    )
