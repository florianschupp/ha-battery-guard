# ADR-002: React + TypeScript + Vite + Shadcn/ui for Setup Wizard

## Status

Accepted

## Context

The setup wizard needs to be an accessible, end-user-friendly single-page application that communicates with Home Assistant via its WebSocket API. The primary technical constraint is compatibility with the `home-assistant-js-websocket` library, which is the official JavaScript client for HA's WebSocket API. The wizard must support drag-and-drop for intuitive device tier assignment and run entirely client-side without a backend.

## Decision

The following stack was selected:

| Technology | Role |
|------------|------|
| **React 19** | UI framework -- chosen for direct compatibility with `home-assistant-js-websocket` (a JS/TS library designed for React-style usage) |
| **TypeScript (strict mode)** | Type safety across HA API types, wizard state, and component props |
| **Vite** | Build tool -- fast HMR in development, optimized production bundles |
| **Shadcn/ui** | UI component library -- accessible, composable, zero runtime dependencies (components are copied into the project, not imported from node_modules) |
| **Tailwind CSS** | Utility-first CSS framework -- pairs with Shadcn/ui, avoids CSS-in-JS overhead |
| **@dnd-kit** | Drag-and-drop library -- accessible, lightweight, supports keyboard interaction |

## Alternatives Considered

- **Vue.js:** No official HA WebSocket library for Vue. Would require wrapping the JS library or writing a custom client. Rejected.
- **Vanilla JavaScript:** Not maintainable for a multi-step wizard with complex state management and drag-and-drop. Rejected.
- **HA Custom Panel (Lit/Web Components):** Requires deep HA frontend knowledge, Lit framework expertise, and tight coupling to HA's build pipeline. Too complex for the scope. Rejected.
- **MUI / Ant Design:** Heavyweight runtime dependencies, opinionated styling that conflicts with HA's design language. Rejected in favor of Shadcn/ui's copy-paste model.

## Consequences

- The wizard is a standalone SPA, decoupled from HA's frontend build system.
- Shadcn/ui components live in the project source tree and can be customized freely.
- The React + TS ecosystem provides strong tooling for testing (Vitest + Testing Library) and linting (ESLint).
- Bundle size must be monitored since the wizard ships as static files served from HA's www folder.
