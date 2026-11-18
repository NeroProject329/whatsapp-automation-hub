"use client";
import { useCallback, useEffect, useState } from "react";
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const res = await fetch("/api/" + path, {
    method,
    cache: "no-store",
    headers: data ? { "content-type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  const value = await res.json().catch(() => null);
  if (!res.ok)
    throw new ApiError(
      value?.error?.message ?? "Não foi possível concluir esta ação.",
      res.status,
    );
  return value as T;
}
export function useData<T>(path: string, interval = 0) {
  const [version, setVersion] = useState(0),
    [value, setValue] = useState<T>(),
    [error, setError] = useState("");
  const refresh = useCallback(() => setVersion((x) => x + 1), []);
  useEffect(() => {
    let active = true;
    let busy = false;
    const load = async () => {
      if (!path || busy) return;
      busy = true;
      try {
        const data = await api<T>(path);
        if (active) {
          setValue(data);
          setError("");
        }
      } catch (e) {
        if (active) setError(message(e));
      } finally {
        busy = false;
      }
    };
    void load();
    const timer = interval ? window.setInterval(load, interval) : null;
    return () => {
      active = false;
      if (timer) window.clearInterval(timer);
    };
  }, [path, interval, version]);
  return { value, error, refresh };
}
export function message(e: unknown) {
  return e instanceof Error ? e.message : "Não foi possível concluir.";
}
export function field(form: FormData, name: string) {
  return String(form.get(name) ?? "");
}
export const date = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
const statuses: Record<string, string> = {
  READY: "Pronto",
  OFFLINE: "Desconectado",
  OFF: "Desligado",
  CONNECTING: "Conectando",
  QR: "Aguardando QR",
  EXPIRED: "Vínculo expirado",
  ERROR: "Atenção",
  DRAFT: "Rascunho",
  SCHEDULED: "Agendada",
  RUNNING: "Em andamento",
  PAUSED: "Pausada",
  CANCELLED: "Cancelada",
  COMPLETED: "Concluída",
  PENDING: "Pendente",
  DISPATCHING: "Em trânsito",
  SUBMITTED: "Submetida",
  SENT: "Aceita pelo canal",
  DELIVERED: "Entregue",
  READ: "Lida",
  FAILED: "Falha",
  UNKNOWN: "Resultado incerto",
  SUPPRESSED: "Bloqueada",
  eligible: "Elegível",
  blocked: "Suprimido",
  "no-consent": "Sem consentimento",
  INBOUND: "Recebida",
  OPT_OUT: "Descadastro",
  MARKETING: "Campanha",
  TEST: "Teste",
  valid: "Válida",
  invalid: "Inválida",
  duplicate: "Duplicada",
};
export const label = (status: string) => statuses[status] ?? status;
export type Contact = {
  id: string;
  name: string;
  phone: string;
  status: string;
  attributes: Record<string, string>;
  tags: string[];
  consents?: {
    id: string;
    source: string;
    evidence: string;
    grantedAt: string;
    revokedAt?: string;
  }[];
  suppression?: { reason: string; at: string } | null;
};
export type ContactList = { items: Contact[]; total: number; limited: boolean };
export type Connection = {
  id: string;
  label: string;
  provider: string;
  state: string;
  desired: string;
  lastError?: string;
  lastSeen?: string;
  accountPhone?: string;
  qr?: string;
};
export type Campaign = {
  id: string;
  name: string;
  state: string;
  scheduledAt: string;
  timezone: string;
  body: string;
  audience: string[];
  connectionId: string;
  windowStart: number;
  windowEnd: number;
  connection?: { label: string };
  results?: Record<string, number>;
};
export type Template = {
  id: string;
  name: string;
  version: number;
  body: string;
};
export type Dispatch = {
  id: string;
  phone?: string;
  state: string;
  kind?: string;
  code?: string;
  submittedAt?: string;
  deliveredAt?: string;
  createdAt?: string;
};
