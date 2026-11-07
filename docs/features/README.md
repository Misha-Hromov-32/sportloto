# Дополнительные функции и их коды

Дополнительные функции в коде и документах помечены кодом из буквы и номера: В1–В8, С1–С17, Н1–Н6 (буквы кириллические). Код стоит в docstring модуля `backend/app/domain/features/*.py`, в комментариях к разделам `core.py`, `provider.py` (маршруты), `schema.py` (таблицы) и демо-данных `seed/`, в комментариях фронтенда `frontend/src` и в заголовках документов этой папки, `docs/architecture/api.md` и `docs/product/06-domain.md`. Обязательные сценарии S1–S6 (латинская S) — отдельный ряд, они описаны в [README](../../README.md#основные-сценарии).

Что означают буквы, в репозитории не записано: все коды появились разом в коммите прототипа `d734816`, исходного списка в истории нет. Поэтому ниже это просто серии В, С и Н. Номера С5 и Н4 не используются.

Отдельный ряд — латинские D-16 и D-17: номера решений владельца, которыми помечен код позже. D-16 — стоп-лист организатора ([stop-list.md](stop-list.md)), D-17 — боты Telegram и VK ([10-bots.md](../product/10-bots.md)).

## Легенда

Модули указаны относительно `backend/app/domain/`. `features/community_api.py` — общие HTTP-ресурсы для В6, В8, С16 и С17.

| Код | Функция | Модули бэкенда | Документ |
|---|---|---|---|
| В1 | Внешний ассистент по MCP: личные токены, каталог инструментов, подтверждение изменяющих действий, журнал вызовов | `features/mcp.py`, `seed/mcp.py`, точка `app/api/routes/mcp.py` | [mcp.md](mcp.md), [architecture/mcp.md](../architecture/mcp.md) |
| В2 | Подбор с помощником: фраза → 2–3 события с объяснением, уточнение кнопками, «Ищу компанию», если ничего нет | `features/match.py`, `features/kit.py`, `seed/community.py` | [assistant-match.md](assistant-match.md) |
| В3 | Инвентарь для игры: что нужно, «возьму с собой», просьба вещи на встречу | `features/inventory.py`, `seed/inventory.py` | [inventory.md](inventory.md) |
| В4 | Площадки и их свободные окна | `features/venues.py`, `seed/venues.py` | [venues.md](venues.md) |
| В5 | Удобное место для компании («Подобрать место для всех») | `features/venues.py` | [venues.md](venues.md) |
| В6 | Спрос и инфраструктура по районам (аналитика администратора) | `features/analytics.py`, `features/demand.py`, `features/community_api.py` | [analytics.md](analytics.md) |
| В7 | Фильтр состава: только женщины, только мужчины или все | `features/composition.py`, `seed/participation.py` | [participation.md](participation.md) |
| В8 | Наполнение из сообществ: импорт постов из файла в черновики | `features/imports.py`, `features/community_api.py` | [imports.md](imports.md) |
| С1 | «Я впервые — меня встретят»: встречающий, приметы, памятка новичку | `features/greeter.py`, `features/kit.py`, `seed/community.py` | [greeter-and-urgent.md](greeter-and-urgent.md) |
| С2 | Сбор компании от спроса: клуб видит обезличенные группы и предлагает встречу | `features/demand.py`, `seed/community.py` | [demand.md](demand.md) |
| С3 | Срочный добор игроков за 48 часов до начала | `features/urgent.py`, `seed/community.py` | [greeter-and-urgent.md](greeter-and-urgent.md) |
| С4 | Лист ожидания с предложением места: резерв до срока, «Иду» или «Отказаться» | `features/waitlist_offer.py`, `seed/participation.py` | [participation.md](participation.md) |
| С6 | План Б: похожие встречи взамен отменённой или перенесённой | `features/plan_b.py` | [participation.md](participation.md) |
| С7 | Общая полка и помощь партнёров (в паре с В3) | `features/inventory.py`, `seed/inventory.py` | [inventory.md](inventory.md) |
| С8 | Избранное; подписки на организаторов и сохранённые поиски (в интерфейсе — только просмотр и удаление) | `features/favorites.py`, `seed/engagement.py` | [favorites.md](favorites.md) |
| С9 | Личный календарь: пересечения по времени, напоминания за сутки и за 2 часа | `features/calendar.py` | [participation.md](participation.md) |
| С10 | Регулярные занятия: серия, запись на все встречи сразу | `features/series.py` | [participation.md](participation.md) |
| С11 | Быстрое создание: шаблоны в мастере и «Создать похожее» | `features/templates.py` | [favorites.md](favorites.md) |
| С12 | «Собраться тем же составом» | `features/again.py` | [again-team-family-corporate.md](again-team-family-corporate.md) |
| С13 | Встреча по приглашению (корпоративный спорт) | `features/invite_only.py` | [again-team-family-corporate.md](again-team-family-corporate.md) |
| С14 | Выгрузка участников в CSV; соуправляющие и закреплённое сообщение (только API) | `features/managers.py`, `seed/engagement.py` | [club-and-reliability.md](club-and-reliability.md) |
| С15 | Надёжность организатора: «Встреча состоялась?» | `features/reliability.py`, `seed/engagement.py` | [club-and-reliability.md](club-and-reliability.md) |
| С16 | Жалобы на событие или сообщение обсуждения | `features/reports.py`, `features/community_api.py` | [reports-moderation.md](reports-moderation.md) |
| С17 | Приостановка допуска организации | `features/org_suspend.py`, `features/community_api.py` | [reports-moderation.md](reports-moderation.md) |
| Н1 | Доступная среда: фильтр условий площадки и «Мне нужно сопровождение» | `features/venues.py`, `seed/venues.py` | [venues.md](venues.md) |
| Н2 | Программа поддержки ветеранов: наставник, «приду с близким» | `features/greeter.py`, `seed/community.py` | [greeter-and-urgent.md](greeter-and-urgent.md) |
| Н3 | Запись всей командой | `features/team.py` | [again-team-family-corporate.md](again-team-family-corporate.md) |
| Н5 | Информация без интернета: карточки ближайших записей на устройстве | `features/share.py` | [share-and-offline.md](share-and-offline.md) |
| Н6 | Семейный формат: «Можно с детьми» и «Для детей N–M лет» | `features/family.py` | [again-team-family-corporate.md](again-team-family-corporate.md) |

## Функции без кода

| Функция | Где | Документ |
|---|---|---|
| Ссылка близкому (`/share/:token`) | `features/share.py` | [share-and-offline.md](share-and-offline.md) |
| Подборка дня: три встречи раз в день, уведомление и письмо | `features/digest.py`, `app/services/digest_mail.py`, `app/mail/digest.py` | [daily-digest.md](daily-digest.md) |
| «Для вас» и «почему подходит» | `assistant.py` (`explain_event`) | [recommendations.md](recommendations.md) |
| Альбом «Как это было»: до четырёх фото прошедшей встречи | `features/event_photos.py` | раздел `events` в [api.md](../architecture/api.md) |
| Чат-помощник с режимами модели и мостом | `app/assistant/`, `app/api/routes/assistant.py` | [assistant-chat.md](assistant-chat.md), [chat.md](chat.md) |
| Заполнение профиля из ВКонтакте | `app/integrations/vk.py`, `app/api/routes/profile_import.py` | [profile-vk.md](profile-vk.md) |
| Оплата на сайте: встречи «с человека», складчина, продажа вещей с полки, балансы и выплаты | `features/payments.py`, `app/payments/`, `app/services/payments.py`, `app/api/routes/payments.py` | [payments.md](payments.md), [payments-yookassa-setup.md](payments-yookassa-setup.md) |
| Стоп-лист организатора и «Убрать из участников» (D-16) | `features/stop_list.py` | [stop-list.md](stop-list.md) |
| Логотип и обложка организации, фото после регистрации | проверки в `core.py` и `lib/event_rules.py` | [org-media.md](org-media.md) |

## Документы папки

| Документ | О чём |
|---|---|
| [again-team-family-corporate.md](again-team-family-corporate.md) | Собраться снова, встреча по приглашению, запись командой, семейные встречи |
| [analytics.md](analytics.md) | Спрос и инфраструктура по районам для администратора |
| [assistant-chat.md](assistant-chat.md) | Чат-бот: ответы о сайте, подбор, действия с подтверждением, режимы модели |
| [assistant-match.md](assistant-match.md) | Подбор с помощником под строкой поиска |
| [chat.md](chat.md) | Кнопка и окно чата на всех страницах, история, вид |
| [club-and-reliability.md](club-and-reliability.md) | CSV участников, «Встреча состоялась?»; соуправляющие и закрепление (только API) |
| [daily-digest.md](daily-digest.md) | Подборка дня: правила, настройки, письмо |
| [demand.md](demand.md) | «Спрос рядом»: клубы собирают компанию из спроса |
| [favorites.md](favorites.md) | Избранное, подписки и сохранённые поиски из демо-данных, шаблоны |
| [greeter-and-urgent.md](greeter-and-urgent.md) | Встречающий новичков, срочный добор, программа для ветеранов |
| [imports.md](imports.md) | Импорт встреч из сообществ с проверкой черновика |
| [inventory.md](inventory.md) | Инвентарь для игры, общая полка, помощь партнёров |
| [mcp.md](mcp.md) | Личные токены и консоль для внешнего ассистента |
| [motion.md](motion.md) | Входные анимации интерфейса |
| [org-media.md](org-media.md) | Логотип и обложка организации, фото после регистрации |
| [participation.md](participation.md) | Состав, резерв из листа ожидания, план Б, календарь, серия |
| [payments.md](payments.md) | Оплата на сайте: схема, сбор сервиса, складчина, возвраты, выплаты, контракт |
| [payments-yookassa-setup.md](payments-yookassa-setup.md) | Подключение магазина ЮKassa и переменные |
| [profile-vk.md](profile-vk.md) | Заполнение профиля из ВКонтакте и как его включить |
| [recommendations.md](recommendations.md) | Счёт и причины «почему вам подходит», подборка «Для вас» |
| [reports-moderation.md](reports-moderation.md) | Жалобы и приостановка допуска |
| [share-and-offline.md](share-and-offline.md) | Ссылка близкому и карточки без сети |
| [stop-list.md](stop-list.md) | Стоп-лист организатора и «Убрать из участников» (D-16) |
| [venues.md](venues.md) | Площадки и окна, удобное место для всех, доступная среда |
