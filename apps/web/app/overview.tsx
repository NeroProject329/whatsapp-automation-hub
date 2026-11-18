"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Radio } from "lucide-react";
import { date, useData } from "./client";
import type { Campaign, Connection, Dispatch } from "./client";
import {
  Empty,
  Heading,
  Loading,
  Notice,
  Pager,
  Status,
  Table,
} from "./components";
type Dashboard = {
  campaigns: Campaign[];
  connections: Record<string, number>;
  states: Record<string, number>;
  eligible: number;
  inbound: number;
  optouts: number;
  receipts: number;
  activeCampaigns: number;
  pending: number;
  holds: number;
  pace: { day: string; accepted: number; delivered: number; failed: number }[];
  workerAlive: boolean;
};
export function Overview({ report = false }: { report?: boolean }) {
  const [days, setDays] = useState(7),
    [sender, setSender] = useState(""),
    [campaign, setCampaign] = useState("");
  const { value: d, error } = useData<Dashboard>(
    "dashboard?" +
      new URLSearchParams({
        days: String(days),
        ...(sender ? { connectionId: sender } : {}),
        ...(campaign ? { campaignId: campaign } : {}),
      }),
    4000,
  );
  const connections = useData<Connection[]>("connections"),
    campaigns = useData<Campaign[]>("campaigns");
  const s = d?.states ?? {};
  const accepted = d?.pace.reduce((sum, x) => sum + x.accepted, 0) ?? 0;
  const data = d?.pace ?? [];
  const max = Math.max(
    1,
    ...data.map((x) => Math.max(x.accepted, x.delivered, x.failed)),
  );
  const bars = Array.from({ length: days }, (_, i) => {
    const t = new Date(Date.now() - (days - 1 - i) * 86400000)
      .toISOString()
      .slice(0, 10);
    return {
      t,
      ...(data.find((d) => d.day.slice(0, 10) === t) ?? {
        accepted: 0,
        delivered: 0,
        failed: 0,
      }),
    };
  });
  return (
    <>
      <Heading
        title={report ? "Relatórios" : "Visão geral"}
        subtitle={
          report
            ? "Acompanhe os resultados confirmados e filtre a atividade."
            : "Acompanhe conexões, campanhas e mensagens em um só lugar."
        }
        actions={
          !report ? (
            <Link className="button primary" href="/campaigns/new">
              Nova campanha <ArrowUpRight size={16} />
            </Link>
          ) : undefined
        }
      />
      <Notice text={error} />
      {!d ? (
        <Loading />
      ) : (
        <>
          <Notice
            text={
              d.holds
                ? "Há pedidos de descadastro sem telefone confirmado. Os disparos de campanhas estão em pausa."
                : ""
            }
          />
          <div className="monitor">
            <div>
              <Radio size={18} />
              <strong>Estado da operação</strong>
              <span className={d.workerAlive ? "monitor-ok" : "monitor-off"}>
                <i />
                {d.workerAlive ? "Worker ativo" : "Worker indisponível"}
              </span>
            </div>
            <Link href="/connections">
              {d.connections.READY ?? 0}{" "}
              {d.connections.READY === 1
                ? "conexão pronta"
                : "conexões prontas"}{" "}
              <ArrowUpRight size={14} />
            </Link>
          </div>
          <dl className="metrics">
            {[
              [d.eligible, "Contatos elegíveis"],
              [d.pending, "Na fila"],
              [accepted, "Submetidas"],
              [d.receipts, "Entregas confirmadas"],
              [(s.FAILED ?? 0) + (s.UNKNOWN ?? 0), "Falhas ou incertas"],
              [d.optouts, "Descadastros"],
            ].map(([number, title]) => (
              <div key={title}>
                <dt>{title}</dt>
                <dd>{Number(number).toLocaleString("pt-BR")}</dd>
              </div>
            ))}
          </dl>
          <section className="panel activity">
            <div className="panel-title">
              <div>
                <h2>Atividade de envio</h2>
                <p>{d.inbound} mensagens recebidas no período · datas em UTC</p>
              </div>
              <div className="actions">
                {report && (
                  <>
                    <select
                      aria-label="Remetente"
                      value={sender}
                      onChange={(e) => setSender(e.target.value)}
                    >
                      <option value="">Todos os remetentes</option>
                      {connections.value?.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Campanha"
                      value={campaign}
                      onChange={(e) => setCampaign(e.target.value)}
                    >
                      <option value="">Todas as campanhas</option>
                      {campaigns.value?.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <select
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  aria-label="Período"
                >
                  <option value={7}>Últimos 7 dias</option>
                  <option value={14}>Últimos 14 dias</option>
                  <option value={30}>Últimos 30 dias</option>
                </select>
              </div>
            </div>
            <div className="chart-legend">
              <span>
                <i /> Submetidas
              </span>
              <span>
                <i /> Entregues
              </span>
              <span>
                <i /> Falhas / incertas
              </span>
            </div>
            <div className="chart" aria-label="Gráfico diário de mensagens">
              {bars.map((b, i) => (
                <div
                  key={b.t}
                  className="chart-day"
                  title={
                    b.t +
                    ": " +
                    b.accepted +
                    " submetidas, " +
                    b.delivered +
                    " entregues, " +
                    b.failed +
                    " falhas ou incertas"
                  }
                >
                  <div className="chart-bars">
                    {[b.accepted, b.delivered, b.failed].map((v, k) => (
                      <span
                        key={k}
                        style={{
                          height: (v ? Math.max(2, (100 * v) / max) : 0) + "%",
                        }}
                      />
                    ))}
                  </div>
                  <small>
                    {days < 15 || i % 5 === 0
                      ? b.t.slice(8) + "/" + b.t.slice(5, 7)
                      : ""}
                  </small>
                </div>
              ))}
            </div>
            <p className="footnote">
              Submissão ao canal e entrega são fatos distintos. A entrega só
              aparece quando confirmada pelo WhatsApp.
            </p>
          </section>
          <section className="panel recent">
            <div className="panel-title">
              <div>
                <h2>Campanhas recentes</h2>
                <p>{d.activeCampaigns} agendadas ou em andamento.</p>
              </div>
              <Link className="button" href="/campaigns">
                Ver campanhas <ArrowUpRight size={15} />
              </Link>
            </div>
            {d.campaigns.length ? (
              <Table headers={["Campanha", "Situação", "Agendada para"]}>
                {d.campaigns.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={"/campaigns/" + c.id}>{c.name}</Link>
                    </td>
                    <td>
                      <Status value={c.state} />
                    </td>
                    <td>{date(c.scheduledAt)}</td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty
                title="Nenhuma campanha registrada"
                description="Crie uma campanha para preparar a mensagem, selecionar o público e conferir a prévia."
              />
            )}
          </section>
          {report && <Outgoing />}
        </>
      )}
    </>
  );
}
function Outgoing() {
  const [p, set] = useState(1);
  const { value, error } = useData<Dispatch[]>("messages?page=" + p, 4500);
  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <h2>Histórico geral de envios</h2>
          <p>Campanhas, envios de teste e confirmações de descadastro.</p>
        </div>
      </div>
      <Notice text={error} />
      {!value ? (
        <Loading />
      ) : value.length ? (
        <Table
          headers={[
            "Tipo",
            "Número",
            "Situação",
            "Registrada em",
            "Diagnóstico",
          ]}
        >
          {value.map((x) => (
            <tr key={x.id}>
              <td>{x.kind && <Status value={x.kind} />}</td>
              <td>{x.phone ?? "—"}</td>
              <td>
                <Status value={x.state} />
              </td>
              <td>{date(x.createdAt)}</td>
              <td>{x.code ?? "—"}</td>
            </tr>
          ))}
        </Table>
      ) : (
        <Empty
          title="Nenhum envio nesta página"
          description="Envios enfileirados e resultados aparecem aqui."
        />
      )}
      <Pager page={p} set={set} more={value?.length === 50} />
    </section>
  );
}
export function Logs() {
  const [p, set] = useState(1);
  const { value, error } = useData<
    {
      id: string;
      action: string;
      entity: string;
      entityId: string;
      code?: string;
      actor: string;
      at: string;
    }[]
  >("logs?page=" + p, 5000);
  return (
    <>
      <Heading
        title="Auditoria"
        subtitle="Ações administrativas, alterações de conexão e registros de execução."
      />
      <Notice text={error} />
      <section className="panel">
        {!value ? (
          <Loading />
        ) : value.length ? (
          <Table headers={["Data", "Ação", "Ator", "Referência", "Código"]}>
            {value.map((r) => (
              <tr key={r.id}>
                <td>{date(r.at)}</td>
                <td>{r.action}</td>
                <td title={r.actor}>
                  {r.actor.length > 12 ? r.actor.slice(0, 8) : r.actor}
                </td>
                <td title={r.entityId}>
                  {r.entity} · {r.entityId.slice(0, 8)}
                </td>
                <td>{r.code ?? "—"}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty
            title="Sem registros nesta página"
            description="Novas ações aparecem aqui automaticamente."
          />
        )}
        <Pager page={p} set={set} more={value?.length === 50} />
      </section>
    </>
  );
}
const mediaLabels: Record<string, string> = {
  IMAGE: "Imagem recebida",
  VIDEO: "Vídeo recebido",
  AUDIO: "Áudio recebido",
  DOCUMENT: "Documento recebido",
  STICKER: "Figurinha recebida",
};

export function InboxView() {
  const [p, set] = useState(1);
  const { value, error } = useData<
    {
      id: string;
      kind: string;
      connectionId: string;
      contactId?: string;
      text?: string;
      contentType?: string | null;
      occurredAt: string;
    }[]
  >("events?page=" + p, 4000);
  return (
    <>
      <Heading
        title="Mensagens recebidas"
        subtitle="Consulte respostas, pedidos de descadastro e confirmações do canal."
      />
      <Notice text={error} />
      <section className="panel">
        {!value ? (
          <Loading />
        ) : value.length ? (
          <Table headers={["Data", "Evento", "Contato", "Conteúdo"]}>
            {value.map((r) => (
              <tr key={r.id}>
                <td>{date(r.occurredAt)}</td>
                <td>
                  <Status value={r.kind} />
                </td>
                <td>
                  {r.contactId ? (
                    <Link href={"/contacts/" + r.contactId}>Abrir contato</Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="message-cell">
                  {r.contentType && mediaLabels[r.contentType] && (
                    <strong>{mediaLabels[r.contentType]}</strong>
                  )}
                  {r.text && <div>{r.text}</div>}
                  {!r.text &&
                    !(r.contentType && mediaLabels[r.contentType]) &&
                    "—"}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty
            title="Nenhum evento nesta página"
            description="Mensagens recebidas e descadastros aparecem aqui."
          />
        )}
        <Pager page={p} set={set} more={value?.length === 50} />
      </section>
    </>
  );
}
export function SettingsView() {
  const { value, error } = useData<{
    provider: string;
    realSendEnabled: boolean;
    testNumbersConfigured: number;
    sendIntervalMs: number;
  }>("settings");
  return (
    <>
      <Heading
        title="Configurações"
        subtitle="Confira o provedor e as permissões ativas neste ambiente."
      />
      <Notice text={error} />
      <section className="panel form-panel">
        {!value ? (
          <Loading />
        ) : (
          <dl className="settings">
            <div>
              <dt>Provedor</dt>
              <dd>
                {value.provider === "fake" ? "Simulador local" : value.provider}
              </dd>
            </div>
            <div>
              <dt>Envios reais</dt>
              <dd>{value.realSendEnabled ? "Habilitados" : "Desabilitados"}</dd>
            </div>
            <div>
              <dt>Números de teste autorizados</dt>
              <dd>{value.testNumbersConfigured}</dd>
            </div>
            <div>
              <dt>Intervalo entre tarefas</dt>
              <dd>{value.sendIntervalMs / 1000} s</dd>
            </div>
          </dl>
        )}
        <a
          href="/api/openapi.json"
          className="button"
          target="_blank"
          rel="noreferrer"
        >
          Abrir OpenAPI <ArrowUpRight size={14} />
        </a>
      </section>
    </>
  );
}
