/**
 * Кто отвечает за сайт и персональные данные. Одно место для всех документов на /legal:
 * при смене контактов или реквизитов править только здесь и поднять редакцию.
 */
export const OPERATOR = {
  name: 'Хромов Михаил Сергеевич',
  nameDative: 'Хромову Михаилу Сергеевичу',
  nameInstrumental: 'Хромовым Михаилом Сергеевичем',
  short: 'Хромов М. С.',
  status: 'физическое лицо, гражданин Российской Федерации',
  email: 'dev@hromovm.ru',
  site: 'https://sport.up-point.tech',
  service: '«Спорт и точка»',
  servers: 'серверах хостинг-провайдера SpaceWeb в Санкт-Петербурге (Россия)',
} as const;

/** Редакция документов. Совпадает с LEGAL_VERSION на сервере (backend/app/api/routes/auth.py). */
export const LEGAL_VERSION = '2026-11-03';
export const LEGAL_EDITION = '3 ноября 2026 года';
