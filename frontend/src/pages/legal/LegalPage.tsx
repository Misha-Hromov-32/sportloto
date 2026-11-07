import { FileTextIcon } from '@phosphor-icons/react';
import { Link, Navigate, useLocation, useParams } from 'react-router';

import { legalDoc, legalPath, LEGAL_DOCS } from './documents';
import { LEGAL_EDITION, OPERATOR } from './operator';
import styles from './parts/Legal.module.css';
import type { LegalBlock, LegalDoc } from './types';
import { PersonalPage } from '../shared/PersonalPage';

function Block({ block }: { block: LegalBlock }) {
  if (typeof block === 'string') return <p className={styles.text}>{block}</p>;
  if ('list' in block) {
    return (
      <ul className={styles.items}>
        {block.list.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{block.head[0]}</th>
            <th scope="col">{block.head[1]}</th>
          </tr>
        </thead>
        <tbody>
          {block.rows.map(([name, value]) => (
            <tr key={name}>
              <th scope="row">{name}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OperatorCard() {
  return (
    <section className={styles.operator} aria-labelledby="operator-title">
      <h2 id="operator-title" className={styles.operatorTitle}>
        Владелец сайта и оператор данных
      </h2>
      <dl className={styles.operatorList}>
        <div>
          <dt>Кто</dt>
          <dd>
            {OPERATOR.name}, {OPERATOR.status}
          </dd>
        </div>
        <div>
          <dt>Почта для обращений</dt>
          <dd>
            <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>
          </dd>
        </div>
        <div>
          <dt>Где хранятся данные</dt>
          <dd>В России, на {OPERATOR.servers}</dd>
        </div>
      </dl>
    </section>
  );
}

function DocumentsIndex() {
  return (
    <PersonalPage
      title="Документы"
      icon={<FileTextIcon size={28} />}
      summary={
        <>
          <strong>Редакция от {LEGAL_EDITION}</strong>Все документы действуют для сайта {OPERATOR.site}
        </>
      }
      description="Здесь собраны условия пользования сайтом и документы об обработке персональных данных. Перед полным текстом каждого документа есть краткое описание."
    >
      <div className={styles.index}>
        <ul className={styles.cards}>
          {LEGAL_DOCS.map((d) => (
            <li key={d.slug}>
              <Link to={legalPath(d.slug)} className={styles.card}>
                <span className={styles.cardTitle}>{d.title}</span>
                <span className={styles.cardText}>{d.short}</span>
              </Link>
            </li>
          ))}
          <li>
            <Link to="/rules" className={styles.card}>
              <span className={styles.cardTitle}>Правила платформы</span>
              <span className={styles.cardText}>Как вести себя на встречах и в обсуждениях</span>
            </Link>
          </li>
        </ul>
        <OperatorCard />
      </div>
    </PersonalPage>
  );
}

function Document({ doc }: { doc: LegalDoc }) {
  const { hash } = useLocation();
  return (
    <PersonalPage
      title={doc.title}
      eyebrow="Документы"
      description={
        <>
          Редакция от {LEGAL_EDITION}. {doc.short}.
        </>
      }
    >
      <div className={styles.layout}>
        <nav className={styles.toc} aria-label="Оглавление документа">
          <h2 className={styles.tocTitle}>Оглавление</h2>
          <ol className={styles.tocList}>
            {doc.sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} aria-current={hash === `#${s.id}` ? 'location' : undefined}>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
          <Link to="/legal" className={styles.back}>
            Все документы
          </Link>
        </nav>

        <div className={styles.body}>
          <section className={styles.summary} aria-labelledby="summary-title">
            <h2 id="summary-title" className={styles.summaryTitle}>
              Коротко
            </h2>
            <ul className={styles.summaryList}>
              {doc.summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className={styles.summaryNote}>Это пересказ. Юридическую силу имеет полный текст ниже.</p>
          </section>

          <article className={styles.doc} aria-label={doc.title}>
            {doc.sections.map((s) => (
              <section key={s.id} id={s.id} className={styles.section} aria-labelledby={`${s.id}-title`}>
                <h2 id={`${s.id}-title`} className={styles.sectionTitle}>
                  {s.title}
                </h2>
                {s.body.map((block, i) => (
                  <Block key={i} block={block} />
                ))}
              </section>
            ))}
          </article>

          <OperatorCard />

          <nav className={styles.others} aria-label="Другие документы">
            <h2 className={styles.tocTitle}>Другие документы</h2>
            <ul>
              {LEGAL_DOCS.filter((d) => d.slug !== doc.slug).map((d) => (
                <li key={d.slug}>
                  <Link to={legalPath(d.slug)}>{d.title}</Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
    </PersonalPage>
  );
}

export default function LegalPage() {
  const { slug } = useParams();
  if (!slug) return <DocumentsIndex />;
  const doc = legalDoc(slug);
  if (!doc) return <Navigate to="/legal" replace />;
  return <Document key={doc.slug} doc={doc} />;
}
