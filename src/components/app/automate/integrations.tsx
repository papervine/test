// Catalog + brand marks for the Automate › Agent integrations gallery (SPEC §10.2).
// Scaffold data: the agent shares the §9.2 authoring backend, but none of these
// connectors are wired yet — the cards are presentational. Logos are hand-built
// inline SVGs (no brand-icon dependency; we only ship lucide-react) sized to sit on
// the dark tile the card supplies.

import type { ReactElement } from "react";

type LogoProps = { className?: string };

export type Integration = {
  id: string;
  name: string;
  category: string;
  description: string;
  Logo: (props: LogoProps) => ReactElement;
};

function Notion({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="3" y="2.5" width="18" height="19" rx="3" fill="#fff" />
      <path
        d="M8 16.5v-9l8 9v-9"
        stroke="#0d0d0d"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function GoogleDrive({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M12 3.5 5 14h7z" fill="#00AC47" />
      <path d="M12 3.5 19 14h-7z" fill="#FFBA00" />
      <path d="M5 14h14l-2.6 6.5H7.6z" fill="#2684FF" />
    </svg>
  );
}

function GoogleCalendar({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="2.5" fill="#fff" />
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5V8H4z" fill="#4285F4" />
      <text
        x="12"
        y="17"
        textAnchor="middle"
        fontSize="8.5"
        fontWeight="700"
        fontFamily="Arial, sans-serif"
        fill="#4285F4"
      >
        31
      </text>
    </svg>
  );
}

function Linear({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="4.5" fill="#5E6AD2" />
      <g stroke="#fff" strokeWidth="1.4" strokeLinecap="round">
        <path d="M7 14.5 9.5 17" />
        <path d="M7 10.5 13.5 17" />
        <path d="M8.5 7 17 15.5" />
      </g>
    </svg>
  );
}

function Slack({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#E01E5A"
        d="M5.04 15.17a2.52 2.52 0 1 1-2.52-2.52h2.52v2.52Zm1.27 0a2.52 2.52 0 0 1 5.04 0v6.31a2.52 2.52 0 0 1-5.04 0v-6.31Z"
      />
      <path
        fill="#36C5F0"
        d="M8.83 5.04a2.52 2.52 0 1 1 2.52-2.52v2.52H8.83Zm0 1.27a2.52 2.52 0 0 1 0 5.04H2.52a2.52 2.52 0 0 1 0-5.04h6.31Z"
      />
      <path
        fill="#2EB67D"
        d="M18.96 8.83a2.52 2.52 0 1 1 2.52 2.52h-2.52V8.83Zm-1.27 0a2.52 2.52 0 0 1-5.04 0V2.52a2.52 2.52 0 0 1 5.04 0v6.31Z"
      />
      <path
        fill="#ECB22E"
        d="M15.17 18.96a2.52 2.52 0 1 1-2.52 2.52v-2.52h2.52Zm0-1.27a2.52 2.52 0 0 1 0-5.04h6.31a2.52 2.52 0 0 1 0 5.04h-6.31Z"
      />
    </svg>
  );
}

function Plain({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <text
        x="4"
        y="18"
        fontSize="15"
        fontWeight="700"
        fontFamily="Georgia, 'Times New Roman', serif"
        fill="var(--fg)"
      >
        P.
      </text>
    </svg>
  );
}

function Intercom({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="4.5" fill="#1F8DED" />
      <g stroke="#fff" strokeWidth="1.5" strokeLinecap="round">
        <path d="M7.5 8.5v6" />
        <path d="M10.5 8v7.5" />
        <path d="M13.5 8v7.5" />
        <path d="M16.5 8.5v6" />
      </g>
    </svg>
  );
}

function Salesforce({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#00A1E0"
        d="M10.4 7.1a3.7 3.7 0 0 1 6.5 1.3 3.1 3.1 0 0 1-.7 6.1H8.1A3.4 3.4 0 0 1 7.3 7.7a3.7 3.7 0 0 1 3.1-.6Z"
      />
    </svg>
  );
}

function Jira({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#2684FF" d="M12 22 3 13l2.6-2.6L12 16.8l6.4-6.4L21 13z" />
      <path fill="#1868DB" d="M12 15.6 6.7 10.3 9.3 7.7 12 10.4l2.7-2.7 2.6 2.6z" />
      <path fill="#2684FF" d="M12 9.2 7.6 4.8 9.4 3l2.6 2.6L14.6 3l1.8 1.8z" />
    </svg>
  );
}

function Confluence({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#1868DB" d="M3 16.6c3.6-4.6 8.4-5.4 12.4-1.8l3.3-1.4c-4-5-10.4-5-14.6.7z" />
      <path fill="#2684FF" d="M21 7.4C17.4 12 12.6 12.8 8.6 9.2L5.3 10.6c4 5 10.4 5 14.6-.7z" />
    </svg>
  );
}

function HubSpot({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="none" stroke="#FF7A59">
      <circle cx="8.5" cy="15" r="4" strokeWidth="2" />
      <circle cx="17" cy="8.5" r="2.4" strokeWidth="2" />
      <path d="M8.5 11V6.2" strokeWidth="2" strokeLinecap="round" />
      <path d="M15 9.6 11 13" strokeWidth="2" strokeLinecap="round" />
      <circle cx="8.5" cy="4.8" r="1.6" fill="#FF7A59" stroke="none" />
    </svg>
  );
}

// Row-major order — matches the two-column layout in the reference design.
export const AVAILABLE_INTEGRATIONS: Integration[] = [
  {
    id: "notion",
    name: "Notion",
    category: "Documentation",
    description: "Pages, docs, and knowledge bases.",
    Logo: Notion,
  },
  {
    id: "google-drive",
    name: "Google Drive",
    category: "Documentation",
    description: "Files, folders, and shared drives.",
    Logo: GoogleDrive,
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    category: "Communication",
    description: "Events, schedules, and meetings.",
    Logo: GoogleCalendar,
  },
  {
    id: "linear",
    name: "Linear",
    category: "Project management",
    description: "Issues, projects, and roadmaps.",
    Logo: Linear,
  },
  {
    id: "slack",
    name: "Slack",
    category: "Communication",
    description: "Channels, messages, and DMs.",
    Logo: Slack,
  },
  {
    id: "plain",
    name: "Plain",
    category: "Customer support",
    description: "Customer support conversations.",
    Logo: Plain,
  },
  {
    id: "intercom",
    name: "Intercom",
    category: "Customer support",
    description: "Conversations and customer data.",
    Logo: Intercom,
  },
  {
    id: "salesforce",
    name: "Salesforce",
    category: "CRM",
    description: "Accounts, contacts, and opportunities.",
    Logo: Salesforce,
  },
  {
    id: "jira",
    name: "Jira",
    category: "Project management",
    description: "Issues, sprints, and projects.",
    Logo: Jira,
  },
  {
    id: "confluence",
    name: "Confluence",
    category: "Documentation",
    description: "Pages, spaces, and knowledge bases.",
    Logo: Confluence,
  },
  {
    id: "hubspot",
    name: "HubSpot",
    category: "CRM",
    description: "Contacts, companies, deals, and tickets.",
    Logo: HubSpot,
  },
];

export { Slack as SlackLogo };
