"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  ChartNoAxesColumn,
  ChevronRight,
  ClipboardList,
  ContactRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MessagesSquare,
  Radio,
  Send,
  Settings,
  X,
} from "lucide-react";
import { api, ApiError, field, message } from "./client";
import { Loading, Notice } from "./components";
import { Overview, Logs, InboxView, SettingsView } from "./overview";
import { Contacts, ContactView } from "./contacts-ui";
import { Connections, ConnectionView } from "./connections-ui";
import { Campaigns, CampaignView, Templates } from "./campaigns-ui";

const nav = [
  ["dashboard", "Visão geral", LayoutDashboard],
  ["connections", "Conexões", Radio],
  ["contacts", "Contatos", ContactRound],
  ["campaigns", "Campanhas", Send],
  ["templates", "Modelos", BookOpen],
  ["inbox", "Recebidas", MessagesSquare],
  ["reports", "Relatórios", ChartNoAxesColumn],
  ["logs", "Auditoria", ClipboardList],
  ["settings", "Configurações", Settings],
] as const;
function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <Activity size={23} />
      </div>
      <div>
        <strong>WhatsApp Hub</strong>
        <small>Central de operações</small>
      </div>
    </div>
  );
}
export function Console({ section, item }: { section: string; item: string }) {
  const router = useRouter();
  const [admin, setAdmin] = useState<{ email: string }>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState(false);
  useEffect(() => {
    let current = true;
    if (section === "login") return;
    api<{ email: string }>("auth/me")
      .then((a) => {
        if (current) setAdmin(a);
      })
      .catch((e) => {
        if (!current) return;
        if (e instanceof ApiError && e.status === 401) {
          setAdmin(undefined);
          router.replace("/login");
        } else setError(message(e));
      });
    return () => {
      current = false;
    };
  }, [section, router]);
  if (section === "login")
    return (
      <main className="login-shell">
        <div className="login-side">
          <Brand />
          <p>Contatos, campanhas e descadastros no mesmo lugar.</p>
          <div className="login-signal" aria-hidden="true">
            <Activity size={170} strokeWidth={0.45} />
          </div>
          <small>PAINEL PRIVADO</small>
        </div>
        <div className="login-content">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              setError("");
              try {
                await api("auth/login", "POST", {
                  email: field(f, "email"),
                  password: field(f, "password"),
                });
                router.replace("/dashboard");
              } catch (err) {
                setError(message(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <h1>Entrar no painel</h1>
            <p>Use as credenciais da sua conta administrativa.</p>
            <Notice text={error} />
            <label>
              E-mail
              <input
                name="email"
                type="email"
                required
                autoComplete="username"
              />
            </label>
            <label>
              Senha
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? "Entrando…" : "Entrar"} <ArrowUpRight size={16} />
            </button>
          </form>
        </div>
      </main>
    );
  if (!admin)
    return (
      <main className="gate">
        <Brand />
        {error ? (
          <>
            <Notice text={error} />
            <button onClick={() => window.location.reload()}>
              Tentar novamente
            </button>
          </>
        ) : (
          <Loading />
        )}
      </main>
    );
  const page = nav.find((x) => x[0] === section)?.[1] ?? "Visão geral";
  return (
    <div className="shell">
      <a className="skip" href="#conteudo">
        Ir ao conteúdo
      </a>
      {menu && (
        <button
          aria-label="Fechar navegação"
          className="scrim"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={"sidebar " + (menu ? "open" : "")}>
        <Brand />
        <button
          className="mobile-close"
          aria-label="Fechar menu"
          onClick={() => setMenu(false)}
        >
          <X size={20} />
        </button>
        <nav aria-label="Navegação principal">
          {nav.map(([key, title, Icon], i) => (
            <Link
              key={key}
              className={
                (section === key ? "selected " : "") +
                (i === 6 ? "divider" : "")
              }
              href={"/" + key}
              aria-current={section === key ? "page" : undefined}
              onClick={() => setMenu(false)}
            >
              <Icon size={17} />
              <span>{title}</span>
              {section === key && <ChevronRight size={14} />}
            </Link>
          ))}
        </nav>
        <div className="account">
          <div className="avatar">{admin.email.slice(0, 2).toUpperCase()}</div>
          <div>
            <strong>Administrador</strong>
            <small title={admin.email}>{admin.email}</small>
          </div>
          <button
            title="Sair"
            aria-label="Encerrar sessão"
            onClick={async () => {
              try {
                await api("auth/logout", "POST");
                router.replace("/login");
              } catch (e) {
                setError(message(e));
              }
            }}
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <div className="work">
        <header className="topbar">
          <button
            className="nav-button"
            aria-label="Abrir menu"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <Menu size={20} />
          </button>
          <span>Operações</span>
          <ChevronRight size={14} />
          <strong>{page}</strong>
          <span className="private">
            <i /> Acesso privado
          </span>
        </header>
        <main id="conteudo" className="content">
          <Notice text={error} />
          {section === "dashboard" ? (
            <Overview />
          ) : section === "reports" ? (
            <Overview report />
          ) : section === "contacts" ? (
            item ? (
              <ContactView id={item} />
            ) : (
              <Contacts />
            )
          ) : section === "connections" ? (
            item ? (
              <ConnectionView id={item} />
            ) : (
              <Connections />
            )
          ) : section === "campaigns" ? (
            item === "new" ? (
              <Campaigns key="new" startNew />
            ) : item ? (
              <CampaignView key={item} id={item} />
            ) : (
              <Campaigns />
            )
          ) : section === "templates" ? (
            <Templates />
          ) : section === "inbox" ? (
            <InboxView />
          ) : section === "settings" ? (
            <SettingsView />
          ) : (
            <Logs />
          )}
        </main>
      </div>
    </div>
  );
}
