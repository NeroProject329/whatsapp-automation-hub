"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { api, date, field, message, useData } from "./client";
import type { Connection } from "./client";
import { Empty, Heading, Loading, Notice, Status, Table } from "./components";
export function Connections() {
  const [adding, setAdding] = useState(false),
    [failure, setFailure] = useState(""),
    [busy, setBusy] = useState(false);
  const { value, error } = useData<Connection[]>("connections", 3000);
  const router = useRouter();
  return (
    <>
      <Heading
        title="Conexões"
        subtitle="Gerencie os remetentes e acompanhe o vínculo com o WhatsApp."
        actions={
          <button
            className="primary"
            onClick={() => setAdding(!adding)}
            aria-expanded={adding}
          >
            <Plus size={16} /> Nova conexão
          </button>
        }
      />
      <Notice text={failure || error} />
      {adding && (
        <section className="panel form-panel">
          <h2>Identificar remetente</h2>
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setFailure("");
              try {
                const c = await api<Connection>("connections", "POST", {
                  label: field(new FormData(e.currentTarget), "label"),
                });
                router.push("/connections/" + c.id);
              } catch (e) {
                setFailure(message(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Nome da conexão
              <input
                name="label"
                minLength={2}
                maxLength={80}
                required
                placeholder="Ex. Atendimento principal"
              />
            </label>
            <div className="actions">
              <button className="primary" disabled={busy}>
                Cadastrar conexão
              </button>
            </div>
          </form>
        </section>
      )}
      <section className="panel">
        {!value ? (
          <Loading />
        ) : value.length ? (
          <Table
            headers={["Remetente", "Provedor", "Situação", "Última atividade"]}
          >
            {value.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={"/connections/" + c.id}>{c.label}</Link>
                </td>
                <td>{c.provider === "fake" ? "Simulador" : c.provider}</td>
                <td>
                  <Status value={c.state} />
                </td>
                <td>{date(c.lastSeen)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty
            title="Nenhum remetente cadastrado"
            description="Crie uma conexão para preparar o pareamento."
          />
        )}
      </section>
    </>
  );
}
export function ConnectionView({ id }: { id: string }) {
  const {
    value: c,
    error,
    refresh,
  } = useData<Connection>("connections/" + encodeURIComponent(id), 2000);
  const [failure, setFailure] = useState(""),
    [busy, setBusy] = useState(false),
    [revoke, setRevoke] = useState(false),
    [ok, setOk] = useState("");
  const act = async (action: string) => {
    setBusy(true);
    setFailure("");
    setOk("");
    try {
      await api("connections/" + id + "/" + action, "POST");
      refresh();
      setRevoke(false);
      setOk("Solicitação registrada.");
    } catch (e) {
      setFailure(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Link className="back" href="/connections">
        <ArrowLeft size={16} /> Conexões
      </Link>
      <Heading
        title={c?.label ?? "Remetente"}
        subtitle="Pareamento, estado da sessão e ações do remetente."
      />
      <Notice text={failure || error} />
      <Notice good text={ok} />
      {!c ? (
        <Loading />
      ) : (
        <section className="panel form-panel">
          <dl className="settings">
            <div>
              <dt>Estado</dt>
              <dd>
                <Status value={c.state} />
              </dd>
            </div>
            <div>
              <dt>Provedor</dt>
              <dd>
                {c.provider === "fake"
                  ? "Simulador (sem WhatsApp)"
                  : c.provider}
              </dd>
            </div>
            <div>
              <dt>Número vinculado</dt>
              <dd>{c.accountPhone ?? "—"}</dd>
            </div>
            <div>
              <dt>Última atividade</dt>
              <dd>{date(c.lastSeen)}</dd>
            </div>
            <div>
              <dt>Diagnóstico</dt>
              <dd>{c.lastError ?? "—"}</dd>
            </div>
          </dl>
          {c.qr && (
            <div className="qr">
              <h3>Vincule um aparelho</h3>
              <p>
                Abra o WhatsApp no celular, escolha Aparelhos conectados e leia
                o código.
              </p>
              <img
                src={c.qr}
                width={280}
                height={280}
                alt="Código QR temporário de pareamento"
              />
            </div>
          )}
          <div className="actions">
            <button
              className="primary"
              disabled={busy || c.state === "READY" || c.desired === "REVOKE"}
              onClick={() => void act("connect")}
            >
              {c.desired === "ON" ? "Reconectar" : "Conectar"}
            </button>
            <button
              disabled={busy || c.desired !== "ON"}
              onClick={() => void act("disconnect")}
            >
              Desconectar
            </button>
            <button
              className="danger"
              disabled={busy || c.desired === "REVOKE"}
              onClick={() => setRevoke(true)}
            >
              Revogar vínculo
            </button>
          </div>
          {revoke && (
            <div className="confirm">
              <p>
                Remover as chaves de pareamento? Um novo QR será necessário.
              </p>
              <div className="actions">
                <button onClick={() => setRevoke(false)}>Voltar</button>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() => void act("revoke")}
                >
                  Confirmar revogação
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}
