import { describe, it, expect } from "vitest";
import {
  agentCard,
  agentSkillsIndex,
  parseSkill,
  publicSkills,
  skillDigest,
  skillsIndex,
  slugifySkillName,
  type Skill,
} from "@/lib/skills";

const file = (front: string, body = "Body.") => `---\n${front}\n---\n\n${body}\n`;

describe("slugifySkillName", () => {
  it("makes a URL-safe slug", () => {
    expect(slugifySkillName("Papervine Starter")).toBe("papervine-starter");
    expect(slugifySkillName("  Payments & Billing!  ")).toBe("payments-billing");
    expect(slugifySkillName("already-fine")).toBe("already-fine");
  });
});

describe("parseSkill", () => {
  it("reads the frontmatter and keeps the file verbatim", () => {
    const raw = file('name: Payments\ndescription: Take money.');
    const skill = parseSkill(raw, "fallback")!;
    expect(skill.name).toBe("Payments");
    expect(skill.slug).toBe("payments");
    expect(skill.description).toBe("Take money.");
    // Verbatim, frontmatter included: agents fetching the file expect the metadata with it.
    expect(skill.raw).toBe(raw);
  });

  it("falls back to the directory name when there's no `name`", () => {
    const skill = parseSkill(file("description: No name here."), "analytics")!;
    expect(skill.name).toBe("analytics");
    expect(skill.slug).toBe("analytics");
  });

  it("serves a file with broken frontmatter rather than dropping it", () => {
    // A skill that silently vanishes from the index is worse than one with a plain name.
    const skill = parseSkill("---\nname: [unclosed\n---\n\nStill useful.\n", "payments");
    expect(skill).not.toBeNull();
    expect(skill!.slug).toBe("payments");
  });

  it("ignores an empty file", () => {
    expect(parseSkill("   \n", "x")).toBeNull();
  });

  it("caps the description at 1024 characters", () => {
    const skill = parseSkill(file(`description: ${"x".repeat(2000)}`), "x")!;
    expect(skill.description).toHaveLength(1024);
  });
});

describe("publicSkills", () => {
  it("keeps skills with no groups", () => {
    const skill = parseSkill(file("name: Open"), "open")!;
    expect(publicSkills([skill])).toHaveLength(1);
  });

  it("withholds a group-restricted skill entirely", () => {
    // These endpoints carry no reader session, so there is no safe partial version to serve.
    const skill = parseSkill(file("name: Internal\ngroups:\n  - admin"), "internal")!;
    expect(publicSkills([skill])).toEqual([]);
  });

  it("fails closed when `groups` isn't a list of strings", () => {
    const skill = parseSkill(file("name: Odd\ngroups: true"), "odd")!;
    expect(publicSkills([skill])).toEqual([]);
  });
});

describe("discovery documents", () => {
  const skills: Skill[] = [
    { slug: "payments", name: "Payments", description: "Take money.", raw: "one", groups: [] },
    { slug: "analytics", name: "Analytics", description: "Count things.", raw: "two", groups: [] },
  ];

  it("the agent-skills index carries a verifiable digest per skill", () => {
    const index = agentSkillsIndex(skills);
    expect(index.$schema).toBe("https://schemas.agentskills.io/discovery/0.2.0/schema.json");
    expect(index.skills[0]).toEqual({
      name: "payments",
      type: "skill-md",
      description: "Take money.",
      url: "/.well-known/agent-skills/payments/SKILL.md",
      digest: skillDigest("one"),
    });
    expect(index.skills[0].digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("the digest is over the file bytes, so a changed file changes it", () => {
    expect(skillDigest("one")).not.toBe(skillDigest("one "));
  });

  it("the legacy index lists the same skills in the older shape", () => {
    expect(skillsIndex(skills).skills[1]).toEqual({
      name: "analytics",
      description: "Count things.",
      files: ["SKILL.md"],
    });
  });
});

describe("agentCard", () => {
  const card = agentCard({
    origin: "https://docs.example.com/",
    title: "Example Docs",
    description: "How to use Example.",
    skills: [
      { slug: "payments", name: "Payments", description: "Take money.", raw: "x", groups: [] },
    ],
  });

  it("advertises the A2A shape clients negotiate on", () => {
    expect(card.protocolVersion).toBe("0.3");
    expect(card.preferredTransport).toBe("HTTP+JSON");
    expect(card.capabilities).toEqual({ streaming: false, pushNotifications: false });
    expect(card.provider).toEqual({
      url: "https://docs.example.com",
      organization: "Example Docs",
    });
  });

  it("uses ABSOLUTE skill urls — the card gets copied around by agents", () => {
    expect(card.skills[0].url).toBe(
      "https://docs.example.com/.well-known/agent-skills/payments/SKILL.md",
    );
  });

  it("normalizes a trailing slash on the origin rather than doubling it", () => {
    expect(card.url).toBe("https://docs.example.com");
  });
});
