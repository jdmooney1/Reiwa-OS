// `server-only` throws on import outside a React Server Component bundle, which
// is exactly what makes it a useful guard in the application - and exactly why
// a Node-based unit test cannot import it. Aliased here so the modules that
// carry the guard stay unit-testable, while the guard itself remains real in
// the Next.js build.
export {};
