# E2E (Playwright) – Leitlinien

## Grundprinzip
E2E-Tests sollen wie echte Nutzer arbeiten: Seitenleisten-Navigation klicken, dann mit Web-First Assertions verifizieren, dass der erwartete Screen sichtbar ist.

## Selektoren (wichtig für Skalierung)
1. Nutze Primär-Selektoren aus Accessibility/semantischer UI, z.B.:
   - `getByRole('heading', { name: '...' })`
   - `getByRole('button', { name: '...' })`
   - `getByPlaceholder('...' )`
2. Für Icon-Buttons in der Seitenleiste:
   - `getByTitle(..., { exact: true })` (über `Sidebar.buttonByTitle`), da der Button-Text oft nicht im sichtbaren DOM steht — ohne `exact` kollidiert z. B. „Home“ mit Pfaden wie `/home/cnc/…` in anderen `title`-Attributen.
3. Vermeide fragile Selektoren:
   - CSS-Klassenketten (z.B. `className="...something..."`)
   - Pixel-/Layout-basierte Selektoren

## Empfehlung: minimale UI-Testhaken (optional später)
Für neue Features, bei denen stabile Texte/Rollen fehlen, schlagt bitte pro Element zusätzlich `data-e2e="<name>"` vor (z.B. `data-e2e="sidebar-home"`). Das macht Tests deutlich weniger empfindlich gegenüber UI-Textänderungen.

