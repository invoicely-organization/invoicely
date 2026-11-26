// The address of the api. Vite fills VITE_API_URL at build time: on staging render.yaml gives it; locally the api of
// `pnpm dev` is on port 3000.
export const apiBaseUrl: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
