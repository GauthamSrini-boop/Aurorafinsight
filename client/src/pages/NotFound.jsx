import { Link } from '../lib/router.jsx';
import { EmptyState } from '../components/ui.jsx';

export function NotFoundPage() {
  return <EmptyState icon="search" title="Page not found" action={<Link to="/dashboard" className="btn btn-primary btn-md">Back to dashboard</Link>}>That page does not exist.</EmptyState>;
}
