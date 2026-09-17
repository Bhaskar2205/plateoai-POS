'use client';

import { DishManager } from '@/components/menu/dish-manager';
import { PageHeader } from '@/components/page-header';

export default function DishesPage() {
  return (
    <>
      <PageHeader
        title="Dishes"
        description="Your menu items, their prices, ingredients, nutrition and availability."
      />
      <DishManager />
    </>
  );
}
