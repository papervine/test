// Shared layout invariant for the docs article column.
//
// The sidebar (packages/renderer/components/Sidebar.tsx) is `sticky top-28` with
// `h-[calc(100vh-7rem)]`. A sticky element is clamped by its containing block — here the
// flex row that pairs the sidebar with this article column — so the row's height is what
// decides whether the sidebar can sit at its 7rem offset at all. Let the article column be
// shorter than the sidebar and the row collapses: the sidebar can't be pushed down, drops
// to its natural flow position ~47px higher, and snaps back the moment taller content
// arrives. That was visible as a vertical jump on every sidebar click (the short-lived
// loading skeleton) and as a permanently-misplaced sidebar on genuinely short pages.
//
// Every renderer of the article row therefore carries the same minimum height — the
// article itself, the auto-generated OpenAPI endpoint page, and the loading skeleton.
// They drifted apart once; a single constant is what keeps them honest.
//
// Why `min-h-screen` and not the sidebar's own `calc(100vh-7rem)`: to render at its 7rem
// offset the sidebar needs the row to cover that offset PLUS its full height, measured
// from wherever the row starts — and the row's top moves depending on whether NavTabs
// rendered for this site. Matching the sidebar's height exactly leaves it ~47px short on a
// site with no tab bar, which is precisely the failure. A full viewport height clears the
// requirement in every shell configuration without encoding the navbar's pixel arithmetic
// here, where it would silently rot. The cost is that a very short page can scroll by the
// height of the chrome; with the gutter reserved that reads as steady, not as a jump.
export const ARTICLE_ROW = "flex min-h-screen items-start gap-10 px-8 py-10";
