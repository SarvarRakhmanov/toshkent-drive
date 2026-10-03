// Prefix a public/ path with the deploy base path (GitHub Pages project sites live under /<repo>/).
export function asset(path: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return path.startsWith("/") ? `${base}${path}` : path;
}
