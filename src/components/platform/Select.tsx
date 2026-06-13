// The platform Select now lives in the shadcn primitives layer (a native <select> styled
// in the `.db` language — native is the mobile-friendly choice: OS picker, no clipping
// popovers). Re-exported here so existing `@/components/platform/Select` imports keep
// working. See src/components/ui/select.tsx for the rationale.
export { Select } from "@/components/ui/select";
