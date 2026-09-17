'use client';

import { CategoryManager } from '@/components/menu/category-manager';
import { PageHeader } from '@/components/page-header';

export default function CategoriesPage() {
  return (
    <>
      <PageHeader
        title="Categories"
        description="Menu sections, shown to customers in sort order."
      />
      <CategoryManager />
    </>
  );
}
