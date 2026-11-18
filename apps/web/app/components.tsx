"use client";
import { AlertCircle, ArrowLeft, ArrowRight, Inbox } from "lucide-react";
import { label } from "./client";
export function Heading({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="heading">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}
export function Status({ value }: { value: string }) {
  const positive = [
    "READY",
    "RUNNING",
    "eligible",
    "DELIVERED",
    "READ",
    "SENT",
    "valid",
  ].includes(value);
  const negative = [
    "ERROR",
    "FAILED",
    "blocked",
    "SUPPRESSED",
    "invalid",
    "EXPIRED",
    "UNKNOWN",
  ].includes(value);
  return (
    <span
      className={
        "status " +
        (positive
          ? "positive"
          : negative
            ? "negative"
            : ["PENDING", "PAUSED", "SCHEDULED", "QR", "CONNECTING"].includes(
                  value,
                )
              ? "pending"
              : "")
      }
    >
      <i />
      {label(value)}
    </span>
  );
}
export function Notice({
  text,
  good = false,
}: {
  text: string;
  good?: boolean;
}) {
  return text ? (
    <div
      className={"notice " + (good ? "ok" : "")}
      role={good ? "status" : "alert"}
    >
      <AlertCircle size={17} />
      {text}
    </div>
  ) : null;
}
export function Empty({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="empty">
      <Inbox size={26} strokeWidth={1.4} />
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      Carregando…
    </div>
  );
}
export function Table({
  headers,
  children,
}: {
  headers: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export function Pager({
  page,
  set,
  more,
}: {
  page: number;
  set: (n: number) => void;
  more: boolean;
}) {
  return (
    <div className="pager">
      <button
        aria-label="Página anterior"
        disabled={page <= 1}
        onClick={() => set(page - 1)}
      >
        <ArrowLeft size={16} />
      </button>
      <span>Página {page}</span>
      <button
        aria-label="Próxima página"
        disabled={!more}
        onClick={() => set(page + 1)}
      >
        <ArrowRight size={16} />
      </button>
    </div>
  );
}
