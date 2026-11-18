"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Search, Upload } from "lucide-react";
import { api, date, field, message, useData } from "./client";
import type { Contact, ContactList } from "./client";
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
  id: string;
  columns: string[];
  valid: number;
  rows: { row: number; name?: string; phone?: string; status: string }[];
};
function ContactForm({
  contact,
  done,
}: {
  contact?: Contact;
  done: (c: Contact) => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        try {
          const attributes = Object.fromEntries(
            field(f, "attributes")
              .split("\n")
              .filter((x) => x.trim())
              .map((x) => {
                const i = x.indexOf("=");
                if (i < 1) throw Error("Use campo=valor em cada linha.");
                return [x.slice(0, i).trim(), x.slice(i + 1).trim()];
              }),
          );
          done(
            await api<Contact>(
              contact ? "contacts/" + contact.id : "contacts",
              contact ? "PATCH" : "POST",
              {
                name: field(f, "name"),
                phone: field(f, "phone"),
                tags: field(f, "tags")
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean),
                attributes,
              },
            ),
          );
        } catch (e) {
          setError(message(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Notice text={error} />
      <div className="field-row">
        <label>
          Nome
          <input
            name="name"
            defaultValue={contact?.name}
            maxLength={160}
            placeholder="Nome do contato"
          />
        </label>
        <label>
          Telefone
          <input
            name="phone"
            defaultValue={contact?.phone}
            readOnly={!!contact}
            type="tel"
            required
            maxLength={30}
            placeholder="+55 (11) 90000-0000"
          />
        </label>
      </div>
      <label>
        Etiquetas
        <input
          name="tags"
          defaultValue={contact?.tags.join(", ")}
          placeholder="Separe as etiquetas por vírgula"
        />
      </label>
      <label>
        Campos personalizados
        <textarea
          name="attributes"
          rows={3}
          defaultValue={Object.entries(contact?.attributes ?? {})
            .map(([k, v]) => k + "=" + v)
            .join("\n")}
          placeholder="cidade=São Paulo"
        />
      </label>
      <div className="actions">
        <button className="primary" disabled={busy}>
          {contact ? "Salvar alterações" : "Cadastrar contato"}
        </button>
      </div>
    </form>
  );
}
function ImportForm({ done }: { done: () => void }) {
  const [preview, setPreview] = useState<Preview>(),
    [error, setError] = useState(""),
    [ok, setOk] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const file = f.get("file");
          setBusy(true);
          setError("");
          setPreview(undefined);
          setOk("");
          try {
            if (!(file instanceof File) || !file.size || file.size > 2_000_000)
              throw Error("Selecione um arquivo de até 2 MB.");
            const data = await new Promise<string>((resolve, reject) => {
              const r = new FileReader();
              r.onload = () => resolve(String(r.result).split(",")[1]);
              r.onerror = () =>
                reject(Error("Não foi possível ler o arquivo."));
              r.readAsDataURL(file);
            });
            setPreview(
              await api<Preview>("imports/contacts/preview", "POST", {
                filename: file.name,
                data,
                phoneColumn: Number(field(f, "phone")),
                nameColumn: Number(field(f, "name")),
              }),
            );
          } catch (e) {
            setError(message(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Planilha de contatos
          <input type="file" name="file" accept=".csv,.xlsx" required />
        </label>
        <div className="field-row">
          <label>
            Posição da coluna de telefone
            <input
              type="number"
              name="phone"
              defaultValue={1}
              min={1}
              max={50}
              required
            />
          </label>
          <label>
            Posição da coluna de nome (0 para ignorar)
            <input
              type="number"
              name="name"
              defaultValue={2}
              min={0}
              max={50}
              required
            />
          </label>
        </div>
        <p className="footnote">
          A primeira linha deve ter os cabeçalhos. Até 500 registros por
          arquivo. O consentimento é registrado separadamente.
        </p>
        <div className="actions">
          <button disabled={busy} className="primary">
            Gerar prévia
          </button>
        </div>
      </form>
      <Notice text={error} />
      <Notice text={ok} good />
      {preview && (
        <div className="import-results">
          <h3>
            {preview.valid} de {preview.rows.length} registros disponíveis para
            importar
          </h3>
          <p className="footnote">Colunas: {preview.columns.join(" · ")}</p>
          <Table headers={["Linha", "Nome", "Telefone", "Validação"]}>
            {preview.rows.map((r) => (
              <tr key={r.row}>
                <td>{r.row}</td>
                <td>{r.name ?? "—"}</td>
                <td>{r.phone ?? "—"}</td>
                <td>
                  <Status value={r.status} />
                </td>
              </tr>
            ))}
          </Table>
          <button
            className="primary"
            disabled={!preview.valid || busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const r = await api<{ created: number; ignored: number }>(
                  "imports/contacts/" + preview.id + "/commit",
                  "POST",
                );
                setOk(
                  r.created +
                    " contatos incluídos. " +
                    r.ignored +
                    " linhas ignoradas.",
                );
                setPreview(undefined);
                done();
              } catch (e) {
                setError(message(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Confirmar importação
          </button>
        </div>
      )}
    </>
  );
}
export function Contacts() {
  const [mode, setMode] = useState<"add" | "import" | "">(""),
    [q, setQ] = useState(""),
    [filter, setFilter] = useState("all"),
    [tag, setTag] = useState(""),
    [page, setPage] = useState(1);
  const data = useData<ContactList>(
    "contacts?" +
      new URLSearchParams({
        q,
        status: filter,
        page: String(page),
        ...(tag ? { tag } : {}),
      }),
  );
  return (
    <>
      <Heading
        title="Contatos"
        subtitle="Gerencie cadastros, consentimentos e supressões."
        actions={
          <>
            <button
              onClick={() => setMode(mode === "import" ? "" : "import")}
              aria-expanded={mode === "import"}
            >
              <Upload size={16} /> Importar
            </button>
            <button
              className="primary"
              onClick={() => setMode(mode === "add" ? "" : "add")}
              aria-expanded={mode === "add"}
            >
              <Plus size={16} /> Novo contato
            </button>
          </>
        }
      />
      {mode && (
        <section className="panel form-panel">
          <h2>{mode === "add" ? "Novo contato" : "Importar contatos"}</h2>
          {mode === "add" ? (
            <ContactForm
              done={() => {
                setMode("");
                data.refresh();
              }}
            />
          ) : (
            <ImportForm done={data.refresh} />
          )}
        </section>
      )}
      <Notice text={data.error} />
      <section className="panel">
        <div className="panel-title search-row">
          <label className="search">
            <Search size={16} />
            <input
              aria-label="Buscar por nome ou telefone"
              placeholder="Buscar nome ou telefone"
              value={q}
              onChange={(e) => {
                setPage(1);
                setQ(e.target.value);
              }}
            />
          </label>
          <input
            aria-label="Filtrar por etiqueta"
            placeholder="Etiqueta"
            value={tag}
            onChange={(e) => {
              setPage(1);
              setTag(e.target.value);
            }}
          />
          <select
            aria-label="Consentimento"
            value={filter}
            onChange={(e) => {
              setPage(1);
              setFilter(e.target.value);
            }}
          >
            <option value="all">Todos os estados</option>
            <option value="eligible">Elegíveis</option>
            <option value="no-consent">Sem consentimento</option>
            <option value="blocked">Suprimidos</option>
          </select>
        </div>
        {!data.value ? (
          <Loading />
        ) : data.value.items.length ? (
          <Table headers={["Nome", "Telefone", "Consentimento", "Etiquetas"]}>
            {data.value.items.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={"/contacts/" + c.id}>{c.name || "Sem nome"}</Link>
                </td>
                <td>{c.phone}</td>
                <td>
                  <Status value={c.status} />
                </td>
                <td>{c.tags.join(", ") || "—"}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty
            title="Nenhum contato encontrado"
            description="Altere os filtros ou cadastre um contato."
          />
        )}
        <Pager
          page={page}
          set={setPage}
          more={page * 50 < (data.value?.total ?? 0)}
        />
        {data.value?.limited && (
          <p className="footnote inset">
            A consulta foi limitada aos 5.001 registros mais recentes. Refine os
            filtros.
          </p>
        )}
      </section>
    </>
  );
}
export function ContactView({ id }: { id: string }) {
  const router = useRouter();
  const {
    value: c,
    error,
    refresh,
  } = useData<Contact>("contacts/" + encodeURIComponent(id));
  const [feedback, setFeedback] = useState(""),
    [failure, setFailure] = useState(""),
    [action, setAction] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <Link className="back" href="/contacts">
        <ArrowLeft size={16} /> Contatos
      </Link>
      <Heading
        title={c?.name || "Dados do contato"}
        subtitle={c?.phone ?? "Cadastro e histórico de consentimento"}
      />
      <Notice text={error || failure} />
      <Notice good text={feedback} />
      {!c ? (
        <Loading />
      ) : (
        <>
          <section className="panel form-panel">
            <h2>Cadastro</h2>
            <ContactForm
              contact={c}
              done={() => {
                setFeedback("Alterações salvas.");
                refresh();
              }}
            />
          </section>
          <section className="panel form-panel">
            <h2>Consentimento para marketing</h2>
            {c.suppression ? (
              <Notice text="Número suprimido. Reimportar o contato não remove a supressão." />
            ) : (
              <form
                className="form-grid"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  setBusy(true);
                  setFailure("");
                  setFeedback("");
                  try {
                    await api("contacts/" + id + "/consent", "POST", {
                      source: field(f, "source"),
                      evidence: field(f, "evidence"),
                      confirmed: f.has("confirmed"),
                    });
                    e.currentTarget?.reset();
                    refresh();
                    setFeedback("Consentimento registrado.");
                  } catch (e) {
                    setFailure(message(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <div className="field-row">
                  <label>
                    Origem
                    <input
                      name="source"
                      required
                      minLength={3}
                      maxLength={150}
                    />
                  </label>
                  <label>
                    Evidência ou referência
                    <input
                      name="evidence"
                      required
                      minLength={5}
                      maxLength={1500}
                    />
                  </label>
                </div>
                <label className="check">
                  <input name="confirmed" type="checkbox" required /> O titular
                  autorizou mensagens promocionais.
                </label>
                <div className="actions">
                  <button className="primary" disabled={busy}>
                    Registrar autorização
                  </button>
                </div>
              </form>
            )}
            {!!c.consents?.length && (
              <Table
                headers={["Origem", "Evidência", "Registrado", "Revogado"]}
              >
                {c.consents.map((x) => (
                  <tr key={x.id}>
                    <td>{x.source}</td>
                    <td className="message-cell">{x.evidence}</td>
                    <td>{date(x.grantedAt)}</td>
                    <td>{date(x.revokedAt)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </section>
          <section className="panel form-panel">
            <h2>Privacidade</h2>
            <p>Bloqueie próximos envios ou remova os dados de identificação.</p>
            {!action ? (
              <div className="actions">
                {!c.suppression && (
                  <button onClick={() => setAction("suppress")}>
                    Suprimir contato
                  </button>
                )}
                <button className="danger" onClick={() => setAction("erase")}>
                  Apagar dados do contato
                </button>
              </div>
            ) : (
              <div className="confirm">
                <p>
                  {action === "erase"
                    ? "Apagar os dados de identificação e manter o bloqueio de futuros envios?"
                    : "Revogar o consentimento e bloquear este número para campanhas?"}
                </p>
                <div className="actions">
                  <button onClick={() => setAction("")}>Voltar</button>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setFailure("");
                      try {
                        if (action === "erase") {
                          await api("contacts/" + id, "DELETE");
                          router.replace("/contacts");
                        } else {
                          await api("contacts/" + id + "/opt-out", "POST");
                          refresh();
                          setAction("");
                          setFeedback("Contato suprimido.");
                        }
                      } catch (e) {
                        setFailure(message(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Confirmar
                  </button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
