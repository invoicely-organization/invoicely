import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { apiBaseUrl } from './config';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('index.html has no #root element');
}
// Shows in the page which api this build talks to, so a deploy can be checked without devtools.
container.dataset['apiUrl'] = apiBaseUrl;

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
