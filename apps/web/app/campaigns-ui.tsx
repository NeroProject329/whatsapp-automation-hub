"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Search } from "lucide-react";
import { api, date, field, label, message, useData } from "./client";
import type {
  Campaign,
  Connection,
  ContactList,
  Dispatch,
  Template,
} from "./client";
import {
  Empty,
  Heading,
  Loading,
  Notice,
  Pager,
  Status,
  Table,
} from "./components";
type Preview = {
  token: string;
  counts: {
    eligible: number;
    missing: number;
    noConsent: number;
    suppressed: number;
    invalid: number;
  };
  sample: string[];
  errors: { id: string; variables: string[] }[];
};
const minute = (a: string) =>
  Number(a.slice(0, 2)) * 60 + Number(a.slice(3, 5));
const hhmm = (a: number) =>
  a === 1440
    ? "23:59"
    : String(Math.floor(a / 60)).padStart(2, "0") +
      ":" +
      String(a % 60).padStart(2, "0");
function asLocal(value: string) {
  const d = new Date(value);
  return new Date(+d - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function CampaignForm({
  existing,
  done,
}: {
  existing?: Campaign;
  done?: () => void;
}) {
  const router = useRouter();
  const sender = useData<Connection[]>("connections"),
    templates = useData<Template[]>("templates");
  const [q, setQ] = useState(""),
    [body, setBody] = useState(existing?.body ?? ""),
    [template, setTemplate] = useState(""),
    [chosen, setChosen] = useState<Record<string, string>>(
      Object.fromEntries(
        (existing?.audience ?? []).map((id) => [
          id,
          "Contato " + id.slice(0, 8),
        ]),
      ),
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const contacts = useData<ContactList>(
    "contacts?" + new URLSearchParams({ q }),
  );
  const ids = Object.keys(chosen);
  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        try {
          if (!ids.length) throw Error("Selecione pelo menos um contato.");
          const c = await api<Campaign>(
            existing ? "campaigns/" + existing.id : "campaigns",
            existing ? "PATCH" : "POST",
            {
              name: field(f, "name"),
              connectionId: field(f, "connection"),
              contactIds: ids,
              body: template ? undefined : body,
              templateId: template || undefined,
              scheduledAt: new Date(field(f, "start")).toISOString(),
              timezone: field(f, "timezone"),
              windowStart: minute(field(f, "windowStart")),
              windowEnd: f.has("wholeDay")
                ? 1440
                : minute(field(f, "windowEnd")),
            },
          );
          if (done) done();
          else router.push("/campaigns/" + c.id);
        } catch (e) {
          setError(message(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Notice
        text={error || sender.error || contacts.error || templates.error}
      />
      <div className="field-row">
        <label>
          Nome da campanha
          <input
            required
            name="name"
            minLength={2}
            maxLength={100}
            defaultValue={existing?.name}
          />
        </label>
        <label>
          Remetente
          <select
            key={sender.value ? "loaded" : "loading"}
            defaultValue={existing?.connectionId ?? ""}
            required
            name="connection"
          >
            <option value="">Selecione a conexão</option>
            {sender.value?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} · {label(c.state)}
              </option>
            ))}
          </select>
          {sender.value?.length === 0 && (
            <Link href="/connections">Cadastre um remetente primeiro</Link>
          )}
        </label>
      </div>
      <fieldset>
        <legend>Público · {ids.length} selecionado(s)</legend>
        <label className="search">
          <Search size={16} />
          <input
            aria-label="Buscar contatos para a campanha"
            placeholder="Buscar contatos"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <div className="recipient-list">
          {contacts.value?.items.map((c) => (
            <label className="check" key={c.id}>
              <input
                type="checkbox"
                checked={Object.hasOwn(chosen, c.id)}
                disabled={ids.length >= 500 && !Object.hasOwn(chosen, c.id)}
                onChange={(e) => {
                  const change = { ...chosen };
                  if (e.target.checked) change[c.id] = c.name || c.phone;
                  else delete change[c.id];
                  setChosen(change);
                }}
              />
              <span>
                {c.name || c.phone} <small>{c.phone}</small>
              </span>
              <Status value={c.status} />
            </label>
          ))}
          {!!contacts.value && !contacts.value.items.length && (
            <p>Nenhum contato encontrado.</p>
          )}
        </div>
        {ids.length > 0 && (
          <details>
            <summary>Revisar seleção atual</summary>
            <ul className="selection">
              {ids.map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => {
                      const next = { ...chosen };
                      delete next[id];
                      setChosen(next);
                    }}
                  >
                    {chosen[id]} · remover
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </fieldset>
      <label>
        Modelo de mensagem
        <select
          value={template}
          onChange={(e) => {
            setTemplate(e.target.value);
          }}
        >
          <option value="">Escrever nova mensagem</option>
          {templates.value?.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name} · v{x.version}
            </option>
          ))}
        </select>
      </label>
      <label>
        Mensagem
        <textarea
          required
          rows={5}
          maxLength={4000}
          value={
            template
              ? (templates.value?.find((t) => t.id === template)?.body ?? "")
              : body
          }
          readOnly={!!template}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Olá, {{nome}}!"
        />
        <small>
          Use {"{{nome}}"}, {"{{telefone}}"} ou campos personalizados. A
          orientação de descadastro é incluída automaticamente.
        </small>
      </label>
      <div className="field-row">
        <label>
          Agendar para (horário deste dispositivo)
          <input
            name="start"
            type="datetime-local"
            defaultValue={existing ? asLocal(existing.scheduledAt) : undefined}
            required
          />
        </label>
        <label>
          Fuso da janela de envio
          <input
            name="timezone"
            required
            defaultValue={existing?.timezone ?? "America/Sao_Paulo"}
          />
        </label>
      </div>
      <div className="field-row">
        <label>
          Início da janela de envio
          <input
            required
            name="windowStart"
            type="time"
            defaultValue={hhmm(existing?.windowStart ?? 540)}
          />
        </label>
        <label>
          Fim da janela de envio
          <input
            required
            name="windowEnd"
            type="time"
            defaultValue={hhmm(existing?.windowEnd ?? 1080)}
          />
        </label>
      </div>
      <label className="check">
        <input
          name="wholeDay"
          type="checkbox"
          defaultChecked={existing?.windowEnd === 1440}
        />{" "}
        Usar 00:00 do dia seguinte como fim da janela.
      </label>
      <div className="actions">
        <button className="primary" disabled={busy}>
          {existing ? "Salvar e exigir nova aprovação" : "Salvar rascunho"}
        </button>
      </div>
    </form>
  );
}
export function Campaigns({ startNew = false }: { startNew?: boolean }) {
  const [adding, setAdding] = useState(startNew),
    [page, setPage] = useState(1);
  const { value: c, error } = useData<Campaign[]>(
    "campaigns?page=" + page,
    4000,
  );
  return (
    <>
      <Heading
        title="Campanhas"
        subtitle="Prepare, aprove e acompanhe envios para contatos autorizados."
        actions={
          <button
            className="primary"
            onClick={() => setAdding(!adding)}
            aria-expanded={adding}
          >
            <Plus size={16} /> Nova campanha
          </button>
        }
      />
      <Notice text={error} />
      {adding && (
        <section className="panel form-panel">
          <h2>Novo rascunho</h2>
          <CampaignForm />
        </section>
      )}
      <section className="panel">
        {!c ? (
          <Loading />
        ) : c.length ? (
          <Table headers={["Campanha", "Remetente", "Agendamento", "Situação"]}>
            {c.map((x) => (
              <tr key={x.id}>
                <td>
                  <Link href={"/campaigns/" + x.id}>{x.name}</Link>
                </td>
                <td>{x.connection?.label ?? "—"}</td>
                <td>{date(x.scheduledAt)}</td>
                <td>
                  <Status value={x.state} />
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty
            title="Nenhuma campanha nesta página"
            description="Crie um rascunho para configurar a mensagem e o público."
          />
        )}
        <Pager page={page} set={setPage} more={c?.length === 50} />
      </section>
    </>
  );
}
const actions: Record<string, string> = {
  approve: "Aprovar prévia",
  activate: "Ativar campanha",
  pause: "Pausar",
  resume: "Retomar",
  cancel: "Cancelar campanha",
};
export function CampaignView({ id }: { id: string }) {
  const base = "campaigns/" + encodeURIComponent(id);
  const { value: c, error, refresh } = useData<Campaign>(base, 3000);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(false);
  const msgs = useData<Dispatch[]>(base + "/messages?page=" + page, 3000);
  const [preview, setPreview] = useState<Preview>(),
    [checked, setChecked] = useState(false),
    [confirm, setConfirm] = useState(""),
    [failure, setFailure] = useState(""),
    [ok, setOk] = useState(""),
    [busy, setBusy] = useState(false);
  const run = async (action: string, data?: unknown) => {
    setBusy(true);
    setFailure("");
    setOk("");
    try {
      await api(base + "/" + action, "POST", data);
      setOk("Ação registrada: " + actions[action] + ".");
      setConfirm("");
      setChecked(false);
      refresh();
      msgs.refresh();
    } catch (e) {
      setFailure(message(e));
    } finally {
      setBusy(false);
    }
  };
  const getPreview = async () => {
    setBusy(true);
    setFailure("");
    setChecked(false);
    try {
      setPreview(await api<Preview>(base + "/preview"));
    } catch (e) {
      setFailure(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Link className="back" href="/campaigns">
        <ArrowLeft size={16} /> Campanhas
      </Link>
      <Heading
        title={c?.name ?? "Campanha"}
        subtitle={
          c
            ? "Agendada para " +
              date(c.scheduledAt) +
              " · janela em " +
              c.timezone
            : "Prévia e acompanhamento"
        }
        actions={c ? <Status value={c.state} /> : undefined}
      />
      <Notice text={error || failure || msgs.error} />
      <Notice text={ok} good />
      {!c ? (
        <Loading />
      ) : (
        <>
          {editing && (
            <section className="panel form-panel">
              <h2>Editar rascunho</h2>
              <CampaignForm
                existing={c}
                done={() => {
                  setEditing(false);
                  setPreview(undefined);
                  setChecked(false);
                  refresh();
                }}
              />
            </section>
          )}
          <section className="panel form-panel">
            <h2>Mensagem e aprovação</h2>
            <pre className="bubble">{c.body}</pre>
            <div className="actions">
              <button disabled={busy} onClick={() => void getPreview()}>
                Gerar prévia
              </button>
              {["DRAFT", "READY"].includes(c.state) && (
                <button
                  disabled={busy}
                  aria-expanded={editing}
                  onClick={() => setEditing(!editing)}
                >
                  Editar campanha
                </button>
              )}
              {c.state === "READY" && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => setConfirm("activate")}
                >
                  {actions.activate}
                </button>
              )}
              {["RUNNING", "SCHEDULED"].includes(c.state) && (
                <button disabled={busy} onClick={() => void run("pause")}>
                  {actions.pause}
                </button>
              )}
              {c.state === "PAUSED" && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void run("resume")}
                >
                  {actions.resume}
                </button>
              )}
              {["DRAFT", "READY", "RUNNING", "SCHEDULED", "PAUSED"].includes(
                c.state,
              ) && (
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() => setConfirm("cancel")}
                >
                  {actions.cancel}
                </button>
              )}
            </div>
            {confirm && (
              <div className="confirm">
                <p>
                  {confirm === "cancel"
                    ? "Cancelar envios pendentes? Mensagens em trânsito não podem ser recolhidas."
                    : "Autoriza a execução para o público aprovado, dentro da janela de envio?"}
                </p>
                <div className="actions">
                  <button onClick={() => setConfirm("")}>Voltar</button>
                  <button
                    className={confirm === "cancel" ? "danger" : "primary"}
                    disabled={busy}
                    onClick={() => void run(confirm, { confirmed: true })}
                  >
                    Confirmar
                  </button>
                </div>
              </div>
            )}
            {preview && (
              <div className="preview">
                <h3>Prévia do público</h3>
                <p>
                  {preview.counts.eligible} elegíveis ·{" "}
                  {preview.counts.noConsent} sem consentimento ·{" "}
                  {preview.counts.suppressed} suprimidos ·{" "}
                  {preview.counts.missing} indisponíveis ·{" "}
                  {preview.counts.invalid} com variáveis inválidas
                </p>
                {preview.sample.map((text, i) => (
                  <pre key={i} className="bubble">
                    {text}
                  </pre>
                ))}
                {!!preview.errors.length && (
                  <p>
                    Campos a corrigir:{" "}
                    {[
                      ...new Set(preview.errors.flatMap((r) => r.variables)),
                    ].join(", ")}
                    .
                  </p>
                )}
                {c.state === "DRAFT" && (
                  <>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setChecked(e.target.checked)}
                      />{" "}
                      Conferi a amostra e os {preview.counts.eligible}{" "}
                      destinatários elegíveis.
                    </label>
                    <button
                      className="primary"
                      disabled={
                        busy ||
                        !checked ||
                        !preview.counts.eligible ||
                        !!preview.counts.invalid
                      }
                      onClick={() =>
                        void run("approve", {
                          token: preview.token,
                          count: preview.counts.eligible,
                          confirmed: true,
                        })
                      }
                    >
                      {actions.approve}
                    </button>
                  </>
                )}
              </div>
            )}
          </section>
          <section className="panel form-panel">
            <h2>Envio individual de teste</h2>
            <p>
              Use um número autorizado para testar a mensagem. Confira o
              resultado em{" "}
              <Link className="back" href="/reports">
                Relatórios
              </Link>
              .
            </p>
            <form
              className="form-grid"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                setBusy(true);
                setFailure("");
                setOk("");
                try {
                  await api(base + "/test-send", "POST", {
                    phone: field(f, "phone"),
                    requestId: crypto.randomUUID(),
                  });
                  setOk("Teste enviado à fila.");
                } catch (e) {
                  setFailure(message(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Número autorizado
                <input name="phone" type="tel" required />
              </label>
              <div className="actions">
                <button disabled={busy}>Enfileirar teste</button>
              </div>
            </form>
          </section>
          <section className="panel">
            <div className="panel-title">
              <div>
                <h2>Destinatários</h2>
                <p>
                  {Object.entries(c.results ?? {})
                    .map(([k, v]) => v + " " + label(k).toLowerCase())
                    .join(" · ") || "Aguardando agendamento."}
                </p>
              </div>
            </div>
            {msgs.value?.length ? (
              <Table
                headers={[
                  "Número",
                  "Estado",
                  "Submissão",
                  "Entrega confirmada",
                  "Diagnóstico",
                ]}
              >
                {msgs.value.map((m) => (
                  <tr key={m.id}>
                    <td>{m.phone ?? "—"}</td>
                    <td>
                      <Status value={m.state} />
                    </td>
                    <td>{date(m.submittedAt)}</td>
                    <td>{date(m.deliveredAt)}</td>
                    <td>{m.code ?? "—"}</td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty
                title="Nenhuma mensagem nesta página"
                description="Os registros entram no histórico quando a campanha é ativada."
              />
            )}
            <Pager page={page} set={setPage} more={msgs.value?.length === 50} />
          </section>
        </>
      )}
    </>
  );
}
export function Templates() {
  const { value, error, refresh } = useData<Template[]>("templates");
  const [failure, setFailure] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false);
  return (
    <>
      <Heading
        title="Modelos de mensagem"
        subtitle="Guarde textos reutilizáveis com histórico de versões."
        actions={
          <button
            className="primary"
            onClick={() => setEditing(!editing)}
            aria-expanded={editing}
          >
            <Plus size={16} /> Criar modelo
          </button>
        }
      />
      <Notice text={failure || error} />
      {editing && (
        <section className="panel form-panel">
          <h2>Nova versão</h2>
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              setFailure("");
              try {
                await api("templates", "POST", {
                  name: field(f, "name"),
                  body: field(f, "body"),
                });
                setEditing(false);
                refresh();
              } catch (e) {
                setFailure(message(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Nome
              <input name="name" required minLength={2} maxLength={80} />
              <small>
                Repita o nome de um modelo para adicionar uma versão.
              </small>
            </label>
            <label>
              Texto
              <textarea
                name="body"
                required
                rows={5}
                maxLength={4000}
                placeholder="Olá, {{nome}}!"
              />
            </label>
            <div className="actions">
              <button className="primary" disabled={busy}>
                Salvar modelo
              </button>
            </div>
          </form>
        </section>
      )}
      <section className="panel">
        {!value ? (
          <Loading />
        ) : value.length ? (
          <Table headers={["Nome", "Versão", "Mensagem"]}>
            {value.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>v{t.version}</td>
                <td className="message-cell">{t.body}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty
            title="Nenhum modelo cadastrado"
            description="Crie um modelo para reaproveitar o mesmo texto em campanhas futuras."
          />
        )}
      </section>
    </>
  );
}
