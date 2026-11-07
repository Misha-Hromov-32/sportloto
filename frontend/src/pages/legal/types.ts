/** Абзац, список или пары «что — зачем» (таблица из двух колонок). */
export type LegalBlock = string | { list: string[] } | { rows: [string, string][]; head: [string, string] };

export interface LegalSection {
  id: string;
  title: string;
  body: LegalBlock[];
}

export interface LegalDoc {
  slug: string;
  title: string;
  /** Для списка документов и подсказок под формами. */
  short: string;
  /** «Коротко»: главное простыми словами, до чтения полного текста. */
  summary: string[];
  sections: LegalSection[];
}
