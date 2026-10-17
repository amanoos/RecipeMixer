import { Link, Route, Routes } from 'react-router';
import { Layout } from '@/components/Layout';
import { buttonVariants } from '@/components/ui/button';
import { MatchPage } from '@/pages/MatchPage';
import { RecipeDetailPage } from '@/pages/RecipeDetailPage';
import { RecipeFormPage } from '@/pages/RecipeFormPage';
import { RecipeListPage } from '@/pages/RecipeListPage';

function NotFoundPage() {
  return (
    <div className="space-y-3 py-16 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <Link to="/" className={buttonVariants({ variant: 'outline' })}>
        Back to your recipes
      </Link>
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<RecipeListPage />} />
        <Route path="match" element={<MatchPage />} />
        <Route path="recipes/new" element={<RecipeFormPage />} />
        <Route path="recipes/:id" element={<RecipeDetailPage />} />
        <Route path="recipes/:id/edit" element={<RecipeFormPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default App;
