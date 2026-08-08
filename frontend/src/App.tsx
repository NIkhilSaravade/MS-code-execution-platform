// App.tsx is the top-level component that decides WHICH PAGE to show
// based on the current URL. This is where our "routes" (URL -> page
// component mapping) are defined.

import { Route, Routes } from 'react-router-dom';
// Routes = a container that looks at the current URL and renders the ONE
// child <Route> that matches it.
// Route = a single "if the URL is X, render component Y" rule.

import LandingPage from './pages/LandingPage';
import PracticePage from './pages/PracticePage';
import SolvePage from './pages/SolvePage';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import ProtectedRoute from './components/shared/ProtectedRoute';
import PublicOnlyRoute from './components/shared/PublicOnlyRoute';
// These are our "page" components, each living in src/pages/.
// A "page" is not a special React concept — it's just a regular component
// that we've chosen to treat as a full screen.

// Every component in React is a function. By convention it's named with a
// capital letter (App, not app) — React uses the capitalization to tell
// custom components apart from built-in HTML tags like <div>.
function App() {
  // The `return` value of a component is JSX: it describes what should
  // appear on screen. A component can only return ONE root element, which
  // is why everything here is wrapped in <Routes>.
  return (
    <Routes>
      {/* path="/" matches the site root (e.g. http://localhost:5173/)
          element={<LandingPage />} says "render this component when it matches".
          PublicOnlyRoute bounces already-logged-in visitors to /practice —
          the only way back to the landing page is to log out first. */}
      <Route
        path="/"
        element={
          <PublicOnlyRoute>
            <LandingPage />
          </PublicOnlyRoute>
        }
      />

      {/* Matches http://localhost:5173/practice exactly. Wrapped in
          ProtectedRoute — logged-out visitors get bounced to /login. */}
      <Route
        path="/practice"
        element={
          <ProtectedRoute>
            <PracticePage />
          </ProtectedRoute>
        }
      />

      {/* The `:slug` part is a URL PARAMETER — a placeholder. It matches
          anything, e.g. /practice/two-sum or /practice/lru-cache.
          Inside SolvePage, useParams() reads out whatever was in that slot.
          Also protected — same login requirement as /practice. */}
      <Route
        path="/practice/:slug"
        element={
          <ProtectedRoute>
            <SolvePage />
          </ProtectedRoute>
        }
      />

      {/* Auth pages. Both redirect to /practice on success — see
          LoginPage/SignupPage's navigate() calls. Also wrapped in
          PublicOnlyRoute: no reason to show a login form to someone
          who's already logged in. */}
      <Route
        path="/login"
        element={
          <PublicOnlyRoute>
            <LoginPage />
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/signup"
        element={
          <PublicOnlyRoute>
            <SignupPage />
          </PublicOnlyRoute>
        }
      />
    </Routes>
  );
}

// `export default` makes this the "main export" of the file, so other
// files can do `import App from './App.tsx'` (no curly braces needed).
export default App;
