import type { Metadata } from "next";
import "./style.css";
export const metadata: Metadata = {
  title: "WhatsApp Hub | Operações",
  description: "Painel privado de campanhas e contatos autorizados.",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <div
          hidden
          dangerouslySetInnerHTML={{
            __html:
              "<!-- THESIS: Central de operações ancorada na atividade real. OWN-WORLD: caderno de expedição em tinta escura, papel quente e verde sinal. STORY: verificar a conexão, medir a fila e seguir para o trabalho. FIRST VIEWPORT: índice lateral, indicadores lineares e atividade dos envios. FORM: manifesto de expedição, 5, seed 552cd634. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md -->",
          }}
        />
        {children}
      </body>
    </html>
  );
}
