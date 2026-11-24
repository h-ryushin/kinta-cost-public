import { Suspense } from "react";
import { RecipeEditorPage } from "@/components/recipe-editor";
import { Loading } from "@/components/ui";

export default function DraftEditPage() {
  return (
    <Suspense fallback={<Loading />}>
      <RecipeEditorPage kind="draft" />
    </Suspense>
  );
}
