# invoicely

Счетоводна и фактурираща платформа за български счетоводители. Продуктовото repo: web, API, домейн ядро, база, тестове и CI.

## Локално пускане

Нужни са Node 22 и pnpm 10.34.9. След `pnpm install` една команда пуска web и API:

```sh
pnpm dev
```

Web (Vite) е на http://localhost:5173 и показва празна страница. API (NestJS) е на http://localhost:3000: `GET /health` връща 200, а маршрутите са под `/api/v1`.

Проверките на CI: `pnpm typecheck`, `pnpm lint`, `pnpm test`. Картата на repo-то и правилата са в `CLAUDE.md`.

## Staging

Staging е в Render, по ADR-013 (Хостинг, данни и операции). Услугите са описани в `render.yaml` (Render Blueprint):

- web: https://invoicely-web.onrender.com (static site, раздава се през CDN на Render);
- api: https://invoicely-api-maco.onrender.com (web service от `Dockerfile`, регион Франкфурт, план `free`), `GET /health`.

Нов деплой: всяко сливане в `main` пуска сам деплой на двете услуги до няколко минути; ръчна стъпка няма. Web взима
адреса на api от `VITE_API_URL`, а api приема заявки (CORS) само от `WEB_ORIGIN`; и двете са в `render.yaml`. Ако
Render даде друг адрес на услуга, той се сменя в `render.yaml` и тук. На план `free` api заспива след 15 минути без
заявки и първата заявка след това чака около минута. Тайните не са в `render.yaml`: те са `sync: false` и се слагат
в Render.

Агентите, които го изграждат, са в отделното repo `invoicely-agents`. Документацията (Discovery, етапи, спецификации, ADR) е в Linear.
