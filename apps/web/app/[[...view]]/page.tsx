import { notFound, redirect } from "next/navigation";
import { Console } from "../console";
const routes = [
  "login",
  "dashboard",
  "connections",
  "contacts",
  "templates",
  "campaigns",
  "inbox",
  "reports",
  "logs",
  "settings",
];
export default async function Page({
  params,
}: {
  params: Promise<{ view?: string[] }>;
}) {
  const { view } = await params;
  if (!view?.length) redirect("/dashboard");
  if (
    view.length > 2 ||
    !routes.includes(view[0]) ||
    (view.length === 2 &&
      !["contacts", "campaigns", "connections"].includes(view[0]))
  )
    notFound();
  return <Console section={view[0]} item={view[1] ?? ""} />;
}
