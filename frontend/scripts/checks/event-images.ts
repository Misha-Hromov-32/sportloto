import assert from 'node:assert/strict';
import { validEventImage } from '@/lib/eventImages';
import { firstStepWithError, serverErrors } from '@/pages/events/create/model';

export function main() {
  for (const path of [
    '/media/covers/running/photo-12.webp',
    '/media/people/person-2.webp',
    '/img/u/1552674605-db6ffd4facb5.webp',
    '/demo/people/u-anna.jpg',
  ]) {
    assert.ok(validEventImage(path), path);
  }
  process.stdout.write('ок  Формы принимают сохранённые локальные фотографии\n');
  for (const path of [
    '//evil.test/photo.jpg',
    '/api/photo.jpg',
    '/img/../private.jpg',
    '/img/%2e%2e/private.jpg',
    '/img/photo.svg',
    '/img/photo.jpg?next=evil',
    '/img/photo.jpg\n',
  ]) {
    assert.ok(!validEventImage(path), path);
  }
  process.stdout.write('ок  Проверка фотографий не допускает чужие пути и обход каталога\n');
  assert.equal(firstStepWithError(serverErrors({ coverUrl: 'Некорректное фото' })), 'what');
  process.stdout.write('ок  Ошибка фотографии возвращает на шаг с полем фотографии\n');
}
