// This is the ENTRY POINT of the whole app — the first file that runs.
// Vite's index.html has <script type="module" src="/src/main.tsx"></script>,
// which is what loads this file in the browser.

import { StrictMode } from 'react'
// StrictMode is a React dev-only helper. It doesn't render anything visible —
// it just makes React double-invoke some functions (like component bodies)
// in development to help you catch bugs (e.g. code with side effects that
// shouldn't be there). It has zero effect in production builds.

import { createRoot } from 'react-dom/client'
// react-dom is the "renderer" that knows how to turn React components into
// real DOM nodes in a browser. createRoot() is the modern (React 18+) API
// for telling React "this DOM element is yours to manage."

import { BrowserRouter } from 'react-router-dom'
// react-router-dom is a third-party library that adds "pages"/URLs to a
// React app (React itself has no built-in router). BrowserRouter uses the
// browser's real URL bar (e.g. /practice) and History API to switch which
// component is shown, instead of a full page reload.

import './index.css'
// Importing a .css file here means Vite bundles it and injects a <style>
// tag / <link> into the page. This is global CSS that applies everywhere.

import App from './App.tsx'
// Import our own top-level component. In React, "components" are just
// functions that return JSX (the HTML-like syntax you'll see everywhere).

import { AuthProvider } from './context/AuthContext.tsx'
// AuthProvider makes login state (useAuth()) available to every component
// in the tree below it — it has to wrap <App/>, not live inside it, so
// that even top-level routing decisions could see it if needed later.

// document.getElementById('root') grabs the <div id="root"></div> from
// index.html. The `!` after it is TypeScript syntax meaning "trust me,
// this is not null" (normally getElementById can return null).
createRoot(document.getElementById('root')!).render(
  // .render(...) takes JSX and mounts it into that DOM element.
  // JSX looks like HTML but it's actually JavaScript — <StrictMode> here
  // is really calling React.createElement(StrictMode, ...) under the hood.
  <StrictMode>
    <BrowserRouter>
      {/* Everything inside BrowserRouter can now use routing features
          like <Link>, <Routes>, useNavigate(), useParams(), etc.
          Think of it as "turning on" the URL-awareness for the app. */}
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
