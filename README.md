# invoicely

Счетоводна и фактурираща платформа за български счетоводители. Продуктовото repo: web, API, домейн ядро, база, тестове и CI.

## Локално пускане

Нужни са Node 22 и pnpm 10.34.9. След `pnpm install` една команда пуска web и API:

```sh
pnpm dev
```

Web (Vite) е на http://localhost:5173 и показва празна страница. API (NestJS) е на http://localhost:3000: `GET /health` връща 200, а маршрутите са под `/api/v1`.

Проверките на CI: `pnpm typecheck`, `pnpm lint`, `pnpm test`. Картата на repo-то и правилата са в `CLAUDE.md`.

Агентите, които го изграждат, са в отделното repo `invoicely-agents`. Документацията (Discovery, етапи, спецификации, ADR) е в Linear.
