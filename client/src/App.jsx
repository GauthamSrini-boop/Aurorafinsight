import { Redirect, Router, useRouter } from './lib/router.jsx';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { AppShell } from './components/AppShell.jsx';
import { PageLoading } from './components/ui.jsx';
import { LoginPage, RegisterPage } from './pages/AuthPages.jsx';
import { DashboardPage } from './pages/Dashboard.jsx';
import { TransactionsPage } from './pages/Transactions.jsx';
import { AnalyticsPage } from './pages/Analytics.jsx';
import { BudgetsPage } from './pages/Budgets.jsx';
import { GoalsPage } from './pages/Goals.jsx';
import { SmartSavePage } from './pages/SmartSave.jsx';
import { SettingsPage } from './pages/Settings.jsx';
import { NotFoundPage } from './pages/NotFound.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';

const PROTECTED = {
  '/dashboard': DashboardPage, '/transactions': TransactionsPage, '/analytics': AnalyticsPage,
  '/budgets': BudgetsPage, '/goals': GoalsPage, '/smartsave': SmartSavePage, '/settings': SettingsPage,
};
const PUBLIC = { '/login': LoginPage, '/register': RegisterPage };

function Routes() {
  const { path } = useRouter();
  const { status } = useAuth();
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;
  if (status === 'loading') return <PageLoading label="Loading Aurora FinSight…" />;
  if (status === 'anon') {
    const Page = PUBLIC[clean];
    if (!Page) return <Redirect to="/login" />;
    document.title = `${clean === '/login' ? 'Sign in' : 'Create account'} · Aurora FinSight`;
    return <Page />;
  }
  if (clean === '/' || PUBLIC[clean]) return <Redirect to="/dashboard" />;
  const Page = PROTECTED[clean] ?? NotFoundPage;
  return <AppShell><ErrorBoundary key={clean}><Page /></ErrorBoundary></AppShell>;
}

export default function App() {
  return (
    <Router>
      <ToastProvider>
        <AuthProvider>
          <Routes />
        </AuthProvider>
      </ToastProvider>
    </Router>
  );
}
