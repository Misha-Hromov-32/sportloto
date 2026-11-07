# Фотографии вымышленных анкет

Эти изображения иллюстрируют вымышленные анкеты демо-данных. Имена, описания и занятия не относятся к изображённым людям.

32 локальных JPEG загружаются вместе с сайтом: профили, список участников и карточки «Ищу компанию» не зависят от доступности фотобанка.

Источник каждого файла указан в `backend/app/domain/seed/companion_people.json` (`portraits`). Pravatar — [каталог CC0](https://pravatar.cc/images). Фотографии старшего поколения взяты с Pexels: [6874146](https://www.pexels.com/photo/close-up-shot-of-an-elderly-woman-smiling-6874146/), [12644996](https://www.pexels.com/photo/portrait-of-smiling-elderly-woman-12644996/), [6667746](https://www.pexels.com/photo/portrait-of-an-elderly-man-smiling-6667746/), [7937532](https://www.pexels.com/photo/portrait-of-an-elderly-woman-smiling-7937532/), [7322315](https://www.pexels.com/photo/elderly-man-in-gray-long-sleeves-smiling-7322315/).

Для восстановления отсутствующих файлов: `python scripts/fetch-people-portraits.py` из корня репозитория. Существующие файлы скрипт сохраняет.

Обновление добавляет объявления и заполняет пустые поля только известных вымышленных профилей с адресами `.demo`; загруженные фотографии, описания, встречи и платежи сохраняются. Маркер версии предотвращает повторное заполнение после удаления фотографии.
