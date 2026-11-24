import { Suspense } from "react";
import { RecipeEditorPage } from "@/components/recipe-editor";
import { Loading } from "@/components/ui";

export default function MenuEditPage() {
  return (
    <Suspense fallback={<Loading />}>
      <RecipeEditorPage kind="menu" />
    </Suspense>
  );
}
