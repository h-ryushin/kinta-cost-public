import { Suspense } from "react";
import { IngredientEditorPage } from "@/components/ingredient-editor";
import { Loading } from "@/components/ui";

export default function IngredientEditPage() {
  return (
    <Suspense fallback={<Loading />}>
      <IngredientEditorPage />
    </Suspense>
  );
}
