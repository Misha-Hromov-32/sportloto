import { App, Image, Input, Modal } from 'antd';
import { useState } from 'react';
import { Button } from '@/components';
import { API, errorMessage, useAction } from '@/lib/api';
import { prepareEventImage } from '@/lib/eventImages';
import type { EventDetails } from '@/types/api';
import type { EventPhoto } from '@/types/domain';
import styles from './EventPhotos.module.css';

export function EventPhotos({ event: e }: { event: EventDetails }) {
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<EventPhoto[]>([]);
  const [preparing, setPreparing] = useState(false);
  const { run, isPending } = useAction();
  const { message } = App.useApp();
  const eligible = e.state === 'past' || e.state === 'live';
  const upload = async (file: File) => {
    setPreparing(true);
    try {
      const url = await prepareEventImage(file);
      setPhotos((old) => [...old, { id: `draft-${Date.now()}`, url, caption: '' }].slice(0, 4));
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setPreparing(false);
    }
  };
  const save = async () => {
    try {
      await run(API.eventPhotos(e.id), { photos }, { method: 'put', success: 'Фото встречи сохранены' });
      setOpen(false);
    } catch {
      /* API показывает ошибку, черновик остаётся */
    }
  };
  if (!eligible || (!e.photos?.length && !e.isOrganizer)) return null;
  return (
    <section className={styles.root} aria-labelledby="event-photos-title">
      <div className={styles.head}>
        <h2 id="event-photos-title">Как это было</h2>
        {e.isOrganizer && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setPhotos(structuredClone(e.photos ?? []));
              setOpen(true);
            }}
          >
            {e.photos?.length ? 'Изменить альбом' : 'Добавить фото'}
          </Button>
        )}
      </div>
      {e.photos?.length ? (
        <div className={styles.grid}>
          <Image.PreviewGroup>
            {e.photos.map((photo, i) => (
              <figure key={photo.id}>
                <Image src={photo.url} alt={photo.caption || `Фото встречи ${i + 1}`} />
                <figcaption>{photo.caption}</figcaption>
              </figure>
            ))}
          </Image.PreviewGroup>
        </div>
      ) : (
        <p>Поделитесь фотографиями со встречи. Участники увидят альбом в карточке события.</p>
      )}
      <Modal
        open={open}
        title="Фото со встречи"
        onCancel={() => setOpen(false)}
        footer={
          <Button variant="primary" loading={isPending} disabled={preparing} onClick={() => void save()}>
            Сохранить альбом
          </Button>
        }
      >
        <div className={styles.editor}>
          <p>До четырёх фото. Загружайте снимки, которыми можно делиться с участниками встречи.</p>
          {photos.map((photo, i) => (
            <div className={styles.item} key={photo.id}>
              <img src={photo.url} alt={`Фото ${i + 1} перед сохранением`} />
              <label>
                Подпись к фото {i + 1}
                <Input.TextArea
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  value={photo.caption}
                  maxLength={180}
                  onChange={(ev) =>
                    setPhotos(photos.map((p, n) => (n === i ? { ...p, caption: ev.target.value } : p)))
                  }
                />
              </label>
              <Button variant="quiet" size="sm" onClick={() => setPhotos(photos.filter((_, n) => n !== i))}>
                Убрать фото {i + 1}
              </Button>
            </div>
          ))}
          {photos.length < 4 && (
            <label>
              Добавить фото
              <input
                type="file"
                aria-label="Добавить фото со встречи"
                accept="image/jpeg,image/png,image/webp"
                disabled={preparing}
                onChange={(ev) => {
                  const file = ev.target.files?.[0];
                  if (file) void upload(file);
                  ev.currentTarget.value = '';
                }}
              />
            </label>
          )}
          {preparing && <p role="status">Подготавливаем фото…</p>}
        </div>
      </Modal>
    </section>
  );
}
