import { loadConfig } from "@papervine/renderer/lib/content";
import { buildNav } from "@papervine/renderer/lib/nav";
import { Navbar } from "@papervine/renderer/components/Navbar";
import { NavTabs } from "@papervine/renderer/components/NavTabs";
import { Sidebar } from "@papervine/renderer/components/Sidebar";
import { Assistant } from "@/components/assistant/Assistant";
import { AskAssistantButton } from "@/components/assistant/AskAssistantButton";
import { SearchButton } from "@papervine/renderer/components/SearchDialog";

// The public docs chrome. Lives in the (docs) route group so the control plane
// (app) and auth pages don't inherit the nav/sidebar/assistant.
export default async function DocsLayout({ children }: { children: React.ReactNode }) {
  const config = await loadConfig();
  const sections = await buildNav(config);

  return (
    <>
      <Navbar config={config} search={<SearchButton track />} assistant={<AskAssistantButton />} />
      <NavTabs sections={sections} />
      <div className="mx-auto flex max-w-7xl gap-8 pl-9 pr-6">
        <Sidebar sections={sections} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <Assistant />
    </>
  );
}
