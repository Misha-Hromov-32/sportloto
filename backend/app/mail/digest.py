# ruff: noqa: E501  вёрстка письма: длинные строки HTML со стилями в атрибутах читаются лучше целиком
"""Письмо «Подборка дня»: до трёх встреч карточками и ссылка «Отписаться».

Вёрстка — как у писем подтверждения (app/mail/templates.py): таблицы и стили в атрибутах.
Всё, что пришло из данных (названия, адреса, вступление от помощника), экранируется.
"""

from dataclasses import dataclass
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

DEFAULT_INTRO = "Мы подобрали встречи по вашим интересам и району."


@dataclass(frozen=True, slots=True)
class DigestCard:
    title: str
    when: str
    where: str
    reasons: list[str]
    link: str


def _meetings(n: int) -> str:
    tail, tens = n % 10, n % 100 // 10
    if tens != 1 and tail == 1:
        return f"{n} встреча"
    if tens != 1 and 2 <= tail <= 4:  # noqa: PLR2004
        return f"{n} встречи"
    return f"{n} встреч"


def _why(card: DigestCard) -> str:
    reasons = ", ".join(r.strip() for r in card.reasons if r.strip())
    return f"Почему подходит: {reasons[:1].lower()}{reasons[1:]}." if reasons else ""


def _card_html(card: DigestCard) -> str:
    e = escape
    link = e(card.link, quote=True)
    why = _why(card)
    why_row = (
        f'<p style="margin:10px 0 0 0;font-family:{TEXT_FONT};color:{INK};font-size:16px;line-height:24px;">'
        f"{e(why)}</p>"
        if why
        else ""
    )
    return f"""<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;border:1px solid {LINE};border-radius:16px;">
<tr>
<td style="padding:20px 20px 22px 20px;">
<p style="margin:0 0 6px 0;font-family:{TEXT_FONT};color:{ACCENT};font-size:16px;line-height:22px;font-weight:700;">{e(card.when)}</p>
<p style="margin:0 0 6px 0;font-family:{HEADING_FONT};color:{INK};font-size:22px;line-height:28px;font-weight:900;"><a href="{link}" target="_blank" style="color:{INK};text-decoration:none;">{e(card.title)}</a></p>
<p style="margin:0;font-family:{TEXT_FONT};color:{MUTED};font-size:16px;line-height:24px;">{e(card.where)}</p>
{why_row}
<p style="margin:14px 0 0 0;font-family:{TEXT_FONT};font-size:17px;line-height:24px;font-weight:700;"><a href="{link}" target="_blank" style="color:{ACCENT};text-decoration:underline;">Открыть встречу</a></p>
</td>
</tr>
</table>"""


@dataclass(frozen=True, slots=True)
class _Letter:
    subject: str
    greeting: str
    intro: str
    cards: list[DigestCard]
    site: str
    unsubscribe: str


def _html(letter: _Letter) -> str:
    subject, greeting, intro, cards = letter.subject, letter.greeting, letter.intro, letter.cards
    site, unsubscribe = letter.site, letter.unsubscribe
    e = escape
    site_href = e(site, quote=True)
    logo = e(f"{site}/icon-192.png", quote=True)
    feed = e(f"{site}/events", quote=True)
    off = e(unsubscribe, quote=True)
    text = f"font-family:{TEXT_FONT};color:{INK};"
    preheader = "; ".join(c.title for c in cards)
    body = "\n".join(_card_html(c) for c in cards)
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
  .card {{ padding: 28px 16px !important; }}
  .title {{ font-size: 28px !important; line-height: 32px !important; }}
}}
</style>
</head>
<body style="margin:0;padding:0;background-color:{BG};" bgcolor="{BG}">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">{e(preheader)}{_PREHEADER_FILL}</div>
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
<td class="card" bgcolor="{CARD}" style="background-color:{CARD};border-radius:24px;padding:40px 32px 32px 32px;">
<h1 class="title" style="margin:0 0 24px 0;font-family:{HEADING_FONT};font-size:34px;line-height:38px;font-weight:900;color:{INK};text-transform:uppercase;letter-spacing:0.5px;">ПОДБОРКА ДНЯ</h1>
<p style="margin:0 0 12px 0;{text}font-size:18px;line-height:28px;">{e(greeting)}</p>
<p style="margin:0 0 28px 0;{text}font-size:18px;line-height:28px;">{e(intro)}</p>
{body}
<p style="margin:12px 0 28px 0;{text}font-size:16px;line-height:24px;">Другие занятия рядом ищите в <a href="{feed}" target="_blank" style="color:{ACCENT};text-decoration:underline;">ленте на сайте</a>.</p>
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
<tr><td style="border-top:1px solid {LINE};font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>
</table>
<p style="margin:20px 0 0 0;font-family:{TEXT_FONT};color:{MUTED};font-size:15px;line-height:22px;">Подборка приходит раз в день. Если она больше не нужна, <a href="{off}" target="_blank" style="color:{MUTED};text-decoration:underline;">отпишитесь</a>: входить на сайт для этого не нужно.</p>
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


def _text(letter: _Letter) -> str:
    greeting, intro, cards, site, unsubscribe = (
        letter.greeting,
        letter.intro,
        letter.cards,
        letter.site,
        letter.unsubscribe,
    )
    lines = [greeting, "", intro, ""]
    for i, card in enumerate(cards, start=1):
        lines.extend([f"{i}. {card.title}", card.when, card.where])
        why = _why(card)
        if why:
            lines.append(why)
        lines.extend([f"Открыть: {card.link}", ""])
    lines.extend(
        [
            f"Другие занятия рядом: {site}/events",
            "",
            f"Отписаться от подборки: {unsubscribe}",
            "",
            "--",
            f"«{BRAND}»: совместные тренировки рядом с домом",
            site,
            "",
        ]
    )
    return "\n".join(lines)


def digest_mail(name: str, intro: str, cards: list[DigestCard], site: str, unsubscribe: str) -> RenderedMail:
    subject = f"Подборка дня: {_meetings(len(cards))} для вас"
    greeting = _greeting(name)
    intro = " ".join(intro.split()) or DEFAULT_INTRO
    letter = _Letter(subject, greeting, intro, cards, site, unsubscribe)
    return RenderedMail(subject=subject, text=_text(letter), html=_html(letter))
