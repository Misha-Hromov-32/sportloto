import { useCustom, type BaseRecord } from '@refinedev/core';
import { useCallback } from 'react';
import { useNavigate } from 'react-router';

import { useAction, useLiveGet, useLiveRefetch, type ApiError } from '@/lib/api';
import { PAYMENTS_API, PAYMENTS_LIVE } from '@/lib/payments';
import type {
  BalanceSummary,
  BalanceView,
  OrderView,
  PaymentInput,
  PaymentKind,
  PaymentView,
  QuoteView,
  SbpBank,
} from '@/types/payments';

function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Сумма по способам. При смене количества показываем прежний расчёт, пока считается новый. */
export function useQuote(kind: PaymentKind, targetId: string, quantity = 1, enabled = true) {
  const on = enabled && Boolean(targetId);
  const { query, result } = useCustom<BaseRecord>({
    url: `${PAYMENTS_API.quote}${qs({ kind, targetId, quantity: kind === 'item_order' ? quantity : undefined })}`,
    method: 'get',
    queryOptions: { enabled: on, retry: false, placeholderData: (prev) => prev },
    errorNotification: false,
  });
  useLiveRefetch(PAYMENTS_LIVE, () => {
    if (on) void query.refetch();
  });
  const data = result.data as unknown as QuoteView | undefined;
  return {
    data: data && Array.isArray(data.lines) ? data : null,
    isLoading: query.isLoading && on,
    isFetching: query.isFetching,
    isError: query.isError && !query.isPlaceholderData,
    refetch: query.refetch,
  };
}

/** Страница оплаты: внутренняя (тестовая) — переходом в приложении, банк — обычным переходом. */
export function useOpenConfirmation() {
  const navigate = useNavigate();
  return useCallback(
    (url: string) => {
      if (url.startsWith('/')) navigate(url);
      else window.location.assign(url);
    },
    [navigate],
  );
}

/** Создать платёж и сразу уйти на страницу оплаты. */
export function useStartPayment() {
  const { run, isPending } = useAction<PaymentView>();
  const open = useOpenConfirmation();
  const start = useCallback(
    async (input: PaymentInput) => {
      const payment = (await run(PAYMENTS_API.create, { ...input })) as unknown as PaymentView;
      if (payment.confirmationUrl) open(payment.confirmationUrl);
      return payment;
    },
    [run, open],
  );
  return { start, isPending };
}

/** Платёж; `pollWhile` — опрашивать каждые `poll` мс, пока условие верно. */
export function usePayment(id: string, poll = 0, pollWhile?: (payment: PaymentView | null) => boolean) {
  const { query, result } = useCustom<BaseRecord>({
    url: PAYMENTS_API.payment(id),
    method: 'get',
    queryOptions: {
      enabled: Boolean(id),
      retry: false,
      refetchInterval: (q) => {
        if (!poll) return false;
        const data = (q.state.data as { data?: PaymentView } | undefined)?.data ?? null;
        return !pollWhile || pollWhile(data) ? poll : false;
      },
    },
    errorNotification: false,
  });
  useLiveRefetch(PAYMENTS_LIVE, () => {
    if (id) void query.refetch();
  });
  return {
    payment: query.isSuccess && result.data ? (result.data as unknown as PaymentView) : null,
    isLoading: query.isLoading && Boolean(id),
    isError: query.isError,
    error: query.error as ApiError | null,
    refetch: query.refetch,
  };
}

export function useMyPayments(enabled = true) {
  return useLiveGet<PaymentView[]>(PAYMENTS_API.mine, PAYMENTS_LIVE, enabled);
}

export function useOrders(role: 'buyer' | 'seller', enabled = true) {
  return useLiveGet<OrderView[]>(`${PAYMENTS_API.orders}${qs({ role })}`, PAYMENTS_LIVE, enabled);
}

export function useBalances(enabled = true) {
  return useLiveGet<BalanceSummary[]>(PAYMENTS_API.balances, PAYMENTS_LIVE, enabled);
}

export function useBalance(owner: string) {
  return useLiveGet<BalanceView>(`${PAYMENTS_API.balance}${qs({ owner })}`, PAYMENTS_LIVE, Boolean(owner));
}

export function useSbpBanks(enabled = true) {
  return useLiveGet<SbpBank[]>(PAYMENTS_API.sbpBanks, [], enabled);
}

export function listOf<T>(data: T[] | null): T[] {
  return Array.isArray(data) ? data : [];
}
