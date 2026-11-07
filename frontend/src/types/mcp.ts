import type { ID, ISODate } from './domain';

/** В1. Подключение внешнего ассистента по протоколу MCP: личные токены, журнал, формат JSON-RPC. */

/** Права токена: чтение есть всегда, запись на события и черновики выдаются отдельно. */
export type McpScope = 'read' | 'participate' | 'drafts';

/** Запись журнала: что вызвали и чем кончилось, без аргументов и ответа. */
export interface McpCall {
  id: ID;
  tokenId: ID;
  userId: ID;
  at: ISODate;
  method: string;
  tool: string | null;
  ok: boolean;
  /** Изменяющий инструмент вызван без `confirm: true`: показан предпросмотр, данные не менялись. */
  preview?: boolean;
  error: string | null;
}

export type McpTokenStatus = 'active' | 'revoked' | 'expired';

export interface McpTokenView {
  id: ID;
  name: string;
  scopes: McpScope[];
  last4: string;
  createdAt: ISODate;
  expiresAt: ISODate | null;
  lastUsedAt: ISODate | null;
  revokedAt: ISODate | null;
  status: McpTokenStatus;
  calls: number;
}

export interface McpTokenInput {
  name: string;
  scopes: McpScope[];
  /** 30, 90 или 365. */
  expiresInDays: number;
}

export interface McpIssued {
  token: McpTokenView;
  /** Полный токен. Возвращается только в ответе на выпуск. */
  secret: string;
}

export interface McpCallView extends McpCall {
  tokenName: string;
  /** Понятное название вызова: заголовок инструмента или метода. */
  label: string;
}

// ---------- Формат протокола ----------

export interface JsonSchema {
  type?: 'object' | 'string' | 'integer' | 'number' | 'boolean' | 'array';
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  enum?: (string | number)[];
  /** Подписи вариантов `enum` по-русски, в том же порядке. */
  enumNames?: string[];
  items?: JsonSchema;
  format?: 'date';
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  default?: unknown;
  examples?: unknown[];
}

export interface McpToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema & { type: 'object' };
  annotations: McpToolAnnotations;
  _meta: { scope: McpScope; confirm: boolean };
}

export interface McpResource {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
}

export interface McpCatalog {
  protocolVersion: string;
  serverInfo: { name: string; title: string; version: string };
  endpointPath: string;
  transport: string;
  limits: { callsPerMinute: number; activeTokens: number };
  tools: McpTool[];
  resources: McpResource[];
  scopes: { value: McpScope; label: string; hint: string }[];
  expiryDays: number[];
}

export type JsonRpcId = string | number | null;

export interface JsonRpcError {
  code: number;
  message: string;
  data?: Record<string, unknown>;
}

export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId; result: Record<string, unknown> }
  | { jsonrpc: '2.0'; id: JsonRpcId; error: JsonRpcError };

export interface McpToolResult {
  content: { type: 'text'; text: string }[];
  structuredContent: Record<string, unknown>;
  isError: boolean;
}

export interface McpExchange {
  httpStatus: number;
  /** null — уведомление, ответ не нужен (HTTP 202). */
  response: JsonRpcResponse | null;
}
