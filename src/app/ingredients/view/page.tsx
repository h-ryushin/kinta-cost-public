import { Suspense } from "react";
import { IngredientViewPage } from "@/components/ingredient-view";
import { Loading } from "@/components/ui";

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <IngredientViewPage />
    </Suspense>
  );
}
