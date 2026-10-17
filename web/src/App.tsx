import { Link, Route, Routes, useLocation } from 'react-router';
import { Layout } from '@/components/Layout';
import { buttonVariants } from '@/components/ui/button';
import { ImportPage } from '@/pages/ImportPage';
import { MatchPage } from '@/pages/MatchPage';
import { RecipeDetailPage } from '@/pages/RecipeDetailPage';
import { RecipeFormPage } from '@/pages/RecipeFormPage';
import { RecipeListPage } from '@/pages/RecipeListPage';
import { useDocumentTitle } from '@/lib/use-document-title';

function NotFoundPage() {
  useDocumentTitle('Page not found');
  return (
    <div className="space-y-3 py-16 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <Link to="/" className={buttonVariants({ variant: 'outline' })}>
        Back to your recipes
      </Link>
    </div>
  );
}

/** A fresh form for every navigation, so "New recipe" never keeps the values of an earlier import. */
function FormRoute() {
  return <RecipeFormPage key={useLocation().key} />;
}

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<RecipeListPage />} />
        <Route path="match" element={<MatchPage />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="recipes/new" element={<FormRoute />} />
        <Route path="recipes/:id" element={<RecipeDetailPage />} />
        <Route path="recipes/:id/edit" element={<FormRoute />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default App;
