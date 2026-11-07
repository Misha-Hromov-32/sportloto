import { useLiveGet } from '@/lib/api';
import type { McpCallView, McpCatalog, McpTokenView } from '@/types/mcp';

/** В1. Адреса REST для подключения ассистента; контракт — docs/architecture/mcp.md. */
export const MCP_API = {
  catalog: '/mcp/catalog',
  /** GET — свои токены, POST `McpTokenInput` → `McpIssued`. */
  tokens: '/mcp/tokens',
  revoke: (id: string) => `/mcp/tokens/${id}/revoke`,
  /** GET `?tokenId` — журнал вызовов владельца. */
  calls: '/mcp/calls',
  /** POST `{ authorization, message }` → `McpExchange`: точка протокола. */
  endpoint: '/mcp',
} as const;

const LIVE = ['mcp', 'demo'];

export function useMcpCatalog() {
  return useLiveGet<McpCatalog>(MCP_API.catalog, []);
}

export function useMcpTokens() {
  return useLiveGet<McpTokenView[]>(MCP_API.tokens, LIVE);
}

export function useMcpCalls() {
  return useLiveGet<McpCallView[]>(MCP_API.calls, LIVE);
}
